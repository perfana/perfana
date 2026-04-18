import { request, Agent } from 'undici';
import { getLogger } from '../../lib/utils/logger.js';
import { DynatraceQueryConfig } from '../../types/dynatrace/index.js';
import { assertValidUrl, sanitizeUrl } from '@perfana/shared/security';

const logger = getLogger('dynatrace-api-client');

/**
 * Dynatrace API Client constants
 */

/** Maximum concurrent API requests to Dynatrace (avoids rate-limiting) */
const DEFAULT_MAX_CONCURRENT = 5;

/** Number of retry attempts for failed API requests */
const DEFAULT_MAX_RETRIES = 3;

/** Maximum time (ms) to wait for a DQL async query to complete via polling */
const DEFAULT_MAX_POLL_WAIT_MS = 120_000; // 120s

/** Interval (ms) between poll requests when waiting for async DQL query results */
const DEFAULT_POLL_INTERVAL_MS = 2_000; // 2s

/** Timeout (ms) for individual poll requests — polls just check status, so should be fast */
const POLL_REQUEST_TIMEOUT_MS = 5_000; // 5s

/** Timeout (ms) for the DQL query execution on the Dynatrace side */
const DQL_FETCH_TIMEOUT_SECONDS = 60;

/** Number of persistent HTTP connections to Dynatrace */
const AGENT_CONNECTIONS = 10;

/** Keep-alive timeout (ms) for connection reuse between requests */
const AGENT_KEEP_ALIVE_TIMEOUT_MS = 60_000; // 60s

/** Maximum keep-alive timeout (ms) before forcing a new connection */
const AGENT_MAX_KEEP_ALIVE_TIMEOUT_MS = 600_000; // 10min

/** Base delay (ms) for exponential backoff: delay = 2^(attempt-1) * BASE_RETRY_DELAY_MS */
const BASE_RETRY_DELAY_MS = 1_000;

/** Default time range fallback (ms) when no start time is provided — last hour */
const DEFAULT_TIME_RANGE_MS = 3_600_000; // 1 hour

/** Default resolution for Metrics API v2 queries */
const METRICS_API_RESOLUTION = '1m';

/**
 * Dynatrace API Client
 *
 * Implements the Dynatrace API integration patterns from Python:
 * - /Users/daniel/workspace/perfana-ds/src/perfana_ds/pipelines/dynatrace/api_client.py
 * - Specification: dynatrace-pipeline-migration-specification.md
 *
 * Key features:
 * 1. Dual authentication (Api-Token for legacy metrics, Bearer for DQL)
 * 2. Async query execution with polling for DQL queries
 * 3. Concurrent request processing with semaphore
 * 4. Retry logic with exponential backoff
 * 5. Comprehensive error handling
 *
 * Uses undici Agent pattern to avoid connection timeout issues with long-running DQL queries.
 * Agent keeps connections alive without per-request timeouts.
 */

export interface DynatraceAPIConfig {
  host: string;
  apiToken: string;
  platformToken: string;  // Bearer token for DQL queries (Grail API)
  dynatraceType: 'saas' | 'managed';  // Type determines which endpoint to use
  maxConcurrent?: number;
  maxRetries?: number;
  maxPollWaitMs?: number;  // Maximum time to wait for query completion (default: 120s)
  pollInterval?: number;   // Polling interval in ms (default: 2s)
}

interface DQLQueryResponse {
  requestToken: string;
  state: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

interface UndiciError extends Error {
  code?: string;
  statusCode?: number;
}

/**
 * Simple semaphore for controlling concurrent requests
 */
class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const resolve = this.queue.shift()!;
      resolve();
    } else {
      this.permits++;
    }
  }
}

export class DynatraceAPIClient {
  private agent: Agent;
  private config: DynatraceAPIConfig;
  private semaphore: Semaphore;
  private baseUrl: string;        // Original host URL (for Metrics API v2)
  private dqlBaseUrl: string;     // Converted host URL (for DQL API on SaaS)

