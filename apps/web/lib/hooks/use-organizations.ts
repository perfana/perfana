'use client';

/**
 * React Query hooks for organizations
 *
 * Provides hooks for fetching and mutating organization data with
 * automatic cache invalidation.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listOrganizations,
  getOrganization,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  Organization,
  CreateOrganizationDto,
  UpdateOrganizationDto,
} from '../api/organizations';

// Query keys for cache management
export const organizationsKeys = {
  all: ['organizations'] as const,
  lists: () => [...organizationsKeys.all, 'list'] as const,
  list: () => [...organizationsKeys.lists()] as const,
  details: () => [...organizationsKeys.all, 'detail'] as const,
  detail: (id: string) => [...organizationsKeys.details(), id] as const,
};

/**
 * Hook to fetch all organizations
 */
export function useOrganizations(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: organizationsKeys.list(),
    queryFn: listOrganizations,
    staleTime: 30000, // 30 seconds
    enabled: options?.enabled,
  });
}

/**
 * Hook to fetch a single organization by ID
 */
export function useOrganization(id: string | undefined) {
  return useQuery({
    queryKey: organizationsKeys.detail(id!),
    queryFn: () => getOrganization(id!),
    enabled: !!id,
    staleTime: 30000,
  });
}

/**
 * Hook to create a new organization
 */
export function useCreateOrganization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: CreateOrganizationDto) => createOrganization(dto),
    onSuccess: () => {
      // Invalidate the organizations list cache
      queryClient.invalidateQueries({ queryKey: organizationsKeys.lists() });
    },
  });
}

/**
 * Hook to update an organization
 */
export function useUpdateOrganization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateOrganizationDto }) =>
      updateOrganization(id, dto),
    onSuccess: (updatedOrg) => {
      // Update the cache for this specific organization
      queryClient.setQueryData(
        organizationsKeys.detail(updatedOrg.id),
        updatedOrg
      );
      // Invalidate the list cache
      queryClient.invalidateQueries({ queryKey: organizationsKeys.lists() });
    },
  });
}

/**
 * Hook to delete an organization
 */
export function useDeleteOrganization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteOrganization(id),
    onSuccess: (_, id) => {
      // Remove the organization from the cache
      queryClient.removeQueries({ queryKey: organizationsKeys.detail(id) });
      // Invalidate the list cache
      queryClient.invalidateQueries({ queryKey: organizationsKeys.lists() });
    },
  });
}
