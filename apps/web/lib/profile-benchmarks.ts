import { authenticatedFetch } from './api';
import { ProfileDashboard } from './profiles';
import {
  PERF_TEST_PROFILE_SOURCE,
  PERF_TEST_DASHBOARD_UID_PATTERN_DEFAULT,
  DYNATRACE_HOSTS_PROFILE_SOURCE,
  DYNATRACE_HOST_DASHBOARD_UID_PATTERN_DEFAULT,
  SPLUNK_PROFILE_SOURCE,
  SPLUNK_DASHBOARD_UID_PATTERN_DEFAULT,
} from '@perfana/shared/constants';

/**
 * Synthetic dropdown entry for an SLO on the worker-written `Performance test metrics
 * <scenario>` dashboards. Not a `profile_grafana_dashboards` row: the benchmark is stored
 * with `source = 'performance-metrics'`, no profile dashboard, and `dashboardUid` holding the
 * uid regex grafana-sync fans out over.
 */
export const PERF_TEST_PROFILE_DASHBOARD: ProfileDashboard = {
  id: PERF_TEST_PROFILE_SOURCE,
  profile: '',
  dashboardName: 'Performance test metrics — every scenario',
  dashboardUid: PERF_TEST_DASHBOARD_UID_PATTERN_DEFAULT,
  grafanaLabel: 'Perfana',
  createdAt: '',
  updatedAt: '',
};

export const isPerfTestProfileDashboard = (d: ProfileDashboard | null): boolean =>
  d?.id === PERF_TEST_PROFILE_DASHBOARD.id;

/**
 * Synthetic dropdown entry for an SLO on every mapped Dynatrace host — the Dynatrace twin of
 * PERF_TEST_PROFILE_DASHBOARD. Stored with `source = 'dynatrace-hosts'`, no profile dashboard,
 * and `dashboardUid` holding the regex over the `dynatrace-dynatrace-host-metrics-<host>` uids
 * that grafana-sync fans out over.
 */
export const DYNATRACE_HOSTS_PROFILE_DASHBOARD: ProfileDashboard = {
  id: DYNATRACE_HOSTS_PROFILE_SOURCE,
  profile: '',
  dashboardName: 'Dynatrace — all hosts',
  dashboardUid: DYNATRACE_HOST_DASHBOARD_UID_PATTERN_DEFAULT,
  grafanaLabel: 'Dynatrace',
  createdAt: '',
  updatedAt: '',
};

export const isDynatraceHostsProfileDashboard = (d: ProfileDashboard | null): boolean =>
  d?.id === DYNATRACE_HOSTS_PROFILE_DASHBOARD.id;

/**
 * Synthetic dropdown entry for an SLO on every Splunk dashboard — the Splunk twin of
 * DYNATRACE_HOSTS_PROFILE_DASHBOARD. Stored with `source = 'splunk-panels'`, no profile
 * dashboard, `dashboardUid` holding the regex over the `splunk-<label>` uids, and keyed on the
 * panel TITLE: Splunk panels are user-authored and their ids are assigned per workload.
 */
export const SPLUNK_PROFILE_DASHBOARD: ProfileDashboard = {
  id: SPLUNK_PROFILE_SOURCE,
  profile: '',
  dashboardName: 'Splunk — all panels',
  dashboardUid: SPLUNK_DASHBOARD_UID_PATTERN_DEFAULT,
  grafanaLabel: 'Splunk',
  createdAt: '',
  updatedAt: '',
};

export const isSplunkProfileDashboard = (d: ProfileDashboard | null): boolean =>
  d?.id === SPLUNK_PROFILE_DASHBOARD.id;

/** Any pseudo-dashboard: a uid regex over generated dashboards, no Grafana template behind it. */
export const isPatternProfileDashboard = (d: ProfileDashboard | null): boolean =>
  isPerfTestProfileDashboard(d) || isDynatraceHostsProfileDashboard(d) || isSplunkProfileDashboard(d);

/** Which integrations are configured, for offering the pseudo-dashboards that depend on one. */
export interface ConfiguredIntegrations {
  dynatrace: boolean;
  splunk: boolean;
}

/**
 * The pseudo-dashboards the profile SLO form offers. "Every scenario" needs nothing; the host
 * and Splunk entries only when that integration is configured. The entry `selected` is always
 * kept, so editing an SLO whose integration was since removed still shows what it targets.
 */
