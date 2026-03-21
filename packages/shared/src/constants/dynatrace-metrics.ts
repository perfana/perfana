/**
 * Constants for Dynatrace Host Metrics
 *
 * Defines USE methodology classifications, panel IDs, and threshold configurations
 * for Dynatrace infrastructure/host metrics extracted from the Dynatrace Metrics API.
 *
 * USE Methodology (for Infrastructure Resources):
 * - Utilization: Percentage of resource capacity being used (CPU, Memory, Disk)
 * - Saturation: Degree of queuing or waiting for resources
 * - Errors: Hardware/infrastructure error counts or rates
 *
 * See: Brendan Gregg's USE Method (http://www.brendangregg.com/usemethod.html)
 */

/**
 * Metric classification configuration
 * Defines the classification category and whether higher values are better
 */
export interface MetricClassification {
  classification: string;
  higherIsBetter: boolean | null;
}

/**
 * Panel ID assignments for Dynatrace host metrics
 * Each metric category gets a dedicated panel ID for consistent storage in ds_metrics
 *
 * Panel ID Range: 100-199 reserved for Dynatrace host metrics
 * (to avoid conflicts with performance test metrics which use 1-99)
 */
export const DYNATRACE_HOST_METRIC_PANEL_IDS = {
  /**
   * CPU Usage Percentage (USE_utilization)
   * Metric selector: builtin:host.cpu.usage
   * Lower is better (high CPU usage indicates resource contention)
   */
  CPU_USAGE: 100,

  /**
   * Memory Usage Percentage (USE_utilization)
   * Metric selector: builtin:host.mem.usage
   * Lower is better (high memory usage can lead to swapping/OOM)
   */
  MEMORY_USAGE: 101,

  /**
   * Disk Utilization Time Percentage (USE_utilization)
   * Metric selector: builtin:host.disk.utilTime
   * Lower is better (high disk utilization indicates I/O bottleneck)
   */
  DISK_UTILIZATION: 102,

  /**
   * Network Traffic (USE_utilization - informational)
   * Metric selector: builtin:host.net.nic.traffic
   * Direction is context-dependent (can be inbound or outbound)
   */
  NETWORK_TRAFFIC: 103,

  /**
   * Disk Queue Length (USE_saturation)
   * Metric selector: builtin:host.disk.queueLength
   * Lower is better (high queue depth indicates I/O saturation)
   */
  DISK_QUEUE_LENGTH: 104,

  /**
   * Available Memory Bytes (USE_utilization - inverted)
   * Metric selector: builtin:host.mem.available
   * Higher is better (more available memory is better)
   */
  MEMORY_AVAILABLE: 105,
} as const;

/**
 * Metric classification mappings following USE methodology
 *
 * USE Methodology Categories:
 * - USE_utilization: Resource usage as percentage of capacity (0-100%)
 * - USE_saturation: Queue depth, wait times (indicates resource contention)
 * - USE_errors: Hardware/infrastructure error counts or rates
 *
 * Classification Guidance:
 * - higherIsBetter: false → Lower values indicate better performance/health
 * - higherIsBetter: true → Higher values indicate better performance/health
 * - higherIsBetter: null → Informational metric, direction depends on context
 */
export const DYNATRACE_HOST_METRIC_CLASSIFICATIONS: Record<number, MetricClassification> = {
  // CPU Usage - USE_utilization, lower is better
  [DYNATRACE_HOST_METRIC_PANEL_IDS.CPU_USAGE]: {
    classification: 'USE_utilization',
    higherIsBetter: false,
  },

  // Memory Usage - USE_utilization, lower is better
  [DYNATRACE_HOST_METRIC_PANEL_IDS.MEMORY_USAGE]: {
    classification: 'USE_utilization',
    higherIsBetter: false,
  },

  // Disk Utilization - USE_utilization, lower is better
  [DYNATRACE_HOST_METRIC_PANEL_IDS.DISK_UTILIZATION]: {
    classification: 'USE_utilization',
    higherIsBetter: false,
  },

  // Network Traffic - USE_utilization, informational (context-dependent)
  [DYNATRACE_HOST_METRIC_PANEL_IDS.NETWORK_TRAFFIC]: {
    classification: 'USE_utilization',
    higherIsBetter: null,
  },

  // Disk Queue Length - USE_saturation, lower is better
  [DYNATRACE_HOST_METRIC_PANEL_IDS.DISK_QUEUE_LENGTH]: {
    classification: 'USE_saturation',
    higherIsBetter: false,
  },

  // Available Memory - USE_utilization, higher is better (inverted metric)
  [DYNATRACE_HOST_METRIC_PANEL_IDS.MEMORY_AVAILABLE]: {
    classification: 'USE_utilization',
    higherIsBetter: true,
  },
};

