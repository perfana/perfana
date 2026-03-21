import { authenticatedFetch } from './api';

export interface DeleteAnomalyOptions {
  scope: 'metric' | 'panel';
  range: 'current-test-run' | 'all-test-runs';
}

export interface DeleteAnomalyRequest {
  dashboardLabel: string;
  panelTitle: string;
  metricName?: string;
  panelId: string;
  applicationDashboardId: string;
  scope: 'metric' | 'panel';
  range: 'current-test-run' | 'all-test-runs';
}

export interface DeleteAnomalyResponse {
  message: string;
  deletedCount: number;
  scope: string;
  range: string;
}

export async function deleteAnomalyData(
  testRunId: string,
  data: DeleteAnomalyRequest
): Promise<DeleteAnomalyResponse> {
  const response = await authenticatedFetch(`/test-runs/${testRunId}/anomaly-data`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || 'Failed to delete anomaly data');
  }

  return response.json();
}