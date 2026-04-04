import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, ILike } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AwrReport, ParseStatus, FileType, ParsedAwrData } from '../entities/awr-report.entity';
import { AwrAnalysis, AwrInsight } from '../entities/awr-analysis.entity';
import {
  ResourceNotFoundException,
  DatabaseException,
} from '../../../common/exceptions/business.exception';
import {
  ListAwrReportsQueryDto,
  AwrReportResponseDto,
  AwrReportListItemDto,
  AwrReportListResponseDto,
  AwrReportSummaryResponseDto,
  UploadAwrReportResponseDto,
  DatabaseInfoResponseDto,
  HostInfoResponseDto,
  SnapshotInfoResponseDto,
} from '../dto';

/**
 * Options for creating a new AWR report
 */
export interface CreateAwrReportOptions {
  testRunId: string;
  fileName: string;
  fileSize: number;
  fileType: FileType;
  rawContent?: string;
  rawContentUrl?: string;
  uploadedBy: string;
  description?: string;
}

/**
 * Options for updating AWR report metadata
 */
export interface UpdateAwrReportMetadataOptions {
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

/**
 * Service for AWR Report CRUD operations
 *
 * Provides create, read, update, delete operations for AWR reports
 * using TypeORM repository pattern.
 */
@Injectable()
export class AwrReportsService {
  private readonly logger = new Logger(AwrReportsService.name);

  constructor(
    @InjectRepository(AwrReport)
    private readonly awrReportRepo: Repository<AwrReport>,
    @InjectRepository(AwrAnalysis)
    private readonly awrAnalysisRepo: Repository<AwrAnalysis>,
  ) {}

  // ========== Create Operations ==========

  /**
   * Create a new AWR report record
   * @param options - Creation options including file info and test run ID
   * @returns Upload response with new report ID and status
   */
  async create(options: CreateAwrReportOptions): Promise<UploadAwrReportResponseDto> {
    try {
      const awrReport = this.awrReportRepo.create({
        testRunId: options.testRunId,
        fileName: options.fileName,
        fileSize: options.fileSize,
        fileType: options.fileType,
        rawContent: options.rawContent,
        rawContentUrl: options.rawContentUrl,
        uploadedBy: options.uploadedBy,
        parseStatus: 'pending' as ParseStatus,
      });

      const savedReport = await this.awrReportRepo.save(awrReport);

      this.logger.log(`Created AWR report ${savedReport.id} for test run ${options.testRunId}`);

      return {
        id: savedReport.id,
        fileName: savedReport.fileName,
        fileSize: savedReport.fileSize,
        parseStatus: savedReport.parseStatus,
        message: 'AWR report uploaded successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to create AWR report: ${(error as Error).message}`);
      throw new DatabaseException('Failed to create AWR report', error);
    }
  }

  // ========== Read Operations ==========

  /**
   * Find AWR report by ID
   * @param reportId - AWR report UUID
   * @returns Full AWR report response DTO
   */
  async findById(reportId: string): Promise<AwrReportResponseDto> {
    try {
      const report = await this.awrReportRepo.findOne({
        where: { id: reportId },
      });

      if (!report) {
        throw new ResourceNotFoundException('AWR Report', reportId);
      }

      const analysis = await this.awrAnalysisRepo.findOne({
        where: { awrReportId: reportId, analysisType: 'single' },
        order: { analyzedAt: 'DESC' },
      });

      return this.mapToResponseDto(report, analysis);
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to find AWR report ${reportId}: ${(error as Error).message}`);
      throw new DatabaseException('Failed to retrieve AWR report', error);
    }
  }

  /**
   * Find AWR report entity by ID (internal use)
   * @param reportId - AWR report UUID
   * @returns Raw AWR report entity
   */
  async findEntityById(reportId: string): Promise<AwrReport> {
    try {
      const report = await this.awrReportRepo.findOne({
        where: { id: reportId },
      });

      if (!report) {
        throw new ResourceNotFoundException('AWR Report', reportId);
      }

      return report;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to find AWR report entity ${reportId}: ${(error as Error).message}`);
      throw new DatabaseException('Failed to retrieve AWR report', error);
    }
  }

