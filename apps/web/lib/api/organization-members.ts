/**
 * Organization Members API Client
 *
 * Client functions for organization member management operations.
 * Uses authenticatedFetch for automatic auth header injection and token refresh.
 */

import { authenticatedFetch } from '../api';

// ==================== Type Definitions ====================

/**
 * Organization member entity
 */
export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  roles: string[];
  created_at: string;
  updated_at: string;
  organization?: {
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
 * DTO for adding a member to an organization
 */
export interface AddOrganizationMemberDto {
  userId: string;
  roles: string[];
}

/**
 * DTO for updating member roles
 */
export interface UpdateOrganizationMemberRolesDto {
  roles: string[];
}

// ==================== API Functions ====================

/**
 * List all members of an organization
 */
export async function listOrganizationMembers(
  organizationId: string
): Promise<OrganizationMember[]> {
  const response = await authenticatedFetch(
    `organizations/${organizationId}/members`
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to fetch organization members';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Get a single organization membership by ID
 */
export async function getOrganizationMember(id: string): Promise<OrganizationMember> {
  const response = await authenticatedFetch(`organization-members/${id}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to fetch organization member';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Add a member to an organization
 */
export async function addOrganizationMember(
  organizationId: string,
  dto: AddOrganizationMemberDto
): Promise<OrganizationMember> {
  const response = await authenticatedFetch(
    `organizations/${organizationId}/members`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dto),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to add organization member';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Update the roles of an organization member
 */
export async function updateOrganizationMemberRoles(
  id: string,
  dto: UpdateOrganizationMemberRolesDto
): Promise<OrganizationMember> {
  const response = await authenticatedFetch(`organization-members/${id}/roles`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dto),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to update organization member roles';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Remove a member from an organization
 */
export async function removeOrganizationMember(id: string): Promise<void> {
  const response = await authenticatedFetch(`organization-members/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to remove organization member';
    throw new Error(errorMessage);
  }
}

/**
 * Remove a member from an organization by user ID
 */
export async function removeOrganizationMemberByUser(
  organizationId: string,
  userId: string
): Promise<void> {
  const response = await authenticatedFetch(
    `organizations/${organizationId}/members/${userId}`,
    {
      method: 'DELETE',
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to remove organization member';
    throw new Error(errorMessage);
  }
}

/**
 * Get all organizations the current user belongs to
 */
export async function getMyOrganizationMemberships(): Promise<OrganizationMember[]> {
  const response = await authenticatedFetch('users/me/organizations');

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to fetch organization memberships';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Check if a user is a member of an organization (convenience function)
 */
export async function checkOrganizationMembership(
  organizationId: string,
  userId: string
): Promise<boolean> {
  try {
    const members = await listOrganizationMembers(organizationId);
    return members.some((member) => member.user_id === userId);
  } catch {
    return false;
  }
}
