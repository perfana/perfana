/**
 * AWR Analysis Service
 *
 * Orchestrates AWR report analysis by running all configured analyzers
 * and aggregating their insights. Supports single report analysis and
 * stores results to the database.
 *
 * Key features:
 * - Runs all registered analyzers (SQL, Wait Events, Resource)
 * - Aggregates and ranks insights by impact score
 * - Calculates severity summaries
 * - Persists analysis results to database
 * - Configurable thresholds and options
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { AwrAnalysis, SeveritySummary, type AwrInsight as EntityAwrInsight } from '../entities/awr-analysis.entity';
import { AwrReport } from '../entities/awr-report.entity';
import {
  ResourceNotFoundException,
  DatabaseException,
  ValidationException,
} from '../../../common/exceptions/business.exception';
import {
  AwrAnalyzer,
  AnalyzerResult,
  AnalyzerOptions,
  SqlPerformanceAnalyzer,
  WaitEventsAnalyzer,
  ResourceUtilizationAnalyzer,
  RowSourceAnalyzer,
} from '../analyzers';
import {
  AwrAnalysisConfig,
  DEFAULT_AWR_ANALYSIS_CONFIG,
  createAwrAnalysisConfig,
  ConfigPreset,
  getConfigByPreset,
} from '../config/awr-analysis.config';
import type { ParsedAwrData } from '../types/awr-data.types';
import type { AwrInsight, InsightSeverity } from '../types/insights.types';
import { AwrAnalysisResponseDto } from '../dto';

// ==================== Types ====================

/**
 * Options for running analysis
 */
export interface AnalysisOptions {
  /** Configuration preset to use */
  preset?: ConfigPreset;
  /** Custom configuration overrides */
  configOverrides?: Partial<AwrAnalysisConfig>;
  /** Whether to include info-level insights */
  includeInfoInsights?: boolean;
  /** Maximum total insights to return */
  maxInsights?: number;
  /** Enable debug logging */
  debug?: boolean;
  /** Whether to save results to database */
  saveToDatabase?: boolean;
}

/**
 * Result from analysis orchestration
 */
export interface AnalysisOrchestrationResult {
  /** Generated insights sorted by impact */
  insights: AwrInsight[];
  /** Severity counts */
  severitySummary: SeveritySummary;
  /** Results from individual analyzers */
  analyzerResults: AnalyzerResult[];
  /** Total analysis duration in milliseconds */
  totalDurationMs: number;
  /** Analysis version */
  analysisVersion: string;
  /** Any warnings from analysis */
  warnings?: string[];
}

// ==================== Service ====================

/**
 * Service for orchestrating AWR report analysis
 *
 * Manages the lifecycle of analyzing AWR reports including:
 * - Running multiple analyzers
 * - Aggregating and ranking insights
 * - Persisting results
 * - Retrieving analysis history
 */
@Injectable()
export class AwrAnalysisService {
  private readonly logger = new Logger(AwrAnalysisService.name);

  /** Default configuration */
  private readonly defaultConfig: AwrAnalysisConfig;

  constructor(
    @InjectRepository(AwrAnalysis)
    private readonly awrAnalysisRepo: Repository<AwrAnalysis>,
    @InjectRepository(AwrReport)
    private readonly awrReportRepo: Repository<AwrReport>,
  ) {
    this.defaultConfig = DEFAULT_AWR_ANALYSIS_CONFIG;
  }

  // ==================== Main Analysis Methods ====================

  /**
   * Analyze a single AWR report by ID
   *
   * Retrieves the report, runs all analyzers, and stores results.
   *
   * @param reportId - AWR report UUID
   * @param options - Analysis options
   * @returns Analysis response DTO
   */
  async analyzeSingleReport(
    reportId: string,
    options?: AnalysisOptions,
  ): Promise<AwrAnalysisResponseDto> {
    const startTime = Date.now();
    this.logger.log(`Starting analysis for report ${reportId}`);

    // Get the report
    const report = await this.getReport(reportId);

    // Validate report has parsed data
    if (!report.parsedData) {
      throw new ValidationException(
        `AWR Report ${reportId} has not been parsed yet`,
      );
    }

    // Run analysis
    const result = this.runAnalysis(report.parsedData as ParsedAwrData, options);

    // Save to database if requested (default: true)
    const shouldSave = options?.saveToDatabase !== false;
    let analysisEntity: AwrAnalysis | undefined;

    if (shouldSave) {
      analysisEntity = await this.saveAnalysis(reportId, 'single', result);
    }

    const totalDuration = Date.now() - startTime;
    this.logger.log(
      `Analysis complete for report ${reportId}: ${result.insights.length} insights in ${totalDuration}ms`,
    );

    return this.mapToResponseDto(result, reportId, analysisEntity?.id);
  }

