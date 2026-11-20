// Splunk integration API client. Spec: docs/reference/Features/Splunk Log Metrics (spec).md

import { authenticatedFetch } from './api';

export const SPLUNK_MASK = '[MASKED]';

export interface SplunkConfig {
  id: string;
  label: string;
  host: string;
  clientUrl: string | null;
  /** '[MASKED]' when set, null when not. Send the mask back unchanged to keep it. */
  apiToken: string | null;
  username: string | null;
  password: string | null;
  splunkApp: string;
  verifyTls: boolean;
  useProxy: boolean;
  maxConcurrentSearches: number;
  organizationId: string;
}

export type SplunkConfigInput = Partial<Omit<SplunkConfig, 'id' | 'organizationId'>> & {
  label?: string;
  host?: string;
  organizationId?: string;
};

export interface SplunkDiscoveredSource {
  index: string;
  sourcetype: string;
  host: string;
  count: number;
}

export type SplunkMappingLevel = 'sut' | 'environment' | 'workload';

export interface SplunkEntityMapping {
  id: string;
  splunkConfigId: string;
  systemUnderTestId: string;
  testEnvironment: string | null;
  workload: string | null;
  level: SplunkMappingLevel;
  indexName: string;
  sourcetype: string | null;
  hostPattern: string | null;
  labels: string[];
}

export interface SplunkQuery {
  id: string;
  splunkConfigId: string;
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
  dashboardLabel: string;
  panelTitle: string;
  panelId: number;
  spl: string;
  splitBy: string | null;
  aggregation: string;
  metricUnit: string;
  maxSeries: number;
  enabled: boolean;
}

export interface SplunkScope {
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
}

export interface SplunkPreview {
  search: string | null;
  bucketSeconds?: number;
  series: Array<{ name: string; total: number }>;
  points?: number;
  fields: Array<{ field: string; distinctCount: number; values: string[] }>;
  message?: string;
}

/** The API's own message (a 400/409 says what to fix), falling back to the status text. */
async function errorOf(res: Response, fallback: string): Promise<Error> {
  try {
    const body = (await res.json()) as { message?: string | string[] };
    const msg = Array.isArray(body.message) ? body.message.join('; ') : body.message;
    return new Error(msg || `${fallback}: ${res.statusText}`);
  } catch {
    return new Error(`${fallback}: ${res.statusText}`);
  }
}

async function call<T>(url: string, fallback: string, init: RequestInit = {}): Promise<T> {
  const res = await authenticatedFetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) throw await errorOf(res, fallback);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

// --- connections -------------------------------------------------------------

export const fetchSplunkConfigs = () => call<SplunkConfig[]>('/splunk/configs', 'Failed to fetch Splunk connections');

export const createSplunkConfig = (input: SplunkConfigInput) =>
  call<SplunkConfig>('/splunk/configs', 'Failed to create the Splunk connection', { method: 'POST', ...json(input) });

export const updateSplunkConfig = (id: string, input: SplunkConfigInput) =>
  call<SplunkConfig>(`/splunk/configs/${id}`, 'Failed to update the Splunk connection', { method: 'PATCH', ...json(input) });

export const deleteSplunkConfig = (id: string) =>
  call<void>(`/splunk/configs/${id}`, 'Failed to delete the Splunk connection', { method: 'DELETE' });

export const testSplunkConnection = (input: { host: string; apiToken?: string; username?: string; password?: string; useProxy?: boolean; organizationId?: string }) =>
  call<{ success: boolean; message: string }>('/splunk/configs/test-connection', 'Connection test failed', { method: 'POST', ...json(input) });

export const testSavedSplunkConnection = (id: string) =>
  call<{ success: boolean; message: string }>(`/splunk/configs/${id}/test-connection`, 'Connection test failed', { method: 'POST' });

export const discoverSplunkSources = (id: string, hours = 24, refresh = false) =>
  call<SplunkDiscoveredSource[]>(
    `/splunk/configs/${id}/sources?hours=${hours}${refresh ? '&refresh=true' : ''}`,
    'Failed to list Splunk sources',
  );

// --- mappings ----------------------------------------------------------------

export function fetchSplunkMappings(systemId: string, environment?: string, workload?: string) {
  const p = new URLSearchParams({ systemId });
  if (environment) p.set('environment', environment);
  if (workload) p.set('workload', workload);
  return call<SplunkEntityMapping[]>(`/splunk/entities/mappings?${p}`, 'Failed to fetch Splunk mappings');
}

export const createSplunkMapping = (input: Omit<SplunkEntityMapping, 'id'>) =>
  call<SplunkEntityMapping>('/splunk/entities/mappings', 'Failed to map the Splunk source', { method: 'POST', ...json(input) });

export const deleteSplunkMapping = (id: string) =>
  call<void>(`/splunk/entities/mappings/${id}`, 'Failed to remove the Splunk mapping', { method: 'DELETE' });

// --- queries -----------------------------------------------------------------

