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
  useProxy: boolean;
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
  useProxy?: boolean;
  organizationId?: string;
}

export interface UpdateGrafanaInstanceDto extends Partial<CreateGrafanaInstanceDto> {}

export interface GrafanaInstanceQuery {
  label?: string;
  snapshotInstance?: boolean;
}

// Transform snake_case API response to camelCase
function transformGrafanaInstance(data: unknown): GrafanaInstance {
  const typedData = data as Record<string, unknown>;
  return {
    id: typedData.id as string,
    label: typedData.label as string,
    clientUrl: (typedData.client_url || typedData.clientUrl) as string,
    serverUrl: (typedData.server_url || typedData.serverUrl) as string | undefined,
    orgId: (typedData.org_id || typedData.orgId) as string,
    apiKey: (typedData.api_key || typedData.apiKey) as string | undefined,
    username: typedData.username as string | undefined,
    password: typedData.password as string | undefined,
    snapshotInstance: (typedData.snapshot_instance ?? typedData.snapshotInstance ?? false) as boolean,
    useProxy: (typedData.use_proxy ?? typedData.useProxy ?? false) as boolean,
    createdAt: (typedData.created_at || typedData.createdAt) as string,
    updatedAt: (typedData.updated_at || typedData.updatedAt) as string,
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