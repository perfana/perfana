/**
 * Series grouping API client.
 *
 * One function per route of `apps/api/src/modules/series-grouping` (rules CRUD, preview, apply,
 * and the two per-run reads). Every call goes through `authenticatedFetch`, and a refusal throws
 * the server's own sentence (`serverErrorMessage`): a 400 for an unsafe pattern or a 409 for an
 * occupied slot is only useful with the reason the API gave.
 *
 * The regex itself never travels: the preview returns raw series names and the caller groups
 * them with `applySeriesGrouping` from `@perfana/shared/utils`, the same function the worker uses.
 */

import type {
  SeriesGroupingAggregation,
  SeriesGroupingPreset,
  SeriesGroupingRuleSpec,
} from '@perfana/shared/utils';
import { authenticatedFetch } from '@/lib/api';
import { serverErrorMessage } from '@/lib/errors';

export type SeriesGroupingRuleOrigin = 'manual' | 'suggestion' | 'copy';

export interface SeriesGroupingRuleResponse {
  id: string;
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
  applicationDashboardId: string;
  /** null = every panel on the dashboard; a panel rule overrides it. */
  panelId: number | null;
  preset: SeriesGroupingPreset;
  pattern: string | null;
  replacement: string;
  aggregation: SeriesGroupingAggregation;
  trackMemberCount: boolean;
  enabled: boolean;
  origin: SeriesGroupingRuleOrigin;
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SeriesGroupingCopyTarget {
  testEnvironment: string;
  workload: string;
}

export interface CreateSeriesGroupingRuleParams extends SeriesGroupingRuleSpec {
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
  applicationDashboardId: string;
  panelId?: number | null;
  enabled?: boolean;
  origin?: 'manual' | 'suggestion';
  copyTo?: SeriesGroupingCopyTarget[];
}

/** The slot (system, environment, workload, dashboard, panel) cannot change; re-scoping is delete + create. */
export type UpdateSeriesGroupingRuleParams = Partial<SeriesGroupingRuleSpec> & { enabled?: boolean };

export type SeriesGroupingCopySkipReason =
  | 'exists'
  | 'no-dashboard'
  | 'ambiguous-dashboard'
  | 'unknown-workload'
  | 'not-writable'
  | 'same-slot';

export interface SeriesGroupingCopySkip extends SeriesGroupingCopyTarget {
  reason: SeriesGroupingCopySkipReason;
}

export interface SeriesGroupingCreateResult {
  rule: SeriesGroupingRuleResponse;
  copies: { created: SeriesGroupingRuleResponse[]; skipped: SeriesGroupingCopySkip[] };
}

export interface SeriesGroupingPreviewParams {
  /** The run to preview against. Omit it and name systemId + environment + workload instead to use the workload's latest completed run. */
  testRunId?: string;
  systemId?: string;
  environment?: string;
  workload?: string;
  applicationDashboardId: string;
  panelId?: number | null;
  rule: SeriesGroupingRuleSpec;
}

export interface SeriesGroupingPreviewPanel {
  panelId: number;
  panelTitle: string | null;
  /** Raw series names of the run, sorted. */
  currentNames: string[];
  /** Raw series names of the baseline runs, sorted and de-duplicated. */
  baselineNames: string[];
}

export interface SeriesGroupingSloWarning {
  benchmarkId: string;
  name: string;
  matchPattern: string;
}

export interface SeriesGroupingAlignment {
  panelId: number;
  group: string;
  members: number;
  avgMembers: number;
}

export interface SeriesGroupingPreview {
  testRunId: string;
  baselineRunIds: string[];
  panels: SeriesGroupingPreviewPanel[];
  sloWarnings: SeriesGroupingSloWarning[];
  rawNameCollisions: string[];
  alignment: SeriesGroupingAlignment[];
}

export interface SeriesGroupingSuggestion {
  applicationDashboardId: string;
  dashboardLabel: string | null;
  panelId: number;
  panelTitle: string | null;
  incomparableCount: number;
  preset: Exclude<SeriesGroupingPreset, 'custom'>;
  /** Fraction 0..1 of the run's names the baseline already has. */
  matchedBefore: number;
  /** Fraction 0..1 of the run's groups the baseline has, after the preset. */
  matchedAfter: number;
}

export type SeriesGroupingStaleReason = 'not-applied' | 'rule-changed' | 'rule-removed';

export interface SeriesGroupingStatus {
  stale: { applicationDashboardId: string; panelId: number; reason: SeriesGroupingStaleReason }[];
  misaligned: {
    applicationDashboardId: string;
    panelId: number;
    group: string;
    members: number;
    avgMembers: number;
  }[];
}

export type SeriesGroupingApplyScope = 'baseline' | 'recent';

export interface SeriesGroupingApplyResult {
  /** Canonical `test_run_id`s handed to the re-evaluate batch. */
  enqueued: string[];
  skipped: { testRunId: string; completed: boolean; skipped?: 'running' | 'too-short' | 'not-writable' }[];
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    throw new Error(await serverErrorMessage(response, `${fallback} (${response.status})`));
  }
  return (await response.json()) as T;
}

