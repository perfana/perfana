import { authenticatedFetch } from './api'

export interface DynatraceConfig {
  id: string
  host: string
  apiToken: string
  dynatraceType: 'saas' | 'managed'
  label: string
  platformApiToken?: string
  perfanaTestRunIdAttribute?: string
  perfanaRequestNameAttribute?: string
  createdAt: string
  updatedAt: string
}

export interface CreateDynatraceConfigDto {
  label: string
  host: string
  apiToken: string
  platformApiToken?: string
  dynatraceType?: 'saas' | 'managed'
  perfanaTestRunIdAttribute?: string
  perfanaRequestNameAttribute?: string
  organizationId?: string
}

export interface TestConnectionResponse {
  success: boolean
  version?: string
}

export async function fetchDynatraceConfigs(organizationId?: string | null): Promise<DynatraceConfig[]> {
  const url = organizationId ? `/dynatrace?organizationId=${organizationId}` : '/dynatrace';
  const response = await authenticatedFetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error('Failed to fetch Dynatrace configurations')
  }

  return response.json()
}

export async function createDynatraceConfig(
  data: CreateDynatraceConfigDto
): Promise<DynatraceConfig> {
  const response = await authenticatedFetch('/dynatrace', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.message || 'Failed to create Dynatrace configuration')
  }

  return response.json()
}

export async function testDynatraceConnection(
  data: { host: string; apiToken: string }
): Promise<TestConnectionResponse> {
  const response = await authenticatedFetch('/dynatrace/test-connection', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.message || 'Connection test failed')
  }

  return response.json()
}

export interface UpdateDynatraceConfigDto {
  perfanaTestRunIdAttribute?: string
  perfanaRequestNameAttribute?: string
  platformApiToken?: string
}

export async function updateDynatraceConfig(
  id: string,
  data: UpdateDynatraceConfigDto
): Promise<DynatraceConfig> {
  const response = await authenticatedFetch(`/dynatrace/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.message || 'Failed to update Dynatrace configuration')
  }

  return response.json()
}

export interface DynatraceRequestAttribute {
  id: string
  name: string
}

export interface RequestAttributesResponse {
  all: DynatraceRequestAttribute[]
  perfanaAttributes: DynatraceRequestAttribute[]
}

export async function fetchRequestAttributesForHost(
  host: string
): Promise<RequestAttributesResponse> {
  const response = await authenticatedFetch(`/dynatrace/${encodeURIComponent(host)}/request-attributes`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.message || 'Failed to fetch request attributes')
  }

  return response.json()
}

export async function deleteDynatraceConfig(id: string): Promise<void> {
  const response = await authenticatedFetch(`/dynatrace/${id}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.message || 'Failed to delete Dynatrace configuration')
  }
}

// Query API Functions
export interface DynatraceQuery {
  id: string
  dynatraceConfigId: string
  systemUnderTestId: string
  testEnvironment: string
  workload: string
  dashboardLabel: string
  applicationDashboardId: string
  panelTitle: string
  panelId?: number
  query: string
  matchMetricPattern?: string
  omitGroupByVariableFromMetricName?: string[]
  templateVariables?: Record<string, string>
  dynatraceConfig?: DynatraceConfig
  createdAt: string
  updatedAt: string
}

export interface CreateDynatraceQueryDto {
  dynatraceConfigId: string
  systemUnderTestId: string
  testEnvironment: string
  workload: string
  dashboardLabel: string
  applicationDashboardId: string
  panelTitle: string
  panelId?: number
  query: string
  matchMetricPattern?: string
  omitGroupByVariableFromMetricName?: string[]
  templateVariables?: Record<string, string>
  metricUnit?: string
}

export interface UpdateDynatraceQueryDto {
  dynatraceConfigId?: string
  systemUnderTestId?: string
  testEnvironment?: string
  workload?: string
  dashboardLabel?: string
  applicationDashboardId?: string
  panelTitle?: string
  panelId?: number
  query?: string
  matchMetricPattern?: string
  omitGroupByVariableFromMetricName?: string[]
  templateVariables?: Record<string, string>
  metricUnit?: string
}

export async function fetchDynatraceQueries(
  systemId?: string,
  environment?: string,
  workload?: string
): Promise<DynatraceQuery[]> {
  const params = new URLSearchParams()
  if (systemId) params.append('systemId', systemId)
  if (environment) params.append('environment', environment)
  if (workload) params.append('workload', workload)

  const url = `/dynatrace/queries${params.toString() ? `?${params.toString()}` : ''}`

  const response = await authenticatedFetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error('Failed to fetch Dynatrace queries')
  }

  return response.json()
}

