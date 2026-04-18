// API functions for Pyroscope instances management

import { authenticatedFetch } from './api';

export interface PyroscopeInstance {
  id: string;
  label: string;
  pyroscopeUrl: string;
  backendUrl?: string;
  pyroscopeStandAlone: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePyroscopeInstanceDto {
  label: string;
  pyroscopeUrl: string;
  pyroscopeStandAlone?: boolean;
  organizationId?: string;
}

export interface UpdatePyroscopeInstanceDto extends Partial<CreatePyroscopeInstanceDto> {}

export interface PyroscopeInstanceQuery {
  label?: string;
  pyroscopeStandAlone?: boolean;
}

// Transform snake_case API response to camelCase
function transformPyroscopeInstance(data: unknown): PyroscopeInstance {
  const typedData = data as Record<string, unknown>;
  return {
    id: typedData.id as string,
    label: typedData.label as string,
    pyroscopeUrl: (typedData.pyroscope_url || typedData.pyroscopeUrl) as string,
    backendUrl: (typedData.backend_url || typedData.backendUrl) as string | undefined,
    pyroscopeStandAlone: (typedData.pyroscope_stand_alone ?? typedData.pyroscopeStandAlone ?? false) as boolean,
    createdAt: (typedData.created_at || typedData.createdAt) as string,
    updatedAt: (typedData.updated_at || typedData.updatedAt) as string,
  };
}

export async function fetchPyroscopeInstances(query?: PyroscopeInstanceQuery, organizationId?: string | null): Promise<PyroscopeInstance[]> {
  const searchParams = new URLSearchParams();
  if (query?.label) searchParams.append('label', query.label);
  if (query?.pyroscopeStandAlone !== undefined) searchParams.append('pyroscopeStandAlone', query.pyroscopeStandAlone.toString());
  if (organizationId) searchParams.append('organizationId', organizationId);

  const url = `/pyroscope-instances${searchParams.toString() ? `?${searchParams}` : ''}`;

  const response = await authenticatedFetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Pyroscope instances: ${response.statusText}`);
  }

  const data = await response.json();
  return data.map(transformPyroscopeInstance);
}

export async function fetchPyroscopeInstance(id: string): Promise<PyroscopeInstance> {
  const response = await authenticatedFetch(`/pyroscope-instances/${id}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Pyroscope instance: ${response.statusText}`);
  }

  const data = await response.json();
  return transformPyroscopeInstance(data);
}

export async function createPyroscopeInstance(data: CreatePyroscopeInstanceDto): Promise<PyroscopeInstance> {
  const response = await authenticatedFetch(`/pyroscope-instances`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to create Pyroscope instance: ${response.statusText}`);
  }

  const responseData = await response.json();
  return transformPyroscopeInstance(responseData);
}

export async function updatePyroscopeInstance(id: string, data: UpdatePyroscopeInstanceDto): Promise<PyroscopeInstance> {
  const response = await authenticatedFetch(`/pyroscope-instances/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to update Pyroscope instance: ${response.statusText}`);
  }

  const responseData = await response.json();
  return transformPyroscopeInstance(responseData);
}

export async function deletePyroscopeInstance(id: string): Promise<void> {
  const response = await authenticatedFetch(`/pyroscope-instances/${id}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to delete Pyroscope instance: ${response.statusText}`);
  }
}

export async function testPyroscopeConnection(id: string): Promise<{ success: boolean; message: string }> {
  const response = await authenticatedFetch(`/pyroscope-instances/${id}/test-connection`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to test Pyroscope connection: ${response.statusText}`);
  }

  return response.json();
}

export async function testPyroscopeConnectionWithParams(data: {
  pyroscopeUrl: string;
}): Promise<{ success: boolean; message: string }> {
  const response = await authenticatedFetch('/pyroscope-instances/test-connection', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to test Pyroscope connection: ${response.statusText}`);
  }

  return response.json();
}

// Additional types for Pyroscope integration

export interface ProfilerType {
  value: string;
  label: string;
}

export interface GeneratePyroscopeUrlParams {
  pyroscopeUrl: string;
  isStandalone: boolean;
  application: string;
  profilerValue: string;
  startTime: number; // milliseconds
  endTime: number;
  theme?: string;
}

export interface GeneratePyroscopeCompareUrlParams {
  pyroscopeUrl: string;
  isStandalone: boolean;
  application: string;
  profilerValue: string;
  profilerLabel: string;
  leftStartTime: number; // baseline start in milliseconds
  leftEndTime: number; // baseline end in milliseconds
  rightStartTime: number; // current start in milliseconds
  rightEndTime: number; // current end in milliseconds
  viewMode?: 'comparison' | 'diff';
  theme?: string;
}

export interface TestRunSummary {
  id: string;
  test_run_id: string;
  start_time: string;
  end_time: string;
  duration?: number;
  created_at: string;
}

/**
 * Generate a single view URL for Pyroscope profiling data
 * @param params - Parameters for generating the Pyroscope URL
 * @returns Promise with the generated URL
 */
export async function generatePyroscopeUrl(params: GeneratePyroscopeUrlParams): Promise<{ url: string }> {
  const response = await authenticatedFetch('/pyroscope/generate-url', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to generate Pyroscope URL: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Generate a comparison/diff URL for Pyroscope profiling data
 * @param params - Parameters for generating the comparison URL
 * @returns Promise with the generated URL
 */
export async function generatePyroscopeCompareUrl(params: GeneratePyroscopeCompareUrlParams): Promise<{ url: string }> {
  const response = await authenticatedFetch('/pyroscope/generate-compare-url', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to generate Pyroscope comparison URL: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch available profiler types from the backend
 * @returns Promise with array of profiler types
 */
export async function fetchProfilerTypes(): Promise<ProfilerType[]> {
  const response = await authenticatedFetch('/pyroscope/profiler-types', {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch profiler types: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch baseline test runs for comparison
 * @param systemUnderTestId - System under test ID
 * @param testEnvironment - Test environment
 * @param workload - Workload name
 * @param excludeTestRunId - Test run ID to exclude (current test run)
 * @returns Promise with array of test run summaries
 */
export async function fetchBaselineTestRuns(
  systemUnderTestId: string,
  testEnvironment: string,
  workload: string,
  excludeTestRunId: string
): Promise<TestRunSummary[]> {
  const searchParams = new URLSearchParams({
    systemUnderTestId,
    testEnvironment,
    workload,
    excludeTestRunId,
  });

  const response = await authenticatedFetch(`/test-runs/baseline-candidates?${searchParams.toString()}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch baseline test runs: ${response.statusText}`);
  }

  return response.json();
}
