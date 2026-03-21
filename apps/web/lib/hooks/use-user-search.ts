import { useQuery } from '@tanstack/react-query';
import { searchUsers, UserSearchParams } from '@/lib/api/users';

const userSearchKeys = {
  all: ['user-search'] as const,
  search: (params: UserSearchParams) => [...userSearchKeys.all, 'search', params] as const,
};

/**
 * Hook for searching users in Keycloak
 */
export function useUserSearch(params: UserSearchParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: userSearchKeys.search(params),
    queryFn: () => searchUsers(params),
    enabled: options?.enabled !== false && (!!params.q || !!params.email || !!params.username),
    staleTime: 60000, // 1 minute - user data doesn't change frequently
  });
}
