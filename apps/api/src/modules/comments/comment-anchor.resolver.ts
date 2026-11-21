import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync, type ValidationError } from 'class-validator';
import type { EntityManager } from 'typeorm';
import {
  CONFIG_VIEW_VALUE_MAX_LENGTH,
  PYROSCOPE_VIEWS,
  anomalyItemKey,
  anomalyItemLabel,
  clipCommentText,
  configCommentAnchor,
  dashboardCommentAnchor,
  pyroscopeItemKey,
  pyroscopeItemLabel,
  sloCommentItemKey,
  sloCommentItemLabel,
  transactionCommentItemKey,
  transactionCommentItemLabel,
  tracingItemKey,
  tracingItemLabel,
  transactionScenarioGroup,
  type CommentCardKey,
  type ConfigCommentView,
} from '@perfana/shared/constants/comment-cards';
import { analysisBoundsFromRow, timeBoundsSql } from '@perfana/shared/database/run-window';
import {
  ANCHOR_CARD,
  type AdaptAnchorDto,
  ANCHOR_DTO_BY_TYPE,
  COMMENT_ANCHOR_TYPES,
  type CardAnchorDto,
  type CommentAnchor,
  type ConfigAnchorDto,
  type DashboardAnchorDto,
  type MarkerAnchorDto,
  type PyroscopeAnchorDto,
  type SloAnchorDto,
  type TracingAnchorDto,
  type TransactionAnchorDto,
} from './dto/comment-anchor.dto';

/** What the resolver needs to know about the run a comment is posted on. */
export interface AnchorRun {
  /** `test_runs.id` */
  id: string;
  /** The human `test_run_id`, which `ds_metrics`, `check_results` and the rollups key on. */
  testRunId: string;
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string | null;
  startTime: Date | null;
  endTime: Date | null;
}

/** The run's scope and window, by `test_runs.id`; the caller has already authorized the run. */
export async function loadAnchorRun(em: EntityManager, runUuid: string): Promise<AnchorRun> {
  const rows: Array<{
    id: string;
    test_run_id: string;
    system_under_test_id: string;
    test_environment: string;
    workload: string | null;
    start_time: Date | string | null;
    end_time: Date | string | null;
  }> = await em.query(
    `SELECT id, test_run_id, system_under_test_id, test_environment, workload, start_time, end_time
       FROM test_runs WHERE id = $1`,
    [runUuid],
  );
  const r = rows[0];
  if (!r) throw new BadRequestException('Test run not found');
  return {
    id: r.id,
    testRunId: r.test_run_id,
    systemUnderTestId: r.system_under_test_id,
    testEnvironment: r.test_environment,
    workload: r.workload,
    startTime: r.start_time ? new Date(r.start_time) : null,
    endTime: r.end_time ? new Date(r.end_time) : null,
  };
}

/** The fields an anchor resolves into, exactly the ones a web client sends itself. */
export interface ResolvedAnchor {
  card: CommentCardKey;
  itemKey: string | null;
  itemLabel: string | null;
  markerTime: string | null;
  /** Raw view, still to be validated by `validateChartContext` like a client's. */
  chartContext: Record<string, unknown> | null;
}

const MAX_LISTED = 20;
const list = (values: string[]): string =>
  values.length > MAX_LISTED ? `${values.slice(0, MAX_LISTED).join(', ')} and ${values.length - MAX_LISTED} more` : values.join(', ');

function firstError(errors: ValidationError[], path: string): string {
  const e = errors[0]!;
  if (e.children && e.children.length > 0) return firstError(e.children, `${path}.${e.property}`);
  return `${path}.${e.property}: ${Object.values(e.constraints ?? {})[0] ?? 'is invalid'}`;
}

/** Check an anchor's shape for its type and return the typed, whitelisted anchor. */
export function parseAnchor(raw: Record<string, unknown>): CommentAnchor {
  const type = raw.type;
  if (typeof type !== 'string' || !(COMMENT_ANCHOR_TYPES as readonly string[]).includes(type)) {
    throw new BadRequestException(`anchor.type must be one of ${COMMENT_ANCHOR_TYPES.join(', ')}`);
  }
  const cls = ANCHOR_DTO_BY_TYPE[type as keyof typeof ANCHOR_DTO_BY_TYPE] as new () => object;
  const anchor = plainToInstance(cls, raw);
  const errors = validateSync(anchor, { whitelist: true });
  if (errors.length > 0) throw new BadRequestException(firstError(errors, 'anchor'));
  return anchor as CommentAnchor;
}

