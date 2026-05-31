/**
 * Constants for Performance Test Metrics Pipeline
 *
 * Defines the synthetic dashboard configuration, panel IDs, metric classifications,
 * and default threshold values for performance test metrics extracted from raw
 * performance test tables (requests_raw, transactions, requests_error, virtual_users).
 *
 * IMPORTANT ARCHITECTURAL CHANGES:
 * - New structure uses one dashboard per scenario (instead of single fixed dashboard)
 * - Panels are generated per transaction (hash-based IDs for stability)
 * - Special "scenario-level" panel for scenario-wide metrics
 * - Metric names are simplified (scenario/transaction names removed)
 * - See: uuid-generator.ts and panel-id-generator.ts for new utilities
 */

/**
 * @deprecated Legacy panel ID mapping - replaced by hash-based panel generation
 *
 * Use generateTransactionPanelId() from utils/panel-id-generator.ts instead.
 * New structure generates one panel per transaction with stable hash-based IDs.
 *
 * Panel ID assignments for different metric categories
 * Each metric type gets a dedicated panel ID for consistent storage in ds_metrics
 *
 * NOTE: After time-series refactoring, panel IDs represent metric categories,
 * not specific aggregations. Aggregation type is encoded in metric_name suffix.
 * Example: panel_id=1 covers all response_time metrics (avg, p90, p95, p99)
 */
const PERFORMANCE_METRIC_PANEL_IDS = {
  // Response Time Metrics (Panel ID 1) - Consolidated from 6 panels to 1
  // Stores time-series data with multiple aggregations: avg, p90, p95, p99
  RESPONSE_TIME: 1,

  // Latency & Connection Metrics (Panel IDs 7-8) - from requests_raw table
  RESPONSE_LATENCY: 7,
  RESPONSE_CONNECT_TIME: 8,

  // Error Rate (Panel ID 9) - Renamed from SUCCESS_RATE, inverted metric
  // Now tracks error percentage instead of success percentage
  ERROR_RATE: 9,

  // Throughput (Panel ID 10) - from requests_raw table
  THROUGHPUT: 10,

  // Apdex Score for Requests (Panel ID 11) - from requests_raw table
  APDEX_SCORE_REQUESTS: 11,

  // Error Count (Panel ID 12) - from requests_error table
  ERROR_COUNT: 12,

  // Transaction Response Time (Panel ID 13) - Consolidated transaction metrics
  // Stores time-series data with multiple aggregations: avg, p90, p95, p99
  TRANSACTION_RESPONSE_TIME: 13,

  // Virtual User Metrics (Panel IDs 14-15) - from virtual_users table
  AVG_ACTIVE_THREADS: 14,
  MAX_ACTIVE_THREADS: 15,

  // Transaction Error Rate (Panel ID 16) - from transactions table
  TRANSACTION_ERROR_RATE: 16,

  // Apdex Score for Transactions (Panel ID 17) - from transactions table
  APDEX_SCORE_TRANSACTIONS: 17,
} as const;

/**
 * Aggregation types for time-series metrics
 * Used in metric_name suffixes and ds_compare_config.aggregation field
 *
 * Examples:
 * - "requests.checkout.response_time.avg" → aggregation: "avg"
 * - "requests.checkout.response_time.p95" → aggregation: "p95"
 * - "requests.checkout.apdex_score" → aggregation: "apdex"
 */
export const AGGREGATION_TYPES = {
  AVG: 'avg',
  P50: 'p50',
  P90: 'p90',
  P95: 'p95',
  P99: 'p99',
  APDEX: 'apdex',
} as const;

/**
 * Metric classification configuration
 * Defines the classification category and whether higher values are better
 */
export interface MetricClassification {
  classification: string;
  higherIsBetter: boolean | null;
}

/**
 * Metric classification mappings following RED methodology and standard
 * performance testing best practices
 *
 * RED Methodology:
 * - RED_duration: Response times, latency metrics (lower is better except Apdex)
 * - RED_rate: Request/transaction rates, throughput (higher is better)
 * - RED_errors: Error counts and rates (lower is better)
 *
 * NOTE: After time-series refactoring, panel IDs represent categories.
 * Only baseline aggregations (typically 'avg') receive classifications for ADAPT comparisons.
 * Other aggregations (p90, p95, p99) are stored but not used in automated comparisons.
 */
