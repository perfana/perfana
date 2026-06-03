import { createHash } from 'crypto';

/**
 * Generates a deterministic UUID v5-like identifier from a string input.
 * Uses SHA-256 hashing to ensure stability across pipeline runs.
 *
 * @param input - The string to generate a UUID from (e.g., "sys-123-prod-loadtest")
 * @returns A UUID string in the format xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 *
 * @example
 * const uuid = generateDeterministicUuid('my-system-prod-loadtest');
 * // Returns: "a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7"
 */
export function generateDeterministicUuid(input: string): string {
  // Create SHA-256 hash of the input
  const hash = createHash('sha256').update(input).digest('hex');

  // Format as UUID: 8-4-4-4-12 hexadecimal characters
  // Use version 5 (SHA-1 based, but we're using SHA-256) indicator in the version field
  const uuid = [
    hash.substring(0, 8),
    hash.substring(8, 12),
    '5' + hash.substring(13, 16), // Version 5 identifier
    ((parseInt(hash.substring(16, 18), 16) & 0x3f) | 0x80).toString(16) + hash.substring(18, 20), // Variant bits
    hash.substring(20, 32),
  ].join('-');

  return uuid;
}

/**
 * Generates a dashboard UUID for a specific scenario.
 *
 * @param systemUnderTestId - The UUID of the system under test
 * @param testEnvironment - The test environment (e.g., "production", "staging")
 * @param scenarioName - The scenario name (e.g., "loadtest", "smoketest")
 * @returns A deterministic UUID for the dashboard
 *
 * @example
 * const dashboardId = generateScenarioDashboardUuid(
 *   'abc-123',
 *   'production',
 *   'loadtest'
 * );
 */
export function generateScenarioDashboardUuid(
  systemUnderTestId: string,
  testEnvironment: string,
  scenarioName: string
): string {
  const input = `${systemUnderTestId}-${testEnvironment}-perf-test-${scenarioName}`;
  return generateDeterministicUuid(input);
}

/** Fixed prefix for every performance-test scenario dashboard UID (25 chars). */
const SCENARIO_DASHBOARD_UID_PREFIX = 'performance-test-metrics-';

/**
 * Maximum length of a scenario dashboard UID, bounded by the
 * `application_dashboards.dashboard_uid` column (`varchar(100)`).
 */
const SCENARIO_DASHBOARD_UID_MAX_LENGTH = 100;

/** Length of the deterministic hash suffix appended to truncated UIDs (8 hex chars). */
const SCENARIO_DASHBOARD_UID_HASH_LENGTH = 8;

/**
 * Generates a dashboard UID for Grafana integration.
 *
 * The result is always `<= 100` characters so it fits the `varchar(100)`
 * `application_dashboards.dashboard_uid` column. Short names are returned
 * unchanged (`performance-test-metrics-<sanitized>`) so already-ingested runs
 * keep stable UIDs. When the sanitized name would overflow the column, it is
 * truncated and a short deterministic SHA-256 suffix of the *original* name is
 * appended — this keeps the UID stable across re-runs (idempotent) while
 * guaranteeing two long names that share a truncated prefix still map to
 * distinct UIDs.
 *
 * @param scenarioName - The scenario name (e.g., "loadtest", "smoketest")
 * @returns A dashboard UID string, never longer than 100 characters
 *
 * @example
 * const uid = generateScenarioDashboardUid('loadtest');
 * // Returns: "performance-test-metrics-loadtest"
 */
export function generateScenarioDashboardUid(scenarioName: string): string {
  // Sanitize scenario name for use in UID (lowercase, replace spaces/special chars with hyphens)
  const sanitized = scenarioName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const full = `${SCENARIO_DASHBOARD_UID_PREFIX}${sanitized}`;

  // Common case: the full UID already fits — return it unchanged so existing
  // short-name dashboards see no churn.
  if (full.length <= SCENARIO_DASHBOARD_UID_MAX_LENGTH) {
    return full;
  }

  // Overflow: truncate the sanitized name and append a deterministic hash of the
  // original scenario name to preserve uniqueness within the 100-char budget.
  const hash = createHash('sha256')
    .update(scenarioName)
    .digest('hex')
    .substring(0, SCENARIO_DASHBOARD_UID_HASH_LENGTH);
  const suffix = `-${hash}`; // 9 chars (hyphen + 8 hex)
  const available =
    SCENARIO_DASHBOARD_UID_MAX_LENGTH - SCENARIO_DASHBOARD_UID_PREFIX.length - suffix.length;
  // Trim trailing hyphens from the truncated name to avoid an ugly "--" join.
  const truncated = sanitized.substring(0, available).replace(/-+$/, '');

  return `${SCENARIO_DASHBOARD_UID_PREFIX}${truncated}${suffix}`;
}

/**
 * Generates a human-readable dashboard label.
 *
 * @param scenarioName - The scenario name (e.g., "loadtest", "smoketest")
 * @returns A dashboard label string
 *
 * @example
 * const label = generateScenarioDashboardLabel('loadtest');
 * // Returns: "Performance test metrics loadtest"
 */
export function generateScenarioDashboardLabel(scenarioName: string): string {
  return `Performance test metrics ${scenarioName}`;
}
