import { BasePipelineTypeORM } from './BasePipelineTypeORM.js';
import { PipelineResult } from '../types/pipeline.js';
import { EntityManager } from 'typeorm';
import type {
  SubstageEntry,
} from './helpers/adapt/index.js';
import {
  AdaptValidator,
  ResultsProcessor,
  formatSubstageBreakdown,
} from './helpers/adapt/index.js';

/**
 * ADAPT Pipeline - Orchestrator
 *
 * Automated Detection of Anomalies in Performance Tests.
 * Delegates all processing to specialized helper classes.
 */
export class AdaptPipeline extends BasePipelineTypeORM {
  private validator: AdaptValidator;
  private resultsProcessor: ResultsProcessor;

  constructor(logger: import('pino').Logger) {
    super(logger);
    this.validator = new AdaptValidator(logger);
    this.resultsProcessor = new ResultsProcessor(logger);
  }

  validateInput(input: unknown): boolean {
    return this.validator.validateInput(input).valid;
  }

  async execute(input: unknown): Promise<PipelineResult> {
    const startTime = Date.now();

    const validationResult = this.validator.validateInput(input);
    if (!validationResult.valid) {
      return this.createErrorResult(
        validationResult.error || 'Invalid input: expected { testRunIds: string[], ... }',
        'INVALID_INPUT'
      );
    }

    const {
      testRunIds,
      updateResults = true,
      updateConclusion = true,
      updateTrackedResults = true,
      applicationDashboardId,
      panelId,
      metricName
    } = validationResult.input!;

    try {
      // Verify DB connection is alive before starting long-running pipeline
      await this.ensureConnection();

      this.logger.info(`Starting ADAPT analysis for test runs: ${testRunIds.join(', ')}`);
      const subStages: SubstageEntry[] = [];

      // Cleanup stale data BEFORE transaction (commits immediately)
      const cleanup = await this.cleanupStaleApplicationDashboards([
        'ds_adapt_results', 'ds_adapt_tracked_results', 'ds_compare_config'
      ]);
      subStages.push({ stage: 'cleanup-stale-data', duration: cleanup.duration, rows: cleanup.totalDeleted });

      const result = await this.withAnalyticsTransaction(async (manager: EntityManager) => {
        // JIT off for THIS transaction only, and deliberately not in
        // withAnalyticsTransaction — StatisticsPipeline is measurably faster with
        // it on, so the shared helper must not carry this.
        //
        // Postgres gates JIT on total plan cost, but that cost is driven by row
        // count while JIT's compile cost is driven by the SIZE and NESTING of the
        // expressions it has to compile. The ds_adapt_results upsert is the
        // pathological corner: a huge generated jsonb target list
        // (buildStatisticsColumns + buildConclusionLogic + the three threshold
        // CTEs) over a moderate row count. Estimated cost 2,561,177 clears
        // jit_above_cost and the 500k inline/optimize thresholds, so LLVM runs -O3
        // over the lot.
        //
        // Do NOT read this as "many functions = slow to compile" — our own numbers
        // refute that: StatisticsPipeline compiles 102 functions in 2,155 ms while
        // this one compiles 73 in 64,215 ms. Both clear the 500k thresholds. What
        // differs is how big and deeply nested the individual expressions are.
        //
        // Measured on prod-shaped data, SONAR-acceptatie-loadtest_perfana-00004
        // (20,598 metrics), EXPLAIN (ANALYZE, BUFFERS), same statement both ways:
        //   jit on : 87,308 ms total, JIT footer 64,215 ms (optimize 36.2s, emit 27.0s)
        //   jit off: 13,255 ms total
        // The 64,215 ms is the honest number — it is read straight off the JIT
        // footer and no cache state can inflate it. The 87.3 -> 13.3 total is NOT
        // clean: the two arms ran in sequence, so the second had a warmer cache
        // (21,816 vs 8,580 blocks read), and ~9.8s of the gap is still unexplained
        // after subtracting JIT. Trust the direction and the 64s; do not quote the
        // totals as a precise saving without re-measuring in alternating order.
        //
        // Threshold tuning is not a substitute: dropping inline+optimize still
        // leaves ~27s of emission. (jit_expressions=off / jit_tuple_deforming=off
        // would skip emission with jit=on, but they are developer options and
        // equivalent to jit=off here, so use the plain lever.)
        //
        // The other two withAnalyticsTransaction callers were measured too, which
        // is why this line is here and not in the shared helper:
        //   StatisticsPipeline       157,032 ms on / 174,672 ms off — JIT WINS (102
        //                            functions amortized over millions of ds_metrics
        //                            rows; compile cost only 2,155 ms). Do not
        //                            disable it there.
        //   ControlGroupStatistics   cost 93,338 — under jit_above_cost, never JITs.
        //                            No effect either way, but it sits close enough
        //                            to 100k that a larger control group crosses it.
        //
        // This is also a correctness margin, not only a speed one. AdaptPipeline
        // never calls setAggregationBudget, so it runs on the 120s
        // ANALYTICS_STATEMENT_TIMEOUT_MS cap — 87.3s was 73% of the whole budget
        // spent before the real work started, and a slightly larger run would have
        // been cancelled and rolled the entire ADAPT transaction back. The 2-run
        // batch this was found on was at 109s: 91% of the cap.
        //
        // That cap is also why hardcoding this cannot backfire on a big batch.
        // ADAPT gets every testRunId in one job and the upsert is a single
        // statement, so rows scale with batch size while the 64s compile stays
        // fixed — JIT would only start paying somewhere past ~5 runs. But at
        // ~13s/run with JIT off, a 9-run batch already exceeds the 120s cap. Any
        // batch big enough for JIT to win is already failing on the timeout.
        //
        // Scope: this covers every statement in the transaction, not just the
        // upsert. The siblings were not individually A/B'd, but production
        // pg_stat_statements has generateConclusions at 943 ms and the tracked
        // results upsert at 612 ms with JIT on — both far too cheap to be
        // JIT-compiling, so there is nothing to lose. (validateTestRunExists runs
        // on a separate pooled connection outside this transaction and is
        // unaffected either way.)
        await manager.query('SELECT set_config($1, $2, true)', ['jit', 'off']);

        let processedRows = 0;

        // Validation & setup
        const validationStart = Date.now();
        for (const testRunId of testRunIds) {
          if (!(await this.validateTestRunExists(testRunId))) {
            throw new Error(`Test run not found: ${testRunId}`);
          }
        }
        await this.validator.updateEvaluationStatus(manager, testRunIds, 'IN_PROGRESS');
        subStages.push({ stage: 'validation-setup', duration: Date.now() - validationStart });

        // Pre-processing validation (changepoints, empty control groups)
        const preValidationStart = Date.now();
        const preValidation = await this.validator.runPreProcessingValidation(manager, testRunIds);
        subStages.push({ stage: 'pre-processing-validation', duration: Date.now() - preValidationStart });

        if (preValidation.processableTestRuns.length === 0) {
          this.logger.warn('No test runs available for ADAPT processing after filtering');
          if (updateConclusion) {
            const conclusionStart = Date.now();
            await this.validator.writeExclusionConclusions(
              manager,
              preValidation.changepoints,
              preValidation.tooShortTestRuns,
              preValidation.emptyControlGroups,
            );
            subStages.push({ stage: 'write-exclusion-conclusions', duration: Date.now() - conclusionStart });
          }
          return { processedRows: 0, subStages };
        }

        const processable = preValidation.processableTestRuns;

        // Process ADAPT results
        if (updateResults) {
          const resultsStart = Date.now();
          const metricFilter = (applicationDashboardId || panelId || metricName)
            ? { applicationDashboardId, panelId, metricName } : undefined;
          const adaptRows = await this.resultsProcessor.processAdaptResults(manager, processable, metricFilter);
          processedRows += adaptRows;
          subStages.push({ stage: 'process-adapt-results', duration: Date.now() - resultsStart, rows: adaptRows });
        }

        // Store tracked results
        if (updateTrackedResults) {
          const trackedStart = Date.now();
          const placeholders = processable.map((_: string, i: number) => `$${i + 1}`).join(', ');
          await manager.query(`DELETE FROM ds_adapt_tracked_results WHERE test_run_id IN (${placeholders})`, processable);
          const trackedRows = await this.resultsProcessor.storeTrackedResults(manager, processable);
          processedRows += trackedRows;
          subStages.push({ stage: 'store-tracked-results', duration: Date.now() - trackedStart, rows: trackedRows });
        }

        // Generate conclusions
        if (updateConclusion) {
          const conclusionsStart = Date.now();
          const conclusionRows = await this.resultsProcessor.generateConclusions(manager, processable);
          processedRows += conclusionRows;
          subStages.push({ stage: 'generate-conclusions', duration: Date.now() - conclusionsStart, rows: conclusionRows });
        }

        // Update final status
        const statusStart = Date.now();
        await this.resultsProcessor.updateFinalStatus(manager, testRunIds);
        subStages.push({ stage: 'update-final-status', duration: Date.now() - statusStart });

        return { processedRows, subStages };
      });

      // Publish realtime updates (non-blocking)
      this.resultsProcessor.publishRealtimeUpdates(testRunIds).catch(error => {
        this.logger.warn('Failed to publish realtime updates:', error);
      });

      const duration = Date.now() - startTime;
      this.logPerformance('adapt-analysis', startTime, { testRunIds: testRunIds.length, processedRows: result.processedRows });

      if (result.subStages.length > 0) {
        this.logger.info(formatSubstageBreakdown(result.subStages, duration));
      }

      return this.createSuccessResult({ processedRows: result.processedRows, testRunIds: testRunIds.length }, duration);

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logError(error as Error, { testRunIds });

      try {
        await this.validator.updateFailureStatus(testRunIds);
      } catch (statusError) {
        this.logError(statusError as Error, { context: 'status_update', testRunIds });
      }

      return this.createErrorResult(error as Error, 'ADAPT_ANALYSIS_FAILED', { testRunIds }, duration);
    }
  }
}
