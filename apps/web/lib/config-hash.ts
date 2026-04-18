/**
 * Utility functions for configuration hashing and comparison
 */

/**
 * Generates a consistent hash for configuration objects
 * Uses a deterministic approach to ensure same config always produces same hash
 */
export function generateConfigHash(config: unknown): string {
  // Remove volatile fields that shouldn't affect the hash
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { last_modified_at, config_hash, ...relevantConfig } = (config as Record<string, unknown>) || {};

  // Sort keys for consistent ordering
  const normalized = JSON.stringify(relevantConfig, Object.keys(relevantConfig).sort());

  // Use Web Crypto API for hashing (browser-compatible)
  // For now, we'll use a simple string hash function
  return simpleHash(normalized);
}

/**
 * Simple hash function for browser compatibility
 * Produces a consistent 32-character hash
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  // Convert to hex and pad to ensure consistent length
  const hexHash = Math.abs(hash).toString(16);
  return hexHash.padStart(8, '0').substring(0, 8); // Return 8-char hash
}

/**
 * Checks if a result is stale based on config hash
 */
export function isResultStale(
  resultConfigHash: string | undefined,
  currentConfigHash: string | undefined
): boolean {
  // If either hash is missing, consider it potentially stale
  if (!resultConfigHash || !currentConfigHash) {
    return true;
  }

  return resultConfigHash !== currentConfigHash;
}

/**
 * Generates a hash for specific threshold configuration
 * Used to detect meaningful changes that require re-analysis
 */
export function generateThresholdHash(thresholds: unknown): string {
  const typedThresholds = thresholds as Record<string, unknown>;
  const relevantFields = {
    aggregation: typedThresholds?.aggregation,
    percentageThreshold: typedThresholds?.percentageThreshold,
    iqrThreshold: typedThresholds?.iqrThreshold,
    absoluteThreshold: typedThresholds?.absoluteThreshold
  };

  return generateConfigHash(relevantFields);
}