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