  constructor(config: DynatraceAPIConfig) {
    this.config = {
      maxConcurrent: DEFAULT_MAX_CONCURRENT,
      maxRetries: DEFAULT_MAX_RETRIES,
      maxPollWaitMs: DEFAULT_MAX_POLL_WAIT_MS,
      pollInterval: DEFAULT_POLL_INTERVAL_MS,
      ...config
    };

    // Determine base URLs based on Dynatrace type
    // Key insight: SaaS instances use different domains for different APIs:
    // - Metrics API v2 (/api/v2/metrics/query): live.dynatrace.com
    // - DQL API (/platform/storage/query/v1/query:execute): apps.dynatrace.com
    const host = this.config.host;

    // Ensure URL format (host might already include https://)
    // Remove trailing slash to avoid double slashes when concatenating paths
    let candidateUrl: string;
    if (host.startsWith('http://') || host.startsWith('https://')) {
      candidateUrl = host.replace(/\/$/, '');  // Remove trailing slash
    } else {
      candidateUrl = `https://${host}`.replace(/\/$/, '');  // Remove trailing slash
    }

    // SSRF Protection: Validate the Dynatrace host URL
    // This prevents attackers from making the server send requests to:
    // - Internal services (localhost, private IPs)
    // - Cloud metadata endpoints (169.254.169.254)
    // - Kubernetes internal services
    try {
      const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'dev';
      assertValidUrl(candidateUrl, {
        requireHttps: !isDev,
        allowedHosts: isDev ? ['localhost', '127.0.0.1'] : [],
      });
      this.baseUrl = candidateUrl;
      logger.debug(`SSRF validation passed for Dynatrace host: ${sanitizeUrl(candidateUrl)}`);
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Invalid URL';
      logger.error(`SSRF validation failed for Dynatrace host: ${errorMessage}`);
      throw new Error(`Invalid Dynatrace host URL: ${errorMessage}`);
    }

    if (this.config.dynatraceType === 'saas') {
      // SaaS: Convert live.dynatrace.com to apps.dynatrace.com ONLY for DQL queries
      // Based on Python: query_constructor.py:232-235
      // Metrics API v2 must use the original live.dynatrace.com domain
      this.dqlBaseUrl = this.baseUrl.replace('live.dynatrace.com', 'apps.dynatrace.com');
      logger.info(`SaaS instance configured:`);
      logger.info(`  📊 Metrics API v2 URL: ${this.baseUrl}`);
      logger.info(`  📋 DQL API URL: ${this.dqlBaseUrl}`);
    } else {
      // Managed: Use the same URL for both APIs
      this.dqlBaseUrl = this.baseUrl;
      logger.info(`Managed instance configured: ${this.baseUrl}`);
    }

    // Use Agent pattern: keeps connections alive without per-request timeouts
    // This prevents timeout issues when Dynatrace takes 60+ seconds to process queries
    this.agent = new Agent({
      connections: AGENT_CONNECTIONS,
      keepAliveTimeout: AGENT_KEEP_ALIVE_TIMEOUT_MS,
      keepAliveMaxTimeout: AGENT_MAX_KEEP_ALIVE_TIMEOUT_MS,
    });

    this.semaphore = new Semaphore(this.config.maxConcurrent!);
  }

