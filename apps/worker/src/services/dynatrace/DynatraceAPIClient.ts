import axios, { isAxiosError } from 'axios';
import { getLogger } from '../../lib/utils/logger.js';
import { DynatraceQueryConfig } from '../../types/dynatrace/index.js';
import { assertValidUrl, sanitizeUrl } from '@perfana/shared/security';
import type { AxiosProxyConfig } from '../../config/proxy-resolver.js';

/**
 * axios request options spread into every Dynatrace call. Either `{ proxy }`
 * (explicit DB-configured proxy) or `{}` — in which case axios reads
 * HTTP(S)_PROXY/NO_PROXY from the environment and honors NO_PROXY, matching the
 * API's DynatraceService. See resolveDynatraceAxiosProxy.
 */
export type DynatraceProxyOpts = { proxy: AxiosProxyConfig } | Record<string, never>;

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

/** Timeout (ms) for a Metrics API v2 GET (short, synchronous request) */
const METRICS_REQUEST_TIMEOUT_MS = 30_000; // 30s

/** Timeout (ms) for the DQL start POST — server-side fetch can take up to DQL_FETCH_TIMEOUT_SECONDS */
const DQL_START_TIMEOUT_MS = 70_000; // 70s (> 60s server fetch timeout)

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

/** Narrow error shape for logging (axios errors expose `code`; HTTP status lives on `response.status`). */
interface HttpClientError extends Error {
  code?: string;
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
  private proxyOpts: DynatraceProxyOpts;
  private config: DynatraceAPIConfig;
  private semaphore: Semaphore;
  private baseUrl: string;        // Original host URL (for Metrics API v2)
  private dqlBaseUrl: string;     // Converted host URL (for DQL API on SaaS)

