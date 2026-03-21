import { authenticatedFetch } from './api';

/**
 * Profile benchmark interface matching the backend response
 */
export interface ProfileBenchmark {
  id: string;
  profileId: string;
  profileDashboardId: string;
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
  metadata: Record<string, any>;
  readOnly?: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Data for creating a profile benchmark (SLO)
 */
export interface CreateProfileBenchmarkData {
  profileDashboardId: string;
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
  metadata?: Record<string, any>;
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
