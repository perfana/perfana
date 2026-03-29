import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import {
  KeycloakEnhancedAuthGuard,
  AuthenticatedRequest,
} from '../../guards/keycloak-enhanced-auth.guard';

/**
 * User context extracted from authenticated requests.
 * Works with both Keycloak JWT and API Key authentication.
 */
export interface UserContext {
  /** The user's ID (Keycloak sub or api-key:{id}) */
  userId: string;
  /** The user's roles from Keycloak or API key */
  roles: string[];
  /** The user's accessible organizations (from Keycloak JWT) */
  organizations: string[];
  /** The user's accessible teams (from Keycloak JWT) */
  teams: string[];
  /** The user's default/current organization ID (first from list) */
  organizationId?: string;
  /** The user's default/current team ID (first from list) */
  teamId?: string;
  /** The user's email (only available for Keycloak JWT auth) */
  email?: string;
}

/**
 * Parameter decorator that extracts user context from authenticated requests.
 *
 * This decorator works with both Keycloak JWT and API Key authentication,
 * providing a unified interface for accessing user information in controllers.
 *
 * @example
 * ```typescript
 * @Get()
 * async findAll(@UserCtx() ctx: UserContext) {
 *   return this.service.findAll(ctx.userId, ctx.roles);
 * }
 *
 * @Post()
 * async create(@Body() dto: CreateDto, @UserCtx() ctx: UserContext) {
 *   // Use ctx.organizationId for the default organization
 *   // Or access ctx.organizations for all accessible organizations
 *   return this.service.create(dto, ctx.userId, ctx.organizationId);
 * }
 * ```
 */
export const UserCtx = createParamDecorator(
  async (_data: unknown, ctx: ExecutionContext): Promise<UserContext> => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();

    const userId = KeycloakEnhancedAuthGuard.getUserId(request) || '';

    // Extract organizations and teams arrays from different auth sources
    // Priority order:
    // 1. API key organization
    // 2. JWT organizations (if Keycloak manages them in future)
    // Note: services should load organizations via AuthorizationService.getAccessibleOrganizations()
    let organizations: string[] = [];
    let teams: string[] = [];
    let organizationId: string | undefined;

    // For API key authentication, use the API key's organization
    if (request.apiKey?.organization_id) {
      organizations = [request.apiKey.organization_id];
      organizationId = request.apiKey.organization_id;
    }
    // For JWT authentication, use organizations from token (if Keycloak manages them in future)
    else if (request.user?.organizations && request.user.organizations.length > 0) {
      organizations = request.user.organizations;
      teams = request.user.teams || [];
      organizationId = organizations.length > 0 ? organizations[0] : undefined;
    }

    const result = {
      userId,
      roles: KeycloakEnhancedAuthGuard.getRoles(request),
      organizations,
      teams,
      organizationId,
      teamId: teams.length > 0 ? teams[0] : undefined,
      email: KeycloakEnhancedAuthGuard.getUserEmail(request) || undefined,
    };

    return result;
  },
);
