// API functions for Grafana dashboards management

import { authenticatedFetch } from './api';

export interface GrafanaDashboard {
  id: string;
  grafanaInstanceId: string;
  grafanaId: number;
  datasourceType?: string;
  uid: string;
  slug?: string;
  name: string;
  uri?: string;
  templatingVariables?: any[];
  panels?: any[];
  variables?: any[];
  tags?: string[];
  usedBySut?: string[];
  updated?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GrafanaDashboardQuery {
  grafanaInstanceId?: string;
  name?: string;
  uid?: string;
  tags?: string[];
  usedBySut?: string;
}

// Transform snake_case API response to camelCase
function transformGrafanaDashboard(data: any): GrafanaDashboard {
  return {
    id: data.id,
    grafanaInstanceId: data.grafana_instance_id || data.grafanaInstanceId,
    grafanaId: data.grafana_id || data.grafanaId,
    datasourceType: data.datasource_type || data.datasourceType,
    uid: data.uid,
    slug: data.slug,
    name: data.name,
    uri: data.uri,
    templatingVariables: data.templating_variables || data.templatingVariables,
    panels: data.panels,
    variables: data.variables,
    tags: data.tags || [],
    usedBySut: data.used_by_sut || data.usedBySut || [],
    updated: data.updated,
    createdAt: data.created_at || data.createdAt,
    updatedAt: data.updated_at || data.updatedAt,
  };
}

export async function fetchGrafanaDashboards(query?: GrafanaDashboardQuery): Promise<GrafanaDashboard[]> {
  const searchParams = new URLSearchParams();
  if (query?.grafanaInstanceId) searchParams.append('grafanaInstanceId', query.grafanaInstanceId);
  if (query?.name) searchParams.append('name', query.name);
  if (query?.uid) searchParams.append('uid', query.uid);
  if (query?.tags && query.tags.length > 0) searchParams.append('tags', query.tags.join(','));
  if (query?.usedBySut) searchParams.append('usedBySut', query.usedBySut);

  const url = `/grafana/dashboards${searchParams.toString() ? `?${searchParams}` : ''}`;

  const response = await authenticatedFetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Grafana dashboards: ${response.statusText}`);
  }

  const data = await response.json();
  return data.map(transformGrafanaDashboard);
}

export async function fetchGrafanaDashboard(id: string): Promise<GrafanaDashboard> {
  const response = await authenticatedFetch(`/grafana/dashboards/${id}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Grafana dashboard: ${response.statusText}`);
  }

  const data = await response.json();
  return transformGrafanaDashboard(data);
}

export async function deleteGrafanaDashboard(id: string): Promise<void> {
  const response = await authenticatedFetch(`/grafana/dashboards/${id}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to delete Grafana dashboard: ${response.statusText}`);
  }
}
