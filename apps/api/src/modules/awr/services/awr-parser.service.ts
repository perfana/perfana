/**
 * AWR Parser Service
 *
 * Orchestrates the parsing of Oracle AWR HTML reports with graceful degradation.
 * Uses the HtmlAwrParser to extract data and updates the AWR report entity
 * with parsed data and metadata.
 *
 * Key features:
 * - Graceful degradation - continues parsing even if some sections fail
 * - Extracts metadata from parsed header and updates report entity
 * - Supports both sync parsing (returns result) and async status updates
 * - Configurable parser options for debugging
 *
 * @example
 * const result = await awrParserService.parseReport(reportId);
 * if (result.success) {
 *   console.log('Parsed sections:', result.sectionsCompleted);
 * }
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AwrReport, ParseStatus } from '../entities/awr-report.entity';
import { HtmlAwrParser, type HtmlAwrParserOptions } from '../parsers';
import type {
  ParsedAwrData,
  AwrParseResult,
  AwrReportHeader,
  DatabaseInfo,
  HostInfo,
  SnapshotInfo,
} from '../types';
import {
  ResourceNotFoundException,
  DatabaseException,
} from '../../../common/exceptions/business.exception';

// ==================== Types ====================

/**
 * Options for parsing an AWR report
 */
export interface ParseAwrReportOptions {
  /** Enable debug logging for parsers */
  debug?: boolean;
  /** Include raw HTML sections in parse result (for debugging) */
  includeRawSections?: boolean;
  /** Continue parsing even if required sections fail */
  continueOnRequiredFailure?: boolean;
  /** Timeout in milliseconds for parsing */
  timeoutMs?: number;
  /** Update report status during parsing */
  updateStatus?: boolean;
}

/**
 * Result from parsing an AWR report
 */
export interface ParseReportResult {
  /** Whether parsing was successful (may be partial success) */
  success: boolean;
  /** Report ID that was parsed */
  reportId: string;
  /** Parsed data */
  parsedData?: ParsedAwrData;
  /** Extracted metadata from header */
  metadata?: ExtractedMetadata;
  /** Errors encountered */
  errors?: string[];
  /** Sections successfully parsed */
  sectionsCompleted: string[];
  /** Sections that failed to parse */
  sectionsFailed: string[];
  /** Parse duration in milliseconds */
  parseTimeMs: number;
}

/**
 * Metadata extracted from AWR report header
 */
export interface ExtractedMetadata {
  dbName?: string;
  dbId?: string;
  instanceName?: string;
  dbEdition?: string;
  dbRelease?: string;
  isRac?: boolean;
  isCdb?: boolean;
  hostName?: string;
  platform?: string;
  cpus?: number;
  cores?: number;
  sockets?: number;
  memoryGb?: number;
  snapIdBegin?: number;
  snapIdEnd?: number;
  beginTime?: Date;
  endTime?: Date;
  elapsedMinutes?: number;
  dbTimeMinutes?: number;
  sessionsBegin?: number;
  sessionsEnd?: number;
}

// ==================== Constants ====================

const DEFAULT_TIMEOUT_MS = 120000; // 2 minutes
const MAX_CONTENT_SIZE_FOR_SYNC = 50 * 1024 * 1024; // 50MB

// ==================== Service ====================

/**
 * Service for orchestrating AWR report parsing with graceful degradation
 */
@Injectable()
export class AwrParserService {
  private readonly logger = new Logger(AwrParserService.name);

  constructor(
    @InjectRepository(AwrReport)
    private readonly awrReportRepo: Repository<AwrReport>,
  ) {}

  // ==================== Public Methods ====================

  /**
   * Parse an AWR report by ID
   *
   * Retrieves the report content, parses it, extracts metadata,
   * and updates the report entity with the results.
   *
   * @param reportId - AWR report UUID
   * @param options - Optional parsing options
   * @returns Parse result with data, metadata, and status
   */
  async parseReport(
    reportId: string,
    options: ParseAwrReportOptions = {},
  ): Promise<ParseReportResult> {
    const startTime = Date.now();

    try {
      // Retrieve the report
      const report = await this.findReportById(reportId);

      // Update status to 'parsing' if requested
      if (options.updateStatus !== false) {
        await this.updateReportStatus(reportId, 'parsing');
      }

      // Get the HTML content
      const htmlContent = await this.getHtmlContent(report);

      // Validate content before parsing
      this.validateContentSize(htmlContent);

      // Parse the content
      const parseResult = await this.parseHtmlContent(htmlContent, options);

      // Extract metadata from parsed header
      const metadata = this.extractMetadata(parseResult);

      // Update the report with parsed data and metadata
      await this.updateReportWithParseResult(reportId, parseResult, metadata);

      const parseTimeMs = Date.now() - startTime;

      this.logger.log(
        `Parsed AWR report ${reportId} in ${parseTimeMs}ms ` +
        `(${parseResult.sectionsCompleted?.length || 0} sections)`,
      );

      return {
        success: parseResult.success,
        reportId,
        parsedData: parseResult.data,
        metadata,
        errors: parseResult.errors?.map(e => e.message),
        sectionsCompleted: parseResult.sectionsCompleted || [],
        sectionsFailed: parseResult.sectionsFailed || [],
        parseTimeMs,
      };
    } catch (error) {
      const parseTimeMs = Date.now() - startTime;
      const errorMessage = this.extractErrorMessage(error);

      this.logger.error(`Failed to parse AWR report ${reportId}: ${errorMessage}`);

      // Update status to failed
      if (options.updateStatus !== false) {
        await this.safeUpdateStatus(reportId, 'failed', errorMessage);
      }

      return {
        success: false,
        reportId,
        errors: [errorMessage],
        sectionsCompleted: [],
        sectionsFailed: [],
        parseTimeMs,
      };
    }
  }

