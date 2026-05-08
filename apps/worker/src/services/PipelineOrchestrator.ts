import type { Logger } from 'pino';
import { PipelineConfiguration as _PipelineConfiguration, PipelineResult, PipelineStage as _PipelineStage } from '../types/pipeline.js';
import { logPipelineStart, logPipelineSuccess as _logPipelineSuccess, logPipelineError } from '../lib/utils/logger.js';

// Import pipeline implementations
import { MetricsPipeline } from '../pipelines/MetricsPipeline.js';
import { StatisticsPipeline } from '../pipelines/StatisticsPipeline.js';
import { AdaptPipeline } from '../pipelines/AdaptPipeline.js';
import { ChecksPipeline } from '../pipelines/ChecksPipeline.js';
import { ControlGroupsPipeline } from '../pipelines/ControlGroupsPipeline.js';
import { ControlGroupStatisticsPipeline } from '../pipelines/ControlGroupStatisticsPipeline.js';
import { PanelsPipeline } from '../pipelines/PanelsPipeline.js';
import { DynatracePipeline } from '../pipelines/DynatracePipeline.js';
import { PerformanceTestMetricsPipeline } from '../pipelines/PerformanceTestMetricsPipeline.js';
import { TransactionStatsRollupPipeline } from '../pipelines/TransactionStatsRollupPipeline.js';
import { IncrementalMetricsPipeline } from '../pipelines/IncrementalMetricsPipeline.js';

// Import services
import { MetricCollectionGapService } from './MetricCollectionGapService.js';
import { WorkerDatabaseService } from '../common/database.service.js';
import { ProgressReporter } from './ProgressReporter.js';
import type { DsMetricCollectionStatus } from '@perfana/shared/entities';

/**
 * Pipeline Orchestrator - Coordinates the execution of pipeline stages
 * Implements the complex orchestration patterns from the Python implementation:
 *
 * 1. Sequential Pipeline Execution (analyzeTest pattern)
 * 2. Parallel + Sequential Hybrid (batch processing)
 * 3. Re-evaluation Processing (benchmark updates)
 *
 * All pipelines use TypeORM for database access via NestJS dependency injection
 */
export class PipelineOrchestrator {
  private metricsPipeline: MetricsPipeline;
  private statisticsPipeline: StatisticsPipeline;
  private adaptPipeline: AdaptPipeline;
  private checksPipeline: ChecksPipeline;
  private controlGroupsPipeline: ControlGroupsPipeline;
  private controlGroupStatisticsPipeline: ControlGroupStatisticsPipeline;
  private panelsPipeline: PanelsPipeline;
  private dynatracePipeline: DynatracePipeline;
  private performanceTestMetricsPipeline: PerformanceTestMetricsPipeline;
  private transactionStatsRollupPipeline: TransactionStatsRollupPipeline;
  private incrementalMetricsPipeline: IncrementalMetricsPipeline;
  private gapService: MetricCollectionGapService;
  private databaseService: WorkerDatabaseService;

  constructor(
    private logger: Logger,
    databaseService: WorkerDatabaseService,
    gapService?: MetricCollectionGapService
  ) {
    // Initialize all pipeline services (all migrated to TypeORM)
    this.metricsPipeline = new MetricsPipeline(logger);
    this.statisticsPipeline = new StatisticsPipeline(logger);
    this.adaptPipeline = new AdaptPipeline(logger);
    this.checksPipeline = new ChecksPipeline(logger);
    this.controlGroupsPipeline = new ControlGroupsPipeline(logger);
    this.controlGroupStatisticsPipeline = new ControlGroupStatisticsPipeline(logger);
    this.panelsPipeline = new PanelsPipeline(logger);
    this.dynatracePipeline = new DynatracePipeline(logger);
    this.performanceTestMetricsPipeline = new PerformanceTestMetricsPipeline(logger);
    this.transactionStatsRollupPipeline = new TransactionStatsRollupPipeline(logger);
    this.incrementalMetricsPipeline = new IncrementalMetricsPipeline(logger);

    // Initialize services
    this.databaseService = databaseService;
    this.gapService = gapService || new MetricCollectionGapService(databaseService);
  }