/** The card an anchor belongs to. */
export function anchorCard(anchor: CommentAnchor): CommentCardKey {
  return anchor.type === 'card' ? (anchor as CardAnchorDto).card : ANCHOR_CARD[anchor.type];
}

/**
 * Resolve an anchor against the run: check the thing exists there, and build the item key and
 * label with the same shared builders the web rows use, so an agent's comment lands on the row a
 * person would have commented on. Anything not found is a 400 that names it.
 */
export async function resolveAnchor(em: EntityManager, run: AnchorRun, anchor: CommentAnchor): Promise<ResolvedAnchor> {
  const card = anchorCard(anchor);
  const none = { card, itemKey: null, itemLabel: null, markerTime: null, chartContext: null };
  switch (anchor.type) {
    case 'card':
      return none;
    case 'transaction':
      return { ...none, ...(await resolveTransaction(em, run, anchor as TransactionAnchorDto)) };
    case 'config':
      return { ...none, ...(await resolveConfig(em, run, anchor as ConfigAnchorDto)) };
    case 'dashboard':
      return { ...none, ...(await resolveDashboard(em, run, anchor as DashboardAnchorDto)) };
    case 'slo':
      return { ...none, ...(await resolveSlo(em, run, anchor as SloAnchorDto)) };
    case 'marker':
      return { ...none, ...(await resolveMarker(em, run, anchor as MarkerAnchorDto)) };
    case 'adapt':
      return { ...none, ...(await resolveAdapt(em, run, anchor as AdaptAnchorDto)) };
    case 'tracing':
      return { ...none, ...(await resolveTracing(em, run, anchor as TracingAnchorDto)) };
    case 'pyroscope':
      return { ...none, ...(await resolvePyroscope(em, run, anchor as PyroscopeAnchorDto)) };
  }
}

/**
 * Performance analysis groups transactions by scenario, and the row key carries that group. The
 * rollup answers which scenarios ran the transaction; a run with no rollup yet (live, or never
 * rolled up) falls back to the raw table, bounded by the run window (root CLAUDE.md #56).
 */
async function resolveTransaction(em: EntityManager, run: AnchorRun, anchor: TransactionAnchorDto) {
  let rows: { scenario_name: string | null }[] = await em.query(
    `SELECT DISTINCT scenario_name FROM test_run_transaction_stats WHERE test_run_id = $1 AND transaction_name = $2`,
    [run.testRunId, anchor.name],
  );
  if (rows.length === 0) {
    const bounds = timeBoundsSql(analysisBoundsFromRow({ start_time: run.startTime, end_time: run.endTime }, false), 'time', 3);
    rows = await em.query(
      `SELECT DISTINCT scenario_name FROM transactions WHERE test_run_id = $1 AND transaction_name = $2 ${bounds.clause}`,
      [run.testRunId, anchor.name, ...bounds.params],
    );
  }
  const groups = [...new Set(rows.map((r) => transactionScenarioGroup(r.scenario_name)))].sort();
  if (groups.length === 0) throw new BadRequestException(`Transaction "${anchor.name}" not found in this test run`);
  let group: string;
  if (anchor.scenario !== undefined) {
    if (!groups.includes(anchor.scenario)) {
      throw new BadRequestException(`Transaction "${anchor.name}" did not run in scenario "${anchor.scenario}"; it ran in: ${list(groups)}`);
    }
    group = anchor.scenario;
  } else if (groups.length > 1) {
    throw new BadRequestException(`Transaction "${anchor.name}" ran in more than one scenario; send anchor.scenario, one of: ${list(groups)}`);
  } else {
    group = groups[0]!;
  }
  return { itemKey: transactionCommentItemKey(group, anchor.name), itemLabel: transactionCommentItemLabel(group, anchor.name) };
}

