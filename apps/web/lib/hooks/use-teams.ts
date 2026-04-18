'use client';

/**
 * React Query hooks for teams
 *
 * Provides hooks for fetching and mutating team data with
 * automatic cache invalidation.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listTeams,
  listTeamsByOrganization,
  getTeam,
  createTeam,
  updateTeam,
  deleteTeam,
  _Team,
  CreateTeamDto,
  UpdateTeamDto,
} from '../api/teams';
import { organizationsKeys } from './use-organizations';

// Query keys for cache management
export const teamsKeys = {
  all: ['teams'] as const,
  lists: () => [...teamsKeys.all, 'list'] as const,
  list: () => [...teamsKeys.lists()] as const,
  listByOrg: (organizationId: string) =>
    [...teamsKeys.lists(), 'org', organizationId] as const,
  details: () => [...teamsKeys.all, 'detail'] as const,
  detail: (id: string) => [...teamsKeys.details(), id] as const,
};

/**
 * Hook to fetch all teams
 */
export function useTeams() {
  return useQuery({
    queryKey: teamsKeys.list(),
    queryFn: listTeams,
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook to fetch teams by organization ID
 */
export function useTeamsByOrganization(organizationId: string | undefined) {
  return useQuery({
    queryKey: teamsKeys.listByOrg(organizationId!),
    queryFn: () => listTeamsByOrganization(organizationId!),
    enabled: !!organizationId,
    staleTime: 30000,
  });
}

/**
 * Hook to fetch a single team by ID
 */
export function useTeam(id: string | undefined) {
  return useQuery({
    queryKey: teamsKeys.detail(id!),
    queryFn: () => getTeam(id!),
    enabled: !!id,
    staleTime: 30000,
  });
}

/**
 * Hook to create a new team
 */
export function useCreateTeam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: CreateTeamDto) => createTeam(dto),
    onSuccess: (newTeam) => {
      // Invalidate the teams list cache
      queryClient.invalidateQueries({ queryKey: teamsKeys.lists() });
      // Also invalidate the organization detail cache as team count may have changed
      queryClient.invalidateQueries({
        queryKey: organizationsKeys.detail(newTeam.organization_id),
      });
    },
  });
}

/**
 * Hook to update a team
 */
export function useUpdateTeam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateTeamDto }) =>
      updateTeam(id, dto),
    onSuccess: (updatedTeam) => {
      // Update the cache for this specific team
      queryClient.setQueryData(teamsKeys.detail(updatedTeam.id), updatedTeam);
      // Invalidate the list cache
      queryClient.invalidateQueries({ queryKey: teamsKeys.lists() });
    },
  });
}

/**
 * Hook to delete a team
 */
export function useDeleteTeam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteTeam(id),
    onSuccess: (_, id) => {
      // Remove the team from the cache
      queryClient.removeQueries({ queryKey: teamsKeys.detail(id) });
      // Invalidate the list cache
      queryClient.invalidateQueries({ queryKey: teamsKeys.lists() });
    },
  });
}
