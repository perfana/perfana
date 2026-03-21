/**
 * Base Analyzer for AWR Reports
 *
 * Interface and abstract base class implementing the Strategy pattern for AWR analysis.
 * Each analyzer focuses on a specific aspect of AWR data (SQL performance, wait events, etc.)
 * and generates actionable insights.
 *
 * Key features:
 * - Each analyzer is independent and testable
 * - Easy to add/remove analysis rules
 * - Configurable thresholds for tuning
 * - Clear separation of concerns
 *
 * @example
 * class SqlPerformanceAnalyzer extends BaseAwrAnalyzer {
 *   analyze(data: ParsedAwrData): AwrInsight[] {
 *     // Implementation
 *   }
 * }
 */

import { v4 as uuidv4 } from 'uuid';
import type { ParsedAwrData } from '../types/awr-data.types';
import type {
  AwrInsight,
  InsightSeverity,
  InsightCategory,
  InsightMetadata,
} from '../types/insights.types';
import type { AwrAnalysisConfig } from '../config/awr-analysis.config';

// ==================== Types ====================

/**
 * Result from an analyzer run
 */
export interface AnalyzerResult {
  /** Name of the analyzer that produced this result */
  analyzerName: string;
  /** Generated insights */
  insights: AwrInsight[];
  /** Time taken to analyze in milliseconds */
  analysisDurationMs: number;
  /** Any errors encountered during analysis */
  errors?: string[];
  /** Warnings (non-fatal issues) */
  warnings?: string[];
}

/**
 * Options for configuring analyzer behavior
 */
export interface AnalyzerOptions {
  /** Enable debug logging */
  debug?: boolean;
  /** Include info-level insights */
  includeInfoInsights?: boolean;
  /** Maximum number of insights to generate */
  maxInsights?: number;
  /** Custom configuration overrides */
  config?: Partial<AwrAnalysisConfig>;
}

// ==================== Interface ====================

/**
 * AwrAnalyzer interface for AWR data analysis
 *
 * Each analyzer implementation focuses on a specific aspect:
 * - SqlPerformanceAnalyzer: High DB time queries, CPU-bound, I/O-bound
 * - WaitEventsAnalyzer: I/O wait, lock contention, commit wait
 * - ResourceUtilizationAnalyzer: CPU, memory, I/O patterns
 * - ComparisonAnalyzer: Baseline regression/improvement detection
 */
export interface AwrAnalyzer {
  /**
   * Analyze AWR data and generate insights
   *
   * @param data - Parsed AWR data to analyze
   * @returns Array of insights generated from the analysis
   */
  analyze(data: ParsedAwrData): AwrInsight[];

  /**
   * Get the analyzer name for logging/debugging
   *
   * @returns Human-readable analyzer name
   */
  getName(): string;

  /**
   * Get the category of insights this analyzer produces
   *
   * @returns Primary insight category
   */
  getCategory(): InsightCategory;
}

// ==================== Abstract Base Class ====================

/**
 * Abstract base class for AWR analyzers
 *
 * Provides common functionality for all analyzers including:
 * - Configuration management
 * - Insight generation helpers
 * - Error handling
 * - Debug logging
 */
export abstract class BaseAwrAnalyzer implements AwrAnalyzer {
  /** Analyzer options */
  protected readonly options: AnalyzerOptions;

  /** Configuration for thresholds and limits */
  protected config: AwrAnalysisConfig;

  /**
   * Create a new analyzer instance
   *
   * @param config - Analysis configuration with thresholds
   * @param options - Optional analyzer configuration
   */
  constructor(config: AwrAnalysisConfig, options: AnalyzerOptions = {}) {
    this.options = {
      debug: false,
      includeInfoInsights: true,
      maxInsights: 50,
      ...options,
    };

    // Merge any config overrides from options
    this.config = options.config
      ? { ...config, ...options.config }
      : config;
  }

  // ==================== Abstract Methods ====================