async function configValues(em: EntityManager, runUuid: string, key: string): Promise<(string | null)[]> {
  const rows: { value: string | null }[] = await em.query(
    `SELECT value FROM test_run_configs WHERE test_run_id = $1 AND key = $2 ORDER BY created_at, id`,
    [runUuid, key],
  );
  return rows.map((r) => r.value);
}

const capValue = (v: string | null | undefined): string | null => (v === null || v === undefined ? null : clipCommentText(v, CONFIG_VIEW_VALUE_MAX_LENGTH));

/**
 * A Configuration item plus the view the card would record: the item's status and values against
 * the compared run (or none). The compared run must be a run of the same system, environment and
 * workload, as the card's comparison picker offers. "expected" (an ignored change) is not derived
 * here: an agent's view records the raw comparison.
 */
async function resolveConfig(em: EntityManager, run: AnchorRun, anchor: ConfigAnchorDto) {
  const built = configCommentAnchor(anchor.key);
  if (!built) throw new BadRequestException('anchor.key is too long to anchor a comment');
  const current = await configValues(em, run.id, anchor.key);

  let previous: (string | null)[] = [];
  if (anchor.comparedToTestRunId !== undefined) {
    const compared: { id: string }[] = await em.query(
      `SELECT id FROM test_runs
        WHERE test_run_id = $1 AND system_under_test_id = $2 AND test_environment = $3
          AND workload IS NOT DISTINCT FROM $4 AND id <> $5
        LIMIT 1`,
      [anchor.comparedToTestRunId, run.systemUnderTestId, run.testEnvironment, run.workload, run.id],
    );
    if (!compared[0]) {
      throw new BadRequestException(`Compared run "${anchor.comparedToTestRunId}" is not a run of this system, environment and workload`);
    }
    previous = await configValues(em, compared[0].id, anchor.key);
  }
  if (current.length === 0 && previous.length === 0) {
    throw new BadRequestException(
      anchor.comparedToTestRunId
        ? `Configuration key "${anchor.key}" is in neither this run nor run ${anchor.comparedToTestRunId}`
        : `Configuration key "${anchor.key}" not found in this test run`,
    );
  }
  let status: ConfigCommentView['status'];
  if (anchor.comparedToTestRunId === undefined || previous.length === 0) status = 'new';
  else if (current.length === 0) status = 'removed';
  else status = current[0] === previous[0] ? 'same' : 'changed';

  const view: Record<string, unknown> = {
    ...(anchor.comparedToTestRunId !== undefined ? { comparedToTestRunId: anchor.comparedToTestRunId } : {}),
    status,
    currentValue: capValue(current[0]),
    previousValue: capValue(previous[0]),
  };
  return { itemKey: built.itemKey, itemLabel: built.itemLabel, chartContext: view };
}

/** A Dashboards tile: an application dashboard of the run's system and environment. */
async function resolveDashboard(em: EntityManager, run: AnchorRun, anchor: DashboardAnchorDto) {
  const rows: { id: string; dashboard_label: string | null; dashboard_name: string | null }[] = await em.query(
    `SELECT id, dashboard_label, dashboard_name FROM application_dashboards
      WHERE id = $1 AND system_under_test_id = $2 AND test_environment = $3`,
    [anchor.applicationDashboardId, run.systemUnderTestId, run.testEnvironment],
  );
  if (!rows[0]) {
    throw new BadRequestException(`Application dashboard ${anchor.applicationDashboardId} is not a dashboard of this run's system and environment`);
  }
  return dashboardCommentAnchor(rows[0]);
}

/** An SLO row: a check result of this run. */
async function resolveSlo(em: EntityManager, run: AnchorRun, anchor: SloAnchorDto) {
  const rows: Array<{
    panel_type: string | null;
    evaluate_type: string | null;
    benchmark_id: string | null;
    panel_title: string | null;
    application_dashboard_id: string | null;
    panel_id: number | null;
    metric_name: string | null;
    dashboard_label: string | null;
  }> = await em.query(
    `SELECT cr.panel_type, cr.evaluate_type, cr.benchmark_id, cr.panel_title,
            cr.application_dashboard_id::text AS application_dashboard_id, cr.panel_id, cr.metric_name, cr.dashboard_label
       FROM check_results cr
      WHERE cr.id = $1 AND cr.test_run_id = $2`,
    [anchor.checkResultId, run.testRunId],
  );
  if (!rows[0]) throw new BadRequestException(`Check result ${anchor.checkResultId} does not belong to this test run`);
  return { itemKey: sloCommentItemKey(rows[0]), itemLabel: sloCommentItemLabel(rows[0]) };
}