  /**
   * Check if incremental metric collection is complete and attempt to fill gaps
   *
   * This method:
   * 1. Checks if incremental collection was used for this test run
   * 2. Determines if collection is complete (all sources marked complete)
   * 3. If incomplete, detects gaps and attempts to fill them
   * 4. Returns completion status and any warnings
   *
   * @param testRunId - The test run ID to check
   * @returns Object with completion status and warnings array
   */
  private async checkAndFillMetricGaps(
    testRunId: string
  ): Promise<{ complete: boolean; warnings: string[] }> {
    const warnings: string[] = [];

    try {
      // Check if incremental collection was used
      let statuses = await this.databaseService.getAllCollectionStatuses(testRunId);

      if (statuses.length === 0) {
        // No incremental collection - run traditional pipeline
        this.logger.debug(`No incremental collection statuses found for ${testRunId}`);
        return { complete: false, warnings: [] };
      }

      // Remove orphaned collection status records for sources that are no longer
      // configured (e.g. a Dynatrace config was removed during the test run).
      statuses = await this.removeOrphanedCollectionSources(testRunId, statuses);

      if (statuses.length === 0) {
        return { complete: false, warnings: [] };
      }

      this.logger.info(`📊 Checking incremental collection completeness for ${testRunId}`);

      // Check if collection is already complete
      if (await this.gapService.isCollectionComplete(testRunId)) {
        this.logger.info(`✅ Incremental collection complete for ${testRunId}, skipping metric collection stages`);
        return { complete: true, warnings: [] };
      }

      // Detect gaps in collection
      const gaps = await this.gapService.detectGaps(testRunId);
      this.logger.info(`🔍 Found ${gaps.length} sources with collection gaps for ${testRunId}`);

      // Mark sources with no gaps as complete
      // Sources that already have 100% coverage won't be in the gaps list
      const sourcesWithGaps = new Set(
        gaps.map((g) => `${g.sourceType}::${g.sourceId ?? 'null'}`)
      );

      for (const status of statuses) {
        if (status.is_complete) {
          continue; // Already complete
        }

        const sourceKey = `${status.source_type}::${status.source_id ?? 'null'}`;
        if (!sourcesWithGaps.has(sourceKey)) {
          // This source has no gaps - mark it as complete
          try {
            await this.gapService.markSourceComplete(
              testRunId,
              status.source_type,
              status.source_id ?? null
            );
            this.logger.info(
              `✅ Marked ${status.source_type}/${status.source_id ?? 'null'} as complete (no gaps detected)`
            );
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : 'Unknown error';
            this.logger.error(
              `❌ Failed to mark ${status.source_type}/${status.source_id ?? 'null'} as complete: ${errorMessage}`
            );
          }
        }
      }

      // Attempt to fill gaps for sources that have them
      for (const gap of gaps) {
        const sourceIdentifier = `${gap.sourceType}/${gap.sourceId ?? 'null'}`;
        let sourceHasErrors = false;

        // Process failed ranges (retry up to max attempts)
        for (const failedRange of gap.failedRanges) {
          if (failedRange.attempts >= 5) {
            warnings.push(
              `Max retries (5) exceeded for ${sourceIdentifier} range ${new Date(failedRange.from).toISOString()} - ${new Date(failedRange.to).toISOString()}`
            );
            sourceHasErrors = true;
            continue;
          }

          this.logger.info(
            `🔄 Retrying failed range for ${sourceIdentifier}: ${new Date(failedRange.from).toISOString()} - ${new Date(failedRange.to).toISOString()} (attempt ${failedRange.attempts + 1}/5)`
          );

          try {
            await this.retryCollectionForRange(
              testRunId,
              gap.sourceType,
              gap.sourceId,
              failedRange.from,
              failedRange.to
            );
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : 'Unknown error';
            this.logger.error(
              `❌ Failed to retry collection for ${sourceIdentifier}: ${errorMessage}`
            );
            warnings.push(
              `Retry failed for ${sourceIdentifier} range ${new Date(failedRange.from).toISOString()} - ${new Date(failedRange.to).toISOString()}: ${errorMessage}`
            );
            sourceHasErrors = true;
          }
        }

        // Process missing ranges
        for (const missingRange of gap.missingRanges) {
          this.logger.info(
            `📥 Collecting missing range for ${sourceIdentifier}: ${missingRange.from.toISOString()} - ${missingRange.to.toISOString()}`
          );

          try {
            await this.retryCollectionForRange(
              testRunId,
              gap.sourceType,
              gap.sourceId,
              missingRange.from,
              missingRange.to
            );
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : 'Unknown error';
            this.logger.error(
              `❌ Failed to collect missing range for ${sourceIdentifier}: ${errorMessage}`
            );
            warnings.push(
              `Collection failed for ${sourceIdentifier} range ${missingRange.from.toISOString()} - ${missingRange.to.toISOString()}: ${errorMessage}`
            );
            sourceHasErrors = true;
          }
        }

        // Mark source as complete if all gaps were filled successfully
        if (!sourceHasErrors) {
          try {
            await this.gapService.markSourceComplete(testRunId, gap.sourceType, gap.sourceId);
            this.logger.info(`✅ Marked ${sourceIdentifier} as complete after filling all gaps`);
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : 'Unknown error';
            this.logger.error(
              `❌ Failed to mark ${sourceIdentifier} as complete: ${errorMessage}`
            );
          }
        }
      }

      // Check completion status again after gap filling attempts
      const isComplete = await this.gapService.isCollectionComplete(testRunId);

      if (!isComplete) {
        const summary = await this.gapService.getCollectionSummary(testRunId);
        warnings.push(
          `Metric collection incomplete - proceeding with partial data (${summary.completeSources}/${summary.totalSources} sources complete, ${summary.coverage.toFixed(1)}% coverage)`
        );
        this.logger.warn(
          `⚠️ Collection incomplete for ${testRunId}: ${summary.completeSources}/${summary.totalSources} complete, ${summary.coverage.toFixed(1)}% coverage`
        );
      } else {
        this.logger.info(`✅ All gaps filled successfully for ${testRunId}`);
      }

      return { complete: isComplete, warnings };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`❌ Error checking/filling gaps for ${testRunId}: ${errorMessage}`);
      warnings.push(`Gap filling process failed: ${errorMessage}`);
      return { complete: false, warnings };
    }
  }

  /**
   * Remove collection status records for sources that are no longer configured
   * for the test run (e.g. a Dynatrace config removed during the test).
   *
   * Returns the filtered list of remaining statuses.
   */
  private async removeOrphanedCollectionSources(
    testRunId: string,
    statuses: DsMetricCollectionStatus[]
  ): Promise<DsMetricCollectionStatus[]> {
    const testRun = await this.databaseService.getTestRunByTestRunId(testRunId);
    if (!testRun) {
      return statuses;
    }

    // Build the set of currently configured source keys
    const configuredSources = new Set<string>();

    // performance_test is always valid
    configuredSources.add('performance_test::null');

    // Grafana sources: application_dashboards for this SUT/env
    const appDashboards = await this.databaseService.applicationDashboardRepo.find({
      where: {
        systemUnderTestId: testRun.systemUnderTestId,
        testEnvironment: testRun.testEnvironment,
      },
    });
    for (const ad of appDashboards) {
      if (ad.grafanaInstanceId) {
        configuredSources.add(`grafana::${ad.grafanaInstanceId}`);
      }
    }

    // Dynatrace sources: dynatrace_queries for this SUT/env/workload
    const dtConfigs = await this.databaseService.dataSource.query<Array<{ dynatrace_config_id: string }>>(
      `SELECT DISTINCT dynatrace_config_id FROM dynatrace_queries
       WHERE system_under_test_id = $1 AND test_environment = $2 AND workload = $3
         AND dynatrace_config_id IS NOT NULL`,
      [testRun.systemUnderTestId, testRun.testEnvironment, testRun.workload]
    );
    for (const row of dtConfigs) {
      configuredSources.add(`dynatrace::${row.dynatrace_config_id}`);
    }

    // Remove statuses that reference sources no longer configured
    const remaining: DsMetricCollectionStatus[] = [];
    for (const status of statuses) {
      const key = `${status.source_type}::${status.source_id ?? 'null'}`;
      if (configuredSources.has(key)) {
        remaining.push(status);
      } else {
        this.logger.info(
          `🗑️ Removing orphaned collection status for ${key} (source no longer configured)`
        );
        await this.databaseService.removeCollectionStatus(
          testRunId,
          status.source_type,
          status.source_id ?? null
        );
      }
    }

    return remaining;
  }

  /**
   * Retry collection for a specific time range and source
   *
   * @param testRunId - Test run ID
   * @param sourceType - Source type ('grafana', 'dynatrace', 'performance_test')
   * @param sourceId - Source ID (null for performance_test)
   * @param fromTime - Start of time range
   * @param toTime - End of time range
   */
  private async retryCollectionForRange(
    testRunId: string,
    sourceType: string,
    sourceId: string | null,
    fromTime: Date | string,
    toTime: Date | string
  ): Promise<void> {
    const from = fromTime instanceof Date ? fromTime : new Date(fromTime);
    const to = toTime instanceof Date ? toTime : new Date(toTime);

    // Use IncrementalMetricsPipeline to collect the specific range
    const result = await this.incrementalMetricsPipeline.execute({
      testRunId,
      fromTime: from,
      toTime: to,
      collectGrafanaMetrics: sourceType === 'grafana',
      collectDynatraceMetrics: sourceType === 'dynatrace',
      collectPerformanceTestMetrics: sourceType === 'performance_test',
      // Filter by specific source if needed
      ...(sourceType === 'grafana' && sourceId ? { grafanaInstanceId: sourceId } : {}),
      ...(sourceType === 'dynatrace' && sourceId ? { dynatraceConfigId: sourceId } : {}),
    });

    if (!result.success) {
      throw new Error(
        result.error?.message || `Collection failed for ${sourceType}/${sourceId ?? 'null'}`
      );
    }

    // Record the collected range so coverage calculations reflect the gap-filled data
    await this.databaseService.updateCollectedRanges(testRunId, sourceType, sourceId, { from, to });
  }

  /**
   * Add warnings to test run annotations
   *
   * @param testRunId - Test run ID
   * @param warnings - Array of warning messages
   */
  private async addWarningsToTestRun(
    testRunId: string,
    warnings: string[]
  ): Promise<void> {
    if (warnings.length === 0) {
      return;
    }

    try {
      // Get current test run
      const testRun = await this.databaseService.getTestRunByTestRunId(testRunId);
      if (!testRun) {
        this.logger.error(`Test run not found: ${testRunId}`);
        return;
      }

      // Append warnings to annotations
      const currentAnnotations = testRun.annotations || [];
      const warningAnnotations = warnings.map(
        (w) => `[COLLECTION WARNING] ${w}`
      );
      const updatedAnnotations = [...currentAnnotations, ...warningAnnotations];

      // Update test run
      await this.databaseService.updateTestRunByTestRunId(testRunId, {
        annotations: updatedAnnotations,
      });

      this.logger.info(`📝 Added ${warnings.length} collection warnings to test run ${testRunId}`);
    } catch (error) {
      this.logger.error(
        `Failed to add warnings to test run ${testRunId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Execute Sequential Pipeline - Single test run analysis
   * Replicates Python's analyze_test_task pipeline execution
   *
   * @param testRunId - Test run identifier
   * @param config - Pipeline configuration
   * @param progressReporter - Optional progress reporter for real-time updates
   */
  async executeSequentialPipeline(
    testRunId: string,
    config: {
      stages: string[];
      errorHandling?: 'strict' | 'continue' | 'abort';
      timeoutMs?: number;
    },
    progressReporter?: ProgressReporter
  ): Promise<PipelineResult> {
    const { stages, errorHandling = 'continue', timeoutMs = 600000 } = config;
    const startTime = Date.now();

    logPipelineStart(this.logger, 'sequential-pipeline', {
      testRunId,
      stages: stages.length,
      errorHandling
    });

    const results: Array<{ stage: string; result: PipelineResult; duration: number }> = [];
    let overallSuccess = true;
    let collectionWarnings: string[] = [];

    try {
      // Define metric collection stages that can be skipped if incremental collection is complete
      const metricCollectionStages = [
        'dynatrace-collection',
        'panels-processing',
        'performance-test-metrics',
        'metrics-collection'
      ];

      // Check if we should skip metric collection stages
      let skipMetricCollectionStages = false;
      const firstMetricStageIndex = stages.findIndex(stage => metricCollectionStages.includes(stage));

      if (firstMetricStageIndex !== -1) {
        // We have metric collection stages - check if incremental collection is complete
        const { complete: metricsComplete, warnings } = await this.checkAndFillMetricGaps(testRunId);
        collectionWarnings = warnings;

        if (metricsComplete) {
          skipMetricCollectionStages = true;
          this.logger.info(`⏭️ Skipping metric collection stages (incremental collection complete)`);
        }
      }

      // Execute stages sequentially
      for (const stageName of stages) {
        // Skip metric collection stages if incremental collection is complete
        if (skipMetricCollectionStages && metricCollectionStages.includes(stageName)) {
          this.logger.info(`⏭️ Skipping stage: ${stageName} (already collected via incremental collection)`);
          continue;
        }

        const stageStartTime = Date.now();

        try {
          // Report stage start to progress tracker
          if (progressReporter) {
            await progressReporter.startStage(stageName);
          }

          this.logger.info(`🔷 Starting stage: ${stageName} for test run ${testRunId}`);

          const result = await this.executeStage(stageName, testRunId, timeoutMs);
          const stageDuration = Date.now() - stageStartTime;

          results.push({ stage: stageName, result, duration: stageDuration });

          if (result.success) {
            this.logger.info(`✅ Stage ${stageName} completed in ${stageDuration}ms`);

            // Report stage completion to progress tracker
            if (progressReporter) {
              await progressReporter.completeStage();
            }
          } else {
            this.logger.warn(`⚠️ Stage ${stageName} failed in ${stageDuration}ms: ${result.error?.message}`);

            if (errorHandling === 'strict') {
              throw new Error(`Stage ${stageName} failed: ${result.error?.message}`);
            } else if (errorHandling === 'abort') {
              overallSuccess = false;
              break;
            } else {
              // 'continue' - log and continue to next stage
              overallSuccess = false;
              this.logger.info(`🔄 Continuing to next stage despite ${stageName} failure`);
            }
          }
        } catch (stageError) {
          const stageDuration = Date.now() - stageStartTime;
          const errorMessage = stageError instanceof Error ? stageError.message : String(stageError);

          this.logger.error(`❌ Stage ${stageName} error in ${stageDuration}ms: ${errorMessage}`);

          results.push({
            stage: stageName,
            duration: stageDuration,
            result: {
              success: false,
              stage: stageName,
              duration: stageDuration,
              error: {
                message: errorMessage,
                code: 'STAGE_EXECUTION_ERROR'
              }
            }
          });

          if (errorHandling === 'strict' || errorHandling === 'abort') {
            throw stageError;
          } else {
            overallSuccess = false;
          }
        }
      }

      const totalDuration = Date.now() - startTime;

      // Log stage breakdown
      this.logStageBreakdown(results, totalDuration);

      // Add any collection warnings to test run annotations
      if (collectionWarnings.length > 0) {
        await this.addWarningsToTestRun(testRunId, collectionWarnings);
      }

      this.logger.info(`✅ Sequential pipeline completed for ${testRunId} in ${totalDuration}ms`);

      // Report pipeline completion to progress tracker. Best-effort — a failure to
      // finalize progress reporting must not escape the orchestrator (issue #294).
      if (progressReporter) {
        try {
          await progressReporter.complete();
        } catch (reporterError) {
          this.logger.warn('progressReporter.complete() failed; pipeline result is unaffected', {
            testRunId,
            error: reporterError instanceof Error ? reporterError.message : String(reporterError)
          });
        }
      }

      return {
        success: overallSuccess,
        duration: totalDuration,
        data: {
          testRunId,
          stages: results,
          completedStages: results.filter(r => r.result.success).length,
          failedStages: results.filter(r => !r.result.success).length,
          timings: results.map(r => ({ stage: r.stage, duration: r.duration })),
          collectionWarnings: collectionWarnings.length > 0 ? collectionWarnings : undefined
        }
      };

    } catch (error) {
      const totalDuration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logPipelineError(this.logger, 'sequential-pipeline', error as Error, {
        testRunId,
        completedStages: results.length,
        duration: totalDuration
      });

      // Report pipeline failure to progress tracker. Best-effort — a failure here
      // would otherwise become a second throw escaping the catch block, surface as
      // an unhandled rejection, and shut the worker down (issue #294).
      if (progressReporter) {
        try {
          await progressReporter.fail(errorMessage);
        } catch (reporterError) {
          this.logger.warn('progressReporter.fail() failed; pipeline error is still reported via return value', {
            testRunId,
            error: reporterError instanceof Error ? reporterError.message : String(reporterError)
          });
        }
      }

      return {
        success: false,
        duration: totalDuration,
        error: {
          message: errorMessage,
          code: 'SEQUENTIAL_PIPELINE_ERROR',
          details: {
            testRunId,
            completedStages: results.map(r => r.stage)
          }
        }
      };
    }
  }

  /**
   * Log a breakdown of stage timings with percentages
   */
  private logStageBreakdown(
    results: Array<{ stage: string; result: PipelineResult; duration: number }>,
    totalDuration: number
  ): void {
    this.logger.info(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 STAGE TIMING BREAKDOWN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${results.map(r => {
  const percentage = ((r.duration / totalDuration) * 100).toFixed(1);
  const bar = '█'.repeat(Math.round((r.duration / totalDuration) * 40));
  const status = r.result.success ? '✅' : '❌';
  return `${status} ${r.stage.padEnd(30)} ${r.duration.toString().padStart(7)}ms ${percentage.padStart(5)}% ${bar}`;
}).join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 Total Pipeline Duration: ${totalDuration}ms
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
  }

  /**
   * Execute a single pipeline stage
   * Maps stage names to their corresponding pipeline implementations
   */
  private async executeStage(
    stageName: string,
    testRunId: string,
    timeoutMs: number = 300000
  ): Promise<PipelineResult> {
    // Create proper input format - most pipelines expect { testRunIds: string[] }
    const batchInput = { testRunIds: [testRunId] };
    const singleInput = { testRunId };

    // Create a timeout promise with cleanup
    let timeoutHandle: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<PipelineResult>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`Stage ${stageName} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    let executionPromise: Promise<PipelineResult>;

    // Map stage names to pipeline implementations
    switch (stageName) {
      case 'dynatrace-collection':
        executionPromise = this.dynatracePipeline.execute(batchInput);
        break;

      case 'panels-processing':
        executionPromise = this.panelsPipeline.execute(singleInput);
        break;

      case 'performance-test-metrics':
        executionPromise = this.performanceTestMetricsPipeline.execute(singleInput);
        break;

      case 'transaction-stats-rollup':
        // Soft-fail: a rollup miss doesn't break the dashboard (the API falls
        // back to live aggregation when rollup rows are missing), so a failure
        // here must NOT abort the rest of analyze-test (ADAPT, statistics,
        // checks). Log the error and return success to the orchestrator.
        // See: issues #150, #151.
        executionPromise = this.transactionStatsRollupPipeline.execute(singleInput)
          .then(result => {
            if (!result.success) {
              this.logger.warn(
                `transaction-stats-rollup failed but continuing (dashboard will fall back to live aggregation): ${result.error?.message ?? 'unknown error'}`
              );
              return {
                success: true,
                data: {
                  skipped: 'rollup-failed',
                  reason: result.error?.message ?? 'unknown error',
                },
              } satisfies PipelineResult;
            }
            return result;
          })
          .catch(err => {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.warn(
              `transaction-stats-rollup threw but continuing: ${msg}`
            );
            return {
              success: true,
              data: { skipped: 'rollup-threw', reason: msg },
            } satisfies PipelineResult;
          });
        break;

      case 'metrics-collection':
        executionPromise = this.metricsPipeline.execute(singleInput);
        break;

      case 'statistics-calculation':
        executionPromise = this.statisticsPipeline.execute(batchInput);
        break;

      case 'control-groups-creation':
        executionPromise = this.controlGroupsPipeline.execute(batchInput);
        break;

      case 'control-group-statistics':
        executionPromise = this.controlGroupStatisticsPipeline.execute(batchInput);
        break;

      case 'checks-evaluation':
        executionPromise = this.checksPipeline.execute(batchInput);
        break;

      case 'adapt-analysis':
        executionPromise = this.adaptPipeline.execute(batchInput);
        break;

      default:
        return {
          success: false,
          stage: stageName,
          error: {
            message: `Unknown stage: ${stageName}`,
            code: 'UNKNOWN_STAGE'
          }
        };
    }

    try {
      // Race between execution and timeout
      const result = await Promise.race([executionPromise, timeoutPromise]);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        stage: stageName,
        error: {
          message: errorMessage,
          code: error instanceof Error && error.message.includes('timed out') ? 'TIMEOUT' : 'EXECUTION_ERROR'
        }
      };
    } finally {
      // Always clear the timeout to prevent unhandled rejection after Promise.race completes
      clearTimeout(timeoutHandle!);
    }
  }

}