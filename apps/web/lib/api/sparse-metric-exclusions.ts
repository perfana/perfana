/**
 * Sparse Metric Exclusions API Client
 *
 * Client functions for managing metrics excluded from sparse data checks.
 * Uses authenticatedFetch for automatic auth header injection and token refresh.
 */

import { authenticatedFetch } from '../api';

export interface SparseMetricExclusion {
  id: string;
  system_under_test_id: string;
  test_environment: string;
  workload: string;
  dashboard_label: string;
  metric_name: string;
  reason?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateSparseMetricExclusionParams {
  system: string;
  systemUnderTestId?: string;
  environment: string;
  workload: string;
  dashboardLabel: string;
  metricName: string;
  reason?: string;
}

export async function getSparseMetricExclusions(
  system: string,
  environment: string,
  workload: string,
): Promise<SparseMetricExclusion[]> {
  const params = new URLSearchParams({ system, environment, workload });
  const response = await authenticatedFetch(
    `/test-runs/sparse-metric-exclusions?${params.toString()}`,
  );
  if (!response.ok) {
    throw new Error('Failed to fetch sparse metric exclusions');
  }
  return response.json();
}

export async function createSparseMetricExclusion(
  params: CreateSparseMetricExclusionParams,
): Promise<SparseMetricExclusion> {
  const response = await authenticatedFetch('/test-runs/sparse-metric-exclusions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    throw new Error('Failed to create sparse metric exclusion');
  }
  return response.json();
}

export async function deleteSparseMetricExclusion(
  system: string,
  environment: string,
  workload: string,
  dashboardLabel: string,
  metricName: string,
): Promise<void> {
  const params = new URLSearchParams({
    system,
    environment,
    workload,
    dashboardLabel,
    metricName,
  });
  const response = await authenticatedFetch(
    `/test-runs/sparse-metric-exclusions?${params.toString()}`,
    { method: 'DELETE' },
  );
  if (!response.ok) {
    throw new Error('Failed to delete sparse metric exclusion');
  }
}