export const PERFORMANCE_METRIC_CLASSIFICATIONS: Record<number, MetricClassification> = {
  // Response Time Metrics - RED_duration, lower is better
  // Panel ID 1 covers all response_time aggregations (avg, p90, p95, p99)
  // Only avg gets classification for ADAPT comparisons
  [PERFORMANCE_METRIC_PANEL_IDS.RESPONSE_TIME]: {
    classification: 'RED_duration',
    higherIsBetter: false,
  },

  // Latency & Connection Metrics - RED_duration, lower is better
  // Not used in ADAPT comparisons (no classification needed for comparison)
  [PERFORMANCE_METRIC_PANEL_IDS.RESPONSE_LATENCY]: {
    classification: 'RED_duration',
    higherIsBetter: false,
  },
  [PERFORMANCE_METRIC_PANEL_IDS.RESPONSE_CONNECT_TIME]: {
    classification: 'RED_duration',
    higherIsBetter: false,
  },

  // Error Rate - RED_errors, lower is better
  // Renamed from SUCCESS_RATE to ERROR_RATE (inverted metric)
  [PERFORMANCE_METRIC_PANEL_IDS.ERROR_RATE]: {
    classification: 'RED_errors',
    higherIsBetter: false,
  },

  // Throughput - RED_rate, higher is better
  [PERFORMANCE_METRIC_PANEL_IDS.THROUGHPUT]: {
    classification: 'RED_rate',
    higherIsBetter: true,
  },

  // Apdex Score for Requests - RED_duration, higher is better (0.0-1.0 scale)
  [PERFORMANCE_METRIC_PANEL_IDS.APDEX_SCORE_REQUESTS]: {
    classification: 'RED_duration',
    higherIsBetter: true,
  },

  // Error Count - RED_errors, lower is better
  [PERFORMANCE_METRIC_PANEL_IDS.ERROR_COUNT]: {
    classification: 'RED_errors',
    higherIsBetter: false,
  },

  // Transaction Response Time - RED_duration, lower is better
  // Panel ID 13 covers all transaction response_time aggregations
  [PERFORMANCE_METRIC_PANEL_IDS.TRANSACTION_RESPONSE_TIME]: {
    classification: 'RED_duration',
    higherIsBetter: false,
  },

  // Virtual User Metrics - No classification (informational metrics)
  // Changed from RED_rate as these are not typically used in performance comparisons
  [PERFORMANCE_METRIC_PANEL_IDS.AVG_ACTIVE_THREADS]: {
    classification: 'load',
    higherIsBetter: null,
  },
  [PERFORMANCE_METRIC_PANEL_IDS.MAX_ACTIVE_THREADS]: {
    classification: 'load',
    higherIsBetter: null,
  },

  // Transaction Error Rate - RED_errors, lower is better
  [PERFORMANCE_METRIC_PANEL_IDS.TRANSACTION_ERROR_RATE]: {
    classification: 'RED_errors',
    higherIsBetter: false,
  },

  // Apdex Score for Transactions - RED_duration, higher is better (0.0-1.0 scale)
  [PERFORMANCE_METRIC_PANEL_IDS.APDEX_SCORE_TRANSACTIONS]: {
    classification: 'RED_duration',
    higherIsBetter: true,
  },
};

/**
 * Default threshold configuration for ds_compare_config
 * These values are used when creating new compare configurations
 */
export const DEFAULT_PERFORMANCE_THRESHOLDS = {
  /**
   * Default aggregation method for adapt pipeline comparisons
   * Options: 'mean', 'median', 'min', 'max', 'last'
   */
  aggregation: 'mean',

  /**
   * Percentage change threshold - triggers when metric changes by more than this percentage
   * Default: 0.15 (15% change)
   */
  percentageThreshold: 0.15,

  /**
   * IQR (Interquartile Range) threshold for outlier detection
   * Default: 2.0 (more lenient than typical 1.5 to reduce false positives)
   */
  iqrThreshold: 2.0,

  /**
   * Absolute threshold - optional, null by default
   * Can be set per-metric for absolute value comparisons
   */
  absoluteThreshold: null,
} as const;

/**
 * Default value to use if control group is missing
 */
export const DEFAULT_VALUE_IF_CONTROL_GROUP_MISSING = 0;

