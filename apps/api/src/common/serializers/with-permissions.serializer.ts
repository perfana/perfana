export type PermissionsMap = Record<string, boolean>;

export function attachPermissions<T extends object>(
  resource: T,
  permissions: PermissionsMap,
): T & { _permissions: PermissionsMap };
export function attachPermissions<T extends object>(
  resources: T[],
  permissions: PermissionsMap,
): Array<T & { _permissions: PermissionsMap }>;
export function attachPermissions<T extends object>(
  resourceOrList: T | T[],
  permissions: PermissionsMap,
): unknown {
  if (Array.isArray(resourceOrList)) {
    return resourceOrList.map((r) => ({ ...r, _permissions: permissions }));
  }
  return { ...resourceOrList, _permissions: permissions };
}
