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

/** @public */
export const Roles = (options: RoleOptions) => SetMetadata(ROLES_KEY, options);

/** @public */
export const RequireRoles = (...roles: string[]) =>
  Roles({ roles, mode: RoleMatchingMode.ANY });

/** @public */
export const RequireAllRoles = (...roles: string[]) =>
  Roles({ roles, mode: RoleMatchingMode.ALL });