  /**
   * List AWR reports for a test run with pagination and filtering
   * @param testRunId - Test run UUID
   * @param queryDto - Query parameters for filtering and pagination
   * @returns Paginated list of AWR reports
   */
  async findByTestRunId(
    testRunId: string,
    queryDto?: ListAwrReportsQueryDto,
  ): Promise<AwrReportListResponseDto> {
    try {
      const {
        parseStatus,
        dbName,
        limit = 50,
        offset = 0,
        sortBy = 'uploadedAt',
        sortOrder = 'desc',
      } = queryDto || {};

      const where: FindOptionsWhere<AwrReport> = { testRunId };

      if (parseStatus) {
        where.parseStatus = parseStatus as ParseStatus;
      }
      if (dbName) {
        where.dbName = ILike(`%${dbName}%`);
      }

      const sortFieldMap: Record<string, string> = {
        uploadedAt: 'uploadedAt',
        beginTime: 'beginTime',
        dbName: 'dbName',
        parseStatus: 'parseStatus',
      };
      const orderField = sortFieldMap[sortBy] || 'uploadedAt';

      const [reports, total] = await this.awrReportRepo.findAndCount({
        where,
        order: { [orderField]: sortOrder.toUpperCase() as 'ASC' | 'DESC' },
        skip: offset,
        take: limit,
      });

      const reportIds = reports.map(r => r.id);
      const analyses = await this.getAnalysesForReports(reportIds);

      const items = reports.map(report => this.mapToListItemDto(report, analyses.get(report.id)));

      this.logger.log(`Found ${total} AWR reports for test run ${testRunId}`);

      return {
        items,
        total,
        offset,
        limit,
      };
    } catch (error) {
      this.logger.error(`Failed to list AWR reports: ${(error as Error).message}`);
      throw new DatabaseException('Failed to list AWR reports', error);
    }
  }

  /**
   * Get summary for AWR report (for collapsed card view)
   * @param reportId - AWR report UUID
   * @returns Summary DTO with key metrics
   */
  async getSummary(reportId: string): Promise<AwrReportSummaryResponseDto> {
    try {
      const report = await this.awrReportRepo.findOne({
        where: { id: reportId },
        select: [
          'id', 'dbName', 'beginTime', 'endTime',
          'elapsedMinutes', 'dbTimeMinutes', 'parseStatus', 'parsedData',
        ],
      });

      if (!report) {
        throw new ResourceNotFoundException('AWR Report', reportId);
      }

      const analysis = await this.awrAnalysisRepo.findOne({
        where: { awrReportId: reportId, analysisType: 'single' },
        order: { analyzedAt: 'DESC' },
        select: ['insights', 'severitySummary'],
      });

      return this.mapToSummaryDto(report, analysis);
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to get AWR report summary: ${(error as Error).message}`);
      throw new DatabaseException('Failed to retrieve AWR report summary', error);
    }
  }

  /**
   * Get raw content of AWR report
   * @param reportId - AWR report UUID
   * @returns Raw HTML/text content or URL to content
   */
  async getRawContent(reportId: string): Promise<{ content?: string; url?: string }> {
    try {
      const report = await this.awrReportRepo.findOne({
        where: { id: reportId },
        select: ['id', 'rawContent', 'rawContentUrl'],
      });

      if (!report) {
        throw new ResourceNotFoundException('AWR Report', reportId);
      }

      return {
        content: report.rawContent,
        url: report.rawContentUrl,
      };
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to get raw content: ${(error as Error).message}`);
      throw new DatabaseException('Failed to retrieve raw content', error);
    }
  }

  // ========== Update Operations ==========

