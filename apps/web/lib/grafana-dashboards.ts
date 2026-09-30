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
 * One row of `GET /grafana/dashboards` as the API sends it: snake_case, `panels` included.
 * Deliberately NOT the camelCase `GrafanaDashboard` above — the panel-reading callers want
 * the raw payload, and `transformGrafanaDashboard` would only cost a pass. Named rather
 * than `Record<string, unknown>` so a camelCase typo (`grafanaInstanceId`) is a compile
 * error instead of a silent `undefined`.
 */
export interface GrafanaDashboardRow {
  id?: string;
  uid?: string;
  name?: string;
  grafana_instance_id?: string;
  /** Panel shape varies by caller; narrow this, never the row. */
  panels?: unknown[];
}

/** Warn once per uid: this is called per dashboard, per cascade render. */
const ambiguousUidsWarned = new Set<string>();

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
 * It also warns when a SCOPED lookup finds nothing, which means the row's instance id and
 * the dashboard's do not agree — otherwise that surfaces only as an empty panel dropdown.
 */
export async function fetchGrafanaDashboardByUid(
  uid: string,
  grafanaInstanceId?: string,
): Promise<GrafanaDashboardRow | null> {
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
  const rows: GrafanaDashboardRow[] = Array.isArray(data) ? data : data ? [data] : [];

  if (rows.length > 1 && !grafanaInstanceId && !ambiguousUidsWarned.has(uid)) {
    ambiguousUidsWarned.add(uid);
    console.warn(
      `Ambiguous Grafana dashboard uid "${uid}": ${rows.length} rows across instances ` +
        `[${rows.map((r) => r.grafana_instance_id).join(', ')}]. ` +
        `Using the first. Pass grafanaInstanceId to resolve this.`,
    );
  }

  if (rows.length === 0 && grafanaInstanceId) {
    // The scoped query matched nothing, so the application dashboard's instance id and the
    // Grafana dashboard's disagree. Callers degrade to an empty panel list, which on its own
    // looks like "this dashboard has no supported panels".
    console.warn(
      `No Grafana dashboard "${uid}" on instance ${grafanaInstanceId}. ` +
        `The application dashboard's instance id may be stale.`,
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
