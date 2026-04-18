'use client';

/**
 * React Query hooks for team members
 *
 * Provides hooks for fetching and mutating team member data
 * with automatic cache invalidation.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listTeamMembers,
  getTeamMember,
  addTeamMember,
  updateTeamMemberRoles,
  removeTeamMember,
  removeTeamMemberByUser,
  getMyTeamMemberships, TeamMember,
  AddTeamMemberDto,
  UpdateTeamMemberRolesDto,
} from '../api/team-members';
import { teamsKeys } from './use-teams';

// Query keys for cache management
export const teamMembersKeys = {
  all: ['team-members'] as const,
  lists: () => [...teamMembersKeys.all, 'list'] as const,
  list: (teamId: string) =>
    [...teamMembersKeys.lists(), { teamId }] as const,
  details: () => [...teamMembersKeys.all, 'detail'] as const,
  detail: (id: string) => [...teamMembersKeys.details(), id] as const,
  myMemberships: () => [...teamMembersKeys.all, 'my-memberships'] as const,
};

/**
 * Hook to fetch all members of a team
 */
export function useTeamMembers(teamId: string | undefined) {
  return useQuery({
    queryKey: teamMembersKeys.list(teamId!),
    queryFn: () => listTeamMembers(teamId!),
    enabled: !!teamId,
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook to fetch a single team membership by ID
 */
export function useTeamMember(id: string | undefined) {
  return useQuery({
    queryKey: teamMembersKeys.detail(id!),
    queryFn: () => getTeamMember(id!),
    enabled: !!id,
    staleTime: 30000,
  });
}

/**
 * Hook to fetch the current user's team memberships
 */
export function useMyTeamMemberships() {
  return useQuery({
    queryKey: teamMembersKeys.myMemberships(),
    queryFn: getMyTeamMemberships,
    staleTime: 30000,
  });
}

/**
 * Hook to add a member to a team
 */
export function useAddTeamMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      teamId,
      dto,
    }: {
      teamId: string;
      dto: AddTeamMemberDto;
    }) => addTeamMember(teamId, dto),
    onSuccess: (newMember) => {
      // Invalidate the members list cache for this team
      queryClient.invalidateQueries({
        queryKey: teamMembersKeys.list(newMember.team_id),
      });
      // Also invalidate the team detail cache
      queryClient.invalidateQueries({
        queryKey: teamsKeys.detail(newMember.team_id),
      });
      // Invalidate my memberships in case the current user was added
      queryClient.invalidateQueries({
        queryKey: teamMembersKeys.myMemberships(),
      });
    },
  });
}

/**
 * Hook to update the roles of a team member
 */
export function useUpdateTeamMemberRoles() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      dto,
    }: {
      id: string;
      dto: UpdateTeamMemberRolesDto;
    }) => updateTeamMemberRoles(id, dto),
    onSuccess: (updatedMember) => {
      // Update the cache for this specific member
      queryClient.setQueryData(
        teamMembersKeys.detail(updatedMember.id),
        updatedMember
      );
      // Invalidate the members list cache
      queryClient.invalidateQueries({
        queryKey: teamMembersKeys.list(updatedMember.team_id),
      });
      // Invalidate my memberships in case roles were changed for current user
      queryClient.invalidateQueries({
        queryKey: teamMembersKeys.myMemberships(),
      });
    },
  });
}

/**
 * Hook to remove a member from a team
 */
export function useRemoveTeamMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      teamId,
    }: {
      id: string;
      teamId: string;
    }) => removeTeamMember(id),
    onSuccess: (_, { id, teamId }) => {
      // Remove the member from the cache
      queryClient.removeQueries({
        queryKey: teamMembersKeys.detail(id),
      });
      // Invalidate the members list cache
      queryClient.invalidateQueries({
        queryKey: teamMembersKeys.list(teamId),
      });
      // Invalidate the team detail cache
      queryClient.invalidateQueries({
        queryKey: teamsKeys.detail(teamId),
      });
      // Invalidate my memberships in case the current user was removed
      queryClient.invalidateQueries({
        queryKey: teamMembersKeys.myMemberships(),
      });
    },
  });
}

/**
 * Hook to remove a member from a team by user ID
 */
export function useRemoveTeamMemberByUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      teamId,
      userId,
    }: {
      teamId: string;
      userId: string;
    }) => removeTeamMemberByUser(teamId, userId),
    onSuccess: (_, { teamId }) => {
      // Invalidate the members list cache
      queryClient.invalidateQueries({
        queryKey: teamMembersKeys.list(teamId),
      });
      // Invalidate the team detail cache
      queryClient.invalidateQueries({
        queryKey: teamsKeys.detail(teamId),
      });
      // Invalidate my memberships in case the current user was removed
      queryClient.invalidateQueries({
        queryKey: teamMembersKeys.myMemberships(),
      });
    },
  });
}