  constructor(config: DynatraceAPIConfig, proxyOpts: DynatraceProxyOpts = {}) {
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

    // axios proxy handling mirrors the API's DynatraceService: `{ proxy }` when a
    // DB proxy is configured + use_proxy, else `{}` so axios honors env HTTP(S)_PROXY
    // and NO_PROXY on its own (per-request tunneling, no persistent dispatcher).
    this.proxyOpts = proxyOpts;

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

    // [dt-diag] Root-cause routing trace: shows, per instance, which API a query
    // is sent to and whether the credentials for that path are present. A managed
    // instance reaching the DQL path (or hitting it with an empty platform token)
    // is bug #2; a metric selector on a token lacking metrics.read shows up as 403.
    logger.info(
      `[dt-diag] routing decision: host=${this.baseUrl} type=${this.config.dynatraceType} ` +
      `route=${useMetricsAPI ? 'metrics-v2' : 'dql'} ` +
      `hasApiToken=${Boolean(this.config.apiToken)} hasPlatformToken=${Boolean(this.config.platformToken)} ` +
      `dqlBaseUrl=${this.dqlBaseUrl} query="${query.slice(0, 120)}"`
    );
    if (!useMetricsAPI && this.config.dynatraceType === 'managed') {
      logger.warn(
        `[dt-diag] ⚠️ MANAGED instance ${this.baseUrl} routed to DQL — managed has no platform token ` +
        `(hasPlatformToken=${Boolean(this.config.platformToken)}); this query will fail. query="${query.slice(0, 120)}"`
      );
    }

    if (useMetricsAPI) {
      logger.info(`📊 Routing to Metrics API v2 (query format: metric selector)`);
      // Use Metrics API v2 for metric selector queries
      const metricsResult = await this.executeMetricsAPIQuery(query, startTime, endTime);
      // Transform to DQL-like format for consistent processing
      return this.transformMetricsAPIResultToDQL(metricsResult as Record<string, unknown>);
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
  private transformMetricsAPIResultToDQL(metricsResult: Record<string, unknown>): { records: Record<string, unknown>[] } {
    logger.info(`🔄 Transforming Metrics API v2 response to DQL-like format...`);

    const records: Record<string, unknown>[] = [];

    const resultArray = metricsResult.result as Array<{ metricId?: string; data?: Array<{ dimensionMap?: Record<string, unknown>; timestamps?: number[]; values?: (number | null)[] }> }> | undefined;

    if (!resultArray || resultArray.length === 0) {
      logger.warn('Empty Metrics API v2 result');
      return { records: [] };
    }

    for (const metric of resultArray) {
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
          const record: Record<string, unknown> = {
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
  ): Promise<{ immediate: true; result: unknown } | { immediate: false; requestToken: string }> {
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

        // Log details matching Python format (api_client.py:67-70)
        logger.debug(`🔹 Executing Dynatrace API request`);
        logger.debug(`🔹 URL: ${this.dqlBaseUrl}/platform/storage/query/v1/query:execute`);
        logger.debug(`🔹 Payload: ${JSON.stringify(payload, null, 2)}`);
        logger.debug(`Starting DQL query execution (attempt ${attempt}, ${query.length} chars, timezone=${timezone})`);

        logger.info(
          `[dt-diag] DQL POST ${this.dqlBaseUrl}/platform/storage/query/v1/query:execute  ` +
          `type=${this.config.dynatraceType} hasPlatformToken=${Boolean(this.config.platformToken)} ` +
          `platformTokenLen=${(this.config.platformToken || '').length}`
        );

        const response = await axios.post(
          `${this.dqlBaseUrl}/platform/storage/query/v1/query:execute`,
          payload,
          {
            headers: {
              'Authorization': `Bearer ${this.config.platformToken}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            timeout: DQL_START_TIMEOUT_MS,
            validateStatus: () => true,
            ...this.proxyOpts,
          }
        );

        const statusCode = response.status;
        if (statusCode === 401 || statusCode === 403) {
          logger.error(
            `[dt-diag] DQL auth failed status=${statusCode} at ${this.dqlBaseUrl} — Bearer platform token ` +
            `${this.config.platformToken ? 'present but rejected (scope?)' : 'MISSING — managed instance should use Metrics v2, not DQL'}`
          );
        }
        const data = response.data as DQLQueryResponse;

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
        const httpError = error as HttpClientError;

        const errorDetails = {
          message: httpError.message,
          code: httpError.code,
          statusCode: isAxiosError(error) ? error.response?.status : undefined,
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
        // Poll endpoint should respond quickly — a short per-request timeout
        // prevents a hung poll from stalling the loop (axios ECONNABORTED → retry).
        logger.info(`📊 Poll attempt ${pollAttempt} for token ${requestToken} (elapsed: ${elapsed}ms)`);

        const response = await axios.get(
          `${this.dqlBaseUrl}/platform/storage/query/v1/query:poll?request-token=${encodeURIComponent(requestToken)}`,
          {
            headers: {
              'Authorization': `Bearer ${this.config.platformToken}`,
              'Accept': 'application/json',
            },
            timeout: POLL_REQUEST_TIMEOUT_MS,
            validateStatus: () => true,
            ...this.proxyOpts,
          }
        );

        const data = response.data as DQLQueryResponse;

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
        const httpError = error as HttpClientError;

        // Check if we've exceeded overall timeout
        if (Date.now() - startTime > maxWaitMs) {
          logger.error(`DQL query polling exceeded max wait time after ${pollAttempt} attempts`);
          throw new Error(`DQL query polling timed out after ${maxWaitMs}ms (${pollAttempt} attempts)`);
        }

        // Timeout (axios ECONNABORTED) or any network error → retry. A thrown
        // "DQL query failed" state error has no `code`, so it rethrows below.
        if (httpError.code) {
          logger.warn(`⚠️  Poll attempt ${pollAttempt} for token ${requestToken} failed (${httpError.code}), retrying in ${pollInterval}ms`);
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
  ): Promise<Array<{ tileId: string; tileTitle: string; result: unknown; error: string | null }>> {
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

      const metricsUrl = `${this.baseUrl}/api/v2/metrics/query?${queryParams.toString()}`;
      // Log token length only (not any token bytes) so two instances are distinguishable without leaking credential material into logs.
      logger.info(`[dt-diag] Metrics v2 GET ${this.baseUrl}/api/v2/metrics/query  Api-Token present=${Boolean(this.config.apiToken)} (len=${(this.config.apiToken || '').length})`);

      const response = await axios.get(metricsUrl, {
        headers: {
          'Authorization': `Api-Token ${this.config.apiToken}`,
          'Accept': 'application/json',
        },
        timeout: METRICS_REQUEST_TIMEOUT_MS,
        validateStatus: () => true,
        ...this.proxyOpts,
      });

      const status = response.status;
      const contentType = String(response.headers['content-type'] ?? '');
      // axios parses a JSON body into an object; a non-JSON body (proxy/gateway
      // HTML block page) is left as a string. Classify it instead of throwing an
      // opaque parse error — this is the corporate-proxy failure fingerprint.
      const raw: unknown = response.data;
      if (typeof raw !== 'object' || raw === null) {
        const bodyText = typeof raw === 'string' ? raw : String(raw ?? '');
        const looksHtml = /^\s*<(?:!doctype|html)/i.test(bodyText);
        logger.error(
          `[dt-diag] Metrics v2 returned non-JSON (status=${status}, content-type=${contentType}, ` +
          `looksHtml=${looksHtml}) — ${looksHtml ? 'proxy/gateway block page: request went through a proxy it should have bypassed' : 'unexpected body'}. ` +
          `Body head: ${bodyText.slice(0, 200)}`
        );
        throw new Error(`Metrics query returned non-JSON body (status ${status}, content-type ${contentType})`);
      }
      const data = raw as Record<string, unknown>;

      if (status !== 200) {
        const hint =
          status === 403 ? 'token lacks metrics.read scope (entities.read alone is not enough)'
          : status === 401 ? 'token invalid/undecrypted for this instance'
          : status === 404 ? 'wrong metrics URL/host for this instance (path or tenant mismatch)'
          : 'see body';
        logger.error(`[dt-diag] Metrics v2 FAILED status=${status} host=${this.baseUrl} → likely: ${hint}. Body: ${JSON.stringify(data).slice(0, 400)}`);
      }

      if (status === 200) {
        logger.info(`✓ Metrics API v2 query completed successfully`);
        logger.debug(`📊 Raw Metrics API v2 response: ${JSON.stringify(data, null, 2)}`);

        if (data.result && Array.isArray(data.result)) {
          logger.debug(`📈 Response contains ${data.result.length} metric(s)`);
          data.result.forEach((metric: unknown, idx: number) => {
            const m = metric as { metricId?: string; data?: Array<{ values?: unknown[] }> };
            const dataPointCount = m.data?.reduce((sum: number, d) => sum + (d.values?.length || 0), 0) || 0;
            logger.debug(`  Metric ${idx + 1}: ${m.metricId || 'unknown'} - ${dataPointCount} data points`);
          });
        }

        return data;
      }

      throw new Error(`Metrics query failed with status ${status}: ${JSON.stringify(data).slice(0, 400)}`);

    } finally {
      this.semaphore.release();
    }
  }

  /**
   * No-op teardown. Kept for caller compatibility (pipelines call this in a
   * `finally`). The undici keep-alive Agent was removed with the axios port;
   * axios manages sockets per request via the default global agent.
   */
  async close(): Promise<void> {
    // nothing to tear down
  }
}