/**
 * Default threshold configuration for USE metrics in ds_compare_config
 * Infrastructure metrics are more sensitive than application metrics, so we use
 * tighter thresholds to catch performance degradation earlier.
 */
export const DEFAULT_USE_THRESHOLDS = {
  /**
   * Default aggregation method for ADAPT pipeline comparisons
   * Options: 'mean', 'median', 'min', 'max', 'last'
   */
  aggregation: 'mean',

  /**
   * Percentage change threshold for infrastructure metrics
   * Default: 0.10 (10% change)
   * Infrastructure metrics are more sensitive than application metrics (15%)
   * because small changes in CPU/Memory can indicate significant issues.
   */
  percentageThreshold: 0.10,

  /**
   * IQR (Interquartile Range) threshold for outlier detection
   * Default: 2.0 (consistent with performance metrics)
   */
  iqrThreshold: 2.0,

  /**
   * Absolute threshold - optional, null by default
   * Can be set per-metric for absolute value comparisons
   * Example: CPU usage > 80%, Memory usage > 90%
   */
  absoluteThreshold: null,
} as const;

/**
 * Map Dynatrace metric selector to panel ID
 *
 * This helper function translates Dynatrace Metrics API metric selectors
 * into the corresponding panel ID for storage in ds_metrics table.
 *
 * @param metricSelector - Dynatrace metric selector (e.g., "builtin:host.cpu.usage")
 * @returns Panel ID number, or 0 if metric is unknown
 *
 * @example
 * getDynatraceHostPanelId("builtin:host.cpu.usage")
 * // Returns: 100 (DYNATRACE_HOST_METRIC_PANEL_IDS.CPU_USAGE)
 *
 * getDynatraceHostPanelId("builtin:host.mem.usage")
 * // Returns: 101 (DYNATRACE_HOST_METRIC_PANEL_IDS.MEMORY_USAGE)
 *
 * getDynatraceHostPanelId("unknown.metric")
 * // Returns: 0 (unknown metric)
 */
export function getDynatraceHostPanelId(metricSelector: string): number {
  // Normalize the metric selector by removing prefixes and splitting
  const normalizedSelector = metricSelector.toLowerCase().trim();

  // CPU Usage
  if (
    normalizedSelector.includes('cpu.usage') ||
    normalizedSelector.includes('builtin:host.cpu.usage')
  ) {
    return DYNATRACE_HOST_METRIC_PANEL_IDS.CPU_USAGE;
  }

  // Memory Usage
  if (
    normalizedSelector.includes('mem.usage') ||
    normalizedSelector.includes('builtin:host.mem.usage')
  ) {
    return DYNATRACE_HOST_METRIC_PANEL_IDS.MEMORY_USAGE;
  }

  // Disk Utilization Time
  if (
    normalizedSelector.includes('disk.utiltime') ||
    normalizedSelector.includes('builtin:host.disk.utiltime')
  ) {
    return DYNATRACE_HOST_METRIC_PANEL_IDS.DISK_UTILIZATION;
  }

  // Network Traffic
  if (
    normalizedSelector.includes('net.nic.traffic') ||
    normalizedSelector.includes('builtin:host.net.nic.traffic')
  ) {
    return DYNATRACE_HOST_METRIC_PANEL_IDS.NETWORK_TRAFFIC;
  }

  // Disk Queue Length
  if (
    normalizedSelector.includes('disk.queuelength') ||
    normalizedSelector.includes('builtin:host.disk.queuelength')
  ) {
    return DYNATRACE_HOST_METRIC_PANEL_IDS.DISK_QUEUE_LENGTH;
  }

  // Available Memory
  if (
    normalizedSelector.includes('mem.available') ||
    normalizedSelector.includes('builtin:host.mem.available')
  ) {
    return DYNATRACE_HOST_METRIC_PANEL_IDS.MEMORY_AVAILABLE;
  }

  // Unknown metric
  return 0;
}

/**
 * Get metric classification for a Dynatrace metric selector
 *
 * Convenience function that combines panel ID lookup with classification retrieval.
 *
 * @param metricSelector - Dynatrace metric selector
 * @returns MetricClassification object, or null if metric is unknown
 *
 * @example
 * getDynatraceMetricClassification("builtin:host.cpu.usage")
 * // Returns: { classification: "USE_utilization", higherIsBetter: false }
 */
