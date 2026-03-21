/**
 * HTML AWR Parser Orchestrator
 *
 * Main parser class that orchestrates all section parsers to extract
 * complete data from an Oracle AWR HTML report. Uses the Strategy pattern
 * to allow flexible and extensible parsing of different report sections.
 *
 * Key features:
 * - Orchestrates multiple section parsers
 * - Graceful degradation if individual sections fail
 * - Tracks parsing progress and errors
 * - Provides detailed parse results with timing
 *
 * @example
 * const parser = new HtmlAwrParser();
 * const result = parser.parse(htmlContent);
 * if (result.success) {
 *   console.log(result.data.header?.database.dbName);
 * }
 */

import type { CheerioAPI } from 'cheerio';
import { loadHtml } from '../utils/html-utils';
import type {
  ParsedAwrData,
  AwrParseResult,
  ParseError,
} from '../types';
import {
  BaseSectionParser,
  type SectionParseResult,
  type ParserOptions,
} from './base-parser';
import {
  HeaderParser,
  LoadProfileParser,
  SqlParser,
  WaitEventsParser,
  SegmentStatisticsParser,
  parseAshSql,
  parseSqlText,
} from './sections';

// ==================== Constants ====================

/** Current parser version for tracking analysis compatibility */
const PARSER_VERSION = '1.0.0';

/** Maximum time allowed for parsing (in milliseconds) */
const DEFAULT_TIMEOUT_MS = 120000;

// ==================== Types ====================

/**
 * Configuration options for the HTML AWR parser
 */
export interface HtmlAwrParserOptions extends ParserOptions {
  /** Enable debug logging */
  debug?: boolean;
  /** Include raw HTML in parse results for debugging */
  includeRawSections?: boolean;
  /** Timeout in milliseconds for the entire parse operation */
  timeoutMs?: number;
  /** Continue parsing even if required sections fail */
  continueOnRequiredFailure?: boolean;
}

/**
 * Section definition for parser registration
 */
interface SectionDefinition<T> {
  /** Parser instance */
  parser: BaseSectionParser<T>;
  /** Section name */
  name: string;
  /** Whether this section is required for a valid parse */
  required: boolean;
  /** Property name in ParsedAwrData */
  property: keyof ParsedAwrData;
}

// ==================== HTML AWR Parser Class ====================

/**
 * Orchestrator for parsing Oracle AWR HTML reports.
 *
 * Uses multiple specialized section parsers to extract data from
 * different parts of the AWR report. Each section parser is independent
 * and failures in one section don't prevent parsing of others.
 *
 * @example
 * const parser = new HtmlAwrParser({ debug: true });
 * const result = parser.parse(awrHtml);
 *
 * if (result.success) {
 *   console.log('Database:', result.data?.header?.database.dbName);
 *   console.log('Top SQL count:', result.data?.topSql?.byElapsedTime?.length);
 * }
 */
export class HtmlAwrParser {
  private readonly options: HtmlAwrParserOptions;
  private readonly sections: SectionDefinition<unknown>[];

  /**
   * Create a new HTML AWR parser instance
   *
   * @param options - Optional parser configuration
   */
  constructor(options: HtmlAwrParserOptions = {}) {
    this.options = {
      debug: false,
      includeRawSections: false,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      continueOnRequiredFailure: true,
      ...options,
    };

    // Register all section parsers
    this.sections = this.createSectionParsers();
  }

  // ==================== Public Methods ====================

