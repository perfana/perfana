import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, RoleOptions, RoleMatchingMode } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthenticatedRequest, KeycloakEnhancedAuthGuard } from './keycloak-enhanced-auth.guard';

/**
 * RolesGuard - Role-Based Access Control (RBAC) Guard
 *
 * This guard checks if the authenticated user has the required roles to access
 * a route. It supports two matching modes:
 *
 * - ANY (default): User must have at least one of the required roles
 * - ALL: User must have all of the required roles
 *
 * Usage with decorators:
 * - @RequireRoles('admin', 'editor') - User needs 'admin' OR 'editor' role
 * - @RequireAllRoles('admin', 'editor') - User needs BOTH 'admin' AND 'editor' roles
 * - @Roles({ roles: ['admin'], mode: RoleMatchingMode.ALL }) - Full options syntax
 *
 * This guard must be used AFTER KeycloakEnhancedAuthGuard to ensure the user
 * is authenticated and their roles are available on the request object.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Check if the route is marked as public (skip role checking)
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // Get role requirements from decorator metadata
    const roleOptions = this.reflector.getAllAndOverride<RoleOptions>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no roles are specified, allow access (no role restriction)
    if (!roleOptions || !roleOptions.roles || roleOptions.roles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // Get user's roles from the authenticated request
    const userRoles = KeycloakEnhancedAuthGuard.getRoles(request);

    // Determine matching mode (default to ANY)
    const matchingMode = roleOptions.mode || RoleMatchingMode.ANY;

    // Check if user has required roles based on matching mode
    const hasRequiredRoles = this.checkRoles(userRoles, roleOptions.roles, matchingMode);

    if (!hasRequiredRoles) {
      const userId = KeycloakEnhancedAuthGuard.getUserId(request) || 'unknown';
      this.logger.warn(
        `Access denied for user ${userId}. ` +
          `Required roles: [${roleOptions.roles.join(', ')}] (mode: ${matchingMode}), ` +
          `User roles: [${userRoles.join(', ')}]`,
      );
      throw new ForbiddenException(
        `Access denied. Required roles: ${roleOptions.roles.join(', ')} (${matchingMode === RoleMatchingMode.ALL ? 'all required' : 'any required'})`,
      );
    }

    return true;
  }

  /**
   * Check if user has the required roles based on matching mode
   */
  private checkRoles(userRoles: string[], requiredRoles: string[], mode: RoleMatchingMode): boolean {
    if (mode === RoleMatchingMode.ALL) {
      // User must have ALL required roles
      return requiredRoles.every((role) => userRoles.includes(role));
    }

    // Default: ANY mode - User must have at least one required role
    return requiredRoles.some((role) => userRoles.includes(role));
  }
}
