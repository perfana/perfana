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

