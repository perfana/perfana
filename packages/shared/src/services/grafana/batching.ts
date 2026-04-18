import { PanelDocument, GrafanaQuery, Logger, ConsoleLogger } from './types';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _logger: Logger = new ConsoleLogger('grafana-batching');

export interface RequestBatch {
  request: {
    endpoint: string;
    method: string;
    request_body: {
      queries: unknown[];
      from: string;
      to: string;
    };
  };
  ref_id_mapping: Array<{
    panel: PanelDocument;
    target_index: number;
    ref_id: string;
  }>;
}

/**
 * Time range override for incremental collection
 * When provided, overrides the time range stored in panel requests
 */
export interface TimeRangeOverride {
  from: Date;
  to: Date;
}

/**
 * Batch Panel Queries
 * Replicates Python's batch_panel_queries function from query_panels.py:48-96
 *
 * Groups multiple panel queries into Grafana API batches for efficiency
 * Key algorithm: Start new batch every `batchSize` panels with unique refIds
 *
 * @param panels - Panel documents to query
 * @param batchSize - Number of panels per batch (default: 1)
 * @param timeRangeOverride - Optional time range to override stored panel request times (for incremental collection)
 */
export function batchPanelQueries(
  panels: PanelDocument[],
  batchSize: number = 1,
  timeRangeOverride?: TimeRangeOverride
): RequestBatch[] {
  if (panels.length === 0) {
    return [];
  }


  const requestBatches: RequestBatch[] = [];
  let currentBatch: RequestBatch | null = null;
  let refIdMapping: Array<{ panel: PanelDocument; target_index: number; ref_id: string }> = [];
  let processedPanelCount = 0; // Track actually processed panels (excluding skipped ones)

  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i];

    // Skip panels with no requests
    if (!panel.requests || panel.requests.length === 0) {
      continue;
    }

    // CRITICAL: Start new batch every batchSize panels (Python behavior)
    if (currentBatch === null || processedPanelCount % batchSize === 0) {
      // Save previous batch if it exists
      if (currentBatch !== null) {
        requestBatches.push({
          request: currentBatch.request,
          ref_id_mapping: refIdMapping
        });
        refIdMapping = [];
      }

      // Determine time range: use override if provided, otherwise use stored panel request times
      const firstRequest = panel.requests[0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const requestBody = firstRequest.request_body as any;
      const fromTime = timeRangeOverride
        ? String(timeRangeOverride.from.getTime())
        : (requestBody.from_ || requestBody.from);
      const toTime = timeRangeOverride
        ? String(timeRangeOverride.to.getTime())
        : requestBody.to;

      // Create new batch request with time range
      currentBatch = {
        request: {
          endpoint: '/api/ds/query',
          method: 'POST',
          request_body: {
            queries: [],
            from: fromTime,
            to: toTime,
          }
        },
        ref_id_mapping: []
      };
    }

    // Add all queries from panel to batch with unique refIds
    for (let targetIndex = 0; targetIndex < panel.requests.length; targetIndex++) {
      const request = panel.requests[targetIndex];

      for (const query of request.request_body.queries) {
        // CRITICAL: Make refId unique by appending panel index (Python pattern)
        // Type assertion needed to preserve index signature for dynamic properties like 'query'
        const newQuery: GrafanaQuery = {
          ...query,
          refId: `${query.refId}${i}`  // Make refId unique using original panel index
        };

        // CRITICAL: For InfluxDB raw queries, update the embedded time range
        // The $timeFilter variable gets substituted at panel creation time with potentially
        // incorrect values (e.g., when test hasn't ended yet). We need to replace the
        // embedded time range with the correct one from timeRangeOverride.
        if (timeRangeOverride && newQuery.query && typeof newQuery.query === 'string') {
          // Replace any existing "time >= Xms AND time <= Yms" pattern with the correct time range
          const timeFilterPattern = /time\s*>=\s*\d+ms\s+AND\s+time\s*<=\s*\d+ms/gi;
          const newTimeFilter = `time >= ${timeRangeOverride.from.getTime()}ms AND time <= ${timeRangeOverride.to.getTime()}ms`;
          newQuery.query = newQuery.query.replace(timeFilterPattern, newTimeFilter);
        }

        currentBatch.request.request_body.queries.push(newQuery);
        refIdMapping.push({
          panel: panel,
          target_index: targetIndex,
          ref_id: newQuery.refId
        });
      }
    }

    // Increment counter for processed panels (used for batching)
    processedPanelCount++;
  }

  // Add final batch if it has queries
  if (currentBatch && currentBatch.request.request_body.queries.length > 0) {
    requestBatches.push({
      request: currentBatch.request,
      ref_id_mapping: refIdMapping
    });
  }


  return requestBatches;
}

