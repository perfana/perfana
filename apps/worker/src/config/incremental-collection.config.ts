/**
 * Incremental Collection Configuration
 *
 * This configuration controls the incremental collection feature that polls for
 * in-progress test runs and triggers metric collection without waiting for test completion.
 *
 * Benefits:
 * - Real-time metric visibility during test execution
 * - Reduced time-to-insight for long-running tests
 * - Early detection of performance issues
 *
 * Architecture:
 *   Scheduler → Detect in-progress test runs (heartbeat check)
 *            → Trigger incremental collection job
 *            → Process panels in batches
 *            → Publish realtime updates
 *            → Frontend displays live metrics
 */

export interface IncrementalCollectionConfig {
  /** Enable/disable incremental collection feature */
  enabled: boolean;

  /** Interval in seconds between incremental collection checks */
  intervalSeconds: number;

  /** Maximum number of retries for failed collection attempts */
  maxRetries: number;

  /** Heartbeat threshold in seconds - test run is "in progress" if endTime updated within this window */
  heartbeatThresholdSeconds: number;

  /** Number of dashboard panels to process per batch */
  batchSize: number;
}

/**
 * Load incremental collection configuration from environment variables
 *
 * Environment Variables:
 * - INCREMENTAL_COLLECTION_ENABLED: Enable/disable feature (default: true)
 * - INCREMENTAL_COLLECTION_INTERVAL_SECONDS: Polling interval (default: 60)
 * - INCREMENTAL_COLLECTION_MAX_RETRIES: Max retry attempts (default: 5)
 * - INCREMENTAL_COLLECTION_HEARTBEAT_THRESHOLD_SECONDS: Heartbeat window (default: 30)
 * - INCREMENTAL_COLLECTION_BATCH_SIZE: Panels per batch (default: 20)
 */
export const getIncrementalCollectionConfig = (): IncrementalCollectionConfig => ({
  enabled: process.env.INCREMENTAL_COLLECTION_ENABLED !== 'false',
  intervalSeconds: parseInt(process.env.INCREMENTAL_COLLECTION_INTERVAL_SECONDS || '60', 10),
  maxRetries: parseInt(process.env.INCREMENTAL_COLLECTION_MAX_RETRIES || '5', 10),
  heartbeatThresholdSeconds: parseInt(process.env.INCREMENTAL_COLLECTION_HEARTBEAT_THRESHOLD_SECONDS || '30', 10),
  batchSize: parseInt(process.env.INCREMENTAL_COLLECTION_BATCH_SIZE || '20', 10),
});

/**
 * Validate incremental collection configuration
 *
 * Ensures configuration values are within acceptable ranges and makes sense.
 * Throws an error if validation fails.
 */
export const validateIncrementalCollectionConfig = (config: IncrementalCollectionConfig): void => {
  if (config.intervalSeconds < 1) {
    throw new Error('INCREMENTAL_COLLECTION_INTERVAL_SECONDS must be at least 1');
  }

  if (config.intervalSeconds > 3600) {
    throw new Error('INCREMENTAL_COLLECTION_INTERVAL_SECONDS should not exceed 3600 (1 hour)');
  }

  if (config.maxRetries < 1) {
    throw new Error('INCREMENTAL_COLLECTION_MAX_RETRIES must be at least 1');
  }

  if (config.maxRetries > 20) {
    throw new Error('INCREMENTAL_COLLECTION_MAX_RETRIES should not exceed 20');
  }

  if (config.heartbeatThresholdSeconds < 10) {
    throw new Error('INCREMENTAL_COLLECTION_HEARTBEAT_THRESHOLD_SECONDS must be at least 10');
  }

  if (config.heartbeatThresholdSeconds > 600) {
    throw new Error('INCREMENTAL_COLLECTION_HEARTBEAT_THRESHOLD_SECONDS should not exceed 600 (10 minutes)');
  }

  if (config.batchSize < 1) {
    throw new Error('INCREMENTAL_COLLECTION_BATCH_SIZE must be at least 1');
  }

  if (config.batchSize > 100) {
    throw new Error('INCREMENTAL_COLLECTION_BATCH_SIZE should not exceed 100');
  }

  // Heartbeat threshold should be less than interval to avoid missing updates
  if (config.heartbeatThresholdSeconds >= config.intervalSeconds) {
    console.warn(
      `⚠️  INCREMENTAL_COLLECTION_HEARTBEAT_THRESHOLD_SECONDS (${config.heartbeatThresholdSeconds}) ` +
      `should be less than INCREMENTAL_COLLECTION_INTERVAL_SECONDS (${config.intervalSeconds}) ` +
      `to avoid missing test run updates`
    );
  }
};
