/**
 * Base Section Parser for AWR Reports
 *
 * Abstract base class implementing the Strategy pattern for AWR report section parsing.
 * Each section parser extends this class to extract specific data from AWR HTML reports.
 *
 * @example
 * class HeaderParser extends BaseSectionParser<AwrReportHeader> {
 *   parse(html: string): AwrReportHeader | null {
 *     // Implementation
 *   }
 * }
 */

import type { CheerioAPI } from 'cheerio';
import { loadHtml } from '../utils/html-utils';

// ==================== Types ====================

/**
 * Result from a section parse operation
 */
export interface SectionParseResult<T> {
  /** Whether the section was successfully parsed */
  success: boolean;
  /** Parsed data (null if parsing failed) */
  data: T | null;
  /** Error message if parsing failed */
  error?: string;
  /** Warnings encountered during parsing (non-fatal issues) */
  warnings?: string[];
  /** Time taken to parse in milliseconds */
  parseTimeMs?: number;
}

/**
 * Configuration options for section parsers
 */
export interface ParserOptions {
  /** Enable debug logging */
  debug?: boolean;
  /** Include raw HTML in parse errors for debugging */
  includeRawHtmlInErrors?: boolean;
  /** Maximum length of raw HTML to include in errors */
  maxRawHtmlLength?: number;
  /** Timeout in milliseconds for parsing */
  timeoutMs?: number;
}

// ==================== Abstract Base Class ====================

/**
 * Abstract base class for AWR section parsers.
 *
 * Implements the Strategy pattern to allow different parsing strategies
 * for different sections of an AWR report. Each concrete parser handles
 * one specific section (e.g., header, load profile, top SQL).
 *
 * Key features:
 * - ~50-100 lines per parser (easy to understand)
 * - Easy to test individual parsers in isolation
 * - Add new sections without touching existing code
 * - Graceful degradation if one section fails
 *
 * @template T - The type of data this parser extracts
 */
export abstract class BaseSectionParser<T> {
  /** Parser configuration options */
  protected readonly options: ParserOptions;

  /**
   * Create a new section parser instance
   *
   * @param options - Optional parser configuration
   */
  constructor(options: ParserOptions = {}) {
    this.options = {
      debug: false,
      includeRawHtmlInErrors: false,
      maxRawHtmlLength: 500,
      timeoutMs: 30000,
      ...options,
    };
  }

  // ==================== Abstract Methods ====================

  /**
   * Parse a specific section of the AWR report
   *
   * This is the main parsing method that concrete implementations must provide.
   * The method should extract relevant data from the HTML and return a typed result.
   *
   * @param html - The HTML content to parse (full AWR report or section)
   * @returns Parsed data or null if section not found
   */
  abstract parse(html: string): T | null;

  /**
   * Get the name of this section parser for logging and debugging
   *
   * @returns Human-readable section name
   */
  abstract getSectionName(): string;

  // ==================== Protected Helper Methods ====================

  /**
   * Validate the parsed data
   *
   * Override this method in subclasses for custom validation logic.
   *
   * @param data - The parsed data to validate
   * @returns True if data is valid
   */
  protected validate(data: T): boolean {
    return data !== null && data !== undefined;
  }

  /**
   * Load HTML content into a Cheerio instance
   *
   * @param html - Raw HTML string
   * @returns CheerioAPI instance for querying
   */
  protected loadDocument(html: string): CheerioAPI {
    return loadHtml(html);
  }

  /**
   * Log a debug message if debug mode is enabled
   *
   * @param message - Message to log
   * @param data - Optional data to include
   */
  protected debug(message: string, data?: unknown): void {
    if (this.options.debug) {
      const prefix = `[${this.getSectionName()}]`;
      if (data !== undefined) {
        console.debug(prefix, message, data);
      } else {
        console.debug(prefix, message);
      }
    }
  }

  /**
   * Create a warning message for non-fatal parsing issues
   *
   * @param message - Warning message
   * @returns Formatted warning string
   */
  protected createWarning(message: string): string {
    return `[${this.getSectionName()}] ${message}`;
  }

  // ==================== Public Methods ====================

  /**
   * Parse with full result information
   *
   * Wraps the parse method with timing, validation, and error handling.
   * Use this method when you need detailed information about the parse result.
   *
   * @param html - The HTML content to parse
   * @returns Full parse result with success/error information
   */
  parseWithResult(html: string): SectionParseResult<T> {
    const startTime = Date.now();
    const warnings: string[] = [];

    try {
      const data = this.parse(html);
      const parseTimeMs = Date.now() - startTime;

      if (data === null) {
        return {
          success: false,
          data: null,
          error: `Section '${this.getSectionName()}' not found in HTML`,
          warnings,
          parseTimeMs,
        };
      }

      if (!this.validate(data)) {
        return {
          success: false,
          data: null,
          error: `Validation failed for section '${this.getSectionName()}'`,
          warnings,
          parseTimeMs,
        };
      }

      this.debug(`Successfully parsed in ${parseTimeMs}ms`);

      return {
        success: true,
        data,
        warnings: warnings.length > 0 ? warnings : undefined,
        parseTimeMs,
      };
    } catch (error) {
      const parseTimeMs = Date.now() - startTime;
      const errorMessage = this.extractErrorMessage(error);

      this.debug(`Parse failed: ${errorMessage}`);

      return {
        success: false,
        data: null,
        error: `Failed to parse '${this.getSectionName()}': ${errorMessage}`,
        warnings: warnings.length > 0 ? warnings : undefined,
        parseTimeMs,
      };
    }
  }

  /**
   * Check if this section exists in the HTML
   *
   * Useful for determining whether to attempt parsing.
   * Override in subclasses for section-specific detection.
   *
   * @param html - The HTML content to check
   * @returns True if the section appears to exist
   */
  sectionExists(html: string): boolean {
    // Default implementation - subclasses should override
    try {
      const result = this.parse(html);
      return result !== null;
    } catch {
      return false;
    }
  }

  // ==================== Private Helper Methods ====================

  /**
   * Safely extract an error message from an unknown error type
   *
   * Uses the safe error handling pattern from CLAUDE.md
   *
   * @param error - The caught error
   * @returns Error message string
   */
  private extractErrorMessage(error: unknown): string {
    if (error && typeof error === 'object' && 'message' in error) {
      return (error as Error).message;
    }
    return 'An unexpected error occurred';
  }
}
