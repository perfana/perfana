/**
 * The card a test-run comment belongs to (design: docs/designs/test-run-comments.md, R11).
 *
 * Keys are the web page's `expansionState` names; values are what is STORED in
 * `test_run_comments.card_key` and `test_run_comment_reads.card_key`. A stored value must
 * never change: renaming one orphans every comment and read mark on that card with no error.
 * Rename an expansion key freely, but keep its value. The API validates `card` against
 * `COMMENT_CARD_KEYS`; the web asserts every expansion key has an entry.
 */
export const COMMENT_CARD_BY_EXPANSION_KEY = Object.freeze({
  expanded: 'details',
  configExpanded: 'config',
  dashboardsExpanded: 'dashboards',
  anomalyExpanded: 'anomaly',
  performanceExpanded: 'performance',
  sloExpanded: 'slo',
  deepLinksExpanded: 'deep-links',
  eventsExpanded: 'events',
  dynatraceExpanded: 'dynatrace',
  distributedTracingExpanded: 'distributed-tracing',
  pyroscopeExpanded: 'pyroscope',
  splunkExpanded: 'splunk',
  awrExpanded: 'awr',
  reportExpanded: 'report',
  trendsExpanded: 'trends',
  compareExpanded: 'compare',
  graphsExpanded: 'graphs',
} as const);

export type CommentCardKey =
  (typeof COMMENT_CARD_BY_EXPANSION_KEY)[keyof typeof COMMENT_CARD_BY_EXPANSION_KEY];

export const COMMENT_CARD_KEYS: readonly CommentCardKey[] = Object.freeze(
  Object.values(COMMENT_CARD_BY_EXPANSION_KEY),
);

/**
 * What each card is called on the run page, for the drawer heading and a report's Comments
 * section. Display text only: rename freely, unlike the stored keys above.
 */
export const COMMENT_CARD_LABELS: Readonly<Record<CommentCardKey, string>> = Object.freeze({
  details: 'Test run details',
  config: 'Configuration',
  dashboards: 'Dashboards',
  anomaly: 'Anomaly detection',
  performance: 'Performance analysis',
  slo: 'Service level objectives',
  'deep-links': 'Deep links',
  events: 'Events',
  dynatrace: 'Dynatrace',
  'distributed-tracing': 'Distributed tracing',
  pyroscope: 'Pyroscope',
  splunk: 'Splunk',
  awr: 'AWR report',
  report: 'Reports',
  trends: 'Trends',
  compare: 'Compare',
  graphs: 'Graphs',
});

/**
 * Who wrote a comment (migration 1831): a person, or an AI agent through an API key carrying
 * `API_KEY_COMMENTS_WRITE_ROLE`. Stored in `test_run_comments.author_kind` and mirrored by its
 * CHECK, so a stored value must never change.
 */
export const COMMENT_AUTHOR_KINDS = Object.freeze(['user', 'agent'] as const);
export type CommentAuthorKind = (typeof COMMENT_AUTHOR_KINDS)[number];

/**
 * The opt-in API-key role that lets a key write comments (design: test-run-analysis-stories.md,
 * "Reversing v1 R3"). Carried in `api_keys.roles`; it maps to no capability and grants nothing
 * outside the comments routes, which check for it by name.
 */
export const API_KEY_COMMENTS_WRITE_ROLE = 'comments:write';

/** Per API key per run: most root comments and replies an agent may write (design limits). */
export const AGENT_COMMENT_LIMITS = Object.freeze({ roots: 100, replies: 200 });

/** Width of `test_run_comments.client_ref`. */
export const COMMENT_CLIENT_REF_MAX_LENGTH = 64;

/** Comments older than this never count as unread (design R7). */
export const COMMENT_UNREAD_WINDOW_DAYS = 30;

/** Maximum comment body length, mirrored by the table's CHECK. */
export const COMMENT_BODY_MAX_LENGTH = 10_000;

/** Width of `test_run_comments.item_key`; a longer key is refused with a 400. */
export const COMMENT_ITEM_KEY_MAX_LENGTH = 1024;

