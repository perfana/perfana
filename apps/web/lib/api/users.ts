import { authenticatedFetch } from '../api';

export interface UserInfo {
  id: string; // Keycloak user ID (sub claim)
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  displayName: string; // Human-readable name
  enabled: boolean;
  emailVerified: boolean;
}

export interface UserSearchParams {
  q?: string; // Search query
  email?: string; // Exact email match
  username?: string; // Exact username match
  limit?: number; // Max results
}

/**
 * Search for users in Keycloak
 */
export async function searchUsers(params: UserSearchParams): Promise<UserInfo[]> {
  const queryParams = new URLSearchParams();

  if (params.q) queryParams.append('q', params.q);
  if (params.email) queryParams.append('email', params.email);
  if (params.username) queryParams.append('username', params.username);
  if (params.limit) queryParams.append('limit', String(params.limit));

  const response = await authenticatedFetch(`users/search?${queryParams.toString()}`);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      errorText || `Failed to search users: ${response.status} ${response.statusText}`
    );
  }

  return response.json();
}