export function fetchSplunkQueries(scope: SplunkScope) {
  const p = new URLSearchParams({ systemId: scope.systemUnderTestId, environment: scope.testEnvironment, workload: scope.workload });
  return call<SplunkQuery[]>(`/splunk/queries?${p}`, 'Failed to fetch Splunk panels');
}

/** Distinct Splunk panel titles in the caller's organizations plus the starter panels (profile SLO picker). */
export const fetchSplunkPanelTitles = () =>
  call<Array<{ panelTitle: string; metricUnit: string }>>('/splunk/queries/panel-titles', 'Failed to fetch Splunk panel titles');

export type SplunkQueryInput = SplunkScope & {
  splunkConfigId: string;
  /** Create only; defaults to "Splunk logs" on the API. */
  dashboardLabel?: string;
  panelTitle: string;
  spl: string;
  splitBy?: string | null;
  aggregation?: string;
  metricUnit?: string;
  maxSeries?: number;
  enabled?: boolean;
};

export const createSplunkQuery = (input: SplunkQueryInput) =>
  call<SplunkQuery>('/splunk/queries', 'Failed to create the Splunk panel', { method: 'POST', ...json(input) });

export const createSplunkStarterQueries = (input: SplunkScope & { splunkConfigId: string; levelField?: string }) =>
  call<SplunkQuery[]>('/splunk/queries/starter', 'Failed to create the starter panels', { method: 'POST', ...json(input) });

export const updateSplunkQuery = (id: string, input: Partial<Omit<SplunkQueryInput, keyof SplunkScope | 'splunkConfigId' | 'dashboardLabel'>>) =>
  call<SplunkQuery>(`/splunk/queries/${id}`, 'Failed to update the Splunk panel', { method: 'PATCH', ...json(input) });

export const deleteSplunkQuery = (id: string) =>
  call<void>(`/splunk/queries/${id}`, 'Failed to delete the Splunk panel', { method: 'DELETE' });

export const previewSplunkQuery = (
  input: SplunkScope & { splunkConfigId: string; spl: string; splitBy?: string | null; aggregation?: string; maxSeries?: number; minutes?: number },
) => call<SplunkPreview>('/splunk/queries/preview', 'Preview failed', { method: 'POST', ...json(input) });

// --- tree --------------------------------------------------------------------

export interface SourceTreeIndex {
  index: string;
  count: number;
  sourcetypes: Array<{ sourcetype: string; count: number; hosts: Array<{ host: string; count: number }> }>;
}

/** index -> sourcetype -> host, each level ordered by event count. */
export function buildSourceTree(sources: SplunkDiscoveredSource[]): SourceTreeIndex[] {
  const byIndex = new Map<string, Map<string, Array<{ host: string; count: number }>>>();
  for (const s of sources) {
    const st = byIndex.get(s.index) ?? new Map<string, Array<{ host: string; count: number }>>();
    st.set(s.sourcetype, [...(st.get(s.sourcetype) ?? []), { host: s.host, count: s.count }]);
    byIndex.set(s.index, st);
  }
  const sum = (xs: Array<{ count: number }>) => xs.reduce((n, x) => n + x.count, 0);
  return [...byIndex.entries()]
    .map(([index, st]) => {
      const sourcetypes = [...st.entries()]
        .map(([sourcetype, hosts]) => ({ sourcetype, count: sum(hosts), hosts: [...hosts].sort((a, b) => b.count - a.count) }))
        .sort((a, b) => b.count - a.count);
      return { index, count: sum(sourcetypes), sourcetypes };
    })
    .sort((a, b) => b.count - a.count);
}

/** Label for a mapping row: what it reads, in Splunk's own terms. */
export function describeMapping(m: Pick<SplunkEntityMapping, 'indexName' | 'sourcetype' | 'hostPattern'>): string {
  return [`index=${m.indexName}`, m.sourcetype && `sourcetype=${m.sourcetype}`, m.hostPattern && `host=${m.hostPattern}`]
    .filter(Boolean)
    .join(' ');
}

// --- test run card -------------------------------------------------------------

export interface SplunkRunPanel {
  panelId: number;
  /** The artificial dashboard this panel's series are stored under in ds_metrics. */
  dashboardLabel: string;
  title: string;
  aggregation: string;
  splitBy: string | null;
  unit: string;
  series: Array<{ name: string; mean: number | null; peak: number | null; total: number | null }>;
  /** This panel's search as a Splunk Web timechart over the run, or null when it cannot be built. */
  link: string | null;
}

export type SplunkRunSummary =
  | { configured: false }
  | {
      configured: true;
      connection: { id: string; label: string } | null;
      sources: Array<Pick<SplunkEntityMapping, 'id' | 'level' | 'indexName' | 'sourcetype' | 'hostPattern' | 'labels'>>;
      openInSplunk: string | null;
      window: { from: string; to: string } | null;
      panels: SplunkRunPanel[];
    };

export const fetchSplunkRunSummary = (testRunId: string) =>
  call<SplunkRunSummary>(`/splunk/runs/${encodeURIComponent(testRunId)}/summary`, 'Failed to load the Splunk summary');
