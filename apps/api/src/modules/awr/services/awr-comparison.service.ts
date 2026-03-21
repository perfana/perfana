/**
 * AWR Comparison Service (Orchestrator)
 *
 * Orchestrates AWR report comparison by delegating to specialized services.
 * This is a thin orchestrator that coordinates:
 * - Data fetching and validation
 * - Comparison execution
 * - Detailed comparison building (SQL, wait events, load profile)
 * - Result persistence
 * - Summary generation
 *
 * Key features:
 * - Compares two AWR reports (current vs baseline)
 * - Builds detailed SQL, wait event, and load profile comparisons
 * - Stores comparison results to database
 * - Provides available baselines for comparison selection
 * - Configurable comparison thresholds
 */

import { Injectable, Logger } from '@nestjs/common';
import { AwrAnalysis } from '../entities/awr-analysis.entity';
import { ValidationException } from '../../../common/exceptions/business.exception';
import {
  ComparisonDataFetcherService,
  ComparisonExecutorService,
  SqlComparisonBuilderService,
  WaitEventComparisonBuilderService,
  LoadProfileComparisonBuilderService,
  ComparisonResultPersisterService,
  ComparisonSummaryBuilderService,
  ComparisonExecutionOptions,
} from './comparison';
import {
  CompareReportsDto,
  CompareTestRunAwrReportsDto,
  ComparisonResponseDto,
  ComparisonSummaryDto,
  AvailableBaselinesResponseDto,
} from '../dto';

/**
 * Orchestrator service for AWR report comparison
 * Coordinates specialized services to perform comparisons and manage results.
 */
@Injectable()
export class AwrComparisonService {
  private readonly logger = new Logger(AwrComparisonService.name);

  constructor(
    private readonly dataFetcher: ComparisonDataFetcherService,
    private readonly executor: ComparisonExecutorService,
    private readonly sqlBuilder: SqlComparisonBuilderService,
    private readonly waitEventBuilder: WaitEventComparisonBuilderService,
    private readonly loadProfileBuilder: LoadProfileComparisonBuilderService,
    private readonly persister: ComparisonResultPersisterService,
    private readonly summaryBuilder: ComparisonSummaryBuilderService,
  ) {}

  // ==================== Main Comparison Methods ====================

  /**
   * Compare two AWR reports by their IDs
   *
   * @param dto - Comparison request with report IDs and options
   * @returns Comparison response with insights and detailed comparisons
   */
  async compareReports(dto: CompareReportsDto): Promise<ComparisonResponseDto> {
    const startTime = Date.now();
    this.logger.log(`Starting comparison: ${dto.currentReportId} vs ${dto.baselineReportId}`);

    // Fetch and validate reports
    const [currentReport, baselineReport] = await this.dataFetcher.getReportsForComparison(
      dto.currentReportId,
      dto.baselineReportId,
    );

    // Build execution options
    const executionOptions = this.buildExecutionOptions(dto);

    // Execute comparison
    const executionResult = this.executor.executeComparison(
      currentReport.parsedData!,
      baselineReport.parsedData!,
      executionOptions,
    );

    // Build detailed comparisons if requested
    const sqlComparison =
      dto.includeSqlComparison !== false
        ? this.sqlBuilder.buildSqlComparison(
            currentReport.parsedData!,
            baselineReport.parsedData!,
            executionResult.config,
            dto.maxSqlStatements ?? 50,
          )
        : undefined;

    const waitEventComparison =
      dto.includeWaitEventComparison !== false
        ? this.waitEventBuilder.buildWaitEventComparison(
            currentReport.parsedData!,
            baselineReport.parsedData!,
            executionResult.config,
          )
        : undefined;

    const loadProfileComparison =
      dto.includeLoadProfileComparison !== false
        ? this.loadProfileBuilder.buildLoadProfileComparison(
            currentReport.parsedData!,
            baselineReport.parsedData!,
            executionResult.config,
          )
        : undefined;

    // Calculate severity summary
    const severitySummary = this.summaryBuilder.calculateSeveritySummary(
      executionResult.insights,
    );

    // Save to database (default: true)
    await this.persister.saveComparisonAnalysis(dto.currentReportId, dto.baselineReportId, {
      insights: executionResult.insights,
      severitySummary,
      comparisonVersion: executionResult.comparisonVersion,
    });

    const totalDuration = Date.now() - startTime;
    this.logger.log(
      `Comparison complete: ${executionResult.insights.length} insights in ${totalDuration}ms`,
    );

    return {
      currentReportId: dto.currentReportId,
      baselineReportId: dto.baselineReportId,
      insights: executionResult.insights,
      severitySummary,
      sqlComparison,
      waitEventComparison,
      loadProfileComparison,
      comparedAt: new Date(),
      comparisonVersion: executionResult.comparisonVersion,
      comparisonDurationMs: executionResult.comparisonDurationMs,
    };
  }

