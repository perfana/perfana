'use client';

/**
 * React Query hooks for organization members
 *
 * Provides hooks for fetching and mutating organization member data
 * with automatic cache invalidation.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listOrganizationMembers,
  getOrganizationMember,
  addOrganizationMember,
  updateOrganizationMemberRoles,
  removeOrganizationMember,
  removeOrganizationMemberByUser,
  getMyOrganizationMemberships, OrganizationMember,
  AddOrganizationMemberDto,
  UpdateOrganizationMemberRolesDto,
} from '../api/organization-members';
import { organizationsKeys } from './use-organizations';

// Query keys for cache management
export const organizationMembersKeys = {
  all: ['organization-members'] as const,
  lists: () => [...organizationMembersKeys.all, 'list'] as const,
  list: (organizationId: string) =>
    [...organizationMembersKeys.lists(), { organizationId }] as const,
  details: () => [...organizationMembersKeys.all, 'detail'] as const,
  detail: (id: string) => [...organizationMembersKeys.details(), id] as const,
  myMemberships: () => [...organizationMembersKeys.all, 'my-memberships'] as const,
};

/**
 * Hook to fetch all members of an organization
 */
export function useOrganizationMembers(organizationId: string | undefined) {
  return useQuery({
    queryKey: organizationMembersKeys.list(organizationId!),
    queryFn: () => listOrganizationMembers(organizationId!),
    enabled: !!organizationId,
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook to fetch a single organization membership by ID
 */
export function useOrganizationMember(id: string | undefined) {
  return useQuery({
    queryKey: organizationMembersKeys.detail(id!),
    queryFn: () => getOrganizationMember(id!),
    enabled: !!id,
    staleTime: 30000,
  });
}

/**
 * Hook to fetch the current user's organization memberships
 */
export function useMyOrganizationMemberships() {
  return useQuery({
    queryKey: organizationMembersKeys.myMemberships(),
    queryFn: getMyOrganizationMemberships,
    staleTime: 30000,
  });
}

/**
 * Hook to add a member to an organization
 */
export function useAddOrganizationMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      organizationId,
      dto,
    }: {
      organizationId: string;
      dto: AddOrganizationMemberDto;
    }) => addOrganizationMember(organizationId, dto),
    onSuccess: (newMember) => {
      // Invalidate the members list cache for this organization
      queryClient.invalidateQueries({
        queryKey: organizationMembersKeys.list(newMember.organization_id),
      });
      // Also invalidate the organization detail cache
      queryClient.invalidateQueries({
        queryKey: organizationsKeys.detail(newMember.organization_id),
      });
      // Invalidate my memberships in case the current user was added
      queryClient.invalidateQueries({
        queryKey: organizationMembersKeys.myMemberships(),
      });
    },
  });
}

/**
 * Hook to update the roles of an organization member
 */
export function useUpdateOrganizationMemberRoles() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      dto,
    }: {
      id: string;
      dto: UpdateOrganizationMemberRolesDto;
    }) => updateOrganizationMemberRoles(id, dto),
    onSuccess: (updatedMember) => {
      // Update the cache for this specific member
      queryClient.setQueryData(
        organizationMembersKeys.detail(updatedMember.id),
        updatedMember
      );
      // Invalidate the members list cache
      queryClient.invalidateQueries({
        queryKey: organizationMembersKeys.list(updatedMember.organization_id),
      });
      // Invalidate my memberships in case roles were changed for current user
      queryClient.invalidateQueries({
        queryKey: organizationMembersKeys.myMemberships(),
      });
    },
  });
}

/**
 * Hook to remove a member from an organization
 */
export function useRemoveOrganizationMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      organizationId,
    }: {
      id: string;
      organizationId: string;
    }) => removeOrganizationMember(id),
    onSuccess: (_, { id, organizationId }) => {
      // Remove the member from the cache
      queryClient.removeQueries({
        queryKey: organizationMembersKeys.detail(id),
      });
      // Invalidate the members list cache
      queryClient.invalidateQueries({
        queryKey: organizationMembersKeys.list(organizationId),
      });
      // Invalidate the organization detail cache
      queryClient.invalidateQueries({
        queryKey: organizationsKeys.detail(organizationId),
      });
      // Invalidate my memberships in case the current user was removed
      queryClient.invalidateQueries({
        queryKey: organizationMembersKeys.myMemberships(),
      });
    },
  });
}

/**
 * Hook to remove a member from an organization by user ID
 */
export function useRemoveOrganizationMemberByUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      organizationId,
      userId,
    }: {
      organizationId: string;
      userId: string;
    }) => removeOrganizationMemberByUser(organizationId, userId),
    onSuccess: (_, { organizationId }) => {
      // Invalidate the members list cache
      queryClient.invalidateQueries({
        queryKey: organizationMembersKeys.list(organizationId),
      });
      // Invalidate the organization detail cache
      queryClient.invalidateQueries({
        queryKey: organizationsKeys.detail(organizationId),
      });
      // Invalidate my memberships in case the current user was removed
      queryClient.invalidateQueries({
        queryKey: organizationMembersKeys.myMemberships(),
      });
    },
  });
}