/**
 * Metric name templates for different performance metrics
 * Used to generate consistent metric names in ds_metrics table
 *
 * NOTE: After time-series refactoring, aggregation suffixes are dynamic.
 * These templates provide base names that will be combined with aggregation types.
 *
 * Examples:
 * - Base: "response_time" → Full names: "response_time.avg", "response_time.p95", "response_time.p99"
 * - Prefix: "requests.checkout" → Full: "requests.checkout.response_time.avg"
 * - Prefix: "transactions.login" → Full: "transactions.login.response_time.avg"
 */
export const METRIC_NAME_TEMPLATES = {
  // Response time base (no aggregation suffix in template, added dynamically)
  // Will generate: response_time.avg, response_time.p90, response_time.p95, response_time.p99
  RESPONSE_TIME: 'response_time',

  // Latency & connection metrics (averaged per bucket, no suffix needed)
  RESPONSE_LATENCY: 'response_latency',
  RESPONSE_CONNECT_TIME: 'response_connect_time',

  // Error rate (replaces SUCCESS_RATE)
  ERROR_RATE: 'error_rate',

  // Throughput
  THROUGHPUT: 'throughput',

  // Apdex scores
  APDEX_SCORE: 'apdex_score',

  // Error metrics
  ERROR_COUNT: 'error_count',

  // Virtual user metrics
  AVG_ACTIVE_THREADS: 'avg_active_threads',
  MAX_ACTIVE_THREADS: 'max_active_threads',
} as const;

/**
 * Default Apdex threshold in milliseconds
 * Used when no workload or transaction-specific threshold is configured
 */
export const DEFAULT_APDEX_THRESHOLD_MS = 500;

/**
 * Apdex calculation constants
 * Apdex formula:
 * - Satisfied: response_time <= T
 * - Tolerating: T < response_time <= 4T
 * - Frustrated: response_time > 4T
 * - Apdex Score = (Satisfied + 0.5 * Tolerating) / Total
 */
export const APDEX_CONSTANTS = {
  /**
   * Multiplier for tolerating threshold (4 * T)
   */
  TOLERATING_MULTIPLIER: 4,

  /**
   * Weight given to tolerating requests in Apdex calculation
   */
  TOLERATING_WEIGHT: 0.5,
} as const;

/**
 * NEW ARCHITECTURE CONSTANTS
 * These constants support the new scenario/transaction-based dashboard structure
 */

// ---------------------------------------------------------------------------
// Panel-Per-Metric-Type Architecture (v2)
//
// Each panel represents ONE metric type across ALL transactions/requests.
// Panel IDs are fixed integers grouped by level:
//   101-106: Transaction-level metrics
//   201-209: Request-level metrics
//   301-303: Scenario-level metrics
// ---------------------------------------------------------------------------

/**
 * Fixed panel IDs for the panel-per-metric-type structure.
 */
export const METRIC_TYPE_PANEL_IDS = {
  // Transaction-level (101-107)
  TXN_RT_AVG: 101,
  TXN_RT_P90: 102,
  TXN_RT_P95: 103,
  TXN_RT_P99: 104,
  TXN_ERROR_RATE: 105,
  TXN_APDEX: 106,
  TXN_THROUGHPUT: 107,

  // Request-level (201-209)
  REQ_RT_AVG: 201,
  REQ_RT_P90: 202,
  REQ_RT_P95: 203,
  REQ_RT_P99: 204,
  REQ_ERROR_RATE: 205,
  REQ_THROUGHPUT: 206,
  REQ_APDEX: 207,
  REQ_LATENCY: 208,
  REQ_CONNECT_TIME: 209,

  // Scenario-level (301-303)
  SCENARIO_ERROR_COUNT: 301,
  SCENARIO_AVG_THREADS: 302,
  SCENARIO_MAX_THREADS: 303,
} as const;

/**
 * Human-readable panel names keyed by panel ID.
 */
