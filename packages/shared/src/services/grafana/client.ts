import { Pool } from 'undici';
import {
  PanelDocument,
  PanelMetricsDocument,
  Logger,
  ConsoleLogger
} from './types';
import { batchPanelQueries, processBatchedResponses, type RequestBatch, type TimeRangeOverride } from './batching';
import { transformGrafanaResponseToMetrics } from './formatter';
import { validateUrl, type UrlValidationOptions } from '../../security/url-validator';

/**
 * Grafana API Client
 *
 * Implements the complex Grafana API integration patterns from Python:
 * - /Users/daniel/workspace/perfana-ds/src/perfana_ds/pipelines/metrics/query_panels.py
 * - Specification: METRICS_PIPELINE.md (Lines 199-320)
 *
 * Key features:
 * 1. Request batching with configurable batch size (default: 20)
 * 2. Concurrent HTTP processing (default: 30 connections)
 * 3. Comprehensive error handling hierarchy
 * 4. Automatic retries with exponential backoff
 * 5. Response data transformation to time-series format
 *
 * Uses undici for modern HTTP connection pooling with proper keep-alive
 */
export interface GrafanaConfig {
  url: string;
  apiKey: string;
  orgId?: string;
  timeout?: number;
  concurrency?: number;
  batchSize?: number;
  /**
   * SSRF validation options for the Grafana URL.
   * By default, SSRF protection is enabled and blocks localhost, private IPs,
   * cloud metadata endpoints, and Kubernetes internal addresses.
   */
  ssrfOptions?: UrlValidationOptions;
  /**
   * Skip SSRF validation entirely (NOT RECOMMENDED for production).
   * Only use this for trusted internal deployments where the Grafana URL
   * is known to be on a private network and SSRF is not a concern.
   */
  skipSsrfValidation?: boolean;
}

interface UndiciError extends Error {
  code?: string;
  statusCode?: number;
}

export class GrafanaClient {
  private pool: Pool;
  private grafanaConfig: GrafanaConfig;
  private logger: Logger;

  constructor(grafanaConfig: GrafanaConfig, logger?: Logger) {
    this.grafanaConfig = grafanaConfig;
    this.logger = logger || new ConsoleLogger('grafana-client');

    // Validate Grafana URL for SSRF protection
    this.validateGrafanaUrl();

    this.pool = this.createConnectionPool();
  }

  /**
   * Validates the Grafana URL for SSRF safety.
   *
   * This prevents Server-Side Request Forgery attacks by blocking:
   * - Localhost and loopback addresses (127.x.x.x, ::1)
   * - Private IP ranges (10.x, 192.168.x, 172.16-31.x)
   * - Link-local addresses (169.254.x.x)
   * - Cloud metadata endpoints (169.254.169.254, metadata.google.internal)
   * - Kubernetes service discovery (.svc, .cluster.local)
   * - Non-HTTP protocols
   *
   * @throws Error if the URL is invalid or unsafe for SSRF
   */
  private validateGrafanaUrl(): void {
    // Allow skipping SSRF validation for trusted internal deployments
    if (this.grafanaConfig.skipSsrfValidation) {
      this.logger.warn(
        '⚠️ SSRF validation is disabled for Grafana URL. ' +
        'This should only be used in trusted internal deployments.'
      );
      return;
    }

    const url = this.grafanaConfig.url;

    // Validate the URL using the SSRF-safe validator
    const validationResult = validateUrl(url, this.grafanaConfig.ssrfOptions);

    if (!validationResult.isValid) {
      const errorMessage = `Invalid Grafana URL: ${validationResult.error}`;
      this.logger.error(`🚫 SSRF Protection: ${errorMessage}`);
      throw new Error(errorMessage);
    }

    this.logger.debug(`✅ Grafana URL validated: ${validationResult.url?.origin}`);
  }