export interface ProcessedPanelResult {
  panel: PanelDocument;
  data: unknown | null;
  errors: Array<{
    target_index: number;
    status_code?: number;
    message: string;
    type: string;
    detail?: string;
  }> | null;
}

/**
 * Process Batched Responses
 * Replicates Python's response processing logic from query_panels.py:145-225
 *
 * Handles the complex error hierarchy:
 * 1. Client-side HTTP errors
 * 2. Batch-level Grafana API errors
 * 3. Query-level errors within successful batch
 * 4. Success case with data extraction
 */
export function processBatchedResponses(
  requestBatches: RequestBatch[],
  responses: unknown[]
): ProcessedPanelResult[] {
  const results: ProcessedPanelResult[] = [];
  const processedPanels = new Set<string>(); // Track processed panels to avoid duplicates


  for (let batchIndex = 0; batchIndex < requestBatches.length; batchIndex++) {
    const requestBatch = requestBatches[batchIndex];
    const response = responses[batchIndex];
    const refIdMapping = requestBatch.ref_id_mapping;

    // Group mapping by panel to process each panel once
    const panelGroups = new Map<string, Array<{ panel: PanelDocument; target_index: number; ref_id: string }>>();

    for (const mapping of refIdMapping) {
      const panelKey = `${mapping.panel.test_run_id}-${mapping.panel.application_dashboard_id}-${mapping.panel.panel_id}`;
      if (!panelGroups.has(panelKey)) {
        panelGroups.set(panelKey, []);
      }
      panelGroups.get(panelKey)!.push(mapping);
    }

    // Process each panel in this batch
    for (const [panelKey, mappings] of Array.from(panelGroups)) {
      if (processedPanels.has(panelKey)) {
        continue; // Skip already processed panels
      }
      processedPanels.add(panelKey);

      const panel = mappings[0].panel;
      const targetIndex = mappings[0].target_index;

      try {
        // 1. Client-side HTTP errors (network, timeout, etc.)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const responseAny = response as any;
        if (responseAny.error || !responseAny.response) {
          const error = responseAny.error || new Error('Unknown client error');

          results.push({
            panel,
            data: null,
            errors: [{
              target_index: targetIndex,
              status_code: undefined,
              message: 'Internal client error when making request to Grafana.',
              type: error.constructor?.name || 'ClientError',
            }]
          });
          continue;
        }

        const jsonResponse = responseAny.response;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _statusCode = responseAny.status;



        // 2. Process individual query results within the batch
        // CRITICAL: Even HTTP 400 responses can contain valid individual query results
        const responseResults = jsonResponse.results || {};
        const panelData: any = { results: {} };
        const panelErrors: Array<any> = [];



        // Check each query result for this panel
        for (const mapping of mappings) {
          const refId = mapping.ref_id;
          const queryResult = responseResults[refId];



          if (!queryResult) {
            panelErrors.push({
              target_index: mapping.target_index,
              message: `No result found for query ${refId}`,
              status_code: undefined, // Individual query missing, not batch-level error
              type: 'missingResult',
            });
            continue;
          }

          // 4. Query-level errors within successful batch
          // Note: successful queries might have status=200, status=undefined, or no status field
          if (queryResult.status && queryResult.status !== 200) {

            panelErrors.push({
              target_index: mapping.target_index,
              message: 'Grafana request returned error status.',
              status_code: queryResult.status,
              detail: queryResult.error || 'No error details',
              type: 'requestError',
            });
            continue;
          }

          // 5. Success case - add to panel data

          panelData.results[refId] = queryResult;
        }

        // Add processed panel result
        const finalResult = {
          panel,
          data: Object.keys(panelData.results).length > 0 ? panelData : null,
          errors: panelErrors.length > 0 ? panelErrors : null
        };


        results.push(finalResult);

      } catch (processingError) {

        results.push({
          panel,
          data: null,
          errors: [{
            target_index: 0,
            message: `Error processing response: ${processingError}`,
            status_code: undefined,
            type: 'processingError',
          }]
        });
      }
    }
  }


  return results;
}