export function getDynatraceMetricClassification(
  metricSelector: string
): MetricClassification | null {
  const panelId = getDynatraceHostPanelId(metricSelector);
  if (panelId === 0) {
    return null;
  }
  return DYNATRACE_HOST_METRIC_CLASSIFICATIONS[panelId] || null;
}

/**
 * Check if a metric selector is a known Dynatrace host metric
 *
 * @param metricSelector - Dynatrace metric selector to check
 * @returns true if the metric is known and classified, false otherwise
 *
 * @example
 * isDynatraceHostMetric("builtin:host.cpu.usage")
 * // Returns: true
 *
 * isDynatraceHostMetric("custom:my.metric")
 * // Returns: false
 */
export function isDynatraceHostMetric(metricSelector: string): boolean {
  return getDynatraceHostPanelId(metricSelector) !== 0;
}

/**
 * Metric name templates for Dynatrace host metrics
 * Used to generate consistent metric names in ds_metrics table
 *
 * Format: "dynatrace.host.{metric_type}"
 * This distinguishes them from performance test metrics
 */
export const DYNATRACE_METRIC_NAME_TEMPLATES = {
  CPU_USAGE: 'dynatrace.host.cpu.usage',
  MEMORY_USAGE: 'dynatrace.host.mem.usage',
  DISK_UTILIZATION: 'dynatrace.host.disk.utiltime',
  NETWORK_TRAFFIC: 'dynatrace.host.net.nic.traffic',
  DISK_QUEUE_LENGTH: 'dynatrace.host.disk.queuelength',
  MEMORY_AVAILABLE: 'dynatrace.host.mem.available',
} as const;

/**
 * Build a Dynatrace metric name from a metric selector
 *
 * Converts Dynatrace API metric selectors into standardized metric names
 * for storage in ds_metrics table.
 *
 * @param metricSelector - Dynatrace metric selector
 * @param entityName - Optional entity name to include (host name, process group, etc.)
 * @returns Standardized metric name, or null if metric is unknown
 *
 * @example
 * buildDynatraceMetricName("builtin:host.cpu.usage", "web-server-01")
 * // Returns: "dynatrace.host.web-server-01.cpu.usage"
 *
 * buildDynatraceMetricName("builtin:host.cpu.usage")
 * // Returns: "dynatrace.host.cpu.usage"
 */
export function buildDynatraceMetricName(
  metricSelector: string,
  entityName?: string
): string | null {
  const panelId = getDynatraceHostPanelId(metricSelector);
  if (panelId === 0) {
    return null;
  }

  // Map panel ID to metric name template
  let baseTemplate: string;
  switch (panelId) {
    case DYNATRACE_HOST_METRIC_PANEL_IDS.CPU_USAGE:
      baseTemplate = DYNATRACE_METRIC_NAME_TEMPLATES.CPU_USAGE;
      break;
    case DYNATRACE_HOST_METRIC_PANEL_IDS.MEMORY_USAGE:
      baseTemplate = DYNATRACE_METRIC_NAME_TEMPLATES.MEMORY_USAGE;
      break;
    case DYNATRACE_HOST_METRIC_PANEL_IDS.DISK_UTILIZATION:
      baseTemplate = DYNATRACE_METRIC_NAME_TEMPLATES.DISK_UTILIZATION;
      break;
    case DYNATRACE_HOST_METRIC_PANEL_IDS.NETWORK_TRAFFIC:
      baseTemplate = DYNATRACE_METRIC_NAME_TEMPLATES.NETWORK_TRAFFIC;
      break;
    case DYNATRACE_HOST_METRIC_PANEL_IDS.DISK_QUEUE_LENGTH:
      baseTemplate = DYNATRACE_METRIC_NAME_TEMPLATES.DISK_QUEUE_LENGTH;
      break;
    case DYNATRACE_HOST_METRIC_PANEL_IDS.MEMORY_AVAILABLE:
      baseTemplate = DYNATRACE_METRIC_NAME_TEMPLATES.MEMORY_AVAILABLE;
      break;
    default:
      return null;
  }

  // If entity name is provided, insert it into the metric name
  if (entityName) {
    // Convert template: "dynatrace.host.cpu.usage" → "dynatrace.host.{entity}.cpu.usage"
    const parts = baseTemplate.split('.');
    // Insert entity name after "dynatrace.host"
    parts.splice(2, 0, entityName);
    return parts.join('.');
  }

  return baseTemplate;
}