  /**
   * Parse HTML content directly without database interaction
   *
   * Useful for preview/validation before saving to database.
   *
   * @param htmlContent - AWR HTML content to parse
   * @param options - Optional parsing options
   * @returns Parse result with data
   */
  async parseHtmlContent(
    htmlContent: string,
    options: ParseAwrReportOptions = {},
  ): Promise<AwrParseResult> {
    const parserOptions: HtmlAwrParserOptions = {
      debug: options.debug ?? false,
      includeRawSections: options.includeRawSections ?? false,
      continueOnRequiredFailure: options.continueOnRequiredFailure ?? true,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };

    const parser = new HtmlAwrParser(parserOptions);
    return parser.parse(htmlContent);
  }

  /**
   * Check if HTML content appears to be a valid AWR report
   *
   * @param htmlContent - HTML content to validate
   * @returns True if content appears to be an AWR report
   */
  isValidAwrReport(htmlContent: string): boolean {
    const parser = new HtmlAwrParser();
    return parser.isAwrReport(htmlContent);
  }

  /**
   * Parse report and return only metadata (faster, for preview)
   *
   * @param htmlContent - AWR HTML content to parse
   * @returns Extracted metadata or null if parsing fails
   */
  async parseMetadataOnly(htmlContent: string): Promise<ExtractedMetadata | null> {
    try {
      const parser = new HtmlAwrParser({
        debug: false,
        continueOnRequiredFailure: false,
      });

      const result = parser.parse(htmlContent);

      if (!result.success || !result.data?.header) {
        return null;
      }

      return this.extractMetadataFromHeader(result.data.header);
    } catch {
      return null;
    }
  }

  /**
   * Re-parse an existing report (for updates or version upgrades)
   *
   * @param reportId - AWR report UUID
   * @param options - Optional parsing options
   * @returns Parse result
   */
  async reparseReport(
    reportId: string,
    options: ParseAwrReportOptions = {},
  ): Promise<ParseReportResult> {
    this.logger.log(`Re-parsing AWR report ${reportId}`);
    return this.parseReport(reportId, { ...options, updateStatus: true });
  }

  // ==================== Private Methods ====================

  /**
   * Find AWR report by ID
   */
  private async findReportById(reportId: string): Promise<AwrReport> {
    const report = await this.awrReportRepo.findOne({
      where: { id: reportId },
      select: ['id', 'rawContent', 'rawContentUrl', 'fileType'],
    });

    if (!report) {
      throw new ResourceNotFoundException('AWR Report', reportId);
    }

    return report;
  }

  /**
   * Get HTML content from report (inline or from URL)
   */
  private async getHtmlContent(report: AwrReport): Promise<string> {
    if (report.rawContent) {
      return report.rawContent;
    }

    if (report.rawContentUrl) {
      return this.fetchContentFromUrl(report.rawContentUrl);
    }

    throw new Error('AWR report has no content (rawContent and rawContentUrl are both empty)');
  }