/**
 * An Anomaly detection row: an Adapt result of this run. The card lists one row per
 * `ds_adapt_results` row, keyed on dashboard, panel and series.
 */
async function resolveAdapt(em: EntityManager, run: AnchorRun, anchor: AdaptAnchorDto) {
  const rows: { dashboard_label: string | null; panel_title: string | null }[] = await em.query(
    `SELECT dashboard_label, panel_title FROM ds_adapt_results
      WHERE test_run_id = $1 AND application_dashboard_id = $2::uuid AND panel_id = $3 AND metric_name = $4
      LIMIT 1`,
    [run.testRunId, anchor.applicationDashboardId, anchor.panelId, anchor.metricName],
  );
  if (!rows[0]) {
    const onPanel: { metric_name: string }[] = await em.query(
      `SELECT DISTINCT metric_name FROM ds_adapt_results
        WHERE test_run_id = $1 AND application_dashboard_id = $2::uuid AND panel_id = $3
        ORDER BY metric_name LIMIT ${MAX_LISTED + 1}`,
      [run.testRunId, anchor.applicationDashboardId, anchor.panelId],
    );
    const where = `panel ${anchor.panelId} of application dashboard ${anchor.applicationDashboardId}`;
    throw new BadRequestException(
      onPanel.length > 0
        ? `No Adapt result for series "${anchor.metricName}" on ${where} in this test run; that panel has: ${list(onPanel.map((r) => r.metric_name))}`
        : `No Adapt result for ${where} in this test run`,
    );
  }
  const row = {
    application_dashboard_id: anchor.applicationDashboardId,
    panel_id: anchor.panelId,
    metric_name: anchor.metricName,
    dashboard_label: rows[0].dashboard_label,
    panel_title: rows[0].panel_title,
  };
  return { itemKey: anomalyItemKey(row), itemLabel: anomalyItemLabel(row) };
}

/**
 * A Distributed tracing service tab and the request filters it was written under. The card shows
 * the run's tracing service by the same hierarchy as `TracingServiceRepository.findWithHierarchy`:
 * system + environment + workload, else system + environment, else the system alone. The item key
 * carries that service's id, so the service name must be one the winning level configures.
 */
async function resolveTracing(em: EntityManager, run: AnchorRun, anchor: TracingAnchorDto) {
  const rows: { id: string; service_names: string[] | null; level: number }[] = await em.query(
    `SELECT id, service_names,
            CASE WHEN workload IS NOT NULL THEN 0 WHEN test_environment IS NOT NULL THEN 1 ELSE 2 END AS level
       FROM tracing_services
      WHERE system_under_test_id = $1
        AND ((test_environment = $2 AND workload = $3)
          OR (test_environment = $2 AND workload IS NULL)
          OR (test_environment IS NULL AND workload IS NULL))
      ORDER BY level, created_at, id`,
    [run.systemUnderTestId, run.testEnvironment, run.workload],
  );
  if (rows.length === 0) {
    throw new BadRequestException("No tracing service is configured for this run's system, environment and workload");
  }
  const level = rows[0]!.level;
  const shown = rows.filter((r) => r.level === level);
  const service = shown.find((r) => (r.service_names ?? []).includes(anchor.serviceName));
  if (!service) {
    const names = [...new Set(shown.flatMap((r) => r.service_names ?? []))].sort();
    throw new BadRequestException(
      names.length > 0
        ? `Service "${anchor.serviceName}" is not configured in this run's tracing service; it traces: ${list(names)}`
        : `Service "${anchor.serviceName}" is not configured: this run's tracing service lists no service names`,
    );
  }
  const s = { tracingServiceId: service.id, serviceName: anchor.serviceName };
  const filters = { scenario: anchor.scenario ?? null, transaction: anchor.transaction ?? null, sampler: anchor.sampler ?? null };
  return { itemKey: tracingItemKey(s, filters), itemLabel: tracingItemLabel(s, filters) };
}

