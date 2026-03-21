import { SetMetadata } from '@nestjs/common';

export enum RoleMatchingMode {
  ALL = 'all',
  ANY = 'any',
}

export interface RoleOptions {
  roles: string[];
  mode?: RoleMatchingMode;
}

export const ROLES_KEY = 'roles';

export const Roles = (options: RoleOptions) => SetMetadata(ROLES_KEY, options);

export const RequireRoles = (...roles: string[]) =>
  Roles({ roles, mode: RoleMatchingMode.ANY });

export const RequireAllRoles = (...roles: string[]) =>
  Roles({ roles, mode: RoleMatchingMode.ALL });