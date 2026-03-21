/**
 * Team Members API Client
 *
 * Client functions for team member management operations.
 * Uses authenticatedFetch for automatic auth header injection and token refresh.
 */

import { authenticatedFetch } from '../api';

// ==================== Type Definitions ====================

/**
 * Team member entity
 */
export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  roles: string[];
  created_at: string;
  updated_at: string;
  team?: {
    id: string;
    name: string;
  };
  userInfo?: {
    username: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    displayName: string;
    enabled: boolean;
    emailVerified: boolean;
  };
}

/**
 * DTO for adding a member to a team
 */
export interface AddTeamMemberDto {
  userId: string;
  roles: string[];
}

/**
 * DTO for updating member roles
 */
export interface UpdateTeamMemberRolesDto {
  roles: string[];
}

// ==================== API Functions ====================

/**
 * List all members of a team
 */
export async function listTeamMembers(teamId: string): Promise<TeamMember[]> {
  const response = await authenticatedFetch(`teams/${teamId}/members`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to fetch team members';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Get a single team membership by ID
 */
export async function getTeamMember(id: string): Promise<TeamMember> {
  const response = await authenticatedFetch(`team-members/${id}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to fetch team member';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Add a member to a team
 */
export async function addTeamMember(
  teamId: string,
  dto: AddTeamMemberDto
): Promise<TeamMember> {
  const response = await authenticatedFetch(`teams/${teamId}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dto),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to add team member';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Update the roles of a team member
 */
export async function updateTeamMemberRoles(
  id: string,
  dto: UpdateTeamMemberRolesDto
): Promise<TeamMember> {
  const response = await authenticatedFetch(`team-members/${id}/roles`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dto),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to update team member roles';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Remove a member from a team
 */
export async function removeTeamMember(id: string): Promise<void> {
  const response = await authenticatedFetch(`team-members/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to remove team member';
    throw new Error(errorMessage);
  }
}

/**
 * Remove a member from a team by user ID
 */
export async function removeTeamMemberByUser(
  teamId: string,
  userId: string
): Promise<void> {
  const response = await authenticatedFetch(
    `teams/${teamId}/members/${userId}`,
    {
      method: 'DELETE',
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to remove team member';
    throw new Error(errorMessage);
  }
}

/**
 * Get all teams the current user belongs to
 */
export async function getMyTeamMemberships(): Promise<TeamMember[]> {
  const response = await authenticatedFetch('users/me/teams');

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to fetch team memberships';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Check if a user is a member of a team (convenience function)
 */
export async function checkTeamMembership(
  teamId: string,
  userId: string
): Promise<boolean> {
  try {
    const members = await listTeamMembers(teamId);
    return members.some((member) => member.user_id === userId);
  } catch {
    return false;
  }
}