export const METRIC_TYPE_PANEL_NAMES: Record<number, string> = {
  [METRIC_TYPE_PANEL_IDS.TXN_RT_AVG]: 'Transaction RT Avg',
  [METRIC_TYPE_PANEL_IDS.TXN_RT_P90]: 'Transaction RT P90',
  [METRIC_TYPE_PANEL_IDS.TXN_RT_P95]: 'Transaction RT P95',
  [METRIC_TYPE_PANEL_IDS.TXN_RT_P99]: 'Transaction RT P99',
  [METRIC_TYPE_PANEL_IDS.TXN_ERROR_RATE]: 'Transaction Error Rate',
  [METRIC_TYPE_PANEL_IDS.TXN_APDEX]: 'Transaction Apdex',
  [METRIC_TYPE_PANEL_IDS.TXN_THROUGHPUT]: 'Transaction Throughput',

  [METRIC_TYPE_PANEL_IDS.REQ_RT_AVG]: 'Request RT Avg',
  [METRIC_TYPE_PANEL_IDS.REQ_RT_P90]: 'Request RT P90',
  [METRIC_TYPE_PANEL_IDS.REQ_RT_P95]: 'Request RT P95',
  [METRIC_TYPE_PANEL_IDS.REQ_RT_P99]: 'Request RT P99',
  [METRIC_TYPE_PANEL_IDS.REQ_ERROR_RATE]: 'Request Error Rate',
  [METRIC_TYPE_PANEL_IDS.REQ_THROUGHPUT]: 'Request Throughput',
  [METRIC_TYPE_PANEL_IDS.REQ_APDEX]: 'Request Apdex',
  [METRIC_TYPE_PANEL_IDS.REQ_LATENCY]: 'Request Latency',
  [METRIC_TYPE_PANEL_IDS.REQ_CONNECT_TIME]: 'Request Connect Time',

  [METRIC_TYPE_PANEL_IDS.SCENARIO_ERROR_COUNT]: 'Error Count',
  [METRIC_TYPE_PANEL_IDS.SCENARIO_AVG_THREADS]: 'Avg Active Threads',
  [METRIC_TYPE_PANEL_IDS.SCENARIO_MAX_THREADS]: 'Max Active Threads',
};

/**
 * Unit strings keyed by panel ID.
 */
export const METRIC_TYPE_PANEL_UNITS: Record<number, string> = {
  [METRIC_TYPE_PANEL_IDS.TXN_RT_AVG]: 'ms',
  [METRIC_TYPE_PANEL_IDS.TXN_RT_P90]: 'ms',
  [METRIC_TYPE_PANEL_IDS.TXN_RT_P95]: 'ms',
  [METRIC_TYPE_PANEL_IDS.TXN_RT_P99]: 'ms',
  [METRIC_TYPE_PANEL_IDS.TXN_ERROR_RATE]: '%',
  [METRIC_TYPE_PANEL_IDS.TXN_APDEX]: '',
  [METRIC_TYPE_PANEL_IDS.TXN_THROUGHPUT]: 'txn/s',

  [METRIC_TYPE_PANEL_IDS.REQ_RT_AVG]: 'ms',
  [METRIC_TYPE_PANEL_IDS.REQ_RT_P90]: 'ms',
  [METRIC_TYPE_PANEL_IDS.REQ_RT_P95]: 'ms',
  [METRIC_TYPE_PANEL_IDS.REQ_RT_P99]: 'ms',
  [METRIC_TYPE_PANEL_IDS.REQ_ERROR_RATE]: '%',
  [METRIC_TYPE_PANEL_IDS.REQ_THROUGHPUT]: 'req/s',
  [METRIC_TYPE_PANEL_IDS.REQ_APDEX]: '',
  [METRIC_TYPE_PANEL_IDS.REQ_LATENCY]: 'ms',
  [METRIC_TYPE_PANEL_IDS.REQ_CONNECT_TIME]: 'ms',

  [METRIC_TYPE_PANEL_IDS.SCENARIO_ERROR_COUNT]: 'count',
  [METRIC_TYPE_PANEL_IDS.SCENARIO_AVG_THREADS]: 'threads',
  [METRIC_TYPE_PANEL_IDS.SCENARIO_MAX_THREADS]: 'threads',
};

/**
 * Classification objects keyed by panel ID.
 */