  /**
   * Detect if a query is in metric selector format vs DQL format
   *
   * Metric selector patterns (Metrics API v2):
   * - builtin:host.cpu.usage:filter(eq("dt.entity.host","HOST-xxx")):avg
   * - builtin:service.response.time:splitBy("dt.entity.service"):avg
   * - ext:custom.metric:merge("dt.entity.host"):max
   *
   * DQL query patterns (Grail DQL API):
   * - fetch logs | filter ...
   * - timeseries avg(dt.host.cpu.usage), by:{dt.entity.host}
   * - SELECT ... FROM ...
   *
   * @param query - The query string to analyze
   * @returns true if the query is a metric selector, false if it's a DQL query
   */
  private isMetricSelector(query: string): boolean {
    const trimmedQuery = query.trim();

    // Metric selector patterns - these are characteristic of Metrics API v2 selectors
    const metricSelectorPatterns = [
      /^builtin:/i,           // Starts with builtin: (most common)
      /^ext:/i,               // Starts with ext: (extensions)
      /^calc:/i,              // Starts with calc: (calculated metrics)
      /^func:/i,              // Starts with func: (function metrics)
      /^custom:/i,            // Starts with custom: (custom metrics)
      /:filter\(/i,           // Contains :filter( transformation
      /:splitBy\(/i,          // Contains :splitBy( transformation
      /:merge\(/i,            // Contains :merge( transformation
      /:fold\(/i,             // Contains :fold( transformation
      /:avg$/i,               // Ends with :avg aggregation
      /:sum$/i,               // Ends with :sum aggregation
      /:min$/i,               // Ends with :min aggregation
      /:max$/i,               // Ends with :max aggregation
      /:count$/i,             // Ends with :count aggregation
      /:percentile\(/i,       // Contains :percentile( aggregation
    ];

    // DQL query patterns - these are characteristic of DQL queries
    const dqlPatterns = [
      /^fetch\s/i,            // Starts with fetch (DQL fetch command)
      /^timeseries\s/i,       // Starts with timeseries (DQL timeseries)
      /^SELECT\s/i,           // Starts with SELECT (SQL-like DQL)
      /\|\s*filter/i,         // Contains | filter (DQL pipe syntax)
      /\|\s*summarize/i,      // Contains | summarize (DQL pipe syntax)
      /\|\s*sort/i,           // Contains | sort (DQL pipe syntax)
      /\|\s*limit/i,          // Contains | limit (DQL pipe syntax)
    ];

    // Check if it matches any DQL pattern first (higher priority)
    for (const pattern of dqlPatterns) {
      if (pattern.test(trimmedQuery)) {
        logger.debug(`Query detected as DQL format (matched pattern: ${pattern})`);
        return false;
      }
    }

    // Check if it matches any metric selector pattern
    for (const pattern of metricSelectorPatterns) {
      if (pattern.test(trimmedQuery)) {
        logger.debug(`Query detected as metric selector format (matched pattern: ${pattern})`);
        return true;
      }
    }

    // Default: if dynatraceType is 'managed', assume metric selector; otherwise assume DQL
    const defaultIsMetricSelector = this.config.dynatraceType !== 'saas';
    logger.debug(`Query format unclear, defaulting to ${defaultIsMetricSelector ? 'metric selector' : 'DQL'} based on dynatraceType=${this.config.dynatraceType}`);
    return defaultIsMetricSelector;
  }

  /**
   * Execute query using the appropriate endpoint based on query format detection
   *
   * Routes queries intelligently:
   * - Metric selectors (builtin:..., ext:...) → Metrics API v2 endpoint
   * - DQL queries (fetch, timeseries, SELECT) → DQL platform endpoint
   *
   * This allows both SaaS and Managed instances to use either API based on
   * the actual query format, rather than assuming one API per instance type.
   *
   * Returns normalized result in DQL-like format for consistent processing
   */
  async executeQuery(
    query: string,
    startTime?: Date,
    endTime?: Date
  ): Promise<unknown> {
    const useMetricsAPI = this.isMetricSelector(query);

    if (useMetricsAPI) {
      logger.info(`📊 Routing to Metrics API v2 (query format: metric selector)`);
      // Use Metrics API v2 for metric selector queries
      const metricsResult = await this.executeMetricsAPIQuery(query, startTime, endTime);
      // Transform to DQL-like format for consistent processing
      return this.transformMetricsAPIResultToDQL(metricsResult);
    } else {
      logger.info(`📊 Routing to DQL API (query format: DQL)`);
      // Use DQL platform endpoint for DQL queries
      return await this.executeDQLQuery(query, startTime, endTime);
    }
  }

  /**
   * Transform Metrics API v2 response to DQL-like format
   * This allows the DataProcessor to handle both formats uniformly
   *
   * Metrics API v2 format:
   * {
   *   result: [{
   *     metricId: "builtin:host.cpu.system",
   *     data: [{
   *       dimensionMap: { "dt.entity.host": "HOST-123" },
   *       timestamps: [1634000000000, 1634001000000],
   *       values: [10.5, 12.3]
   *     }]
   *   }]
   * }
   *
   * DQL-like format:
   * {
   *   records: [
   *     { timestamp: "2021-10-12T00:00:00Z", "dt.entity.host": "HOST-123", value: 10.5 },
   *     { timestamp: "2021-10-12T00:16:40Z", "dt.entity.host": "HOST-123", value: 12.3 }
   *   ]
   * }
   */
  private transformMetricsAPIResultToDQL(metricsResult: any): any {
    logger.info(`🔄 Transforming Metrics API v2 response to DQL-like format...`);

    const records: unknown[] = [];

    if (!metricsResult.result || metricsResult.result.length === 0) {
      logger.warn('Empty Metrics API v2 result');
      return { records: [] };
    }

    for (const metric of metricsResult.result) {
      if (!metric.data || metric.data.length === 0) {
        logger.debug(`Skipping metric ${metric.metricId || 'unknown'} - no data`);
        continue;
      }

      logger.info(`  Processing metric: ${metric.metricId || 'unknown'}`);

      for (const dataPoint of metric.data) {
        const { dimensionMap = {}, timestamps = [], values = [] } = dataPoint;

        logger.debug(`    Data point: ${timestamps.length} timestamps, ${values.length} values, dimensions: ${JSON.stringify(dimensionMap)}`);

        // Create a record for each timestamp/value pair
        for (let i = 0; i < timestamps.length; i++) {
          const record: any = {
            timestamp: new Date(timestamps[i]).toISOString(),
            value: values[i]
          };

          // Add dimension fields (e.g., dt.entity.host, etc.)
          Object.assign(record, dimensionMap);

          records.push(record);
        }
      }
    }

    logger.info(`✅ Transformation complete: ${records.length} records created`);
    logger.info(`🔍 Sample transformed records (first 3): ${JSON.stringify(records.slice(0, 3), null, 2)}`);

    return { records };
  }

  /**
   * Execute DQL query and poll for results if needed
   * Handles both immediate (HTTP 200) and async (HTTP 202) responses
   * Implements async query execution pattern from Python:
   * - api_client.py:43-84
   */
  private async executeDQLQuery(
    query: string,
    startTime?: Date,
    endTime?: Date
  ): Promise<unknown> {
    await this.semaphore.acquire();

    try {
      // Step 1: Start query execution
      const response = await this.startDQLQuery(query, startTime, endTime);

      // Step 2: If immediate success, return results directly
      if (response.immediate) {
        logger.info(`✓ DQL query completed immediately (no polling required)`);
        return response.result;
      }

      // Step 3: Otherwise poll for async results
      logger.info(`⏳ DQL query requires polling (async execution)`);
      const result = await this.pollDQLQueryResult(response.requestToken);
      logger.info(`✓ DQL query polling completed successfully`);

      return result;
    } finally {
      this.semaphore.release();
    }
  }

  /**
   * Start DQL query execution
   * POST /platform/storage/query/v1/query:execute
   * Based on Dynatrace Grail API Swagger specification
   *
   * Returns either:
   * - { immediate: true, result } for HTTP 200 (query completed immediately)
   * - { immediate: false, requestToken } for HTTP 202 (async, requires polling)
   */
  private async startDQLQuery(
    query: string,
    startTime?: Date,
    endTime?: Date
  ): Promise<{ immediate: true; result: any } | { immediate: false; requestToken: string }> {
    const maxRetries = this.config.maxRetries!;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Get system timezone
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

        // Construct payload according to Dynatrace API spec
        // Times should be in payload, NOT in the query string
        const payload: Record<string, unknown> = {
          query,
          timezone,
          fetchTimeoutSeconds: DQL_FETCH_TIMEOUT_SECONDS
        };

        // Add timeframe if provided
        if (startTime) {
          payload.defaultTimeframeStart = startTime.toISOString();
        }
        if (endTime) {
          payload.defaultTimeframeEnd = endTime.toISOString();
        }

        const requestBody = JSON.stringify(payload);

        // Log details matching Python format (api_client.py:67-70)
        logger.debug(`🔹 Executing Dynatrace API request`);
        logger.debug(`🔹 URL: ${this.dqlBaseUrl}/platform/storage/query/v1/query:execute`);
        logger.debug(`🔹 Payload: ${JSON.stringify(payload, null, 2)}`);
        logger.debug(`Starting DQL query execution (attempt ${attempt}, ${query.length} chars, timezone=${timezone})`);

        const response = await request(`${this.dqlBaseUrl}/platform/storage/query/v1/query:execute`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.platformToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: requestBody,
          dispatcher: this.agent,
        });

        const data = await response.body.json() as DQLQueryResponse;
        const statusCode = response.statusCode;

        // Handle immediate success (HTTP 200) - query completed synchronously
        if (statusCode === 200 && data.state === 'SUCCEEDED') {
          logger.debug(`DQL query completed immediately (HTTP 200)`);
          return { immediate: true, result: data.result };
        }

        // Handle async execution (HTTP 202) - need to poll for results
        if (statusCode === 202) {
          logger.debug(`DQL query started (HTTP 202): ${data.requestToken}`);
          return { immediate: false, requestToken: data.requestToken };
        }

        // Log detailed error information for debugging
        logger.error(`DQL query start failed with status ${statusCode}:`, {
          statusCode,
          error: data.error,
          state: data.state,
          query: query.substring(0, 200),
          payload: JSON.stringify(payload).substring(0, 500)
        });

        throw new Error(`Unexpected status code ${statusCode} when starting DQL query: ${JSON.stringify(data.error || data)}`);

      } catch (error) {
        lastError = error as Error;
        const undiciError = error as UndiciError;

        const errorDetails = {
          message: undiciError.message,
          code: undiciError.code,
          statusCode: undiciError.statusCode,
          attempt,
          maxRetries
        };

        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt - 1) * BASE_RETRY_DELAY_MS;
          logger.warn(`DQL query start failed, retrying in ${delay}ms:`, errorDetails);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          logger.error(`DQL query start failed after ${maxRetries} attempts:`, errorDetails);
        }
      }
    }

    throw lastError || new Error('Failed to start DQL query');
  }