export interface ListSeriesGroupingRulesParams {
  systemId: string;
  environment?: string;
  workload?: string;
  applicationDashboardId?: string;
}

export async function listRules(params: ListSeriesGroupingRulesParams): Promise<SeriesGroupingRuleResponse[]> {
  const query = new URLSearchParams({ systemId: params.systemId });
  if (params.environment) query.set('environment', params.environment);
  if (params.workload) query.set('workload', params.workload);
  if (params.applicationDashboardId) query.set('applicationDashboardId', params.applicationDashboardId);
  const response = await authenticatedFetch(`/series-grouping-rules?${query.toString()}`);
  return readJson(response, 'Failed to load series grouping rules');
}

export async function createRule(params: CreateSeriesGroupingRuleParams): Promise<SeriesGroupingCreateResult> {
  const response = await authenticatedFetch('/series-grouping-rules', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(params),
  });
  return readJson(response, 'Failed to create the series grouping rule');
}

export async function updateRule(
  id: string,
  patch: UpdateSeriesGroupingRuleParams,
): Promise<SeriesGroupingRuleResponse> {
  const response = await authenticatedFetch(`/series-grouping-rules/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
  });
  return readJson(response, 'Failed to update the series grouping rule');
}

export async function deleteRule(id: string): Promise<void> {
  const response = await authenticatedFetch(`/series-grouping-rules/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(
      await serverErrorMessage(response, `Failed to delete the series grouping rule (${response.status})`),
    );
  }
}

export async function previewRule(params: SeriesGroupingPreviewParams): Promise<SeriesGroupingPreview> {
  const response = await authenticatedFetch('/series-grouping-rules/preview', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(params),
  });
  return readJson(response, 'Failed to load the series grouping preview');
}

export async function applyRules(params: {
  testRunId: string;
  scope: SeriesGroupingApplyScope;
}): Promise<SeriesGroupingApplyResult> {
  const response = await authenticatedFetch('/series-grouping-rules/apply', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(params),
  });
  return readJson(response, 'Failed to recalculate statistics');
}

export async function fetchSuggestions(testRunId: string): Promise<SeriesGroupingSuggestion[]> {
  const response = await authenticatedFetch(
    `/test-runs/${encodeURIComponent(testRunId)}/series-grouping-suggestions`,
  );
  return readJson(response, 'Failed to load series grouping suggestions');
}

export async function fetchStatus(testRunId: string): Promise<SeriesGroupingStatus> {
  const response = await authenticatedFetch(`/test-runs/${encodeURIComponent(testRunId)}/series-grouping-status`);
  return readJson(response, 'Failed to load series grouping status');
}