/**
 * A Pyroscope application + profiler tab, in single or diff view. The pair must be one of the
 * system's `pyroscope_configurations`. A diff view compares with a baseline run the card picks from
 * the completed runs of the same system, environment and workload (the latest by default), so a
 * diff anchor needs at least one such run to exist.
 */
async function resolvePyroscope(em: EntityManager, run: AnchorRun, anchor: PyroscopeAnchorDto) {
  const rows: { pyroscope_instance_id: string | null; pyroscope_configurations: Array<{ application?: unknown; profiler?: unknown }> | null }[] =
    await em.query(`SELECT pyroscope_instance_id, pyroscope_configurations FROM systems_under_test WHERE id = $1`, [run.systemUnderTestId]);
  const configs = (rows[0]?.pyroscope_configurations ?? []).filter(
    (c): c is { application: string; profiler: string } => typeof c?.application === 'string' && typeof c?.profiler === 'string',
  );
  if (!rows[0]?.pyroscope_instance_id || configs.length === 0) {
    throw new BadRequestException("Pyroscope is not configured for this run's system");
  }
  if (!configs.some((c) => c.application === anchor.application && c.profiler === anchor.profiler)) {
    throw new BadRequestException(
      `Application "${anchor.application}" with profiler "${anchor.profiler}" is not configured for this run's system; configured: ` +
        list(configs.map((c) => `${c.application} (${c.profiler})`)),
    );
  }
  const viewModeTab = PYROSCOPE_VIEWS.indexOf(anchor.view);
  if (anchor.view === 'diff') {
    const baselines: unknown[] = await em.query(
      `SELECT 1 FROM test_runs
        WHERE system_under_test_id = $1 AND test_environment = $2 AND workload = $3 AND id <> $4
          AND completed AND start_time IS NOT NULL AND end_time IS NOT NULL
        LIMIT 1`,
      [run.systemUnderTestId, run.testEnvironment, run.workload, run.id],
    );
    if (baselines.length === 0) {
      throw new BadRequestException(
        'The diff view needs a completed earlier run of this system, environment and workload to compare with, and there is none; use view "single"',
      );
    }
  }
  const combo = { application: anchor.application, profiler: anchor.profiler };
  return { itemKey: pyroscopeItemKey(combo, viewModeTab), itemLabel: pyroscopeItemLabel(combo, viewModeTab) };
}

/** The graph-preset `source` the Graphs card gives a series, from its dashboard's metrics source. */
export function seriesSource(sourceType: string | null): string {
  switch (sourceType) {
    case 'performance_test':
      return 'performance-metrics';
    case 'dynatrace':
      return 'dynatrace';
    case 'splunk':
      return 'splunk';
    default:
      return 'grafana';
  }
}

interface DashboardCandidate {
  id: string;
  dashboard_label: string;
  source_type: string | null;
}

/**
 * A numbered Graphs marker and the view it records. Each series is located on an application
 * dashboard of the run's system and environment by label (or id), and must have data for the run
 * in `ds_metrics`, or a statistics row when the name is a series group (which `ds_metrics` never
 * holds). A label two dashboards share is narrowed to the ones that hold the series; if more than
 * one still does, the agent must name `applicationDashboardId` (root CLAUDE.md #51).
 */