  /**
   * Poll for DQL query results until completion
   * GET /platform/storage/query/v1/query:poll
   *
   * Uses time-based timeout instead of fixed poll attempts to handle variable query durations
   * Each individual poll request has a 30s timeout to prevent hanging
   */
  private async pollDQLQueryResult(requestToken: string): Promise<unknown> {
    const startTime = Date.now();
    const maxWaitMs = this.config.maxPollWaitMs!;
    const pollInterval = this.config.pollInterval!;
    let pollAttempt = 0;

    logger.info(`Starting DQL query polling (token: ${requestToken}, max wait: ${maxWaitMs}ms, interval: ${pollInterval}ms)`);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Check overall timeout before making request
      const elapsed = Date.now() - startTime;
      if (elapsed > maxWaitMs) {
        throw new Error(`DQL query polling timed out after ${elapsed}ms (${pollAttempt} attempts)`);
      }

      pollAttempt++;

      try {
        // Create AbortController with 5s timeout for this individual poll request
        // Poll endpoint should respond quickly - it's just checking status
        const abortController = new AbortController();
        const pollTimeout = setTimeout(() => abortController.abort(), POLL_REQUEST_TIMEOUT_MS);

        logger.info(`📊 Poll attempt ${pollAttempt} for token ${requestToken} (elapsed: ${elapsed}ms)`);

        const response = await request(
          `${this.dqlBaseUrl}/platform/storage/query/v1/query:poll?request-token=${encodeURIComponent(requestToken)}`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${this.config.platformToken}`,
              'Accept': 'application/json',
            },
            dispatcher: this.agent,
            signal: abortController.signal,
          }
        );

        clearTimeout(pollTimeout);

        const data = await response.body.json() as DQLQueryResponse;

        if (data.state === 'SUCCEEDED') {
          logger.info(`✓ DQL query ${requestToken} succeeded after ${Date.now() - startTime}ms (${pollAttempt} poll attempts)`);
          return data.result;
        }

        if (data.state === 'FAILED') {
          const errorMsg = data.error?.message || 'Unknown error';
          throw new Error(`DQL query failed: ${errorMsg}`);
        }

        // Still RUNNING, wait and poll again
        logger.info(`⏸️  DQL query ${requestToken} still RUNNING, waiting ${pollInterval}ms before next poll`);
        await new Promise(resolve => setTimeout(resolve, pollInterval));

      } catch (error) {
        const undiciError = error as UndiciError;

        // Check if we've exceeded overall timeout
        if (Date.now() - startTime > maxWaitMs) {
          logger.error(`DQL query polling exceeded max wait time after ${pollAttempt} attempts`);
          throw new Error(`DQL query polling timed out after ${maxWaitMs}ms (${pollAttempt} attempts)`);
        }

        // If it's an abort error or network error, retry
        if (undiciError.code === 'UND_ERR_ABORTED' || undiciError.code) {
          logger.warn(`⚠️  Poll attempt ${pollAttempt} for token ${requestToken} failed (${undiciError.code}), retrying in ${pollInterval}ms`);
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          continue;
        }

        throw error;
      }
    }
  }

  /**
   * Execute multiple queries in batch with controlled concurrency
   * Routes to appropriate endpoint based on dynatraceType
   */
  async executeBatchQueries(
    queries: DynatraceQueryConfig[],
    startTime?: Date,
    endTime?: Date
  ): Promise<any[]> {
    const apiType = this.config.dynatraceType === 'saas' ? 'DQL' : 'Metrics API v2';
    logger.info(`Executing ${queries.length} ${apiType} queries with max concurrency ${this.config.maxConcurrent}`);

    const promises = queries.map(async (queryConfig) => {
      try {
        const result = await this.executeQuery(queryConfig.query, startTime, endTime);
        return {
          tileId: queryConfig.tileId,
          tileTitle: queryConfig.tileTitle,
          result,
          error: null
        };
      } catch (error) {
        logger.error(`Query failed for tile ${queryConfig.tileTitle}:`, error);
        return {
          tileId: queryConfig.tileId,
          tileTitle: queryConfig.tileTitle,
          result: null,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    });

    const results = await Promise.all(promises);

    const successCount = results.filter(r => r.error === null).length;
    logger.info(`Batch execution complete: ${successCount}/${queries.length} queries succeeded`);

    return results;
  }

  /**
   * Execute query using legacy Metrics API v2 (for managed instances)
   * GET /api/v2/metrics/query
   * Query format: builtin:host.cpu.system:filter(eq("dt.entity.host",HOST-123)):avg
   */
  private async executeMetricsAPIQuery(
    metricSelector: string,
    startTime?: Date,
    endTime?: Date
  ): Promise<unknown> {
    await this.semaphore.acquire();

    try {
      // Use provided times or default to last hour
      const from = startTime || new Date(Date.now() - DEFAULT_TIME_RANGE_MS);
      const to = endTime || new Date();

      const fromMs = from.getTime();
      const toMs = to.getTime();

      const queryParams = new URLSearchParams({
        metricSelector,
        from: fromMs.toString(),
        to: toMs.toString(),
        resolution: METRICS_API_RESOLUTION
      });

      const durationMinutes = Math.round((toMs - fromMs) / 60000);
      logger.info(`🔍 Executing Metrics API v2 query`);
      logger.info(`  📅 Time range: ${from.toISOString()} to ${to.toISOString()} (${durationMinutes} minutes)`);
      logger.info(`  📊 Resolution: 1m (1-minute intervals)`);
      logger.info(`  🔎 Selector: ${metricSelector}`);
      logger.info(`  🌐 URL: ${this.baseUrl}/api/v2/metrics/query`);

      const response = await request(
        `${this.baseUrl}/api/v2/metrics/query?${queryParams.toString()}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Api-Token ${this.config.apiToken}`,
            'Accept': 'application/json',
          },
          dispatcher: this.agent,
        }
      );

      const data = await response.body.json() as any;

      if (response.statusCode === 200) {
        logger.info(`✓ Metrics API v2 query completed successfully`);
        logger.info(`📊 Raw Metrics API v2 response: ${JSON.stringify(data, null, 2)}`);

        // Log summary of response structure
        if (data.result && Array.isArray(data.result)) {
          logger.info(`📈 Response contains ${data.result.length} metric(s)`);
          data.result.forEach((metric: unknown, idx: number) => {
            const dataPointCount = metric.data?.reduce((sum: number, d: any) => sum + (d.values?.length || 0), 0) || 0;
            logger.info(`  Metric ${idx + 1}: ${metric.metricId || 'unknown'} - ${dataPointCount} data points`);
          });
        }

        return data;
      }

      logger.error(`Metrics API v2 query failed with status ${response.statusCode}:`, data);
      throw new Error(`Metrics query failed with status ${response.statusCode}: ${JSON.stringify(data)}`);

    } finally {
      this.semaphore.release();
    }
  }

  /**
   * Close the agent and destroy all connections immediately
   * This prevents connection stalling on subsequent requests
   */
  async close(): Promise<void> {
    // Destroy connections immediately instead of waiting for keep-alive to expire
    await this.agent.destroy();
  }
}
