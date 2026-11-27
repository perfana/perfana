// Loki integration API client. Spec: docs/reference/Features/Loki Log Metrics (spec).md
//
// Loki is reached through a Grafana instance Perfana already has: a connection is a Loki
// datasource on that instance, and every query goes through the instance's credentials.

import { authenticatedFetch } from './api';
import type { LokiMatcher, LokiMatcherOp } from '@perfana/shared/services/loki/client';

export type { LokiMatcher, LokiMatcherOp };
export { LOKI_MATCHER_OPS, validateMatchers, validateLogqlPipeline, buildStreamSelector } from '@perfana/shared/services/loki/client';

export interface LokiConfig {
  id: string;
  label: string;
  grafanaInstanceId: string;
  grafanaInstanceLabel: string | null;
  grafanaClientUrl: string | null;
  datasourceUid: string;
  datasourceName: string | null;
  levelLabel: string;
  maxConcurrentQueries: number;
  organizationId: string;
}

export interface LokiConfigInput {
  label?: string;
  grafanaInstanceId?: string;
  datasourceUid?: string;
  datasourceName?: string | null;
  levelLabel?: string;
  maxConcurrentQueries?: number;
}

export interface LokiDatasource {
  uid: string;
  name: string;
  isDefault: boolean;
}

export type LokiMappingLevel = 'sut' | 'environment' | 'workload';

export interface LokiStreamMapping {
  id: string;
  lokiConfigId: string;
  systemUnderTestId: string;
  testEnvironment: string | null;
  workload: string | null;
  level: LokiMappingLevel;
  matchers: LokiMatcher[];
  selector: string;
  labels: string[];
}

export interface LokiQuery {
  id: string;
  lokiConfigId: string;
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
  dashboardLabel: string;
  panelTitle: string;
  panelId: number;
  logql: string;
  splitBy: string | null;
  aggregation: string;
  metricUnit: string;
  maxSeries: number;
  enabled: boolean;
}

export interface LokiScope {
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
}

