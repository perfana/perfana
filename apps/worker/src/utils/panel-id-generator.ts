import { createHash } from 'crypto';

/**
 * Special panel name for scenario-level metrics (virtual users, etc.)
 */
export const SCENARIO_LEVEL_PANEL_NAME = 'scenario-level';

/**
 * @deprecated Use METRIC_TYPE_PANEL_IDS.SCENARIO_* from constants/performance-metrics.ts instead.
 * Fixed panel ID for scenario-level metrics.
 * Using a high number to avoid collisions with transaction-based panel IDs.
 */
export const SCENARIO_LEVEL_PANEL_ID = 999999;

/**
 * Generates a deterministic panel ID from a panel name using hash-based generation.
 * Ensures consistent panel IDs across pipeline runs for the same transaction/panel names.
 *
 * @param panelName - The name of the panel (typically a transaction name or SCENARIO_LEVEL_PANEL_NAME)
 * @returns A positive integer panel ID
 *
 * @example
 * const panelId = generatePanelId('checkout');
 * // Returns a stable integer like 123456
 *
 * const scenarioPanelId = generatePanelId(SCENARIO_LEVEL_PANEL_NAME);
 * // Returns: 999999 (fixed ID for scenario-level metrics)
 */
export function generatePanelId(panelName: string): number {
  // Special case: scenario-level panel always uses fixed ID
  if (panelName === SCENARIO_LEVEL_PANEL_NAME) {
    return SCENARIO_LEVEL_PANEL_ID;
  }

  // Create SHA-256 hash of the panel name
  const hash = createHash('sha256').update(panelName).digest('hex');

  // Convert first 8 hex characters to integer
  // Use modulo to keep it within a reasonable range (1 to 999998)
  const hashInt = parseInt(hash.substring(0, 8), 16);
  const panelId = (hashInt % 999998) + 1; // Range: 1 to 999998

  return panelId;
}

/**
 * @deprecated Use METRIC_TYPE_PANEL_IDS from constants/performance-metrics.ts instead.
 * Kept for backward compatibility with old test run data.
 *
 * Generates a panel ID specifically for a transaction.
 *
 * @param transactionName - The transaction name
 * @returns A deterministic panel ID for the transaction
 */
export function generateTransactionPanelId(transactionName: string): number {
  return generatePanelId(transactionName);
}

/**
 * @deprecated Use METRIC_TYPE_PANEL_IDS.SCENARIO_* from constants/performance-metrics.ts instead.
 * Kept for backward compatibility with old test run data.
 *
 * Returns the fixed panel ID for scenario-level metrics.
 *
 * @returns The scenario-level panel ID (999999)
 */
export function getScenarioLevelPanelId(): number {
  return SCENARIO_LEVEL_PANEL_ID;
}
