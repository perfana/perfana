/**
 * Comparison Executor Service
 *
 * Executes AWR report comparison analysis using the ComparisonAnalyzer.
 * Responsible for:
 * - Configuring the comparison analyzer
 * - Running comparison analysis
 * - Managing comparison options and thresholds
 */

import { Injectable, Logger } from '@nestjs/common';
import { ParsedAwrData } from '../../entities/awr-report.entity';
import { ComparisonAnalyzer } from '../../analyzers/comparison-analyzer';
import {
  AwrAnalysisConfig,
  DEFAULT_AWR_ANALYSIS_CONFIG,
  createAwrAnalysisConfig,
  ConfigPreset,
  getConfigByPreset,
} from '../../config/awr-analysis.config';
import type { AwrInsight } from '../../types/insights.types';

/**
 * Options for running comparison
 */
export interface ComparisonExecutionOptions {
  /** Configuration preset to use */
  preset?: ConfigPreset;
  /** Custom regression threshold percentage */
  regressionThresholdPercent?: number;
  /** Custom improvement threshold percentage */
  improvementThresholdPercent?: number;
  /** Include info-level insights */
  includeInfoInsights?: boolean;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Comparison execution result
 */
export interface ComparisonExecutionResult {
  insights: AwrInsight[];
  comparisonDurationMs: number;
  comparisonVersion: string;
  config: AwrAnalysisConfig;
}

/**
 * Service for executing AWR comparison analysis
 */
@Injectable()
export class ComparisonExecutorService {
  private readonly logger = new Logger(ComparisonExecutorService.name);
  private readonly defaultConfig: AwrAnalysisConfig;

  constructor() {
    this.defaultConfig = DEFAULT_AWR_ANALYSIS_CONFIG;
  }

  /**
   * Execute comparison between two parsed AWR data sets
   *
   * @param currentData - Current report parsed data
   * @param baselineData - Baseline report parsed data
   * @param options - Comparison execution options
   * @returns Comparison insights and metadata
   */
  executeComparison(
    currentData: ParsedAwrData,
    baselineData: ParsedAwrData,
    options: ComparisonExecutionOptions = {},
  ): ComparisonExecutionResult {
    const startTime = Date.now();

    // Get configuration with custom thresholds if provided
    const config = this.getConfig(options);

    // Create analyzer with configuration
    const analyzer = new ComparisonAnalyzer(config, {
      debug: options.debug || false,
      includeInfoInsights: options.includeInfoInsights ?? false,
    });

    // Run comparison
    const insights = analyzer.compareReports(currentData as any, baselineData as any);

    const comparisonDurationMs = Date.now() - startTime;

    this.logger.log(
      `Comparison executed: ${insights.length} insights generated in ${comparisonDurationMs}ms`,
    );

    return {
      insights,
      comparisonDurationMs,
      comparisonVersion: config.settings.analysisVersion,
      config,
    };
  }

  /**
   * Get configuration based on options
   *
   * @param options - Comparison execution options
   * @returns AWR analysis configuration
   */
  private getConfig(options: ComparisonExecutionOptions): AwrAnalysisConfig {
    let config = options.preset
      ? getConfigByPreset(options.preset)
      : this.defaultConfig;

    // Apply custom thresholds if provided
    if (options.regressionThresholdPercent || options.improvementThresholdPercent) {
      config = createAwrAnalysisConfig({
        thresholds: {
          ...config.thresholds,
          comparison: {
            ...config.thresholds.comparison,
            significantRegressionPercent:
              options.regressionThresholdPercent ??
              config.thresholds.comparison.significantRegressionPercent,
            significantImprovementPercent:
              options.improvementThresholdPercent ??
              config.thresholds.comparison.significantImprovementPercent,
          },
        },
      });
    }

    return config;
  }
}
