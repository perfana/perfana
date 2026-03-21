import { authenticatedFetch } from './api';

/**
 * Interface for nested tracing instance in TracingService (camelCase - from TracingInstanceInfo)
 */
export interface TracingInstanceInfo {
  id: string;
  label: string;
  tracingUrl: string;
  tracingApiUrl?: string;
  tracingUi: 'tempo' | 'jaeger' | 'elastic';
  tracingIframeAllowed: boolean;
}

/**
 * Interface for tracing service configuration
 * Maps to backend TracingServiceResponseDto (uses camelCase)
 */
export interface TracingService {
  id: string;
  systemUnderTestId: string;
  testEnvironment?: string | null;
  workload?: string | null;
  tracingInstanceId: string;
  tracingInstance: TracingInstanceInfo;
  serviceNames: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Legacy interface for backward compatibility with URL generation
 * TODO: Refactor URL generation to use new structure
 */
export interface LegacyTracingService {
  tracing_url: string;
  tracing_ui: 'tempo' | 'jaeger' | 'elastic';
  trace_request_name_panel_description?: string;
}

/**
 * Interface for tracing instance configuration (for integrations page)
 * Maps to backend TracingInstanceResponseDto (uses snake_case)
 */
export interface TracingInstance {
  id: string;
  label: string;
  tracing_url: string;
  tracing_api_url?: string;
  tracing_ui: 'tempo' | 'jaeger' | 'elastic';
  tracing_iframe_allowed: boolean;
  created_at?: string;
  updated_at?: string;
}

/**
 * Parameters for generating tracing URLs
 */
interface TracingUrlParams {
  tracingService: TracingService;
  testRunId: string;
  startTime: string;
  endTime: string;
  serviceName?: string; // Service name for Jaeger
  requestName?: string;
  minDuration?: string;
  maxDuration?: string;
  themeMode?: 'light' | 'dark';
}

/**
 * Fetch tracing services configured for a system/environment/workload combination
 *
 * @param systemId - System under test ID
 * @param environment - Optional test environment
 * @param workload - Optional workload
 * @returns Array of tracing service configurations
 */
export async function fetchTracingServices(
  systemId: string,
  environment?: string,
  workload?: string
): Promise<TracingService[]> {
  try {
    const params = new URLSearchParams();
    params.append('systemId', systemId);
    if (environment) params.append('environment', environment);
    if (workload) params.append('workload', workload);

    const response = await authenticatedFetch(`/tracing-services?${params.toString()}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch tracing services: ${response.statusText}`);
    }

    return response.json();
  } catch (err) {
    console.error('Error fetching tracing services:', err);
    throw err;
  }
}

/**
 * Generate tracing URL based on UI type
 * Dispatches to appropriate UI-specific generator
 *
 * @param params - URL generation parameters
 * @returns Generated tracing URL
 */
export function generateTracingUrl(params: TracingUrlParams): string {
  const { tracingService } = params;

  // Access the UI type from the nested tracingInstance
  const tracingUi = tracingService.tracingInstance?.tracingUi;

  if (!tracingUi) {
    throw new Error('Tracing instance or UI type is not configured');
  }

  switch (tracingUi) {
    case 'tempo':
      return generateTempoUrl(params);
    case 'jaeger':
      return generateJaegerUrl(params);
    case 'elastic':
      return generateElasticUrl(params);
    default:
      throw new Error(`Unsupported tracing UI type: ${tracingUi}`);
  }
}

/**
 * Generate Tempo tracing URL
 * Based on legacy implementation: testRunTraces.js lines 497-519
 *
 * Legacy Tempo uses Grafana dashboard with variables, not direct Tempo datasource access
 *
 * @param params - URL generation parameters
 * @returns Tempo-formatted URL (Grafana dashboard with variables)
 */
export function generateTempoUrl(params: TracingUrlParams): string {
  const { tracingService, testRunId, startTime, endTime, serviceName, requestName, minDuration, maxDuration } = params;

  // Convert ISO timestamps to milliseconds
  const startMs = new Date(startTime).getTime();
  const endMs = new Date(endTime).getTime();

  // Build Grafana dashboard query parameters (legacy format)
  const queryParams = new URLSearchParams();

  // Grafana org ID (default to 1)
  queryParams.append('orgId', '1');

  // Time range
  queryParams.append('from', startMs.toString());
  queryParams.append('to', endMs.toString());

  // Service variable
  if (serviceName) {
    queryParams.append('var-service', serviceName);
  }

  // Test run ID variable
  queryParams.append('var-perfanaTestRunId', testRunId);

  // Request name variable (use ".*" regex to match all if not specified)
  queryParams.append('var-perfanaRequestName', requestName || '.*');

  // Duration filters
  const minDurationStr = minDuration ? `${minDuration}ms` : '1ms';
  const maxDurationStr = maxDuration ? `${maxDuration}ms` : '100s';
  queryParams.append('var-minDuration', minDurationStr);
  queryParams.append('var-maxDuration', maxDurationStr);

  // Limit (default 500)
  queryParams.append('var-limit', '500');

  // Theme (matches current UI theme)
  queryParams.append('theme', params.themeMode || 'light');

  // Kiosk mode for clean iframe display
  queryParams.append('kiosk', '');

  // Construct full URL (no /explore path - direct to Grafana dashboard)
  const baseUrl = tracingService.tracingInstance.tracingUrl.replace(/\/$/, ''); // Remove trailing slash
  return `${baseUrl}?${queryParams.toString()}`;
}

