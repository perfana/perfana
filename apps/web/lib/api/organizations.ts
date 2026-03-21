/**
 * Organizations API Client
 *
 * Client functions for organization CRUD operations.
 * Uses authenticatedFetch for automatic auth header injection and token refresh.
 */

import { authenticatedFetch } from '../api';

// ==================== Type Definitions ====================

/**
 * Team summary (nested in organization response)
 */
export interface TeamSummary {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Organization entity
 */
export interface Organization {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
  teams?: TeamSummary[];
}

/**
 * DTO for creating an organization
 */
export interface CreateOrganizationDto {
  name: string;
  description?: string;
}

/**
 * DTO for updating an organization
 */
export interface UpdateOrganizationDto {
  name?: string;
  description?: string;
}

// ==================== API Functions ====================

/**
 * List all organizations the user has access to
 */
export async function listOrganizations(): Promise<Organization[]> {
  const response = await authenticatedFetch('organizations');

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to fetch organizations';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Get a single organization by ID
 * @throws Error if not found (404) or access denied (403)
 */
export async function getOrganization(id: string): Promise<Organization> {
  const response = await authenticatedFetch(`organizations/${id}`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Organization not found');
    }
    if (response.status === 403) {
      throw new Error('You do not have access to this organization');
    }
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to fetch organization';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Create a new organization
 */
export async function createOrganization(dto: CreateOrganizationDto): Promise<Organization> {
  const response = await authenticatedFetch('organizations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dto),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to create organization';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Update an existing organization
 * @throws Error if not found (404) or access denied (403)
 */
export async function updateOrganization(
  id: string,
  dto: UpdateOrganizationDto
): Promise<Organization> {
  const response = await authenticatedFetch(`organizations/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dto),
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Organization not found');
    }
    if (response.status === 403) {
      throw new Error('You do not have permission to update this organization');
    }
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to update organization';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Delete an organization
 * @throws Error if not found (404) or access denied (403)
 */
export async function deleteOrganization(id: string): Promise<void> {
  const response = await authenticatedFetch(`organizations/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Organization not found');
    }
    if (response.status === 403) {
      throw new Error('You do not have permission to delete this organization');
    }
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to delete organization';
    throw new Error(errorMessage);
  }
}
