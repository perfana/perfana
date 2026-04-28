import { authenticatedFetch } from '../api';

export interface PermissionsResponse {
  userId: string;
  global: string[];
  byOrg: Record<string, string[]>;
}

export async function fetchPermissions(): Promise<PermissionsResponse> {
  const r = await authenticatedFetch('/users/me/permissions');
  if (!r.ok) throw new Error(`Failed to fetch permissions: ${r.status}`);
  return r.json();
}