  /**
   * Parse an AWR HTML report
   *
   * Orchestrates all section parsers and returns complete parsed data.
   * Uses graceful degradation - continues parsing even if some sections fail.
   *
   * @param html - The HTML content of the AWR report
   * @returns Parse result with data, errors, and timing information
   */
  parse(html: string): AwrParseResult {
    const startTime = Date.now();
    const errors: ParseError[] = [];
    const sectionsCompleted: string[] = [];
    const sectionsFailed: string[] = [];

    // Validate input
    if (!html || html.trim().length === 0) {
      return this.createFailureResult('HTML content is empty', startTime);
    }

    this.debug('Starting AWR HTML parse', { htmlLength: html.length });

    // Load HTML once for all parsers
    const $ = this.loadDocument(html);

    if (!$) {
      return this.createFailureResult('Failed to load HTML document', startTime);
    }

    // Initialize parsed data
    const data: ParsedAwrData = {
      parserVersion: PARSER_VERSION,
      parseErrors: [],
    };

    // Parse ASH SQL sections (Top SQL with Events/Row Sources)
    try {
      const ashSqlData = parseAshSql($);
      if (ashSqlData && (ashSqlData.topSqlWithEvents?.length || ashSqlData.topSqlWithRowSources?.length)) {
        data.ashSql = ashSqlData;
        sectionsCompleted.push('ASH SQL');
        this.debug('ASH SQL sections parsed successfully');
      }
    } catch (error) {
      sectionsFailed.push('ASH SQL');
      const errorMessage = this.extractErrorMessage(error);
      errors.push({
        section: 'ASH SQL',
        message: `Failed to parse ASH SQL: ${errorMessage}`,
        recoverable: true,
      });
      this.debug(`ASH SQL parsing failed: ${errorMessage}`);
    }

    // Parse SQL Text section (Complete List of SQL Text)
    try {
      const sqlTextData = parseSqlText($);
      if (sqlTextData && sqlTextData.count > 0) {
        data.sqlTextMap = sqlTextData.sqlTextMap;
        sectionsCompleted.push('SQL Text');
        this.debug(`SQL Text parsed successfully: ${sqlTextData.count} SQL statements`);
      }
    } catch (error) {
      sectionsFailed.push('SQL Text');
      const errorMessage = this.extractErrorMessage(error);
      errors.push({
        section: 'SQL Text',
        message: `Failed to parse SQL Text: ${errorMessage}`,
        recoverable: true,
      });
      this.debug(`SQL Text parsing failed: ${errorMessage}`);
    }

    // Parse each section
    for (const section of this.sections) {
      const sectionResult = this.parseSection(section, html);

      if (sectionResult.success && sectionResult.data !== null) {
        // Assign parsed data to the appropriate property
        (data as Record<string, unknown>)[section.property] = sectionResult.data;
        sectionsCompleted.push(section.name);

        this.debug(`Section ${section.name} parsed successfully`, {
          parseTimeMs: sectionResult.parseTimeMs,
        });
      } else {
        sectionsFailed.push(section.name);

        const error: ParseError = {
          section: section.name,
          message: sectionResult.error || `Failed to parse ${section.name}`,
          recoverable: !section.required,
        };

        errors.push(error);
        data.parseErrors?.push(error);

        this.debug(`Section ${section.name} failed`, {
          error: sectionResult.error,
          required: section.required,
        });
      }
    }

    // Optionally include raw sections for debugging
    if (this.options.includeRawSections) {
      data.rawSections = this.extractRawSections($);
    }

    // Determine overall success
    const hasRequiredSections = this.hasRequiredSections(sectionsCompleted);
    const success = hasRequiredSections || this.options.continueOnRequiredFailure === true;

    const parseTimeMs = Date.now() - startTime;

    this.debug('AWR HTML parse complete', {
      success,
      sectionsCompleted: sectionsCompleted.length,
      sectionsFailed: sectionsFailed.length,
      parseTimeMs,
    });

    return {
      success,
      data,
      errors: errors.length > 0 ? errors : undefined,
      parseTimeMs,
      sectionsCompleted,
      sectionsFailed,
    };
  }

  /**
   * Check if the given HTML appears to be an AWR report
   *
   * @param html - HTML content to check
   * @returns True if the HTML appears to be an AWR report
   */
  isAwrReport(html: string): boolean {
    const lowerHtml = html.toLowerCase();

    // Check for common AWR report indicators
    const indicators = [
      'workload repository report',
      'awr report',
      'automatic workload repository',
      'db name',
      'db id',
      'snap id',
      'load profile',
    ];

    const matchCount = indicators.filter((indicator) =>
      lowerHtml.includes(indicator),
    ).length;

    return matchCount >= 2;
  }