  /**
   * Analyze parsed AWR data directly without database operations
   *
   * Useful for testing or preview analysis.
   *
   * @param parsedData - Parsed AWR data
   * @param options - Analysis options
   * @returns Analysis orchestration result
   */
  analyzeData(
    parsedData: ParsedAwrData,
    options?: AnalysisOptions,
  ): AnalysisOrchestrationResult {
    return this.runAnalysis(parsedData, options);
  }

  /**
   * Re-analyze an existing report
   *
   * Useful when analysis rules have been updated.
   *
   * @param reportId - AWR report UUID
   * @param options - Analysis options
   * @returns Analysis response DTO
   */
  async reanalyzeReport(
    reportId: string,
    options?: AnalysisOptions,
  ): Promise<AwrAnalysisResponseDto> {
    // Delete existing analyses for this report
    await this.deleteAnalysesByReportId(reportId);

    // Run fresh analysis
    return this.analyzeSingleReport(reportId, options);
  }

  // ==================== Retrieval Methods ====================

  /**
   * Get analysis for a report
   *
   * @param reportId - AWR report UUID
   * @returns Analysis response DTO or null if not found
   */
  async getAnalysisForReport(reportId: string): Promise<AwrAnalysisResponseDto | null> {
    try {
      const analysis = await this.awrAnalysisRepo.findOne({
        where: { awrReportId: reportId, analysisType: 'single' },
        order: { analyzedAt: 'DESC' },
      });

      if (!analysis) {
        return null;
      }

      return {
        id: analysis.id,
        awrReportId: analysis.awrReportId,
        analysisType: analysis.analysisType,
        insights: analysis.insights || [],
        severitySummary: analysis.severitySummary || this.createEmptySeveritySummary(),
        analyzedAt: analysis.analyzedAt,
        analysisVersion: analysis.analysisVersion,
      };
    } catch (error) {
      this.logger.error(`Failed to get analysis: ${this.extractErrorMessage(error)}`);
      throw new DatabaseException('Failed to retrieve analysis', error);
    }
  }