  /**
   * Update parse status of AWR report
   * @param reportId - AWR report UUID
   * @param status - New parse status
   * @param error - Optional error message if status is 'failed'
   */
  async updateParseStatus(
    reportId: string,
    status: ParseStatus,
    error?: string,
  ): Promise<void> {
    try {
      const updateData: Partial<AwrReport> = { parseStatus: status };

      if (status === 'completed') {
        updateData.parsedAt = new Date();
      }
      if (status === 'failed' && error) {
        updateData.parseError = error;
      }

      const result = await this.awrReportRepo.update(reportId, updateData as QueryDeepPartialEntity<AwrReport>);

      if (result.affected === 0) {
        throw new ResourceNotFoundException('AWR Report', reportId);
      }

      this.logger.log(`Updated parse status for report ${reportId} to ${status}`);
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to update parse status: ${(error as Error).message}`);
      throw new DatabaseException('Failed to update parse status', error);
    }
  }

  /**
   * Update AWR report with parsed data and metadata
   * @param reportId - AWR report UUID
   * @param parsedData - Parsed sections from AWR report
   * @param metadata - Extracted database and host metadata
   */
  async updateParsedData(
    reportId: string,
    parsedData: ParsedAwrData,
    metadata?: UpdateAwrReportMetadataOptions,
  ): Promise<void> {
    try {
      const updateData: Partial<AwrReport> = {
        parsedData,
        parseStatus: 'completed' as ParseStatus,
        parsedAt: new Date(),
      };

      if (metadata) {
        Object.assign(updateData, metadata);
      }

      const result = await this.awrReportRepo.update(reportId, updateData as QueryDeepPartialEntity<AwrReport>);

      if (result.affected === 0) {
        throw new ResourceNotFoundException('AWR Report', reportId);
      }

      this.logger.log(`Updated parsed data for report ${reportId}`);
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to update parsed data: ${(error as Error).message}`);
      throw new DatabaseException('Failed to update parsed data', error);
    }
  }

  // ========== Delete Operations ==========

  /**
   * Delete AWR report by ID
   * @param reportId - AWR report UUID
   */
  async delete(reportId: string): Promise<void> {
    try {
      const result = await this.awrReportRepo.delete(reportId);

      if (result.affected === 0) {
        throw new ResourceNotFoundException('AWR Report', reportId);
      }

      this.logger.log(`Deleted AWR report ${reportId}`);
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to delete AWR report: ${(error as Error).message}`);
      throw new DatabaseException('Failed to delete AWR report', error);
    }
  }

  /**
   * Delete all AWR reports for a test run
   * @param testRunId - Test run UUID
   * @returns Number of deleted reports
   */
  async deleteByTestRunId(testRunId: string): Promise<number> {
    try {
      const result = await this.awrReportRepo.delete({ testRunId });
      const deletedCount = result.affected || 0;

      this.logger.log(`Deleted ${deletedCount} AWR reports for test run ${testRunId}`);
      return deletedCount;
    } catch (error) {
      this.logger.error(`Failed to delete AWR reports: ${(error as Error).message}`);
      throw new DatabaseException('Failed to delete AWR reports', error);
    }
  }

  // ========== Utility Methods ==========

  /**
   * Check if test run has any AWR reports
   * @param testRunId - Test run UUID
   * @returns True if AWR reports exist
   */
  async hasReports(testRunId: string): Promise<boolean> {
    try {
      const count = await this.awrReportRepo.count({ where: { testRunId } });
      return count > 0;
    } catch (error) {
      this.logger.error(`Failed to check for reports: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Count AWR reports for test run
   * @param testRunId - Test run UUID
   * @returns Number of reports
   */
  async countByTestRunId(testRunId: string): Promise<number> {
    try {
      return await this.awrReportRepo.count({ where: { testRunId } });
    } catch (error) {
      this.logger.error(`Failed to count reports: ${(error as Error).message}`);
      return 0;
    }
  }

  /**
   * Get reports that need parsing (status = pending)
   * @param limit - Maximum number of reports to return
   * @returns List of pending AWR reports
   */
  async getPendingReports(limit: number = 10): Promise<AwrReport[]> {
    try {
      return await this.awrReportRepo.find({
        where: { parseStatus: 'pending' as ParseStatus },
        order: { uploadedAt: 'ASC' },
        take: limit,
      });
    } catch (error) {
      this.logger.error(`Failed to get pending reports: ${(error as Error).message}`);
      return [];
    }
  }

  // ========== Private Mapping Methods ==========

  /**
   * Get analyses for multiple reports (batch query)
   */
  private async getAnalysesForReports(
    reportIds: string[],
  ): Promise<Map<string, AwrAnalysis>> {
    if (reportIds.length === 0) {
      return new Map();
    }

    try {
      const analyses = await this.awrAnalysisRepo
        .createQueryBuilder('a')
        .where('a.awrReportId IN (:...reportIds)', { reportIds })
        .andWhere('a.analysisType = :type', { type: 'single' })
        .orderBy('a.analyzedAt', 'DESC')
        .getMany();

      const analysisMap = new Map<string, AwrAnalysis>();
      for (const analysis of analyses) {
        if (!analysisMap.has(analysis.awrReportId)) {
          analysisMap.set(analysis.awrReportId, analysis);
        }
      }
      return analysisMap;
    } catch (error) {
      this.logger.error(`Failed to get analyses: ${(error as Error).message}`);
      return new Map();
    }
  }

  /**
   * Map AWR report entity to full response DTO
   */
  private mapToResponseDto(
    report: AwrReport,
    analysis?: AwrAnalysis | null,
  ): AwrReportResponseDto {
    const dto: AwrReportResponseDto = {
      id: report.id,
      testRunId: report.testRunId,
      fileName: report.fileName,
      fileSize: report.fileSize,
      fileType: report.fileType,
      parseStatus: report.parseStatus,
      parseError: report.parseError,
      parsedAt: report.parsedAt,
      uploadedAt: report.uploadedAt,
      uploadedBy: report.uploadedBy,
      parsedData: report.parsedData as Record<string, unknown> | undefined,
      hasAnalysis: !!analysis,
      severitySummary: analysis?.severitySummary,
    };

    // Add database info if available
    if (report.dbName || report.dbId || report.instanceName) {
      dto.database = this.mapToDatabaseInfo(report);
    }

    // Add host info if available
    if (report.hostName || report.platform || report.cpus) {
      dto.host = this.mapToHostInfo(report);
    }

    // Add snapshot info if available
    if (report.snapIdBegin || report.beginTime || report.elapsedMinutes) {
      dto.snapshot = this.mapToSnapshotInfo(report);
    }

    return dto;
  }

  /**
   * Map AWR report entity to list item DTO (compact)
   */
  private mapToListItemDto(
    report: AwrReport,
    analysis?: AwrAnalysis | null,
  ): AwrReportListItemDto {
    return {
      id: report.id,
      testRunId: report.testRunId,
      fileName: report.fileName,
      fileSize: report.fileSize,
      dbName: report.dbName,
      beginTime: report.beginTime,
      endTime: report.endTime,
      parseStatus: report.parseStatus,
      uploadedAt: report.uploadedAt,
      severitySummary: analysis?.severitySummary,
    };
  }

  /**
   * Map AWR report to summary DTO
   */
  private mapToSummaryDto(
    report: AwrReport,
    analysis?: AwrAnalysis | null,
  ): AwrReportSummaryResponseDto {
    const dto: AwrReportSummaryResponseDto = {
      id: report.id,
      dbName: report.dbName,
      beginTime: report.beginTime,
      endTime: report.endTime,
      elapsedMinutes: report.elapsedMinutes ? Number(report.elapsedMinutes) : undefined,
      dbTimeMinutes: report.dbTimeMinutes ? Number(report.dbTimeMinutes) : undefined,
      parseStatus: report.parseStatus,
      severitySummary: analysis?.severitySummary,
    };

    // Extract metrics from parsed data if available
    if (report.parsedData?.loadProfile) {
      const loadProfile = report.parsedData.loadProfile as Record<string, unknown>;
      if (loadProfile.transactionsPerSecond) {
        dto.transactionsPerSecond = Number(loadProfile.transactionsPerSecond);
      }
      if (loadProfile.avgActiveSessions) {
        dto.avgActiveSessions = Number(loadProfile.avgActiveSessions);
      }
    }

    // Get top issue from analysis
    if (analysis?.insights && analysis.insights.length > 0) {
      const sortedInsights = this.sortInsightsBySeverity(analysis.insights);
      if (sortedInsights.length > 0 && sortedInsights[0]) {
        dto.topIssue = {
          severity: sortedInsights[0].severity,
          title: sortedInsights[0].title,
        };
      }
    }

    return dto;
  }

  /**
   * Map report to database info DTO
   */
  private mapToDatabaseInfo(report: AwrReport): DatabaseInfoResponseDto {
    return {
      dbName: report.dbName,
      dbId: report.dbId,
      instanceName: report.instanceName,
      dbEdition: report.dbEdition,
      dbRelease: report.dbRelease,
      isRac: report.isRac,
      isCdb: report.isCdb,
    };
  }

  /**
   * Map report to host info DTO
   */
  private mapToHostInfo(report: AwrReport): HostInfoResponseDto {
    return {
      hostName: report.hostName,
      platform: report.platform,
      cpus: report.cpus,
      cores: report.cores,
      sockets: report.sockets,
      memoryGb: report.memoryGb ? Number(report.memoryGb) : undefined,
    };
  }

  /**
   * Map report to snapshot info DTO
   */
  private mapToSnapshotInfo(report: AwrReport): SnapshotInfoResponseDto {
    return {
      snapIdBegin: report.snapIdBegin,
      snapIdEnd: report.snapIdEnd,
      beginTime: report.beginTime,
      endTime: report.endTime,
      elapsedMinutes: report.elapsedMinutes ? Number(report.elapsedMinutes) : undefined,
      dbTimeMinutes: report.dbTimeMinutes ? Number(report.dbTimeMinutes) : undefined,
      sessionsBegin: report.sessionsBegin,
      sessionsEnd: report.sessionsEnd,
    };
  }

  /**
   * Sort insights by severity (critical first, then warning, then info)
   */
  private sortInsightsBySeverity(insights: AwrInsight[]): AwrInsight[] {
    const severityOrder: Record<string, number> = {
      critical: 0,
      warning: 1,
      info: 2,
    };

    return [...insights].sort((a, b) => {
      const orderA = severityOrder[a.severity] ?? 3;
      const orderB = severityOrder[b.severity] ?? 3;
      return orderA - orderB;
    });
  }
}
