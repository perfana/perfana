// API functions for systems under test management

import { authenticatedFetch } from './api';
import { SystemUnderTest } from '../types/test-runs';

export interface SystemSummary {
  id: string;
  name: string;
  description?: string;
  team_id?: string | null;
  environments: Array<{
    environment: string;
    workloads: string[];
  }>;
  created_at: string;
}

export interface PyroscopeConfiguration {
  application: string;
  profiler: string;
}

export interface UpdateSystemPyroscopeConfigDto {
  pyroscope_instance_id: string | null;
  pyroscope_configurations: PyroscopeConfiguration[];
}

export interface UpdateSystemUnderTestDto {
  name?: string;
  description?: string;
  team_id?: string | null;
  tracing_service?: string;
}

/**
 * Update Pyroscope configuration for a system under test
 * @param systemId - System under test ID
 * @param config - Pyroscope configuration data
 * @returns Promise with updated system under test
 */
export async function updateSystemPyroscopeConfig(
  systemId: string,
  config: UpdateSystemPyroscopeConfigDto
): Promise<SystemUnderTest> {
  console.log('🌐 updateSystemPyroscopeConfig called', {
    systemId,
    config,
    url: `/systems-under-test/${systemId}/pyroscope`,
  });

  const response = await authenticatedFetch(`/systems-under-test/${systemId}/pyroscope`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(config),
  });

  console.log('📥 Response received', {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error('❌ API error response:', errorData);
    throw new Error(
      errorData.message || `Failed to update Pyroscope configuration: ${response.statusText}`
    );
  }

  const result = await response.json();
  console.log('✅ API success response:', result);
  return result;
}

/**
 * Update general properties of a system under test
 * @param systemId - System under test ID
 * @param updateDto - Properties to update (name, description, team_id, tracing_service)
 * @returns Promise with updated system under test
 */
export async function updateSystemUnderTest(
  systemId: string,
  updateDto: UpdateSystemUnderTestDto
): Promise<SystemUnderTest> {
  console.log('🌐 updateSystemUnderTest called', {
    systemId,
    updateDto,
    url: `/systems-under-test/${systemId}`,
  });

  const response = await authenticatedFetch(`/systems-under-test/${systemId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updateDto),
  });

  console.log('📥 Response received', {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error('❌ API error response:', errorData);
    throw new Error(
      errorData.message || `Failed to update system under test: ${response.statusText}`
    );
  }

  const result = await response.json();
  console.log('✅ API success response:', result);
  return result;
}

/**
 * Fetch all systems under test accessible to the current user
 */
export async function fetchAllSystemsUnderTest(): Promise<SystemUnderTest[]> {
  const response = await authenticatedFetch('/systems-under-test');
  if (!response.ok) {
    throw new Error(`Failed to fetch systems under test: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetch a single system under test by ID (includes environments and workloads)
 */
export async function fetchSystemUnderTest(systemId: string): Promise<SystemUnderTest> {
  const response = await authenticatedFetch(`/systems-under-test/${systemId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch system under test: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetch system summary with environments and workloads
 */
export async function fetchSystemSummary(systemId: string): Promise<SystemSummary> {
  const response = await authenticatedFetch(`/systems-under-test/${systemId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch system summary: ${response.statusText}`);
  }
  return response.json();
}