/** Width of `test_run_comments.item_label`. */
export const COMMENT_ITEM_LABEL_MAX_LENGTH = 255;

/**
 * Item key of a Configuration card row (design: test-run-analysis-stories.md, "Item-level
 * comments"). On the config key alone: a key's tags can differ between the two compared runs,
 * so one key may render as several rows, and they all share one thread. Stored, so the format
 * must never change.
 */
export function configCommentItemKey(configKey: string): string {
  return `config:${configKey}`;
}

/**
 * Item key of a Dashboards card tile: the application dashboard's id, never the Grafana
 * dashboard uid, which is unique only within one Grafana instance. Stored, so the format must
 * never change.
 */
export function dashboardCommentItemKey(applicationDashboardId: string): string {
  return `dashboard:${applicationDashboardId}`;
}

/** Code points, so a key or label is never cut through a surrogate pair. */
const codePoints = (s: string): string[] => Array.from(s);

/** `s` cut to `max` code points. */
export function clipCommentText(s: string, max: number): string {
  const c = codePoints(s);
  return c.length > max ? c.slice(0, max).join('') : s;
}

/**
 * A Configuration row's comment anchor, or null when its item key would not fit `item_key`
 * (the API would refuse it). Keys that long are not expected; the guard only avoids a 400.
 * Shared by the web row and the API's agent anchor resolver, so both build the same key.
 */
export function configCommentAnchor(configKey: string): { itemKey: string; itemLabel: string } | null {
  const itemKey = configCommentItemKey(configKey);
  if (codePoints(itemKey).length > COMMENT_ITEM_KEY_MAX_LENGTH) return null;
  return { itemKey, itemLabel: clipCommentText(configKey, COMMENT_ITEM_LABEL_MAX_LENGTH) };
}

/** What a Dashboards tile comment is anchored to and called. */
export function dashboardCommentAnchor(dashboard: {
  id: string;
  dashboard_label?: string | null;
  dashboard_name?: string | null;
}): { itemKey: string; itemLabel: string } {
  const label = dashboard.dashboard_label || dashboard.dashboard_name || dashboard.id;
  return { itemKey: dashboardCommentItemKey(dashboard.id), itemLabel: clipCommentText(label, COMMENT_ITEM_LABEL_MAX_LENGTH) };
}

/** The scenario group Performance analysis lists a transaction without a scenario under. */
export const TRANSACTION_NO_SCENARIO_GROUP = 'No Scenario';

/** The Performance analysis group a transaction's `scenario_name` lands in. */
export function transactionScenarioGroup(scenarioName: string | null | undefined): string {
  return scenarioName || TRANSACTION_NO_SCENARIO_GROUP;
}

/**
 * Item key of a Performance analysis transaction row: the scenario group it is listed under
 * plus its name (two scenarios can share a transaction name). JSON so either part may contain
 * any text. Stored, so the format must never change.
 */
export function transactionCommentItemKey(scenarioGroup: string, transactionName: string): string {
  return JSON.stringify([scenarioGroup, transactionName]);
}

/** What a transaction row's comment is called. */
export function transactionCommentItemLabel(scenarioGroup: string, transactionName: string): string {
  return `${scenarioGroup} · ${transactionName}`.slice(0, COMMENT_ITEM_LABEL_MAX_LENGTH);
}

export function parseTransactionCommentItemKey(key: string): { scenario: string; transaction: string } | null {
  try {
    const v: unknown = JSON.parse(key);
    return Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'string')
      ? { scenario: v[0] as string, transaction: v[1] as string }
      : null;
  } catch {
    return null;
  }
}

/** The check-result fields an SLO row's key and label are built from (snake_case, as the API returns them). */
export interface SloCommentResultFields {
  panel_type?: string | null;
  evaluate_type?: string | null;
  benchmark_id?: string | null;
  panel_title?: string | null;
  application_dashboard_id?: string | null;
  panel_id?: number | null;
  metric_name?: string | null;
  dashboard_label?: string | null;
}