  /**
   * Compare AWR reports between test runs
   *
   * Uses the latest completed reports from each test run if specific IDs not provided.
   *
   * @param dto - Test run comparison request
   * @returns Comparison response
   */
  async compareTestRunReports(
    dto: CompareTestRunAwrReportsDto,
  ): Promise<ComparisonResponseDto> {
    // Get report IDs (use specified or find latest)
    const currentReportId =
      dto.currentReportId || (await this.dataFetcher.getLatestReportId(dto.currentTestRunId));
    const baselineReportId =
      dto.baselineReportId || (await this.dataFetcher.getLatestReportId(dto.baselineTestRunId));

    if (!currentReportId) {
      throw new ValidationException(
        `No completed AWR reports found for current test run ${dto.currentTestRunId}`,
      );
    }

    if (!baselineReportId) {
      throw new ValidationException(
        `No completed AWR reports found for baseline test run ${dto.baselineTestRunId}`,
      );
    }

    // Convert to standard comparison DTO
    const compareDto: CompareReportsDto = {
      currentReportId,
      baselineReportId,
      regressionThresholdPercent: dto.significantChangeThreshold,
      improvementThresholdPercent: dto.significantChangeThreshold,
    };

    return this.compareReports(compareDto);
  }

  /**
   * Get comparison summary for quick overview
   *
   * @param currentReportId - Current report ID
   * @param baselineReportId - Baseline report ID
   * @returns Quick comparison summary
   */
  async getComparisonSummary(
    currentReportId: string,
    baselineReportId: string,
  ): Promise<ComparisonSummaryDto> {
    // Check for existing comparison analysis
    const existingAnalysis = await this.persister.getExistingComparison(
      currentReportId,
      baselineReportId,
    );

    if (existingAnalysis) {
      return this.summaryBuilder.buildSummaryFromAnalysis(existingAnalysis);
    }

    // Run quick comparison to generate summary
    const [currentReport, baselineReport] = await this.dataFetcher.getReportsForComparison(
      currentReportId,
      baselineReportId,
    );

    const executionResult = this.executor.executeComparison(
      currentReport.parsedData!,
      baselineReport.parsedData!,
      {},
    );

    return this.summaryBuilder.buildSummaryFromInsights(executionResult.insights);
  }

  // ==================== Baseline Discovery Methods ====================

  /**
   * Get available baselines for comparison with a report
   *
   * @param reportId - Current report ID
   * @param limit - Maximum baselines to return
   * @returns Available baselines
   */
  async getAvailableBaselines(
    reportId: string,
    limit: number = 20,
  ): Promise<AvailableBaselinesResponseDto> {
    return this.dataFetcher.getAvailableBaselines(reportId, limit);
  }

  /**
   * Get available baselines for a test run
   *
   * @param testRunId - Current test run ID
   * @param limit - Maximum baselines to return
   * @returns Available baselines
   */
  async getAvailableBaselinesForTestRun(
    testRunId: string,
    limit: number = 20,
  ): Promise<AvailableBaselinesResponseDto> {
    return this.dataFetcher.getAvailableBaselinesForTestRun(testRunId, limit);
  }

  // ==================== Retrieval Methods ====================

  /**
   * Get existing comparison analysis between two reports
   */
  async getExistingComparison(
    currentReportId: string,
    baselineReportId: string,
  ): Promise<AwrAnalysis | null> {
    return this.persister.getExistingComparison(currentReportId, baselineReportId);
  }

  /**
   * Get comparison response from existing analysis
   */
  async getComparisonResponse(
    currentReportId: string,
    baselineReportId: string,
  ): Promise<ComparisonResponseDto | null> {
    const analysis = await this.persister.getExistingComparison(currentReportId, baselineReportId);

    if (!analysis) {
      return null;
    }

    return {
      currentReportId,
      baselineReportId,
      insights: analysis.insights || [],
      severitySummary:
        analysis.severitySummary || this.summaryBuilder.createEmptySeveritySummary(),
      comparedAt: analysis.analyzedAt,
      comparisonVersion: analysis.analysisVersion,
    };
  }

  /**
   * Check if comparison exists between two reports
   */
  async hasComparison(currentReportId: string, baselineReportId: string): Promise<boolean> {
    return this.persister.hasComparison(currentReportId, baselineReportId);
  }

  // ==================== Delete Methods ====================

  /**
   * Delete comparison analyses for a report
   */
  async deleteComparisonsForReport(reportId: string): Promise<number> {
    return this.persister.deleteComparisonsForReport(reportId);
  }

  // ==================== Private Helper Methods ====================

  /**
   * Build execution options from DTO
   */
  private buildExecutionOptions(dto: CompareReportsDto): ComparisonExecutionOptions {
    return {
      regressionThresholdPercent: dto.regressionThresholdPercent,
      improvementThresholdPercent: dto.improvementThresholdPercent,
      includeInfoInsights: false,
      debug: false,
    };
  }
}