  /**
   * Analyze AWR data and generate insights
   *
   * @param data - Parsed AWR data to analyze
   * @returns Array of insights
   */
  abstract analyze(data: ParsedAwrData): AwrInsight[];

  /**
   * Get the analyzer name
   *
   * @returns Analyzer name
   */
  abstract getName(): string;

  /**
   * Get the primary category of insights
   *
   * @returns Insight category
   */
  abstract getCategory(): InsightCategory;

  // ==================== Protected Helper Methods ====================

  /**
   * Analyze with full result information
   *
   * Wraps the analyze method with timing and error handling.
   *
   * @param data - The parsed AWR data to analyze
   * @returns Full analysis result with timing information
   */
  protected analyzeWithResult(data: ParsedAwrData): AnalyzerResult {
    const startTime = Date.now();
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      let insights = this.analyze(data);

      // Filter out info insights if not included
      if (!this.options.includeInfoInsights) {
        insights = insights.filter((i) => i.severity !== 'info');
      }

      // Limit number of insights
      if (this.options.maxInsights && insights.length > this.options.maxInsights) {
        warnings.push(
          `Insights limited to ${this.options.maxInsights} (${insights.length} total)`
        );
        insights = insights.slice(0, this.options.maxInsights);
      }

      return {
        analyzerName: this.getName(),
        insights,
        analysisDurationMs: Date.now() - startTime,
        errors: errors.length > 0 ? errors : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      errors.push(errorMessage);

      return {
        analyzerName: this.getName(),
        insights: [],
        analysisDurationMs: Date.now() - startTime,
        errors,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    }
  }

  /**
   * Create a new insight with standard fields populated
   *
   * @param params - Insight parameters
   * @returns Complete insight object
   */
  protected createInsight(params: {
    severity: InsightSeverity;
    category: InsightCategory;
    title: string;
    description: string;
    recommendation?: string;
    sqlId?: string;
    sqlText?: string;
    fullSqlText?: string;
    waitEvent?: string;
    waitClass?: string;
    value?: number;
    unit?: string;
    threshold?: number;
    percentDbTime?: number;
    impactScore?: number;
    isComparison?: boolean;
    baselineValue?: number;
    changePercent?: number;
    metadata?: InsightMetadata;
    tags?: string[];
  }): AwrInsight {
    const insight: AwrInsight = {
      id: uuidv4(),
      severity: params.severity,
      category: params.category,
      title: params.title,
      description: params.description,
    };

    // Add optional fields only if provided
    if (params.recommendation !== undefined) {
      insight.recommendation = params.recommendation;
    }
    if (params.sqlId !== undefined) {
      insight.sqlId = params.sqlId;
    }
    if (params.sqlText !== undefined) {
      insight.sqlText = params.sqlText;
    }
    if (params.fullSqlText !== undefined) {
      insight.fullSqlText = params.fullSqlText;
    }
    if (params.waitEvent !== undefined) {
      insight.waitEvent = params.waitEvent;
    }
    if (params.waitClass !== undefined) {
      insight.waitClass = params.waitClass;
    }
    if (params.value !== undefined) {
      insight.value = params.value;
    }
    if (params.unit !== undefined) {
      insight.unit = params.unit;
    }
    if (params.threshold !== undefined) {
      insight.threshold = params.threshold;
    }
    if (params.percentDbTime !== undefined) {
      insight.percentDbTime = params.percentDbTime;
    }
    if (params.impactScore !== undefined) {
      insight.impactScore = params.impactScore;
    }
    if (params.isComparison !== undefined) {
      insight.isComparison = params.isComparison;
    }
    if (params.baselineValue !== undefined) {
      insight.baselineValue = params.baselineValue;
    }
    if (params.changePercent !== undefined) {
      insight.changePercent = params.changePercent;
    }
    if (params.tags !== undefined) {
      insight.tags = params.tags;
    }

    // Add source metadata
    insight.metadata = {
      source: this.getName(),
      ...params.metadata,
    };

    return insight;
  }

  /**
   * Calculate impact score based on percentage of DB time
   *
   * @param percentDbTime - Percentage of total DB time
   * @returns Impact score (0-100)
   */
  protected calculateImpactScore(percentDbTime: number): number {
    // Impact score is roughly proportional to DB time percentage
    // with some scaling to make smaller percentages more meaningful
    return Math.min(100, Math.round(percentDbTime * 2));
  }

  /**
   * Determine severity based on percentage of DB time
   *
   * @param percentDbTime - Percentage of total DB time
   * @returns Appropriate severity level
   */
  protected determineSeverityByDbTime(percentDbTime: number): InsightSeverity {
    if (percentDbTime >= this.config.thresholds.severity.criticalDbTimePercent) {
      return 'critical';
    }
    if (percentDbTime >= this.config.thresholds.severity.warningDbTimePercent) {
      return 'warning';
    }
    return 'info';
  }

  /**
   * Determine severity based on change percentage (for comparisons)
   *
   * @param changePercent - Percentage change (positive = regression)
   * @returns Appropriate severity level
   */
  protected determineSeverityByChange(changePercent: number): InsightSeverity {
    const absChange = Math.abs(changePercent);
    if (absChange >= this.config.thresholds.comparison.criticalRegressionPercent) {
      return 'critical';
    }
    if (absChange >= this.config.thresholds.comparison.significantRegressionPercent) {
      return 'warning';
    }
    return 'info';
  }

  /**
   * Check if a value exceeds a threshold
   *
   * @param value - Current value
   * @param threshold - Threshold to compare against
   * @returns True if value exceeds threshold
   */
  protected exceedsThreshold(value: number, threshold: number): boolean {
    return value >= threshold;
  }

  /**
   * Log a debug message if debug mode is enabled
   *
   * @param message - Message to log
   * @param data - Optional data to include
   */
  protected debug(message: string, data?: unknown): void {
    if (this.options.debug) {
      const prefix = `[${this.getName()}]`;
      if (data !== undefined) {
        console.debug(prefix, message, data);
      } else {
        console.debug(prefix, message);
      }
    }
  }

  /**
   * Truncate SQL text to a reasonable length for display
   *
   * @param sqlText - Full SQL text
   * @param maxLength - Maximum length (default 200)
   * @returns Truncated SQL text
   */
  protected truncateSql(sqlText: string, maxLength = 200): string {
    if (sqlText.length <= maxLength) {
      return sqlText;
    }
    return sqlText.substring(0, maxLength - 3) + '...';
  }

  /**
   * Format a number with appropriate precision
   *
   * @param value - Number to format
   * @param precision - Decimal places (default 2)
   * @returns Formatted number string
   */
  protected formatNumber(value: number, precision = 2): string {
    return value.toFixed(precision);
  }

  /**
   * Format a time value in seconds to a human-readable string
   *
   * @param seconds - Time in seconds
   * @returns Formatted time string
   */
  protected formatTime(seconds: number): string {
    if (seconds < 1) {
      return `${(seconds * 1000).toFixed(0)}ms`;
    }
    if (seconds < 60) {
      return `${seconds.toFixed(2)}s`;
    }
    if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
    }
    const hours = Math.floor(seconds / 3600);
    const remainingMinutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${remainingMinutes}m`;
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
    return 'An unexpected error occurred during analysis';
  }
}

// ==================== Utility Types ====================

/**
 * Type representing an analyzer class constructor
 */
export type AnalyzerConstructor = new (
  config: AwrAnalysisConfig,
  options?: AnalyzerOptions
) => AwrAnalyzer;

/**
 * Registry entry for an analyzer
 */
export interface AnalyzerRegistryEntry {
  /** Analyzer class constructor */
  analyzer: AnalyzerConstructor;
  /** Whether this analyzer is required */
  required: boolean;
  /** Processing priority (lower = earlier) */
  priority: number;
  /** Whether this analyzer is for comparison analysis only */
  comparisonOnly?: boolean;
}
