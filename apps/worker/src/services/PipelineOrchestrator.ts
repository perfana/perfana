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
import { HEAVY_STAGES, HeavyStageMutex } from './HeavyStageMutex.js';
import type { DsMetricCollectionStatus } from '@perfana/shared/entities';
import { collectionSourceKey, getConfiguredSourceKeys } from './collectable-sources.js';

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
/**
 * The stage names `executeStage` can dispatch, in pipeline order.
 *
 * Anything outside this list falls through to the `default` branch, which returns
 * success:false — and under `errorHandling: 'abort'` that fails the whole run. That is not
 * hypothetical: analyze.ts passed 'data-sanity-check' (which runs outside the orchestrator)
 * in its execution plan, and every analysis reported 'partial' until v0.2.74.0. Callers should
 * type their plan as OrchestratedStage[] so a stage with no case here is a compile error.
 */
export const ORCHESTRATED_STAGES = [
  'dynatrace-collection',
  'panels-processing',
  'performance-test-metrics',
  'transaction-stats-rollup',
  'metrics-collection',
  'statistics-calculation',
  'checks-evaluation',
  'control-groups-creation',
  'control-group-statistics',
  'adapt-analysis',
] as const;

export type OrchestratedStage = (typeof ORCHESTRATED_STAGES)[number];

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
   * 4. Returns whether the full collection stages can be skipped, and any warnings
   *
   * `skipCollection` is "incremental collection existed", NOT "every source is complete".
   * Until v0.2.95.20 an incomplete source sent the run down the full-collection path —
   * every stage, every source, opening with `DELETE FROM ds_metrics WHERE test_run_id`
   * and a re-fetch of the whole window from Grafana and Dynatrace — even though this
   * method had just retried every missing and failed range per source, so the full
   * pass could not return anything the retry had not. On a large run that was tens of
   * millions of row-store deletes and ~200 MB/s of WAL on every completion, and one
   * source that errors throughout a run (a bad DQL, an expired token) made it happen on
   * every analysis of that workload, forever. The warning emitted below has always said
   * "proceeding with partial data"; now the code does what it says. The incomplete
   * sources keep `is_complete = false`, so the sanity check scores their coverage and a
   * later re-analysis retries their failed ranges (capped at 5 attempts).
   *
   * @param testRunId - The test run ID to check
   * @returns Object with skipCollection flag and warnings array
   */
  private async checkAndFillMetricGaps(
    testRunId: string
  ): Promise<{ skipCollection: boolean; warnings: string[] }> {
    const warnings: string[] = [];
    // Set once we know incremental collection ran, so a failure later in this method
    // (detectGaps throwing, a fill erroring) still means "keep what was collected".
    let hadIncremental = false;

    try {
      // Check if incremental collection was used
      let statuses = await this.databaseService.getAllCollectionStatuses(testRunId);

      if (statuses.length === 0) {
        // No incremental collection - run traditional pipeline
        this.logger.debug(`No incremental collection statuses found for ${testRunId}`);
        return { skipCollection: false, warnings: [] };
      }

      // Remove orphaned collection status records for sources that are no longer
      // configured (e.g. a Dynatrace config was removed during the test run).
      statuses = await this.removeOrphanedCollectionSources(testRunId, statuses);

      if (statuses.length === 0) {
        return { skipCollection: false, warnings: [] };
      }
      hadIncremental = true;

      this.logger.info(`📊 Checking incremental collection completeness for ${testRunId}`);

      // Check if collection is already complete
      if (await this.gapService.isCollectionComplete(testRunId)) {
        this.logger.info(`✅ Incremental collection complete for ${testRunId}, skipping metric collection stages`);
        return { skipCollection: true, warnings: [] };
      }

      // Detect gaps in collection
      const gaps = await this.gapService.detectGaps(testRunId);
      this.logger.info(`🔍 Found ${gaps.length} sources with collection gaps for ${testRunId}`);

      // Mark sources with no gaps as complete
      // Sources that already have 100% coverage won't be in the gaps list
      const sourcesWithGaps = new Set(
        gaps.map((g) => collectionSourceKey(g.sourceType, g.sourceId))
      );

      for (const status of statuses) {
        if (status.is_complete) {
          continue; // Already complete
        }
        // detectGaps never reports the perf-test row, so "no gaps" says nothing about it.
        // Its is_complete is the perf-test stage's finalisation marker (see
        // PerformanceTestMetricsPipeline.planFullCollection): certifying it here, before that
        // stage runs, made every ticked run skip its own finalisation.
        if (status.source_type === 'performance_test') {
          continue;
        }

        const sourceKey = collectionSourceKey(status.source_type, status.source_id);
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
          `⚠️ Collection incomplete for ${testRunId}: ${summary.completeSources}/${summary.totalSources} complete, ${summary.coverage.toFixed(1)}% coverage — keeping the incremental data, not re-collecting`
        );
      } else {
        this.logger.info(`✅ All gaps filled successfully for ${testRunId}`);
      }

      return { skipCollection: true, warnings };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`❌ Error checking/filling gaps for ${testRunId}: ${errorMessage}`);
      warnings.push(`Gap filling process failed: ${errorMessage}`);
      return { skipCollection: hadIncremental, warnings };
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

    // Shared with DataSanityCheckPipeline's sweep and with IncrementalCollectionScheduler.
    // This copy previously had NEITHER the dq.enabled filter nor the artificial/tagged
    // Grafana filter, and it runs FIRST — before any stage — so a dead source it kept was
    // gap-filled, and could flip isCollectionComplete() to true and skip every collection
    // stage for the run.
    const configuredSources = await getConfiguredSourceKeys(this.databaseService, testRun);

    // Remove statuses that reference sources no longer configured
    const remaining: DsMetricCollectionStatus[] = [];
    for (const status of statuses) {
      const key = collectionSourceKey(status.source_type, status.source_id);
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
   * @param sourceId - Source ID ('' for performance_test — the row's NOT NULL sentinel; null is normalised to '')
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

  /** Best-effort: a failure here leaves the collection to hit the DML limit it always did. */
  private async decompressRunSpanForCollection(testRunId: string): Promise<void> {
    try {
      const run = await this.databaseService.getTestRunByTestRunId(testRunId);
      if (!run?.startTime) {return;}
      await this.databaseService.decompressChunksForRange('ds_metrics', run.startTime, run.endTime ?? new Date());
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err ? (err as Error).message : String(err);
      this.logger.warn(`Could not decompress ${testRunId}'s span before collection: ${msg}`);
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
      /**
       * Wall-clock budget PER STAGE (not for the pipeline), applied to every stage outside
       * HEAVY_STAGES. The HEAVY_STAGES are exempt: Postgres already bounds every statement they run
       * (statement_timeout, 540 s), and a wall-clock race on top of that cancels nothing —
       * it only abandons the promise, so the aggregation keeps running on the database
       * while the job reports `partial`, frees its slot, and the next job starts on top of
       * it. That is how 4 parallel analyses became 3 failures on 2026-09-11.
       */
      timeoutMs?: number;
      /**
       * Serialises the HEAVY_STAGES across the deployment. Omit to run them unguarded
       * (tests, and the re-evaluate orchestrator, which drives those pipelines as
       * separate jobs it waits on for at most JOB_WAIT_TIMEOUT_MS).
       */
      heavyStageMutex?: HeavyStageMutex;
      /**
       * Whether this method publishes the terminal progress event. Default true.
       *
       * Pass false when the caller runs more work after the pipeline: the web client stops
       * accepting progress for a job the moment `job:completed` arrives (useJobProgress drops
       * later events for 30s), so a stage reported after finalization is never rendered and the
       * UI's last frame is "Stage 10 of 11". The caller must then call complete()/fail() itself.
       */
      finalizeProgress?: boolean;
    },
    progressReporter?: ProgressReporter
  ): Promise<PipelineResult> {
    const { stages, errorHandling = 'continue', timeoutMs = 600000, finalizeProgress = true, heavyStageMutex } = config;
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
      // Stages that gap-filling an incremental collection makes redundant.
      const metricCollectionStages = [
        'dynatrace-collection',
        'panels-processing',
        'performance-test-metrics',
        'metrics-collection'
      ];
      // performance-test-metrics is NOT skipped here: the pipeline decides for itself
      // (PerformanceTestMetricsPipeline.planFullCollection). When the ticks wrote the run
      // at the bucket size its length calls for it only aggregates the tail after the last
      // tick; when they did not — no ticks, an aborted run, rows off the grid — it deletes
      // and rebuilds, which reads requests_raw in this database and preserves the other
      // sources' rows. Skipping it blindly made ADAPT compare per-minute error counts
      // against run totals (v0.2.95.22).
      const skippableCollectionStages = metricCollectionStages.filter(
        (stage) => stage !== 'performance-test-metrics'
      );

      // Check if we should skip metric collection stages
      let skipMetricCollectionStages = false;
      const firstMetricStageIndex = stages.findIndex(stage => metricCollectionStages.includes(stage));

      if (firstMetricStageIndex !== -1) {
        // We have metric collection stages - gap-fill the incremental collection if there
        // was one. The full stages run only when there was none (SUT import, legacy run).
        const { skipCollection, warnings } = await this.checkAndFillMetricGaps(testRunId);
        collectionWarnings = warnings;

        if (skipCollection) {
          skipMetricCollectionStages = true;
          this.logger.info(`⏭️ Skipping Grafana/Dynatrace collection stages (incremental collection gap-filled)`);
        } else {
          // A full collection on a run whose chunks are already compressed — a re-analysis
          // of a run older than compress_after (2 days since migration 1805, 7 before) whose
          // incremental status never completed — is thousands of INSERT ... ON CONFLICT DO
          // UPDATE into columnstore. TimescaleDB decompresses each matching batch as DML,
          // which reads as a stage stuck at "Metric collection" for ten minutes and then
          // `tuple decompression limit exceeded`. Decompress the run's span first, the way
          // the force re-fetch does; on a fresh run every chunk is row store and this is a
          // no-op. The chunks go back in analyze.ts's finally. The perf-test stage on the
          // skipped path looks after itself: its rebuild's DELETE drops whole compressed
          // segments and needs nothing, and its tail pass decompresses its own span.
          await this.decompressRunSpanForCollection(testRunId);
        }
      }

      // Execute stages sequentially
      for (const stageName of stages) {
        // Skip the external-source collection stages if incremental collection is complete
        if (skipMetricCollectionStages && skippableCollectionStages.includes(stageName)) {
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

          const heavy = HEAVY_STAGES.has(stageName);
          let releaseHeavyStage: (() => Promise<void>) | null = null;
          if (heavy && heavyStageMutex) {
            try {
              // The holder id names another run (possibly another organisation's), so it goes
              // to the worker log only; the progress record everyone in the scope sees is neutral.
              releaseHeavyStage = await heavyStageMutex.acquire(async (holder) => {
                this.logger.info(`${stageName} for ${testRunId} queued behind heavy stage of ${holder}`);
                await progressReporter?.setWaiting(
                  `Queued: waiting for another analysis to finish its database-heavy stage before ${stageName} can start`,
                );
              });
            } catch (acquireError) {
              // Nothing about the RUN failed — the lock gave up after its ceiling, or Redis
              // errored. Tag it so analyze.ts rethrows into the retry policy instead of
              // recording 'partial' (BullMQ completed, analysis silently dropped).
              (acquireError as Error & { retryable?: boolean }).retryable = true;
              throw acquireError;
            } finally {
              // On the give-up throw too, or the terminal progress record says "Queued: ...".
              await progressReporter?.setWaiting(null);
            }
          }

          // A heavy stage publishes nothing while it runs and has no wall-clock bound, but the
          // progress record expires after LOCK_TTL_SECONDS (5 min): the API then evicts the
          // job from the scope and the UI goes blank while the scope lock still refuses new
          // runs. Keep the record alive for the duration.
          const keepAlive = heavy && progressReporter
            ? setInterval(() => void progressReporter.touch(), 60_000)
            : null;

          let result: PipelineResult;
          try {
            result = await this.executeStage(stageName, testRunId, heavy ? null : timeoutMs);
          } finally {
            if (keepAlive) {clearInterval(keepAlive);}
            // Release on every path, including the timeout one, or a stage that exits early
            // holds the lock for its full TTL and every other analysis queues behind a ghost.
            await releaseHeavyStage?.();
          }
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
                code: (stageError as { retryable?: boolean } | null)?.retryable ? 'RETRYABLE' : 'STAGE_EXECUTION_ERROR'
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
      if (progressReporter && finalizeProgress) {
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
      if (progressReporter && finalizeProgress) {
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
    timeoutMs: number | null = 300000
  ): Promise<PipelineResult> {
    // Create proper input format - most pipelines expect { testRunIds: string[] }
    const batchInput = { testRunIds: [testRunId] };
    const singleInput = { testRunId };

    // Wall-clock race. null = none: the stage is bounded by Postgres instead (see the
    // timeoutMs doc on executeSequentialPipeline). A rejected race does NOT stop the
    // pipeline promise — it keeps running to completion on the database.
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<PipelineResult>((_, reject) => {
      if (timeoutMs === null) {return;}
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
        // Programmer error, not a data problem: the caller asked for a stage this orchestrator
        // has no case for. Returning success:false alone is what let analyze.ts quietly report
        // 'partial' for months, so say it at error level too.
        this.logger.error(
          `BUG: no orchestrator case for stage '${stageName}' — it will fail the run under errorHandling:'abort'. ` +
          `Valid stages: ${ORCHESTRATED_STAGES.join(', ')}`,
        );
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
      const retryable = Boolean((error as { retryable?: boolean } | null)?.retryable);
      return {
        success: false,
        stage: stageName,
        error: {
          message: errorMessage,
          code: retryable
            ? 'RETRYABLE'
            : error instanceof Error && error.message.includes('timed out') ? 'TIMEOUT' : 'EXECUTION_ERROR'
        }
      };
    } finally {
      // Always clear the timeout to prevent unhandled rejection after Promise.race completes
      clearTimeout(timeoutHandle);
    }
  }

}