  /**
   * Get the list of registered section names
   *
   * @returns Array of section names
   */
  getSectionNames(): string[] {
    return this.sections.map((s) => s.name);
  }

  // ==================== Private Methods ====================

  /**
   * Create and register all section parsers
   */
  private createSectionParsers(): SectionDefinition<unknown>[] {
    const parserOptions: ParserOptions = {
      debug: this.options.debug,
    };

    return [
      {
        parser: new HeaderParser(parserOptions) as BaseSectionParser<unknown>,
        name: 'Header',
        required: true,
        property: 'header',
      },
      {
        parser: new LoadProfileParser(parserOptions) as BaseSectionParser<unknown>,
        name: 'Load Profile',
        required: false,
        property: 'loadProfile',
      },
      {
        parser: new SqlParser(parserOptions) as BaseSectionParser<unknown>,
        name: 'Top SQL',
        required: false,
        property: 'topSql',
      },
      {
        parser: new WaitEventsParser(parserOptions) as BaseSectionParser<unknown>,
        name: 'Wait Events',
        required: false,
        property: 'waitEvents',
      },
      {
        parser: new SegmentStatisticsParser(parserOptions) as BaseSectionParser<unknown>,
        name: 'Segment Statistics',
        required: false,
        property: 'segmentStatistics',
      },
    ];
  }

  /**
   * Parse a single section using its parser
   */
  private parseSection<T>(
    section: SectionDefinition<T>,
    html: string,
  ): SectionParseResult<T> {
    try {
      return section.parser.parseWithResult(html) as SectionParseResult<T>;
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);

      return {
        success: false,
        data: null,
        error: `Exception parsing ${section.name}: ${errorMessage}`,
      };
    }
  }

  /**
   * Check if all required sections were parsed successfully
   */
  private hasRequiredSections(completedSections: string[]): boolean {
    const requiredSectionNames = this.sections
      .filter((s) => s.required)
      .map((s) => s.name);

    return requiredSectionNames.every((name) =>
      completedSections.includes(name),
    );
  }

  /**
   * Load HTML content into a Cheerio instance
   */
  private loadDocument(html: string): CheerioAPI | null {
    try {
      return loadHtml(html);
    } catch {
      return null;
    }
  }

  /**
   * Extract raw section HTML for debugging purposes
   */
  private extractRawSections($: CheerioAPI): Record<string, string> {
    const sections: Record<string, string> = {};

    // Extract major sections by heading
    $('h1, h2, h3').each((_idx, elem) => {
      const heading = $(elem).text().trim();
      const key = this.normalizeHeadingKey(heading);

      if (key) {
        let content = '';
        let next = $(elem).next();

        while (
          next.length > 0 &&
          !next.is('h1') &&
          !next.is('h2') &&
          !next.is('h3')
        ) {
          content += $.html(next);
          next = next.next();
        }

        if (content.length > 0) {
          sections[key] = content.substring(0, 10000);
        }
      }
    });

    return sections;
  }

  /**
   * Normalize a heading to a key for raw sections
   */
  private normalizeHeadingKey(heading: string): string {
    return heading
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .substring(0, 50);
  }

  /**
   * Create a failure result
   */
  private createFailureResult(
    message: string,
    startTime: number,
  ): AwrParseResult {
    return {
      success: false,
      errors: [
        {
          section: 'Parser',
          message,
          recoverable: false,
        },
      ],
      parseTimeMs: Date.now() - startTime,
      sectionsCompleted: [],
      sectionsFailed: [],
    };
  }

  /**
   * Log debug message if debug mode is enabled
   */
  private debug(message: string, data?: unknown): void {
    if (this.options.debug) {
      if (data !== undefined) {
        console.debug('[HtmlAwrParser]', message, data);
      } else {
        console.debug('[HtmlAwrParser]', message);
      }
    }
  }

  /**
   * Safely extract an error message from an unknown error type
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
