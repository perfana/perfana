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
  templatingVariables?: unknown[];
  panels?: unknown[];
  variables?: unknown[];
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
function transformGrafanaDashboard(data: unknown): GrafanaDashboard {
  const typedData = data as Record<string, unknown>;
  return {
    id: typedData.id as string,
    grafanaInstanceId: (typedData.grafana_instance_id || typedData.grafanaInstanceId) as string,
    grafanaId: (typedData.grafana_id || typedData.grafanaId) as number,
    datasourceType: (typedData.datasource_type || typedData.datasourceType) as string | undefined,
    uid: typedData.uid as string,
    slug: typedData.slug as string | undefined,
    name: typedData.name as string,
    uri: typedData.uri as string | undefined,
    templatingVariables: (typedData.templating_variables || typedData.templatingVariables) as unknown[] | undefined,
    panels: typedData.panels as unknown[] | undefined,
    variables: typedData.variables as unknown[] | undefined,
    tags: (typedData.tags || []) as string[],
    usedBySut: (typedData.used_by_sut || typedData.usedBySut || []) as string[],
    updated: typedData.updated as string | undefined,
    createdAt: (typedData.created_at || typedData.createdAt) as string,
    updatedAt: (typedData.updated_at || typedData.updatedAt) as string,
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

/**
 * Resolve ONE Grafana dashboard by uid.
 *
 * A dashboard uid is unique only WITHIN a Grafana instance — the same uid routinely exists
 * on a dev and a prod Grafana with different panel sets and panel ids — and
 * `GET /grafana/dashboards?uid=` applies no instance scope, so it answers with an array
 * ordered by name, which ties for copies of one dashboard. Every caller used to take
 * `[0]`, which silently bound SLOs and graph presets to another instance's panel ids.
 *
 * Pass `grafanaInstanceId` whenever it is in hand — an `ApplicationDashboard` carries it.
 * Without it the answer is a guess, so this says so in the console rather than hiding it.
 * Returns the raw API row (snake_case, `panels` included), not the camelCase
 * `GrafanaDashboard` — the panel-reading callers want the payload as the API sends it.
 */
export async function fetchGrafanaDashboardByUid(
  uid: string,
  grafanaInstanceId?: string,
): Promise<Record<string, unknown> | null> {
  const params = new URLSearchParams({ uid });
  if (grafanaInstanceId) params.set('grafanaInstanceId', grafanaInstanceId);

  const response = await authenticatedFetch(`/grafana/dashboards?${params.toString()}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Grafana dashboard ${uid}: ${response.statusText}`);
  }

  const data = await response.json();
  const rows: Record<string, unknown>[] = Array.isArray(data) ? data : data ? [data] : [];

  if (rows.length > 1 && !grafanaInstanceId) {
    console.warn(
      `Ambiguous Grafana dashboard uid "${uid}": ${rows.length} rows across instances ` +
        `[${rows.map((r) => r.grafana_instance_id ?? r.grafanaInstanceId).join(', ')}]. ` +
        `Using the first. Pass grafanaInstanceId to resolve this.`,
    );
  }

  return rows[0] ?? null;
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
