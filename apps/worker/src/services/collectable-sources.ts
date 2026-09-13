import { ApplicationDashboard, TestRun } from '@perfana/shared/entities';
import { WorkerDatabaseService } from '../common/database.service.js';
import { NO_ANOMALY_DETECTION_MARKER } from '../constants/dashboard-tags.js';

/**
 * One answer to "which metric sources does this test run actually have".
 *
 * Three call sites used to answer it independently — `IncrementalCollectionScheduler`
 * (which sources to enqueue), `PipelineOrchestrator.removeOrphanedCollectionSources`
 * (which status rows to sweep before the stages run) and the identically-named method in
 * `DataSanityCheckPipeline` (which to sweep after). They disagreed, and the disagreement
 * is what makes a run invalid:
 *
 * `MetricCollectionGapService.calculateCoverage` divides the summed `collected_ranges` by
 * (run duration x number of `ds_metric_collection_status` rows), so a source that can
 * never return data drags the average down by existing. The incremental ticks cannot
 * rescue it either — `incremental-metrics.ts` records a ZERO-WIDTH range when a tick
 * returns nothing, deliberately, so the window is retried rather than skipped past data
 * the API had not published yet. A registered-but-dead source therefore pins coverage at
 * 0% and `DataSanityCheckPipeline` fails the run with "Data collection coverage is 0%" —
 * blaming coverage for what is really a config toggle.
 *
 * Two switches mean "this source is off", and each is honoured in exactly one place here:
 *
 * - `dynatrace_queries.enabled = false`. `DynatraceRepository` and the incremental
 *   Dynatrace collector both filter on it, so a disabled config collects nothing while
 *   the scheduler kept enqueueing a job a minute.
 * - The Grafana `no-anomaly-detection` tag. `createPanelDocuments` skips a tagged
 *   dashboard outright, so it yields no `ds_panels` and there is nothing to fetch. It is
 *   the Grafana-side equivalent of `enabled = false`.
 *
 * Plus the artificial `grafana_dashboards` placeholders, which are not Grafana dashboards
 * at all: `ensureArtificialDashboardExists` writes them so non-Grafana sources have
 * somewhere to hang their panels, and their `application_dashboards` rows carry a
 * `grafana_instance_id`, so they look like Grafana sources to anything reading only that
 * column.
 */

/** Ids of the `grafana_dashboards` rows that cannot yield Grafana data for a run. */
async function findUncollectableDashboardIds(
  db: WorkerDatabaseService,
  dashboardIds: string[]
): Promise<Set<string>> {
  // Detect an artificial row by `grafana_json`, never by a `grafana_id` range: the
  // "800000+ is Dynatrace" comment at that insert is not a rule the data obeys in either
  // direction — real Grafana ids are snowflake-style and land far above both ranges, so a
  // range test classifies the whole table as artificial. See CLAUDE.md, "grafana_dashboards
  // is a mixed table".
  //
  // Resolve through `id`, not `dashboard_uid`: a uid is unique only within a Grafana
  // instance, and the same uid routinely exists on several, so a uid match lets one
  // instance's row vouch for another's.
  const rows: Array<{ id: string }> = await db.dataSource.query(
    `SELECT id::text AS id
       FROM grafana_dashboards
      WHERE id = ANY($1::uuid[])
        AND (grafana_json IS NULL OR $2 = ANY(COALESCE(tags, '{}')))`,
    [dashboardIds, NO_ANOMALY_DETECTION_MARKER]
  );
  return new Set(rows.map(r => r.id));
}

/**
 * Drop the application dashboards Grafana can never answer for.
 *
 * Fails OPEN in every direction — a dashboard with no foreign key, one whose
 * `grafana_dashboards` row has been deleted, and (via the catch) every dashboard if the
 * query itself fails. Dropping a live dashboard from collection is the worse error, and
 * the caller runs inside a single try/catch that would otherwise abandon the whole tick,
 * taking the Dynatrace and performance-test jobs down with it.
 */
