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