export const METRIC_TYPE_PANEL_CLASSIFICATIONS: Record<number, MetricClassification> = {
  [METRIC_TYPE_PANEL_IDS.TXN_RT_AVG]: { classification: 'RED_duration', higherIsBetter: false },
  [METRIC_TYPE_PANEL_IDS.TXN_RT_P90]: { classification: 'RED_duration', higherIsBetter: false },
  [METRIC_TYPE_PANEL_IDS.TXN_RT_P95]: { classification: 'RED_duration', higherIsBetter: false },
  [METRIC_TYPE_PANEL_IDS.TXN_RT_P99]: { classification: 'RED_duration', higherIsBetter: false },
  [METRIC_TYPE_PANEL_IDS.TXN_ERROR_RATE]: { classification: 'RED_errors', higherIsBetter: false },
  [METRIC_TYPE_PANEL_IDS.TXN_APDEX]: { classification: 'RED_duration', higherIsBetter: true },
  [METRIC_TYPE_PANEL_IDS.TXN_THROUGHPUT]: { classification: 'RED_rate', higherIsBetter: true },

  [METRIC_TYPE_PANEL_IDS.REQ_RT_AVG]: { classification: 'RED_duration', higherIsBetter: false },
  [METRIC_TYPE_PANEL_IDS.REQ_RT_P90]: { classification: 'RED_duration', higherIsBetter: false },
  [METRIC_TYPE_PANEL_IDS.REQ_RT_P95]: { classification: 'RED_duration', higherIsBetter: false },
  [METRIC_TYPE_PANEL_IDS.REQ_RT_P99]: { classification: 'RED_duration', higherIsBetter: false },
  [METRIC_TYPE_PANEL_IDS.REQ_ERROR_RATE]: { classification: 'RED_errors', higherIsBetter: false },
  [METRIC_TYPE_PANEL_IDS.REQ_THROUGHPUT]: { classification: 'RED_rate', higherIsBetter: true },
  [METRIC_TYPE_PANEL_IDS.REQ_APDEX]: { classification: 'RED_duration', higherIsBetter: true },
  [METRIC_TYPE_PANEL_IDS.REQ_LATENCY]: { classification: 'RED_duration', higherIsBetter: false },
  [METRIC_TYPE_PANEL_IDS.REQ_CONNECT_TIME]: { classification: 'RED_duration', higherIsBetter: false },

  [METRIC_TYPE_PANEL_IDS.SCENARIO_ERROR_COUNT]: { classification: 'RED_errors', higherIsBetter: false },
  [METRIC_TYPE_PANEL_IDS.SCENARIO_AVG_THREADS]: { classification: 'load', higherIsBetter: null },
  [METRIC_TYPE_PANEL_IDS.SCENARIO_MAX_THREADS]: { classification: 'load', higherIsBetter: null },
};

/**
 * ADAPT aggregation method keyed by panel ID.
 * Maps each panel to the aggregation name expected by the ADAPT pipeline.
 */
export const METRIC_TYPE_PANEL_ADAPT_AGGREGATION: Record<number, string> = {
  [METRIC_TYPE_PANEL_IDS.TXN_RT_AVG]: 'mean',
  [METRIC_TYPE_PANEL_IDS.TXN_RT_P90]: 'q90',
  [METRIC_TYPE_PANEL_IDS.TXN_RT_P95]: 'q95',
  [METRIC_TYPE_PANEL_IDS.TXN_RT_P99]: 'q99',
  [METRIC_TYPE_PANEL_IDS.TXN_ERROR_RATE]: 'mean',
  [METRIC_TYPE_PANEL_IDS.TXN_APDEX]: 'mean',
  [METRIC_TYPE_PANEL_IDS.TXN_THROUGHPUT]: 'mean',

  [METRIC_TYPE_PANEL_IDS.REQ_RT_AVG]: 'mean',
  [METRIC_TYPE_PANEL_IDS.REQ_RT_P90]: 'q90',
  [METRIC_TYPE_PANEL_IDS.REQ_RT_P95]: 'q95',
  [METRIC_TYPE_PANEL_IDS.REQ_RT_P99]: 'q99',
  [METRIC_TYPE_PANEL_IDS.REQ_ERROR_RATE]: 'mean',
  [METRIC_TYPE_PANEL_IDS.REQ_THROUGHPUT]: 'mean',
  [METRIC_TYPE_PANEL_IDS.REQ_APDEX]: 'mean',
  [METRIC_TYPE_PANEL_IDS.REQ_LATENCY]: 'mean',
  [METRIC_TYPE_PANEL_IDS.REQ_CONNECT_TIME]: 'mean',

  [METRIC_TYPE_PANEL_IDS.SCENARIO_ERROR_COUNT]: 'mean',
  [METRIC_TYPE_PANEL_IDS.SCENARIO_AVG_THREADS]: 'mean',
  [METRIC_TYPE_PANEL_IDS.SCENARIO_MAX_THREADS]: 'mean',
};