  /**
   * Get analysis by ID
   *
   * @param analysisId - Analysis UUID
   * @returns Analysis response DTO
   */
  async getAnalysisById(analysisId: string): Promise<AwrAnalysisResponseDto> {
    try {
      const analysis = await this.awrAnalysisRepo.findOne({
        where: { id: analysisId },
      });

      if (!analysis) {
        throw new ResourceNotFoundException('AWR Analysis', analysisId);
      }

      return {
        id: analysis.id,
        awrReportId: analysis.awrReportId,
        analysisType: analysis.analysisType,
        baselineReportId: analysis.baselineReportId,
        insights: analysis.insights || [],
        severitySummary: analysis.severitySummary || this.createEmptySeveritySummary(),
        analyzedAt: analysis.analyzedAt,
        analysisVersion: analysis.analysisVersion,
      };
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to get analysis: ${this.extractErrorMessage(error)}`);
      throw new DatabaseException('Failed to retrieve analysis', error);
    }
  }

  /**
   * Check if report has analysis
   *
   * @param reportId - AWR report UUID
   * @returns True if analysis exists
   */
  async hasAnalysis(reportId: string): Promise<boolean> {
    try {
      const count = await this.awrAnalysisRepo.count({
        where: { awrReportId: reportId },
      });
      return count > 0;
    } catch (error) {
      this.logger.error(`Failed to check analysis: ${this.extractErrorMessage(error)}`);
      return false;
    }
  }

  // ==================== Delete Methods ====================

  /**
   * Delete analyses for a report
   *
   * @param reportId - AWR report UUID
   * @returns Number of deleted analyses
   */
  async deleteAnalysesByReportId(reportId: string): Promise<number> {
    try {
      const result = await this.awrAnalysisRepo.delete({ awrReportId: reportId });
      const deletedCount = result.affected || 0;

      if (deletedCount > 0) {
        this.logger.log(`Deleted ${deletedCount} analyses for report ${reportId}`);
      }

      return deletedCount;
    } catch (error) {
      this.logger.error(`Failed to delete analyses: ${this.extractErrorMessage(error)}`);
      throw new DatabaseException('Failed to delete analyses', error);
    }
  }

  // ==================== Private Analysis Methods ====================

  /**
   * Run analysis using all configured analyzers
   */
  private runAnalysis(
    parsedData: ParsedAwrData,
    options?: AnalysisOptions,
  ): AnalysisOrchestrationResult {
    const startTime = Date.now();
    const warnings: string[] = [];

    // Get configuration
    const config = this.getConfig(options);

    // Get analyzer options
    const analyzerOptions: AnalyzerOptions = {
      debug: options?.debug || false,
      includeInfoInsights: options?.includeInfoInsights ?? config.settings.includeInfoInsights,
      maxInsights: options?.maxInsights ?? config.settings.maxTotalInsights,
      config: options?.configOverrides,
    };

    // Create analyzers
    const analyzers = this.createAnalyzers(config, analyzerOptions);

    // Run all analyzers and collect results
    const analyzerResults: AnalyzerResult[] = [];
    const allInsights: AwrInsight[] = [];

    for (const analyzer of analyzers) {
      try {
        const result = this.runSingleAnalyzer(analyzer, parsedData);
        analyzerResults.push(result);
        allInsights.push(...result.insights);

        this.logAnalyzerResult(analyzer.getName(), result);

        // Collect warnings
        if (result.warnings) {
          warnings.push(...result.warnings.map(w => `[${analyzer.getName()}] ${w}`));
        }
      } catch (error) {
        const errorMessage = this.extractErrorMessage(error);
        this.logger.error(`Analyzer ${analyzer.getName()} failed: ${errorMessage}`);
        warnings.push(`[${analyzer.getName()}] Analysis failed: ${errorMessage}`);
      }
    }

    // Sort insights by impact score (highest first)
    const sortedInsights = this.sortInsightsByImpact(allInsights);

    // Limit total insights if configured
    const maxInsights = options?.maxInsights ?? config.settings.maxTotalInsights;
    const limitedInsights = sortedInsights.slice(0, maxInsights);

    if (sortedInsights.length > maxInsights) {
      warnings.push(`Insights limited to ${maxInsights} (${sortedInsights.length} total)`);
    }

    // Calculate severity summary
    const severitySummary = this.calculateSeveritySummary(limitedInsights);

    return {
      insights: limitedInsights,
      severitySummary,
      analyzerResults,
      totalDurationMs: Date.now() - startTime,
      analysisVersion: config.settings.analysisVersion,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Create all analyzer instances
   */
  private createAnalyzers(
    config: AwrAnalysisConfig,
    options: AnalyzerOptions,
  ): AwrAnalyzer[] {
    return [
      new SqlPerformanceAnalyzer(config, options),
      new WaitEventsAnalyzer(config, options),
      new ResourceUtilizationAnalyzer(config, options),
      new RowSourceAnalyzer(config, options),
    ];
  }

  /**
   * Run a single analyzer with timing
   */
  private runSingleAnalyzer(
    analyzer: AwrAnalyzer,
    parsedData: ParsedAwrData,
  ): AnalyzerResult {
    const startTime = Date.now();

    try {
      const insights = analyzer.analyze(parsedData);

      return {
        analyzerName: analyzer.getName(),
        insights,
        analysisDurationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);

      return {
        analyzerName: analyzer.getName(),
        insights: [],
        analysisDurationMs: Date.now() - startTime,
        errors: [errorMessage],
      };
    }
  }

  /**
   * Log analyzer result for debugging
   */
  private logAnalyzerResult(analyzerName: string, result: AnalyzerResult): void {
    const insightCount = result.insights.length;
    const duration = result.analysisDurationMs;

    if (result.errors && result.errors.length > 0) {
      this.logger.warn(
        `${analyzerName}: ${insightCount} insights, ${duration}ms, errors: ${result.errors.join(', ')}`,
      );
    } else {
      this.logger.debug(`${analyzerName}: ${insightCount} insights in ${duration}ms`);
    }
  }

  // ==================== Persistence Methods ====================

  /**
   * Save analysis results to database
   */
  private async saveAnalysis(
    reportId: string,
    analysisType: 'single' | 'comparison',
    result: AnalysisOrchestrationResult,
    baselineReportId?: string,
  ): Promise<AwrAnalysis> {
    try {
      const analysis = this.awrAnalysisRepo.create({
        id: uuidv4(),
        awrReportId: reportId,
        analysisType,
        baselineReportId,
        insights: result.insights as unknown as EntityAwrInsight[],
        severitySummary: result.severitySummary,
        analysisVersion: result.analysisVersion,
        analyzedAt: new Date(),
      });

      const savedAnalysis = await this.awrAnalysisRepo.save(analysis);

      this.logger.log(`Saved analysis ${savedAnalysis.id} for report ${reportId}`);

      return savedAnalysis;
    } catch (error) {
      this.logger.error(`Failed to save analysis: ${this.extractErrorMessage(error)}`);
      throw new DatabaseException('Failed to save analysis results', error);
    }
  }

  // ==================== Helper Methods ====================

  /**
   * Get report from database
   */
  private async getReport(reportId: string): Promise<AwrReport> {
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
      this.logger.error(`Failed to get report: ${this.extractErrorMessage(error)}`);
      throw new DatabaseException('Failed to retrieve AWR report', error);
    }
  }

  /**
   * Get configuration based on options
   */
  private getConfig(options?: AnalysisOptions): AwrAnalysisConfig {
    if (options?.preset) {
      const baseConfig = getConfigByPreset(options.preset);
      if (options.configOverrides) {
        return createAwrAnalysisConfig({
          ...baseConfig,
          ...options.configOverrides,
        });
      }
      return baseConfig;
    }

    if (options?.configOverrides) {
      return createAwrAnalysisConfig(options.configOverrides);
    }

    return this.defaultConfig;
  }

  /**
   * Sort insights by impact score (highest first), then by severity
   */
  private sortInsightsByImpact(insights: AwrInsight[]): AwrInsight[] {
    const severityOrder: Record<InsightSeverity, number> = {
      critical: 0,
      warning: 1,
      info: 2,
    };

    return [...insights].sort((a, b) => {
      // First sort by impact score (descending)
      const impactA = a.impactScore ?? 0;
      const impactB = b.impactScore ?? 0;

      if (impactB !== impactA) {
        return impactB - impactA;
      }

      // Then by severity
      const severityA = severityOrder[a.severity] ?? 3;
      const severityB = severityOrder[b.severity] ?? 3;

      return severityA - severityB;
    });
  }

  /**
   * Calculate severity summary from insights
   */
  private calculateSeveritySummary(insights: AwrInsight[]): SeveritySummary {
    const summary: SeveritySummary = {
      critical: 0,
      warning: 0,
      info: 0,
      total: insights.length,
    };

    for (const insight of insights) {
      switch (insight.severity) {
        case 'critical':
          summary.critical++;
          break;
        case 'warning':
          summary.warning++;
          break;
        case 'info':
          summary.info++;
          break;
      }
    }

    return summary;
  }

  /**
   * Create empty severity summary
   */
  private createEmptySeveritySummary(): SeveritySummary {
    return {
      critical: 0,
      warning: 0,
      info: 0,
      total: 0,
    };
  }

  /**
   * Map analysis result to response DTO
   */
  private mapToResponseDto(
    result: AnalysisOrchestrationResult,
    reportId: string,
    analysisId?: string,
  ): AwrAnalysisResponseDto {
    return {
      id: analysisId || uuidv4(), // Generate temp ID if not persisted
      awrReportId: reportId,
      analysisType: 'single',
      insights: result.insights as unknown as EntityAwrInsight[],
      severitySummary: result.severitySummary,
      analyzedAt: new Date(),
      analysisVersion: result.analysisVersion,
    };
  }

  /**
   * Safely extract error message
   */
  private extractErrorMessage(error: unknown): string {
    if (error && typeof error === 'object' && 'message' in error) {
      return (error as Error).message;
    }
    return 'An unexpected error occurred';
  }
}