  /**
   * Create connection pool with proper HTTP keep-alive
   * Undici handles connection pooling automatically
   *
   * Note: Uses concurrency from config to match worker concurrency
   */
  private createConnectionPool(): Pool {
    const timeout = this.grafanaConfig.timeout || 30000;
    const concurrency = this.grafanaConfig.concurrency || 30;

    return new Pool(this.grafanaConfig.url, {
      connections: concurrency * 10,
      pipelining: 1,
      keepAliveTimeout: 60000,
      keepAliveMaxTimeout: 600000,
      connectTimeout: timeout,
      bodyTimeout: timeout,
      headersTimeout: timeout,
    });
  }

  /**
   * Query panel data from Grafana with batched requests
   * Main entry point that replicates Python's _query_grafana_panel_data function
   *
   * @param panels - Panel documents to query
   * @param testRun - Optional test run metadata for response transformation
   * @param timeRangeOverride - Optional time range override for incremental collection
   */
  async queryPanelData(
    panels: PanelDocument[],
    testRun?: any,
    timeRangeOverride?: TimeRangeOverride
  ): Promise<PanelMetricsDocument[]> {
    const startTime = Date.now();

    if (panels.length === 0) {
      this.logger.info('📊 No panels to query');
      return [];
    }

    const timeRangeInfo = timeRangeOverride
      ? ` (time range: ${timeRangeOverride.from.toISOString()} to ${timeRangeOverride.to.toISOString()})`
      : '';
    this.logger.info(`🔍 Starting Grafana query for ${panels.length} panels${timeRangeInfo}`);

    try {
      // Create request batches using same algorithm as Python
      // Pass time range override for incremental collection
      const batchSize = this.grafanaConfig.batchSize || 20;
      const requestBatches = batchPanelQueries(panels, batchSize, timeRangeOverride);

      if (requestBatches.length === 0) {
        this.logger.info('📊 No valid requests to process');
        return [];
      }

      this.logger.info(`📦 Created ${requestBatches.length} request batches`);

      // Execute all batches concurrently with controlled concurrency
      const responses = await this.executeBatchedRequests(requestBatches);

      // Process responses and transform to metrics documents
      const processedResults = processBatchedResponses(requestBatches, responses);

      // Transform to final metrics format
      const metricsDocuments = await transformGrafanaResponseToMetrics(processedResults, testRun);

      const duration = Date.now() - startTime;
      const totalDataPoints = metricsDocuments.reduce((sum, doc) => sum + doc.data.length, 0);

      this.logger.info(`✅ Grafana query completed: ${metricsDocuments.length} documents, ${totalDataPoints} data points in ${duration}ms`);

      return metricsDocuments;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`❌ Grafana query failed after ${duration}ms:`, error);

      // Return error documents for all panels
      return panels.map(panel => this.createErrorDocument(panel, error as Error));
    }
  }

  /**
   * Execute batched requests with controlled concurrency
   * Implements the concurrent execution pattern from Python
   */
  private async executeBatchedRequests(requestBatches: RequestBatch[]): Promise<any[]> {
    const concurrencyLimit = this.grafanaConfig.concurrency || 30;

    this.logger.info(`🚀 Executing ${requestBatches.length} batches with concurrency limit ${concurrencyLimit}`);

    // Execute requests in chunks to control concurrency
    const responses: any[] = [];

    for (let i = 0; i < requestBatches.length; i += concurrencyLimit) {
      const chunk = requestBatches.slice(i, i + concurrencyLimit);

      const chunkPromises = chunk.map((requestBatch, index) =>
        this.executeRequestWithRetry(requestBatch, i + index)
      );

      const chunkResponses = await Promise.allSettled(chunkPromises);

      // Process settled promises and extract results
      for (let j = 0; j < chunkResponses.length; j++) {
        const result = chunkResponses[j];
        const batchIndex = i + j;

        if (result.status === 'fulfilled') {
          responses.push(result.value);
        } else {
          this.logger.error(`❌ Batch ${batchIndex} request failed:`, result.reason);
          responses.push({
            error: result.reason,
            status: 0
          });
        }
      }

      // Log progress for large batches
      if (requestBatches.length > concurrencyLimit) {
        const processed = Math.min(i + concurrencyLimit, requestBatches.length);
        this.logger.debug(`📊 Progress: ${processed}/${requestBatches.length} batches`);
      }
    }

    return responses;
  }

  /**
   * Execute single request with retry logic
   * Implements the retry pattern from Python (3 attempts with exponential backoff)
   */
  private async executeRequestWithRetry(requestBatch: RequestBatch, batchIndex: number): Promise<any> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const requestBody = JSON.stringify(requestBatch.request.request_body);

        this.logger.debug('🔍 Grafana request:', {
          method: 'POST',
          path: requestBatch.request.endpoint,
          dataSize: requestBody.length
        });

        const { statusCode, body } = await this.pool.request({
          path: requestBatch.request.endpoint,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.grafanaConfig.apiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: requestBody,
        });

        const data = await body.json();

        const result = {
          batch: requestBatch,
          response: data,
          status: statusCode
        };

        return result;

      } catch (error) {
        lastError = error as Error;
        const undiciError = error as UndiciError;

        // Log detailed error information
        const errorDetails = {
          message: undiciError.message,
          code: undiciError.code,
          statusCode: undiciError.statusCode,
          requestPath: requestBatch.request.endpoint,
          requestMethod: 'POST',
          timeout: this.grafanaConfig.timeout,
          isTimeout: undiciError.code === 'UND_ERR_HEADERS_TIMEOUT' || undiciError.code === 'UND_ERR_BODY_TIMEOUT',
          isNetworkError: undiciError.code === 'ENOTFOUND' || undiciError.code === 'ECONNREFUSED',
        };

        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = Math.pow(2, attempt - 1) * 1000;
          this.logger.warn(`⚠️ Batch ${batchIndex} attempt ${attempt} failed, retrying in ${delay}ms:\n${JSON.stringify(errorDetails, null, 2)}`);

          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          this.logger.error(`❌ Batch ${batchIndex} failed after ${maxRetries} attempts:\n${JSON.stringify(errorDetails, null, 2)}`);
        }
      }
    }

    return {
      batch: requestBatch,
      error: lastError,
      status: 0
    };
  }

  /**
   * Fetch datasource by UID from Grafana API
   * Returns the datasource with numeric ID that matches Python expectation
   */
  async getDatasourceByUid(uid: string): Promise<{ id: number; uid: string; name: string; type: string } | null> {
    try {
      const { statusCode, body } = await this.pool.request({
        path: `/api/datasources/uid/${uid}`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.grafanaConfig.apiKey}`,
          'Accept': 'application/json',
        },
      });

      if (statusCode === 200) {
        const data = await body.json() as any;
        return {
          id: data.id,
          uid: data.uid,
          name: data.name,
          type: data.type
        };
      }

      this.logger.warn(`Failed to fetch datasource ${uid}: status ${statusCode}`);
      return null;
    } catch (error) {
      this.logger.error(`Error fetching datasource ${uid}:`, error);
      return null;
    }
  }

  /**
   * Create error document for failed panels
   * Matches Python's error document structure
   */
  private createErrorDocument(panel: PanelDocument, error: Error): PanelMetricsDocument {
    return {
      test_run_id: panel.test_run_id,
      application_dashboard_id: panel.application_dashboard_id,
      metrics_source_id: panel.metrics_source_id,
      dashboard_uid: panel.dashboard_uid,
      panel_id: panel.panel_id,
      panel_title: panel.panel_title,
      dashboard_label: panel.dashboard_label,
      benchmark_ids: panel.benchmark_ids,
      errors: [{
        target_index: 0,
        message: `Internal client error when making request to Grafana: ${error.message}`,
        type: error.constructor.name,
        status_code: undefined
      }],
      data: [],
      updated_at: new Date()
    };
  }
}