export async function fetchDynatraceQueryById(id: string): Promise<DynatraceQuery> {
  const response = await authenticatedFetch(`/dynatrace/queries/${id}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error('Failed to fetch Dynatrace query')
  }

  return response.json()
}

export async function createDynatraceQuery(
  data: CreateDynatraceQueryDto
): Promise<DynatraceQuery> {
  const response = await authenticatedFetch('/dynatrace/queries', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.message || 'Failed to create Dynatrace query')
  }

  return response.json()
}

export async function updateDynatraceQuery(
  id: string,
  data: UpdateDynatraceQueryDto
): Promise<DynatraceQuery> {
  const response = await authenticatedFetch(`/dynatrace/queries/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.message || 'Failed to update Dynatrace query')
  }

  return response.json()
}

export async function deleteDynatraceQuery(id: string): Promise<void> {
  const response = await authenticatedFetch(`/dynatrace/queries/${id}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.message || 'Failed to delete Dynatrace query')
  }
}

// SLO Support Functions
export interface DynatraceDashboard {
  dashboardLabel: string
}

export interface DynatraceMetric {
  panelTitle: string
  panelId: number
  applicationDashboardId: string
  metricUnit?: string
}

export async function fetchDynatraceDashboards(
  systemId: string,
  environment: string,
  workload: string
): Promise<DynatraceDashboard[]> {
  const params = new URLSearchParams({
    systemId,
    environment,
    workload
  })

  const response = await authenticatedFetch(`/dynatrace/queries/dashboards?${params.toString()}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    console.error('Dynatrace API error:', response.status, response.statusText, errorData)
    throw new Error(`Failed to fetch Dynatrace dashboards: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

export async function fetchDynatraceMetrics(
  systemId: string,
  environment: string,
  workload: string,
  dashboardLabel: string
): Promise<DynatraceMetric[]> {
  const params = new URLSearchParams({
    systemId,
    environment,
    workload,
    dashboardLabel
  })

  const response = await authenticatedFetch(`/dynatrace/queries/metrics?${params.toString()}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error('Failed to fetch Dynatrace metrics')
  }

  return response.json()
}

// Host Entity Support

export interface HostPropertiesResponse {
  entityId: string;
  displayName: string;
  properties: {
    cpuCores?: number;
    osType?: string;
    osArchitecture?: string;
    bitness?: string;
    monitoringMode?: string;
    hostName?: string;
    ipAddresses?: string[];
    cloudType?: string;
    memoryTotal?: number;
  };
  lastSeenTimestamp?: number;
}

export interface TimeSeriesData {
  metricName: string;
  unit: string;
  dataPoints: { timestamp: string; value: number }[];
}

export interface HostMetricsResponse {
  entityId: string;
  metrics: {
    cpu: TimeSeriesData[];
    memory: TimeSeriesData[];
    disk: TimeSeriesData[];
    network: TimeSeriesData[];
  };
}

export interface HostProblemResponse {
  problemId: string;
  title: string;
  status: 'OPEN' | 'RESOLVED';
  severityLevel: string;
  startTime: string;
  endTime?: string;
  impactLevel?: string;
}

export async function fetchHostProperties(
  hostId: string,
  dynatraceConfigId: string
): Promise<HostPropertiesResponse> {
  const response = await authenticatedFetch(
    `/dynatrace/hosts/${encodeURIComponent(hostId)}/properties?dynatraceConfigId=${encodeURIComponent(dynatraceConfigId)}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.message || 'Failed to fetch host properties')
  }

  return response.json();
}

export async function fetchHostMetrics(
  hostId: string,
  startTime: string,
  endTime: string,
  dynatraceConfigId: string
): Promise<HostMetricsResponse> {
  const params = new URLSearchParams({
    startTime,
    endTime,
    dynatraceConfigId
  });

  const response = await authenticatedFetch(
    `/dynatrace/hosts/${encodeURIComponent(hostId)}/metrics?${params.toString()}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.message || 'Failed to fetch host metrics')
  }

  return response.json();
}

export async function fetchHostProblems(
  hostId: string,
  startTime: string,
  endTime: string,
  dynatraceConfigId: string
): Promise<HostProblemResponse[]> {
  const params = new URLSearchParams({
    startTime,
    endTime,
    dynatraceConfigId
  });

  const response = await authenticatedFetch(
    `/dynatrace/hosts/${encodeURIComponent(hostId)}/problems?${params.toString()}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.message || 'Failed to fetch host problems')
  }

  return response.json();
}

export async function storeHostProperties(
  hostId: string,
  testRunId: string,
  hostDisplayName: string,
  properties: object
): Promise<void> {
  const response = await authenticatedFetch(
    `/dynatrace/hosts/${encodeURIComponent(hostId)}/store-properties`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        testRunId,
        hostDisplayName,
        properties
      }),
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.message || 'Failed to store host properties')
  }
}