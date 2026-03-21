/**
 * Teams API Client
 *
 * Client functions for team CRUD operations.
 * Uses authenticatedFetch for automatic auth header injection and token refresh.
 */

import { authenticatedFetch } from '../api';

// ==================== Type Definitions ====================

/**
 * Team entity
 */
export interface Team {
  id: string;
  name: string;
  description?: string;
  organization_id: string;
  restrict_to_team_members: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * DTO for creating a team
 */
export interface CreateTeamDto {
  name: string;
  description?: string;
  organization_id: string;
}

/**
 * DTO for updating a team
 */
export interface UpdateTeamDto {
  name?: string;
  description?: string;
  restrict_to_team_members?: boolean;
}

// ==================== API Functions ====================

/**
 * List all teams the user has access to
 */
export async function listTeams(): Promise<Team[]> {
  const response = await authenticatedFetch('teams');

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to fetch teams';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * List teams by organization
 */
export async function listTeamsByOrganization(organizationId: string): Promise<Team[]> {
  const response = await authenticatedFetch(`teams?organizationId=${encodeURIComponent(organizationId)}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to fetch teams';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Get a single team by ID
 */
export async function getTeam(id: string): Promise<Team> {
  const response = await authenticatedFetch(`teams/${id}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to fetch team';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Create a new team
 */
export async function createTeam(dto: CreateTeamDto): Promise<Team> {
  const response = await authenticatedFetch('teams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dto),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to create team';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Update an existing team
 */
export async function updateTeam(id: string, dto: UpdateTeamDto): Promise<Team> {
  const response = await authenticatedFetch(`teams/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dto),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to update team';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Delete a team
 */
export async function deleteTeam(id: string): Promise<void> {
  const response = await authenticatedFetch(`teams/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to delete team';
    throw new Error(errorMessage);
  }
}
