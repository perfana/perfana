import { BasePipelineTypeORM } from './BasePipelineTypeORM.js';
import { PipelineResult } from '../types/pipeline.js';
import { MetricCollectionGapService } from '../services/MetricCollectionGapService.js';

export interface DataSanityCheckInput {
  testRunId: string;
}

/**
 * Data Sanity Check Pipeline
 *
 * Validates that a test run's data is complete and consistent after analysis.
 * Sets `valid = false` with detailed reasons when anomalies are found.
 *
 * This pipeline never throws — it catches all errors internally so it
 * never blocks the parent job.
 */
export class DataSanityCheckPipeline extends BasePipelineTypeORM {

  async execute(input: any): Promise<PipelineResult> {
    const startTime = Date.now();
    const { testRunId } = input as DataSanityCheckInput;

    try {
      this.logger.info(`Running data sanity check for ${testRunId}`);
      const reasons: string[] = [];
      const warnings: string[] = [];

      const testRun = await this.db.getTestRunByTestRunId(testRunId);
      if (!testRun) {
        this.logger.warn(`Sanity check: test run not found: ${testRunId}`);
        return this.createSuccessResult({ valid: null, error: 'Test run not found' });
      }

      // 1. Time window check
      if (!testRun.startTime || !testRun.endTime) {
        reasons.push('Test run has no start/end time');
      } else if (new Date(testRun.endTime) <= new Date(testRun.startTime)) {
        reasons.push('Test run has no start/end time');
      }

      // 2. Panels check — only flag when Grafana dashboards with actual panel content
      //    exist but no ds_panels were created. Performance test metrics dashboards have
      //    empty panels arrays in their Grafana JSON and are expected to have no ds_panels.
      const panelsResult = await this.query<{ panels: string; dashboards_with_panels: string }>(
        `SELECT
          (SELECT COUNT(*)::text FROM ds_panels WHERE test_run_id = $1) AS panels,
          (SELECT COUNT(*)::text FROM application_dashboards ad
           JOIN grafana_dashboards gd ON gd.uid = ad.dashboard_uid
           WHERE ad.system_under_test_id = $2 AND ad.test_environment = $3
             AND jsonb_array_length(COALESCE(gd.grafana_json->'panels', '[]'::jsonb)) > 0
          ) AS dashboards_with_panels`,
        [testRunId, testRun.systemUnderTestId, testRun.testEnvironment]
      );
      const panelCount = parseInt(panelsResult[0]?.panels ?? '0', 10);
      const dashboardsWithPanels = parseInt(panelsResult[0]?.dashboards_with_panels ?? '0', 10);
      if (dashboardsWithPanels > 0 && panelCount === 0) {
        reasons.push(`No dashboard panels found (${dashboardsWithPanels} dashboards with panels configured)`);
      }

      // 3. Metrics data check
      const metricsResult = await this.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ds_metrics WHERE test_run_id = $1`,
        [testRunId]
      );
      const metricsCount = parseInt(metricsResult[0]?.count ?? '0', 10);
      if (metricsCount === 0) {
        reasons.push('No metrics data collected');
      }

      // 3b. Sparse data check — flag metrics with very few data points
      if (metricsCount > 0 && testRun.startTime && testRun.endTime) {
        const durationSec = (new Date(testRun.endTime).getTime() - new Date(testRun.startTime).getTime()) / 1000;
        const minDataPoints = parseInt(process.env.SANITY_CHECK_MIN_DATA_POINTS ?? '5', 10);

        if (durationSec > 60) {
          const sparseResult = await this.query<{
            metric_name: string;
            dashboard_label: string;
            panel_title: string;
            data_points: string;
            avg_timestep_sec: string;
          }>(
            `SELECT
              metric_name,
              dashboard_label,
              panel_title,
              COUNT(*)::text AS data_points,
              CASE WHEN COUNT(*) > 1
                THEN ROUND(EXTRACT(EPOCH FROM MAX(time) - MIN(time))::numeric / (COUNT(*) - 1), 0)::text
                ELSE NULL
              END AS avg_timestep_sec
             FROM ds_metrics
             WHERE test_run_id = $1
             GROUP BY metric_name, dashboard_label, panel_title
             HAVING COUNT(*) < $2`,
            [testRunId, minDataPoints]
          );

          if (sparseResult.length > 0) {
            // Exclude thread-count metrics which often have a single aggregated value
            let sparseMetrics = sparseResult.filter(
              r => !r.metric_name.match(/^(avg_active_threads|max_active_threads|total|error_count)$/)
            );

            // Exclude per-scenario aggregated results from performance test dashboards.
            // Request/Transaction panels (RT, Throughput, Apdex, etc.) produce one data
            // point per scenario execution — having few points is expected when a scenario
            // runs infrequently, not a data quality issue.
            sparseMetrics = sparseMetrics.filter(
              r => !(
                r.dashboard_label.startsWith('Performance test metrics') &&
                (r.panel_title.startsWith('Request ') || r.panel_title.startsWith('Transaction '))
              )
            );

            // Exclude user-defined sparse metric exclusions for this scope
            if (sparseMetrics.length > 0) {
              const userExclusions = await this.query<{
                dashboard_label: string;
                metric_name: string;
              }>(
                `SELECT dashboard_label, metric_name FROM sparse_metric_exclusions
                 WHERE system_under_test_id = $1 AND test_environment = $2 AND workload = $3`,
                [testRun.systemUnderTestId, testRun.testEnvironment, testRun.workload]
              );

              if (userExclusions.length > 0) {
                const excludedSet = new Set(
                  userExclusions.map(e => `${e.dashboard_label.trim()}::${e.metric_name.trim()}`)
                );
                sparseMetrics = sparseMetrics.filter(
                  r => !excludedSet.has(`${r.dashboard_label.trim()}::${r.metric_name.trim()}`)
                );
              }
            }

            if (sparseMetrics.length > 0) {
              const examples = sparseMetrics.slice(0, 3).map(r => {
                const ts = r.avg_timestep_sec ? ` (${r.avg_timestep_sec}s timestep)` : '';
                return `${r.dashboard_label} / ${r.metric_name}: ${r.data_points} points${ts}`;
              });
              const suffix = sparseMetrics.length > 3
                ? ` and ${sparseMetrics.length - 3} more`
                : '';
              warnings.push(
                `Sparse data: ${sparseMetrics.length} metric(s) have fewer than ${minDataPoints} data points — ${examples.join('; ')}${suffix}`
              );
            }
          }
        }
      }

      // 4. Statistics completeness (only if metrics exist)
      if (metricsCount > 0) {
        const statsResult = await this.query<{ total: string; all_missing: string }>(
          `SELECT
            COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE all_missing = true)::text AS all_missing
           FROM ds_metric_statistics
           WHERE test_run_id = $1`,
          [testRunId]
        );
        const totalStats = parseInt(statsResult[0]?.total ?? '0', 10);
        const allMissing = parseInt(statsResult[0]?.all_missing ?? '0', 10);

        if (totalStats === 0) {
          // 7. Statistics existence — metrics exist but no statistics
          // Check if the issue is that all metrics fall within the ramp-up period
          const rampUpCheckResult = await this.query<{ total: string; ramp_up_only: string }>(
            `SELECT
              COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE ramp_up = true)::text AS ramp_up_only
             FROM ds_metrics
             WHERE test_run_id = $1`,
            [testRunId]
          );
          const totalDataPoints = parseInt(rampUpCheckResult[0]?.total ?? '0', 10);
          const rampUpOnlyPoints = parseInt(rampUpCheckResult[0]?.ramp_up_only ?? '0', 10);

          if (totalDataPoints > 0 && totalDataPoints === rampUpOnlyPoints) {
            const rampUpSec = testRun.analysisStartOffset ?? 0;
            const durationSec = testRun.startTime && testRun.endTime
              ? Math.round((new Date(testRun.endTime).getTime() - new Date(testRun.startTime).getTime()) / 1000)
              : 0;
            reasons.push(
              `No steady-state data: all ${totalDataPoints.toLocaleString()} data points fall within the configured ramp-up period ` +
              `(${rampUpSec}s ramp-up, ${durationSec}s actual duration). ` +
              `Reduce the ramp-up value to include data for analysis.`
            );
          } else {
            reasons.push('Statistics not calculated (metrics exist but no statistics)');
          }
        } else if (totalStats > 0 && allMissing / totalStats > 0.5) {
          const pct = Math.round((allMissing / totalStats) * 100);
          reasons.push(
            `${pct}% of statistics have all-missing data (${allMissing} of ${totalStats} metrics)`
          );
        }
      }

      // 5. Collection coverage
      try {
        // Remove orphaned collection sources (e.g. Dynatrace config removed during test)
        await this.removeOrphanedCollectionSources(testRunId, testRun);

        const gapService = new MetricCollectionGapService(this.db);
        const summary = await gapService.getCollectionSummary(testRunId);
        const minCoverage = parseInt(process.env.SANITY_CHECK_MIN_COVERAGE ?? '80', 10);

        if (summary.totalSources > 0 && summary.coverage < minCoverage) {
          reasons.push(
            `Data collection coverage is ${Math.round(summary.coverage)}% (threshold: ${minCoverage}%)`
          );
        }

        // 6. Failed ranges
        if (summary.failedRanges > 0) {
          const sourcesWithFailures = await this.query<{ count: string }>(
            `SELECT COUNT(DISTINCT source_type || COALESCE(source_id, ''))::text AS count
             FROM ds_metric_collection_status
             WHERE test_run_id = $1 AND jsonb_array_length(COALESCE(failed_ranges, '[]'::jsonb)) > 0`,
            [testRunId]
          );
          const sourceCount = parseInt(sourcesWithFailures[0]?.count ?? '0', 10);
          reasons.push(
            `${summary.failedRanges} failed collection ranges across ${sourceCount} sources`
          );
        }
      } catch (err) {
        this.logger.warn(`Sanity check: collection coverage check failed for ${testRunId}: ${err}`);
      }

      // 8. ADAPT results check — only flag when control group baselines exist
      //    (no baselines = changepoint or first test run, 0 results is expected)
      if (testRun.adaptConfig && testRun.status?.evaluatingAdapt === 'COMPLETED') {
        const adaptResult = await this.query<{ adapt_count: string; baseline_count: string; is_changepoint: string }>(
          `SELECT
            (SELECT COUNT(*)::text FROM ds_adapt_results WHERE test_run_id = $1) AS adapt_count,
            (SELECT COUNT(*)::text FROM ds_control_group_statistics WHERE test_run_id = $1) AS baseline_count,
            (SELECT COUNT(*)::text FROM ds_change_points
             WHERE test_run_id = $1
               AND system_under_test_id = $2
               AND test_environment = $3
               AND workload = $4) AS is_changepoint`,
          [testRunId, testRun.systemUnderTestId, testRun.testEnvironment, testRun.workload]
        );
        const adaptCount = parseInt(adaptResult[0]?.adapt_count ?? '0', 10);
        const baselineCount = parseInt(adaptResult[0]?.baseline_count ?? '0', 10);
        const isChangepoint = parseInt(adaptResult[0]?.is_changepoint ?? '0', 10) > 0;
        if (adaptCount === 0 && baselineCount > 0 && !isChangepoint) {
          reasons.push('ADAPT analysis completed but no results found');
        }
      }

      // Update test run validity — only hard errors invalidate, warnings are informational
      const valid = reasons.length === 0;
      await this.db.updateTestRunByTestRunId(testRunId, {
        valid,
        reasonsNotValid: (valid ? null : reasons) as any,
        dataWarnings: (warnings.length > 0 ? warnings : null) as any,
      });

      const duration = Date.now() - startTime;
      const allIssues = [...reasons, ...warnings];
      if (allIssues.length === 0) {
        this.logger.info(`Sanity check passed for ${testRunId} in ${duration}ms`);
      } else {
        if (reasons.length > 0) {
          this.logger.warn(
            `Sanity check found ${reasons.length} error(s) for ${testRunId} in ${duration}ms: ${reasons.join('; ')}`
          );
        }
        if (warnings.length > 0) {
          this.logger.info(
            `Sanity check found ${warnings.length} warning(s) for ${testRunId} in ${duration}ms: ${warnings.join('; ')}`
          );
        }
      }

      return this.createSuccessResult({ valid, reasons, warnings }, duration);

    } catch (err) {
      const duration = Date.now() - startTime;
      const message = err && typeof err === 'object' && 'message' in err
        ? (err as Error).message
        : String(err);
      this.logger.warn(`Sanity check failed for ${testRunId} (non-fatal): ${message}`);
      return this.createSuccessResult({ valid: null, error: message }, duration);
    }
  }

  /**
   * Remove collection status records for sources no longer configured for the
   * test run (e.g. a Dynatrace config was removed during the test).
   */
  private async removeOrphanedCollectionSources(
    testRunId: string,
    testRun: { systemUnderTestId: string; testEnvironment: string; workload: string }
  ): Promise<void> {
    const statuses = await this.db.getAllCollectionStatuses(testRunId);
    if (statuses.length === 0) {
      return;
    }

    // Build set of currently configured sources
    const configured = new Set<string>();
    configured.add('performance_test::null');

    const appDashboards = await this.query<{ grafana_instance_id: string }>(
      `SELECT DISTINCT grafana_instance_id FROM application_dashboards
       WHERE system_under_test_id = $1 AND test_environment = $2
         AND grafana_instance_id IS NOT NULL`,
      [testRun.systemUnderTestId, testRun.testEnvironment]
    );
    for (const row of appDashboards) {
      configured.add(`grafana::${row.grafana_instance_id}`);
    }

    const dtConfigs = await this.query<{ dynatrace_config_id: string }>(
      `SELECT DISTINCT dynatrace_config_id FROM dynatrace_queries
       WHERE system_under_test_id = $1 AND test_environment = $2 AND workload = $3
         AND dynatrace_config_id IS NOT NULL`,
      [testRun.systemUnderTestId, testRun.testEnvironment, testRun.workload]
    );
    for (const row of dtConfigs) {
      configured.add(`dynatrace::${row.dynatrace_config_id}`);
    }

    // Remove orphaned records
    for (const status of statuses) {
      const key = `${status.source_type}::${status.source_id ?? 'null'}`;
      if (!configured.has(key)) {
        this.logger.info(`Removing orphaned collection source: ${key}`);
        await this.db.removeCollectionStatus(testRunId, status.source_type, status.source_id ?? null);
      }
    }
  }
}