async function resolveMarker(em: EntityManager, run: AnchorRun, anchor: MarkerAnchorDto) {
  const time = Date.parse(anchor.time);
  if (Number.isNaN(time)) throw new BadRequestException('anchor.time must be a readable timestamp');
  if (!run.startTime) throw new BadRequestException('This test run has not started, so a marker has no time axis to sit on');
  const start = run.startTime.getTime();
  const end = (run.endTime ?? new Date()).getTime();
  if (time < start || time > end) {
    throw new BadRequestException(`anchor.time must lie inside the run, ${new Date(start).toISOString()} to ${new Date(end).toISOString()}`);
  }

  const dashboards: DashboardCandidate[] = await em.query(
    `SELECT ad.id::text AS id, ad.dashboard_label, ms.source_type
       FROM application_dashboards ad
       LEFT JOIN metrics_sources ms ON ms.id = ad.metrics_source_id
      WHERE ad.system_under_test_id = $1 AND ad.test_environment = $2`,
    [run.systemUnderTestId, run.testEnvironment],
  );
  const bounds = timeBoundsSql(analysisBoundsFromRow({ start_time: run.startTime, end_time: run.endTime }, false), 'time', 5);

  const series: Record<string, unknown>[] = [];
  for (const [i, s] of anchor.series.entries()) {
    const named = s.applicationDashboardId
      ? dashboards.filter((d) => d.id === s.applicationDashboardId)
      : dashboards.filter((d) => d.dashboard_label === s.dashboardLabel);
    if (named.length === 0) {
      throw new BadRequestException(
        s.applicationDashboardId
          ? `anchor.series[${i}]: application dashboard ${s.applicationDashboardId} is not a dashboard of this run's system and environment`
          : `anchor.series[${i}]: no dashboard labelled "${s.dashboardLabel}" in this run's system and environment`,
      );
    }
    const found: Array<{ dashboard: DashboardCandidate; panelTitle: string | null; unit: string | null }> = [];
    for (const d of named) {
      const hit = await findSeries(em, run, d.id, s.panelId, s.metricName, bounds);
      if (hit) found.push({ dashboard: d, ...hit });
    }
    if (found.length === 0) {
      throw new BadRequestException(
        `anchor.series[${i}]: series "${s.metricName}" on panel ${s.panelId} of "${s.dashboardLabel}" has no data in this test run`,
      );
    }
    if (found.length > 1) {
      throw new BadRequestException(
        `anchor.series[${i}]: dashboard label "${s.dashboardLabel}" matches more than one application dashboard; ` +
          `send series.applicationDashboardId, one of: ${found.map((f) => `${f.dashboard.id} (${f.dashboard.dashboard_label})`).join(', ')}`,
      );
    }
    const { dashboard, panelTitle, unit } = found[0]!;
    series.push({
      dashboardId: dashboard.id,
      dashboardLabel: dashboard.dashboard_label,
      panelId: s.panelId,
      panelTitle: panelTitle ?? '',
      metricName: s.metricName,
      source: seriesSource(dashboard.source_type),
      ...(unit ? { yAxisFormat: unit } : {}),
      colorSlot: i,
    });
  }

  // The window the Graphs replay opens on: the agent's range clamped to the run, else the run.
  let from = start;
  let to = end;
  if (anchor.range) {
    const [a, b] = anchor.range.map((t) => Date.parse(t));
    if (Number.isNaN(a) || Number.isNaN(b)) throw new BadRequestException('anchor.range must be readable timestamps');
    from = Math.max(start, a!);
    to = Math.min(end, b!);
    if (from >= to) throw new BadRequestException('anchor.range must run forwards and overlap the run');
  }
  const view: Record<string, unknown> = { series, axisMode: 'overlay' };
  if (from < to) view.xRange = [new Date(from).toISOString(), new Date(to).toISOString()];
  return { markerTime: new Date(time).toISOString(), chartContext: view };
}

async function findSeries(
  em: EntityManager,
  run: AnchorRun,
  applicationDashboardId: string,
  panelId: number,
  metricName: string,
  bounds: { clause: string; params: Date[] },
): Promise<{ panelTitle: string | null; unit: string | null } | null> {
  const raw: { panel_title: string | null; unit: string | null }[] = await em.query(
    `SELECT panel_title, unit FROM ds_metrics
      WHERE test_run_id = $1 AND application_dashboard_id = $2::uuid AND panel_id = $3 AND metric_name = $4 ${bounds.clause}
      LIMIT 1`,
    [run.testRunId, applicationDashboardId, panelId, metricName, ...bounds.params],
  );
  if (raw[0]) return { panelTitle: raw[0].panel_title, unit: raw[0].unit };
  const stats: { panel_title: string | null; unit: string | null }[] = await em.query(
    `SELECT panel_title, unit FROM ds_metric_statistics
      WHERE test_run_id = $1 AND application_dashboard_id = $2::uuid AND panel_id = $3 AND metric_name = $4
      LIMIT 1`,
    [run.testRunId, applicationDashboardId, panelId, metricName],
  );
  return stats[0] ? { panelTitle: stats[0].panel_title, unit: stats[0].unit } : null;
}
