/**
 * Resolves the scenario dashboards a source table's metrics will land on.
 *
 * The requests and transactions processors write ds_metrics with one INSERT ... SELECT,
 * so the dashboards have to exist — and be known to SQL as a VALUES table — before the
 * statement runs. That is what this does: one DISTINCT over the source table, then
 * `getOrCreateScenarioDashboard` per scenario (a handful; DashboardManager caches).
 */

import type { DataSource } from 'typeorm';
import type { Logger } from 'pino';
import type { DashboardManager, DashboardMetadata } from './dashboard-manager.js';
import { ALL_AGGREGATED_SCENARIO } from '../../constants/performance-metrics.js';
import type { TestRunMetadata } from '../../types/performance-metrics.js';

export interface ResolveScenarioDashboardsOptions {
  dataSource: DataSource;
  dashboardManager: DashboardManager;
  logger: Logger;
  /** Source table to read scenario names from — must have scenario_name and time. */
  table: 'requests_raw' | 'transactions';
  testRunId: string;
  testRun: TestRunMetadata;
}

export interface ResolvedScenarioDashboards {
  /** Scenario name -> dashboard, including the roll-up pseudo-scenario. */
  dashboards: Map<string, DashboardMetadata>;
  /** Real scenario names present in the data, roll-up excluded. Empty means no data. */
  scenarioNames: string[];
}

export async function resolveScenarioDashboards(
  opts: ResolveScenarioDashboardsOptions
): Promise<ResolvedScenarioDashboards> {
  const { dataSource, dashboardManager, logger, table, testRunId, testRun } = opts;

  const filterFromTime = testRun.filter_from_time ?? testRun.start_time;
  const filterToTime = testRun.filter_to_time ?? testRun.end_time;
  const hasFilterEndTime = filterToTime !== null;

  // $3 is bound only when it is referenced. Unlike the aggregates, which reference
  // parameters past $3 either way, this query's highest placeholder IS $3 — passing a
  // spare one is a hard bind failure ("bind message supplies 3 parameters, but prepared
  // statement requires 2"), reachable on a full collection of a run with no end_time.
  const params: unknown[] = [testRunId, filterFromTime];
  if (hasFilterEndTime) { params.push(filterToTime); }

  const rows = await dataSource.query<Array<{ scenario_name: string }>>(
    `SELECT DISTINCT COALESCE(scenario_name, 'default') AS scenario_name
     FROM ${table}
     WHERE test_run_id = $1
       AND time >= $2
       ${hasFilterEndTime ? 'AND time <= $3' : ''}`,
    params
  );

  const scenarioNames = rows.map((r) => r.scenario_name);
  const dashboards = new Map<string, DashboardMetadata>();

  if (scenarioNames.length === 0) {
    return { dashboards, scenarioNames };
  }

  // The roll-up lands on its own dashboard alongside the real scenarios.
  for (const scenarioName of [...scenarioNames, ALL_AGGREGATED_SCENARIO]) {
    if (dashboards.has(scenarioName)) { continue; }
    try {
      dashboards.set(
        scenarioName,
        await dashboardManager.getOrCreateScenarioDashboard(
          scenarioName,
          testRun.system_under_test_id,
          testRun.test_environment
        )
      );
    } catch (err) {
      // One failing scenario must not abort the run (issue #388). A scenario absent
      // from the map is absent from the VALUES table, so its rows simply do not join.
      const msg = err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Unknown error';
      logger.error(
        { err },
        `⚠️  Skipping scenario "${scenarioName}" — dashboard creation failed: ${msg}. Remaining scenarios will still be processed.`
      );
    }
  }

  return { dashboards, scenarioNames };
}
