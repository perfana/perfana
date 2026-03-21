import { authenticatedFetch } from './api';

export interface AlertTagFilter {
  id: string;
  filterType: 'omit' | 'abort';
  alertSource: 'grafana' | 'alertmanager';
  tagKey: string;
  tagValue?: string;
  systemUnderTestId?: string;
  testEnvironment?: string;
  testType?: string;
  organizationId?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAlertTagFilterInput {
  filterType: 'omit' | 'abort';
  alertSource: 'grafana' | 'alertmanager';
  tagKey: string;
  tagValue?: string;
  systemUnderTestId?: string;
  testEnvironment?: string;
  testType?: string;
  organizationId?: string;
}

export interface UpdateAlertTagFilterInput {
  filterType?: 'omit' | 'abort';
  alertSource?: 'grafana' | 'alertmanager';
  tagKey?: string;
  tagValue?: string;
  systemUnderTestId?: string;
  testEnvironment?: string;
  testType?: string;
}

export async function fetchAlertTagFilters(): Promise<AlertTagFilter[]> {
  const response = await authenticatedFetch('alert-tag-filters');
  if (!response.ok) {
    throw new Error(`Failed to fetch alert tag filters: ${response.statusText}`);
  }
  return response.json();
}

export async function createAlertTagFilter(dto: CreateAlertTagFilterInput): Promise<AlertTagFilter> {
  const response = await authenticatedFetch('alert-tag-filters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dto),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Failed to create filter: ${response.statusText}`);
  }
  return response.json();
}

export async function updateAlertTagFilter(id: string, dto: UpdateAlertTagFilterInput): Promise<AlertTagFilter> {
  const response = await authenticatedFetch(`alert-tag-filters/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dto),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Failed to update filter: ${response.statusText}`);
  }
  return response.json();
}

export async function deleteAlertTagFilter(id: string): Promise<void> {
  const response = await authenticatedFetch(`alert-tag-filters/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(`Failed to delete filter: ${response.statusText}`);
  }
}