  /**
   * Fetch content from external URL (S3, etc.)
   */
  private async fetchContentFromUrl(url: string): Promise<string> {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch content: ${response.status} ${response.statusText}`);
      }

      return await response.text();
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      throw new Error(`Failed to fetch AWR content from URL: ${errorMessage}`);
    }
  }

  /**
   * Validate content size before parsing
   */
  private validateContentSize(content: string): void {
    const sizeBytes = Buffer.byteLength(content, 'utf8');

    if (sizeBytes > MAX_CONTENT_SIZE_FOR_SYNC) {
      this.logger.warn(
        `Large AWR content detected (${Math.round(sizeBytes / 1024 / 1024)}MB), ` +
        `parsing may be slow`,
      );
    }

    if (!content || content.trim().length === 0) {
      throw new Error('AWR report content is empty');
    }
  }

  /**
   * Extract metadata from parse result
   */
  private extractMetadata(parseResult: AwrParseResult): ExtractedMetadata | undefined {
    if (!parseResult.data?.header) {
      return undefined;
    }

    return this.extractMetadataFromHeader(parseResult.data.header);
  }

  /**
   * Extract metadata from AWR report header
   */
  private extractMetadataFromHeader(header: AwrReportHeader): ExtractedMetadata {
    const metadata: ExtractedMetadata = {};

    // Extract database info
    if (header.database) {
      this.extractDatabaseInfo(header.database, metadata);
    }

    // Extract host info
    if (header.host) {
      this.extractHostInfo(header.host, metadata);
    }

    // Extract snapshot info
    if (header.snapshot) {
      this.extractSnapshotInfo(header.snapshot, metadata);
    }

    return metadata;
  }

  /**
   * Extract database info into metadata
   */
  private extractDatabaseInfo(dbInfo: DatabaseInfo, metadata: ExtractedMetadata): void {
    if (dbInfo.dbName) metadata.dbName = dbInfo.dbName;
    if (dbInfo.dbId) metadata.dbId = dbInfo.dbId;
    if (dbInfo.instanceName) metadata.instanceName = dbInfo.instanceName;
    if (dbInfo.dbEdition) metadata.dbEdition = dbInfo.dbEdition;
    if (dbInfo.dbRelease) metadata.dbRelease = dbInfo.dbRelease;
    if (dbInfo.isRac !== undefined) metadata.isRac = dbInfo.isRac;
    if (dbInfo.isCdb !== undefined) metadata.isCdb = dbInfo.isCdb;
  }

  /**
   * Extract host info into metadata
   */
  private extractHostInfo(hostInfo: HostInfo, metadata: ExtractedMetadata): void {
    if (hostInfo.hostName) metadata.hostName = hostInfo.hostName;
    if (hostInfo.platform) metadata.platform = hostInfo.platform;
    if (hostInfo.cpus !== undefined) metadata.cpus = hostInfo.cpus;
    if (hostInfo.cores !== undefined) metadata.cores = hostInfo.cores;
    if (hostInfo.sockets !== undefined) metadata.sockets = hostInfo.sockets;
    if (hostInfo.memoryGb !== undefined) metadata.memoryGb = hostInfo.memoryGb;
  }

  /**
   * Extract snapshot info into metadata
   */
  private extractSnapshotInfo(snapInfo: SnapshotInfo, metadata: ExtractedMetadata): void {
    if (snapInfo.snapIdBegin !== undefined) metadata.snapIdBegin = snapInfo.snapIdBegin;
    if (snapInfo.snapIdEnd !== undefined) metadata.snapIdEnd = snapInfo.snapIdEnd;
    if (snapInfo.beginTime) metadata.beginTime = snapInfo.beginTime;
    if (snapInfo.endTime) metadata.endTime = snapInfo.endTime;
    if (snapInfo.elapsedMinutes !== undefined) metadata.elapsedMinutes = snapInfo.elapsedMinutes;
    if (snapInfo.dbTimeMinutes !== undefined) metadata.dbTimeMinutes = snapInfo.dbTimeMinutes;
    if (snapInfo.sessionsBegin !== undefined) metadata.sessionsBegin = snapInfo.sessionsBegin;
    if (snapInfo.sessionsEnd !== undefined) metadata.sessionsEnd = snapInfo.sessionsEnd;
  }

  /**
   * Update report with parse result and metadata
   */
  private async updateReportWithParseResult(
    reportId: string,
    parseResult: AwrParseResult,
    metadata?: ExtractedMetadata,
  ): Promise<void> {
    try {
      const updateData: Partial<AwrReport> = {
        parsedData: parseResult.data as any,
        parsedAt: new Date(),
        parseStatus: parseResult.success ? 'completed' : 'failed' as ParseStatus,
      };

      // Add error message if parsing failed
      if (!parseResult.success && parseResult.errors?.length) {
        updateData.parseError = parseResult.errors.map(e => e.message).join('; ');
      }

      // Add extracted metadata
      if (metadata) {
        Object.assign(updateData, metadata);
      }

      const result = await this.awrReportRepo.update(reportId, updateData as any);

      if (result.affected === 0) {
        throw new ResourceNotFoundException('AWR Report', reportId);
      }
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.logger.error(`Failed to update report ${reportId}: ${errorMessage}`);
      throw new DatabaseException('Failed to update AWR report with parse result', error);
    }
  }

  /**
   * Update report status
   */
  private async updateReportStatus(
    reportId: string,
    status: ParseStatus,
    error?: string,
  ): Promise<void> {
    try {
      const updateData: Partial<AwrReport> = { parseStatus: status };

      if (status === 'failed' && error) {
        updateData.parseError = error;
      }

      await this.awrReportRepo.update(reportId, updateData as any);
    } catch (err) {
      this.logger.warn(
        `Failed to update status for report ${reportId}: ${this.extractErrorMessage(err)}`,
      );
    }
  }

  /**
   * Safely update status (doesn't throw on failure)
   */
  private async safeUpdateStatus(
    reportId: string,
    status: ParseStatus,
    error?: string,
  ): Promise<void> {
    try {
      await this.updateReportStatus(reportId, status, error);
    } catch {
      // Ignore - status update is best-effort
    }
  }

  /**
   * Safely extract error message from unknown error type
   *
   * Uses the safe error handling pattern from CLAUDE.md
   */
  private extractErrorMessage(error: unknown): string {
    if (error && typeof error === 'object' && 'message' in error) {
      return (error as Error).message;
    }
    return 'An unexpected error occurred';
  }
}