export interface LokiPreview {
  exprs: string[];
  bucketSeconds?: number;
  series: Array<{ name: string; total: number }>;
  points?: number;
  seriesBeforeCap?: number;
  labels: string[];
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

export const fetchLokiConfigs = () => call<LokiConfig[]>('/loki/configs', 'Failed to fetch Loki connections');

export const fetchLokiDatasources = (grafanaInstanceId: string) =>
  call<LokiDatasource[]>(`/loki/datasources?grafanaInstanceId=${encodeURIComponent(grafanaInstanceId)}`, 'Failed to list Loki datasources');

export const createLokiConfig = (input: LokiConfigInput) =>
  call<LokiConfig>('/loki/configs', 'Failed to create the Loki connection', { method: 'POST', ...json(input) });

export const updateLokiConfig = (id: string, input: Omit<LokiConfigInput, 'grafanaInstanceId'>) =>
  call<LokiConfig>(`/loki/configs/${id}`, 'Failed to update the Loki connection', { method: 'PATCH', ...json(input) });

export const deleteLokiConfig = (id: string) =>
  call<void>(`/loki/configs/${id}`, 'Failed to delete the Loki connection', { method: 'DELETE' });

export const testLokiConnection = (input: { grafanaInstanceId: string; datasourceUid: string }) =>
  call<{ success: boolean; message: string; labels?: string[] }>('/loki/configs/test-connection', 'Connection test failed', { method: 'POST', ...json(input) });

export const testSavedLokiConnection = (id: string) =>
  call<{ success: boolean; message: string; labels?: string[] }>(`/loki/configs/${id}/test-connection`, 'Connection test failed', { method: 'POST' });

export const fetchLokiLabels = (id: string, hours = 24, refresh = false) =>
  call<string[]>(`/loki/configs/${id}/labels?hours=${hours}${refresh ? '&refresh=true' : ''}`, 'Failed to list Loki labels');

export function fetchLokiLabelValues(id: string, label: string, matchers: LokiMatcher[] = [], hours = 24) {
  const p = new URLSearchParams({ hours: String(hours) });
  if (matchers.length > 0) p.set('matchers', JSON.stringify(matchers));
  return call<string[]>(`/loki/configs/${id}/labels/${encodeURIComponent(label)}/values?${p}`, 'Failed to list label values');
}

// --- mappings ----------------------------------------------------------------

export function fetchLokiMappings(systemId: string, environment?: string, workload?: string) {
  const p = new URLSearchParams({ systemId });
  if (environment) p.set('environment', environment);
  if (workload) p.set('workload', workload);
  return call<LokiStreamMapping[]>(`/loki/streams/mappings?${p}`, 'Failed to fetch Loki mappings');
}

export const createLokiMapping = (input: Omit<LokiStreamMapping, 'id' | 'selector'>) =>
  call<LokiStreamMapping>('/loki/streams/mappings', 'Failed to map the Loki streams', { method: 'POST', ...json(input) });

export const deleteLokiMapping = (id: string) =>
  call<void>(`/loki/streams/mappings/${id}`, 'Failed to remove the Loki mapping', { method: 'DELETE' });

// --- panels ------------------------------------------------------------------

export function fetchLokiQueries(scope: LokiScope) {
  const p = new URLSearchParams({ systemId: scope.systemUnderTestId, environment: scope.testEnvironment, workload: scope.workload });
  return call<LokiQuery[]>(`/loki/queries?${p}`, 'Failed to fetch Loki panels');
}

/** Distinct Loki panel titles in the caller's organizations plus the starter panels (profile SLO picker). */
export const fetchLokiPanelTitles = () =>
  call<Array<{ panelTitle: string; metricUnit: string }>>('/loki/queries/panel-titles', 'Failed to fetch Loki panel titles');

export type LokiQueryInput = LokiScope & {
  lokiConfigId: string;
  /** Create only; defaults to "Loki logs" on the API. */
  dashboardLabel?: string;
  panelTitle: string;
  logql: string;
  splitBy?: string | null;
  aggregation?: string;
  metricUnit?: string;
  maxSeries?: number;
  enabled?: boolean;
};

export const createLokiQuery = (input: LokiQueryInput) =>
  call<LokiQuery>('/loki/queries', 'Failed to create the Loki panel', { method: 'POST', ...json(input) });

export const createLokiStarterQueries = (input: LokiScope & { lokiConfigId: string; serviceLabel?: string }) =>
  call<LokiQuery[]>('/loki/queries/starter', 'Failed to create the starter panels', { method: 'POST', ...json(input) });

export const updateLokiQuery = (id: string, input: Partial<Omit<LokiQueryInput, keyof LokiScope | 'lokiConfigId' | 'dashboardLabel'>>) =>
  call<LokiQuery>(`/loki/queries/${id}`, 'Failed to update the Loki panel', { method: 'PATCH', ...json(input) });

export const deleteLokiQuery = (id: string) =>
  call<void>(`/loki/queries/${id}`, 'Failed to delete the Loki panel', { method: 'DELETE' });

export const previewLokiQuery = (
  input: LokiScope & { lokiConfigId: string; logql: string; splitBy?: string | null; aggregation?: string; maxSeries?: number; minutes?: number },
) => call<LokiPreview>('/loki/queries/preview', 'Preview failed', { method: 'POST', ...json(input) });

/** Label for a mapping row: the selector it reads. */
export function describeLokiMapping(m: Pick<LokiStreamMapping, 'selector'>): string {
  return m.selector;
}

// --- test run card -------------------------------------------------------------

export interface LokiRunPanel {
  panelId: number;
  /** The artificial dashboard this panel's series are stored under in ds_metrics. */
  dashboardLabel: string;
  title: string;
  aggregation: string;
  splitBy: string | null;
  unit: string;
  /** Split by the connection's level label and counting lines: drives the error-rate KPI. */
  isLevelPanel: boolean;
  series: Array<{ name: string; mean: number | null; peak: number | null; total: number | null }>;
  /** This panel's query in Grafana Explore over the run, or null when it cannot be built. */
  link: string | null;
}

export interface LokiRunPattern {
  pattern: string;
  level: string | null;
  count: number;
  firstSeen: string | null;
  lastSeen: string | null;
  source: 'patterns' | 'sampled' | string;
  /** Absent from every baseline run's snapshot; null when no baseline run has a snapshot. */
  isNew: boolean | null;
  exploreUrl: string | null;
}

export interface LokiRunSample {
  time: string;
  level: string | null;
  line: string;
  labels: Record<string, string>;
}

export interface LokiErrorRate {
  totalLines: number;
  errorLines: number;
  errorRatePct: number;
  baseline: { errorRatePct: number; runs: number } | null;
}

export type LokiRunSummary =
  | { configured: false }
  | {
      configured: true;
      connection: { id: string; label: string; levelLabel: string } | null;
      sources: Array<Pick<LokiStreamMapping, 'id' | 'level' | 'selector' | 'labels'> & { exploreUrl: string | null }>;
      window: { from: string; to: string } | null;
      errorRate: LokiErrorRate | null;
      panels: LokiRunPanel[];
      patterns: LokiRunPattern[];
      patternsSource: string | null;
      newPatterns: number | null;
      baselineRunCount?: number;
      samples: LokiRunSample[];
    };

export const fetchLokiRunSummary = (testRunId: string) =>
  call<LokiRunSummary>(`/loki/runs/${encodeURIComponent(testRunId)}/summary`, 'Failed to load the Loki summary');