/**
 * Generate Jaeger tracing URL
 * Based on legacy implementation: testRunTraces.js lines 521-545
 *
 * @param params - URL generation parameters
 * @returns Jaeger-formatted URL
 */
export function generateJaegerUrl(params: TracingUrlParams): string {
  const { tracingService, testRunId, startTime, endTime, serviceName, requestName, minDuration, maxDuration } = params;

  // Convert ISO timestamps to microseconds (Jaeger uses microseconds)
  const startUs = new Date(startTime).getTime() * 1000;
  const endUs = new Date(endTime).getTime() * 1000;

  // Build tags object (legacy format uses JSON encoding)
  const tags: Record<string, string> = {
    'perfana-test-run-id': testRunId,
  };

  if (requestName) {
    tags['perfana-request-name'] = requestName;
  }

  // Build Jaeger search parameters
  const queryParams = new URLSearchParams();

  // Service name (use provided service name or first service from the list)
  const service = serviceName || tracingService.serviceNames?.[0];
  if (service) {
    queryParams.append('service', service);
  }

  // Time range
  queryParams.append('start', startUs.toString());
  queryParams.append('end', endUs.toString());

  // Add lookback parameter
  queryParams.append('lookback', 'custom');

  // Limit results (default 500)
  queryParams.append('limit', '500');

  // Duration filters (in milliseconds with 'ms' suffix for Jaeger)
  if (minDuration) {
    queryParams.append('minDuration', `${minDuration}ms`);
  }
  if (maxDuration) {
    queryParams.append('maxDuration', `${maxDuration}ms`);
  }

  // Tags as JSON string (legacy format)
  queryParams.append('tags', encodeURIComponent(JSON.stringify(tags)));

  // Construct full URL
  const baseUrl = tracingService.tracingInstance.tracingUrl.replace(/\/$/, '');
  return `${baseUrl}/search?${queryParams.toString()}`;
}

/**
 * Generate Elastic APM tracing URL
 * Based on legacy implementation: testRunTraces.js lines 547-560
 *
 * Legacy Elastic uses direct URL with query params, not /app/apm/traces path
 *
 * @param params - URL generation parameters
 * @returns Elastic APM-formatted URL
 */
export function generateElasticUrl(params: TracingUrlParams): string {
  const { tracingService, testRunId, startTime, endTime, serviceName, requestName } = params;

  // Convert ISO timestamps to ISO strings (legacy format)
  const startIso = new Date(startTime).toISOString();
  const endIso = new Date(endTime).toISOString();

  // Build query string parts
  const queryParts: string[] = [
    `labels.http_request_header_perfana-test-run-id: "${testRunId}"`,
  ];

  if (requestName) {
    queryParts.push(`labels.http_request_header_perfana-request-name: "${requestName}"`);
  }

  if (serviceName) {
    queryParts.push(`service.name : "${serviceName}"`);
  }

  // Build query parameters (legacy format)
  const queryParams = new URLSearchParams();
  queryParams.append('rangeFrom', startIso);
  queryParams.append('rangeTo', endIso);
  queryParams.append('query', queryParts.join(' and '));
  queryParams.append('type', 'kql');

  // Construct full URL (no /app/apm/traces path - direct to base URL)
  const baseUrl = tracingService.tracingInstance.tracingUrl.replace(/\/$/, '');
  return `${baseUrl}?${queryParams.toString()}`;
}

/**
 * Fetch all tracing instances configured in the system
 *
 * @returns Array of tracing instance configurations
 */
export async function fetchTracingInstances(organizationId?: string | null): Promise<TracingInstance[]> {
  const url = organizationId ? `/tracing-instances?organizationId=${organizationId}` : '/tracing-instances';
  const response = await authenticatedFetch(url);
  if (!response.ok) throw new Error('Failed to fetch tracing instances');
  return response.json();
}

/**
 * Create a new tracing instance
 *
 * @param data - Tracing instance configuration data
 * @returns Created tracing instance
 */
export async function createTracingInstance(data: {
  label: string;
  tracingUrl: string;
  tracingApiUrl?: string;
  tracingUi: 'tempo' | 'jaeger' | 'elastic';
  tracingIframeAllowed: boolean;
  organizationId?: string;
}): Promise<TracingInstance> {
  const response = await authenticatedFetch('/tracing-instances', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to create tracing instance');
  return response.json();
}

/**
 * Update an existing tracing instance
 *
 * @param id - Tracing instance ID
 * @param data - Updated tracing instance configuration data
 * @returns Updated tracing instance
 */
export async function updateTracingInstance(
  id: string,
  data: {
    label: string;
    tracingUrl: string;
    tracingApiUrl?: string;
    tracingUi: 'tempo' | 'jaeger' | 'elastic';
    tracingIframeAllowed: boolean;
  }
): Promise<TracingInstance> {
  const response = await authenticatedFetch(`/tracing-instances/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to update tracing instance');
  return response.json();
}

/**
 * Delete a tracing instance
 *
 * @param id - Tracing instance ID
 */
export async function deleteTracingInstance(id: string): Promise<void> {
  const response = await authenticatedFetch(`/tracing-instances/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete tracing instance');
}

/**
 * Test connection to a tracing instance with provided parameters
 *
 * @param params - Connection test parameters
 * @returns Test result message
 */
export async function testTracingConnectionWithParams(params: {
  tracingUrl: string;
  tracingUi: string;
}): Promise<{ message: string }> {
  const response = await authenticatedFetch('/tracing-instances/test-connection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Connection test failed');
  }
  return response.json();
}