export function isApdexCheckResult(result: Pick<SloCommentResultFields, 'panel_type' | 'evaluate_type'>): boolean {
  return result.panel_type === 'apdex' || result.evaluate_type === 'apdex';
}

/**
 * Identity of one SLO row: its React key, its expansion entry and its comment item key.
 * Carries `benchmark_id` because two SLOs can share a dashboard, panel and metric name; is NOT
 * `check_results.id`, because a re-evaluate rewrites results with fresh uuids. Stored as a
 * comment's item key, so the format must never change.
 */
export function sloCommentItemKey(result: SloCommentResultFields): string {
  const benchmarkId = result.benchmark_id || 'unknown';
  if (isApdexCheckResult(result)) {
    return `apdex_${benchmarkId}_${result.panel_title || 'unknown'}`;
  }
  const dashboardId = result.application_dashboard_id || benchmarkId;
  const panelId = result.panel_id ?? 'unknown';
  const metricName = result.metric_name || 'unknown';
  return `${dashboardId}_${panelId}_${metricName}_${benchmarkId}`;
}

/** What an SLO row's comment is called. */
export function sloCommentItemLabel(result: SloCommentResultFields): string {
  if (isApdexCheckResult(result)) {
    return result.panel_title && result.panel_title !== 'Workload Apdex' ? `Apdex SLO · ${result.panel_title}` : 'Apdex SLO';
  }
  return [result.dashboard_label, result.panel_title, result.metric_name].filter(Boolean).join(' · ').slice(0, COMMENT_ITEM_LABEL_MAX_LENGTH) || 'SLO';
}

/** Longest config value a Configuration comment's view keeps; mirrored by the API DTO. */
export const CONFIG_VIEW_VALUE_MAX_LENGTH = 2_000;

/**
 * What a root comment on a Configuration item records (`chart_context`, `kind: 'config'`): the
 * run the card compared with and the item's status and values in that comparison. A value is
 * null when the key is absent from that side.
 */
export interface ConfigCommentView {
  kind?: 'config';
  comparedToTestRunId?: string;
  status: 'changed' | 'expected' | 'new' | 'removed' | 'same';
  currentValue?: string | null;
  previousValue?: string | null;
}

/**
 * One line for a Configuration comment's recorded comparison, shown under the comment in the
 * drawer and in a report: `Compared with run 1234: 2 GB → 512 MB (changed)`. Plain text; the
 * caller escapes it for HTML.
 */
export function describeConfigCommentView(view: Pick<ConfigCommentView, 'comparedToTestRunId' | 'status' | 'currentValue' | 'previousValue'>): string {
  const show = (v: string | null | undefined) => (v === null || v === undefined ? '(not present)' : v);
  const status = view.status === 'expected' ? 'ignored change' : view.status;
  if (!view.comparedToTestRunId) return `Not compared with another run: ${show(view.currentValue)} (${status})`;
  const values = view.status === 'same' ? show(view.currentValue) : `${show(view.previousValue)} → ${show(view.currentValue)}`;
  return `Compared with run ${view.comparedToTestRunId}: ${values} (${status})`;
}

/**
 * Analysis tags a root comment may carry (design: docs/designs/test-run-analysis-stories.md,
 * "Tags"). Stored in `test_run_comments.tag` and mirrored by that column's CHECK, so a stored
 * value must never change. The order is the suggested story order.
 */
export const COMMENT_TAGS = Object.freeze([
  'symptom',
  'hypothesis',
  'evidence',
  'ruled-out',
  'root-cause',
  'action',
] as const);

export type CommentTag = (typeof COMMENT_TAGS)[number];

/** Display text for each tag. Rename freely, unlike the stored keys. */
export const COMMENT_TAG_LABELS: Readonly<Record<CommentTag, string>> = Object.freeze({
  symptom: 'Symptom',
  hypothesis: 'Hypothesis',
  evidence: 'Evidence',
  'ruled-out': 'Ruled out',
  'root-cause': 'Root cause',
  action: 'Action',
});

export function isCommentTag(value: unknown): value is CommentTag {
  return typeof value === 'string' && (COMMENT_TAGS as readonly string[]).includes(value);
}