export function availablePseudoDashboards(
  integrations: ConfiguredIntegrations,
  selected?: ProfileDashboard | null,
): ProfileDashboard[] {
  return [
    PERF_TEST_PROFILE_DASHBOARD,
    ...(integrations.dynatrace || isDynatraceHostsProfileDashboard(selected ?? null) ? [DYNATRACE_HOSTS_PROFILE_DASHBOARD] : []),
    ...(integrations.splunk || isSplunkProfileDashboard(selected ?? null) ? [SPLUNK_PROFILE_DASHBOARD] : []),
  ];
}


/**
 * Profile benchmark interface matching the backend response
 */
export interface ProfileBenchmark {
  id: string;
  profileId: string;
  profileDashboardId: string | null;
  workloadPattern: string;
  source: string;
  grafanaInstance?: string;
  dashboardUid?: string;
  panelId?: number;
  panelTitle?: string;
  panelType?: string;
  panelDescription?: string;
  evaluateType?: string;
  metricUnit?: string;
  requirementOperator?: string;
  requirementValue?: number;
  excludeRampUpTime: boolean;
  averageAll: boolean;
  matchPattern?: string;
  validateWithDefaultIfNoData: boolean;
  validateWithDefaultIfNoDataValue?: number;
  tags: string[];
  metadata: Record<string, unknown>;
  readOnly?: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Data for creating a profile benchmark (SLO)
 */
export interface CreateProfileBenchmarkData {
  profileDashboardId?: string;
  workloadPattern?: string;
  source?: string;
  grafanaInstance?: string;
  dashboardUid?: string;
  panelId?: number;
  panelTitle?: string;
  panelType?: string;
  panelDescription?: string;
  evaluateType?: string;
  metricUnit?: string;
  requirementOperator?: string;
  requirementValue?: number;
  excludeRampUpTime?: boolean;
  averageAll?: boolean;
  matchPattern?: string;
  validateWithDefaultIfNoData?: boolean;
  validateWithDefaultIfNoDataValue?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Data for updating a profile benchmark (all fields optional)
 */
export interface UpdateProfileBenchmarkData extends Partial<CreateProfileBenchmarkData> {}

/**
 * Fetches all benchmarks (SLOs) for a profile
 * @param profileId - Profile UUID
 * @returns Promise<ProfileBenchmark[]> Array of benchmarks
 * @throws Error if the request fails
 */
export async function fetchProfileBenchmarks(profileId: string): Promise<ProfileBenchmark[]> {
  const response = await authenticatedFetch(`/profiles/${profileId}/benchmarks`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch profile benchmarks');
  }

  return response.json();
}

/**
 * Creates a new benchmark (SLO) for a profile
 * @param profileId - Profile UUID
 * @param data - Benchmark creation data
 * @returns Promise<ProfileBenchmark> The created benchmark
 * @throws Error if the request fails
 */
export async function createProfileBenchmark(
  profileId: string,
  data: CreateProfileBenchmarkData
): Promise<ProfileBenchmark> {
  const response = await authenticatedFetch(`/profiles/${profileId}/benchmarks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to create profile benchmark');
  }

  return response.json();
}

/**
 * Updates a benchmark (SLO) for a profile
 * @param profileId - Profile UUID
 * @param benchmarkId - Benchmark UUID
 * @param data - Benchmark update data
 * @returns Promise<ProfileBenchmark> The updated benchmark
 * @throws Error if the request fails
 */
export async function updateProfileBenchmark(
  profileId: string,
  benchmarkId: string,
  data: UpdateProfileBenchmarkData
): Promise<ProfileBenchmark> {
  const response = await authenticatedFetch(`/profiles/${profileId}/benchmarks/${benchmarkId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to update profile benchmark');
  }

  return response.json();
}

/**
 * Deletes a benchmark (SLO) from a profile
 * @param profileId - Profile UUID
 * @param benchmarkId - Benchmark UUID
 * @returns Promise<void>
 * @throws Error if the request fails
 */
export async function deleteProfileBenchmark(
  profileId: string,
  benchmarkId: string
): Promise<void> {
  const response = await authenticatedFetch(`/profiles/${profileId}/benchmarks/${benchmarkId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to delete profile benchmark');
  }
}