export async function filterCollectableGrafanaDashboards(
  db: WorkerDatabaseService,
  dashboards: ApplicationDashboard[],
  logger?: { debug: (msg: string) => void; warn: (msg: string) => void }
): Promise<ApplicationDashboard[]> {
  const dashboardIds = dashboards
    .map(d => d.grafanaDashboardId)
    .filter((id): id is string => !!id);

  if (dashboardIds.length === 0) {
    return dashboards;
  }

  let excluded: Set<string>;
  try {
    excluded = await findUncollectableDashboardIds(db, dashboardIds);
  } catch (err) {
    logger?.warn(
      `Could not determine which Grafana dashboards are collectable, keeping all: ${err}`
    );
    return dashboards;
  }

  if (excluded.size === 0) {
    return dashboards;
  }

  const collectable = dashboards.filter(
    d => !(d.grafanaDashboardId && excluded.has(d.grafanaDashboardId))
  );

  // Logged at info, with the ids: this is the only line that explains why a Grafana
  // source stopped being collected, and "nothing is being collected" is exactly the
  // question someone will be debugging when they come looking.
  logger?.debug(
    `Excluded ${dashboards.length - collectable.length} of ${dashboards.length} application ` +
    `dashboard(s) from Grafana collection (artificial placeholder or ` +
    `"${NO_ANOMALY_DETECTION_MARKER}" tag): ` +
    dashboards
      .filter(d => d.grafanaDashboardId && excluded.has(d.grafanaDashboardId))
      .map(d => d.id)
      .join(', ')
  );

  return collectable;
}

/**
 * The one spelling of a collection-source key. `ds_metric_collection_status.source_id` is
 * NOT NULL with '' for performance_test, so null is normalised to '' — never to 'null'.
 * Every sweep and whitelist must build keys through this or they drift apart silently.
 */
export function collectionSourceKey(sourceType: string, sourceId: string | null | undefined): string {
  return `${sourceType}::${sourceId ?? ''}`;
}

/**
 * The `ds_metric_collection_status` keys a run legitimately has, in the
 * `collectionSourceKey` form both orphan sweeps compare against.
 *
 * Both sweeps must use this. They ran the same query with different predicates before —
 * the orchestrator's copy (which runs FIRST, before any stage) had neither filter — so a
 * row the sanity check would have swept survived long enough to be gap-filled, and
 * `isCollectionComplete()` could flip to true and skip every collection stage for the run.
 */
export async function getConfiguredSourceKeys(
  db: WorkerDatabaseService,
  testRun: { systemUnderTestId: string; testEnvironment: string; workload: string }
): Promise<Set<string>> {
  // performance_test has no natural id; its row carries the '' sentinel (NOT NULL since #146).
  // Spelled through collectionSourceKey on purpose: a hand-written 'performance_test::null'
  // here never matched the sweeps' key, so every analyze swept the perf-test row and sent a
  // JMeter-only run down the full delete-and-rebuild path.
  const configured = new Set<string>([collectionSourceKey('performance_test', '')]);

  const appDashboards = await db.applicationDashboardRepo.find({
    where: {
      systemUnderTestId: testRun.systemUnderTestId,
      testEnvironment: testRun.testEnvironment,
    },
  });

  for (const dashboard of await filterCollectableGrafanaDashboards(db, appDashboards)) {
    if (dashboard.grafanaInstanceId) {
      configured.add(collectionSourceKey('grafana', dashboard.grafanaInstanceId));
    }
  }

  const dtConfigs: Array<{ dynatrace_config_id: string }> = await db.dataSource.query(
    `SELECT DISTINCT dynatrace_config_id FROM dynatrace_queries
      WHERE system_under_test_id = $1 AND test_environment = $2 AND workload = $3
        AND dynatrace_config_id IS NOT NULL
        AND enabled`,
    [testRun.systemUnderTestId, testRun.testEnvironment, testRun.workload]
  );
  for (const row of dtConfigs) {
    configured.add(collectionSourceKey('dynatrace', row.dynatrace_config_id));
  }

  return configured;
}

export type { TestRun };
