import { authenticatedFetch } from './api';

/**
 * Profile interface matching the backend response
 */
export interface Profile {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  readOnly?: boolean;
  dashboardCount: number;
  sloCount: number;
  deepLinksCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Dashboard variable interface
 */
export interface DashboardVariable {
  name: string;
  values: string[];
}

/**
 * Profile dashboard interface matching the backend response
 */
export interface ProfileDashboard {
  id: string;
  profile: string;
  dashboardName: string;
  dashboardUid: string;
  grafanaLabel: string;
  tags?: string[];
  createSeparateDashboardForVariable?: string;
  setHardcodedValueForVariables?: DashboardVariable[];
  matchRegexForVariables?: Record<string, string>;
  readOnly?: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Fetches all profiles from the API
 * @returns Promise<Profile[]> Array of profiles
 * @throws Error if the request fails
 */
export async function fetchProfiles(organizationId?: string): Promise<Profile[]> {
  const url = organizationId
    ? `/profiles?organizationId=${encodeURIComponent(organizationId)}`
    : `/profiles`;
  const response = await authenticatedFetch(url, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Failed to fetch profiles');
  }

  return response.json();
}

/**
 * Fetches a single profile by ID
 * @param id - Profile UUID
 * @returns Promise<Profile> The profile
 * @throws Error if the profile is not found or request fails
 */
export async function fetchProfile(id: string): Promise<Profile> {
  const response = await authenticatedFetch(`/profiles/${id}`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch profile');
  }

  return response.json();
}

/**
 * Fetches all dashboards for a profile
 * @param profileId - Profile UUID
 * @returns Promise<ProfileDashboard[]> Array of dashboards
 * @throws Error if the request fails
 */
export async function fetchProfileDashboards(profileId: string): Promise<ProfileDashboard[]> {
  const response = await authenticatedFetch(`/profiles/${profileId}/dashboards`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch profile dashboards');
  }

  return response.json();
}

/**
 * Data for creating a profile dashboard
 */
export interface CreateProfileDashboardData {
  dashboardUid: string;
  grafanaLabel: string;
  createSeparateDashboardForVariable?: string;
  setHardcodedValueForVariables?: DashboardVariable[];
  matchRegexForVariables?: Record<string, string>;
  readOnly?: boolean;
}

/**
 * Data for updating a profile dashboard
 */
export interface UpdateProfileDashboardData {
  dashboardUid?: string;
  grafanaLabel?: string;
  createSeparateDashboardForVariable?: string;
  setHardcodedValueForVariables?: DashboardVariable[];
  matchRegexForVariables?: Record<string, string>;
  readOnly?: boolean;
}

/**
 * Creates a new dashboard association for a profile
 * @param profileId - Profile UUID
 * @param data - Dashboard creation data
 * @returns Promise<ProfileDashboard> The created dashboard
 * @throws Error if the request fails
 */
export async function createProfileDashboard(
  profileId: string,
  data: CreateProfileDashboardData
): Promise<ProfileDashboard> {
  const response = await authenticatedFetch(`/profiles/${profileId}/dashboards`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to create profile dashboard');
  }

  return response.json();
}

/**
 * Updates a dashboard association for a profile
 * @param profileId - Profile UUID
 * @param dashboardId - Dashboard association UUID
 * @param data - Dashboard update data
 * @returns Promise<ProfileDashboard> The updated dashboard
 * @throws Error if the request fails
 */
export async function updateProfileDashboard(
  profileId: string,
  dashboardId: string,
  data: UpdateProfileDashboardData
): Promise<ProfileDashboard> {
  const response = await authenticatedFetch(`/profiles/${profileId}/dashboards/${dashboardId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to update profile dashboard');
  }

  return response.json();
}

/**
 * Deletes a dashboard association from a profile
 * @param profileId - Profile UUID
 * @param dashboardId - Dashboard association UUID
 * @returns Promise<void>
 * @throws Error if the request fails
 */
export async function deleteProfileDashboard(
  profileId: string,
  dashboardId: string
): Promise<void> {
  const response = await authenticatedFetch(`/profiles/${profileId}/dashboards/${dashboardId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to delete profile dashboard');
  }
}

/**
 * Data for creating a profile
 */
export interface CreateProfileData {
  name: string;
  description?: string;
  tags?: string[];
}

/**
 * Data for updating a profile
 */
export interface UpdateProfileData {
  name?: string;
  description?: string;
  tags?: string[];
}

/**
 * Creates a new profile
 */
export async function createProfile(data: CreateProfileData): Promise<Profile> {
  const response = await authenticatedFetch('/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to create profile');
  }

  return response.json();
}

/**
 * Updates an existing profile
 */
export async function updateProfile(id: string, data: UpdateProfileData): Promise<Profile> {
  const response = await authenticatedFetch(`/profiles/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to update profile');
  }

  return response.json();
}

/**
 * Deletes a profile
 */
export async function deleteProfile(id: string): Promise<void> {
  const response = await authenticatedFetch(`/profiles/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to delete profile');
  }
}
