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

/**
 * Analysis stories (design: test-run-analysis-stories.md, "Stories"; migration 1830). The widths
 * and caps are mirrored by `test_run_stories` / `test_run_story_steps` CHECKs and the API DTOs.
 */
export const STORY_TITLE_MAX_LENGTH = 200;
/** A story's conclusion; the same cap as a comment body. */
export const STORY_SUMMARY_MAX_LENGTH = 10_000;
/** The story author's connecting words on one step. */
export const STORY_STEP_NOTE_MAX_LENGTH = 2_000;
/** Most steps one story may hold. */
export const STORY_MAX_STEPS = 50;

/** Stored in `test_run_stories.status` and mirrored by its CHECK. */
export const STORY_STATUSES = Object.freeze(['draft', 'published'] as const);
export type StoryStatus = (typeof STORY_STATUSES)[number];

/**
 * Who wrote a story, stored in `test_run_stories.author_kind`. Only 'user' is written until agent
 * authoring through MCP ships; the API never reads it from a request.
 */
export const STORY_AUTHOR_KINDS = Object.freeze(['user', 'agent'] as const);
export type StoryAuthorKind = (typeof STORY_AUTHOR_KINDS)[number];

/**
 * The suggested story order (design: "Suggest order"): by tag in `COMMENT_TAGS` order, untagged
 * last, then by creation time. Pure, so the web editor and a test share it. Stable for ties.
 */
export function suggestStoryOrder<T extends { tag: CommentTag | null; createdAt: string }>(steps: readonly T[]): T[] {
  const rank = (t: CommentTag | null): number => (t ? COMMENT_TAGS.indexOf(t) : COMMENT_TAGS.length);
  return steps
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s.tag) - rank(b.s.tag) || Date.parse(a.s.createdAt) - Date.parse(b.s.createdAt) || a.i - b.i)
    .map(({ s }) => s);
}
