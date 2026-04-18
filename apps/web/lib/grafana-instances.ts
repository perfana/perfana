// API functions for Grafana instances management

import { authenticatedFetch } from './api';

export interface GrafanaInstance {
  id: string;
  label: string;
  clientUrl: string;
  serverUrl?: string;
  orgId: string;
  apiKey?: string;
  username?: string;
  password?: string;
  snapshotInstance: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGrafanaInstanceDto {
  label: string;
  clientUrl: string;
  serverUrl?: string;
  orgId: string;
  apiKey?: string;
  username?: string;
  password?: string;
  snapshotInstance?: boolean;
  organizationId?: string;
}

export interface UpdateGrafanaInstanceDto extends Partial<CreateGrafanaInstanceDto> {}

export interface GrafanaInstanceQuery {
  label?: string;
  snapshotInstance?: boolean;
}

// Transform snake_case API response to camelCase
function transformGrafanaInstance(data: unknown): GrafanaInstance {
  return {
    id: data.id,
    label: data.label,
    clientUrl: data.client_url || data.clientUrl,
    serverUrl: data.server_url || data.serverUrl,
    orgId: data.org_id || data.orgId,
    apiKey: data.api_key || data.apiKey,
    username: data.username,
    password: data.password,
    snapshotInstance: data.snapshot_instance ?? data.snapshotInstance ?? false,
    createdAt: data.created_at || data.createdAt,
    updatedAt: data.updated_at || data.updatedAt,
  };
}

export async function fetchGrafanaInstances(query?: GrafanaInstanceQuery, organizationId?: string | null): Promise<GrafanaInstance[]> {
  const searchParams = new URLSearchParams();
  if (query?.label) searchParams.append('label', query.label);
  if (query?.snapshotInstance !== undefined) searchParams.append('snapshotInstance', query.snapshotInstance.toString());
  if (organizationId) searchParams.append('organizationId', organizationId);

  const url = `/grafana-instances${searchParams.toString() ? `?${searchParams}` : ''}`;

  const response = await authenticatedFetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Grafana instances: ${response.statusText}`);
  }

  const data = await response.json();
  return data.map(transformGrafanaInstance);
}

export async function fetchGrafanaInstance(id: string): Promise<GrafanaInstance> {
  const response = await authenticatedFetch(`/grafana-instances/${id}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Grafana instance: ${response.statusText}`);
  }

  const data = await response.json();
  return transformGrafanaInstance(data);
}

export async function createGrafanaInstance(data: CreateGrafanaInstanceDto): Promise<GrafanaInstance> {
  const response = await authenticatedFetch(`/grafana-instances`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to create Grafana instance: ${response.statusText}`);
  }

  const responseData = await response.json();
  return transformGrafanaInstance(responseData);
}

export async function updateGrafanaInstance(id: string, data: UpdateGrafanaInstanceDto): Promise<GrafanaInstance> {
  const response = await authenticatedFetch(`/grafana-instances/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to update Grafana instance: ${response.statusText}`);
  }

  const responseData = await response.json();
  return transformGrafanaInstance(responseData);
}

export async function deleteGrafanaInstance(id: string): Promise<void> {
  const response = await authenticatedFetch(`/grafana-instances/${id}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to delete Grafana instance: ${response.statusText}`);
  }
}

export async function testGrafanaConnection(id: string): Promise<{ success: boolean; message: string }> {
  const response = await authenticatedFetch(`/grafana-instances/${id}/test-connection`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to test Grafana connection: ${response.statusText}`);
  }

  return response.json();
}

export async function testGrafanaConnectionWithParams(data: {
  clientUrl: string;
  serverUrl?: string;
  orgId: string;
  apiKey?: string;
  username?: string;
  password?: string;
}): Promise<{ success: boolean; message: string }> {
  const response = await authenticatedFetch('/grafana-instances/test-connection', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to test Grafana connection: ${response.statusText}`);
  }

  return response.json();
}