import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizationService } from '../services/authorization.service';
import {
  KeycloakEnhancedAuthGuard,
  AuthenticatedRequest,
} from '../../guards/keycloak-enhanced-auth.guard';
import {
  REQUIRES_CAPABILITY_META,
  RequiresCapabilityMeta,
} from '../decorators/requires-capability.decorator';

/**
 * Guard that enforces `@RequiresCapability(...)` metadata.
 *
 * Execution order:
 *  1. Read `RequiresCapabilityMeta` from handler/class via Reflector.
 *  2. If no metadata → allow (route is not capability-gated).
 *  3. Extract userId + roles from the already-authenticated request.
 *  4. Resolve orgId from the configured source (param / body / query / null).
 *  5. Call `AuthorizationService.getCapabilities` and check membership.
 *  6. Grant or deny with a structured WARN log on denial.
 *
 * Register in a module's `providers` array and apply via `@UseGuards(CapabilityGuard)`
 * on controllers or individual route handlers — always AFTER `KeycloakEnhancedAuthGuard`
 * so the request is already authenticated when this guard runs.
 */
@Injectable()
export class CapabilityGuard implements CanActivate {
  private readonly logger = new Logger(CapabilityGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly authzService: AuthorizationService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<RequiresCapabilityMeta | undefined>(
      REQUIRES_CAPABILITY_META,
      [ctx.getHandler(), ctx.getClass()],
    );

    // No capability gate on this handler → allow
    if (!meta) return true;

    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = KeycloakEnhancedAuthGuard.getUserId(request);
    const roles = KeycloakEnhancedAuthGuard.getRoles(request);

    if (!userId) {
      this.logger.warn(
        `Capability denied: no authenticated user (capability=${meta.capability} route=${request.method} ${request.url})`,
      );
      throw new ForbiddenException(`Missing capability: ${meta.capability}`);
    }

    const orgId = this.resolveOrgId(request, meta.source);
    const caps = await this.authzService.getCapabilities(userId, roles, orgId);

    if (caps.includes(meta.capability)) return true;

    this.logger.warn(
      `Capability denied: capability=${meta.capability} userId=${userId} orgId=${orgId ?? 'null'} route=${request.method} ${request.url}`,
    );
    throw new ForbiddenException(`Missing capability: ${meta.capability}`);
  }

  private resolveOrgId(
    request: AuthenticatedRequest,
    source: RequiresCapabilityMeta['source'],
  ): string | null {
    if (source.orgIdParam) return (request.params as Record<string, string>)?.[source.orgIdParam] ?? null;
    if (source.orgIdFromBody) return (request.body as Record<string, string>)?.[source.orgIdFromBody] ?? null;
    if (source.orgIdFromQuery) return (request.query as Record<string, string>)?.[source.orgIdFromQuery] ?? null;
    return null;
  }
}
