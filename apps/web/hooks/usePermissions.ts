import { useQuery } from '@tanstack/react-query';
import { fetchPermissions } from '@/lib/api/permissions';

export interface PermissionContext {
  organizationId?: string;
  /** When provided, prefer the per-resource _permissions field over capabilities. */
  resourcePermissions?: Record<string, boolean>;
}

export function usePermissions() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['permissions', 'me'],
    queryFn: fetchPermissions,
    staleTime: Infinity,
  });

  const can = (action: string, ctx?: PermissionContext): boolean => {
    if (ctx?.resourcePermissions && action in ctx.resourcePermissions) {
      return ctx.resourcePermissions[action] === true;
    }
    if (!data) return false;
    if (data.global.includes(action)) return true;
    if (ctx?.organizationId) {
      return data.byOrg[ctx.organizationId]?.includes(action) ?? false;
    }
    return false;
  };

  return { can, isLoaded: !isLoading && !isError };
}
