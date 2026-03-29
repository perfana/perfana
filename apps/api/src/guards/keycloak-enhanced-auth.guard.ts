import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ApiKeysService } from '../modules/api-keys/api-keys.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { IS_ADMIN_ONLY_KEY } from '../decorators/admin-only.decorator';
import { KeycloakUser, AuthRequestHeaders, AuthenticatedRequest as AuthRequest } from '../types';

export type AuthType = 'api-key' | 'keycloak-jwt';

export interface AuthenticatedRequest extends AuthRequest {
  headers: AuthRequestHeaders;
  [key: string]: unknown;
}

@Injectable()
export class KeycloakEnhancedAuthGuard implements CanActivate {
  private readonly logger = new Logger(KeycloakEnhancedAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
    private readonly apiKeysService: ApiKeysService,
  ) {
    this.logger.log('Keycloak Enhanced Auth Guard initialized');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if the route is marked as public (skip authentication)
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      this.logger.warn('Missing Authorization header');
      throw new UnauthorizedException('Missing Authorization header');
    }

    const token = this.extractTokenFromHeader(authHeader);

    if (!token) {
      this.logger.warn('Invalid authorization header format');
      throw new UnauthorizedException('Invalid authorization type. Expected Bearer token');
    }

    // Try authentication methods in priority order
    const authResult = await this.tryAuthentication(token, request);

    if (!authResult.success) {
      this.logger.warn('All authentication methods failed for provided token');
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Check if the route requires admin role
    const isAdminOnly = this.reflector.getAllAndOverride<boolean>(IS_ADMIN_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isAdminOnly) {
      if (!KeycloakEnhancedAuthGuard.isAdmin(request)) {
        this.logger.warn(`Admin access denied for user: ${authResult.userId}`);
        throw new ForbiddenException('Admin privileges required');
      }
    }

    return true;
  }

  private async tryAuthentication(token: string, request: AuthenticatedRequest): Promise<{
    success: boolean;
    authType?: AuthType;
    userId?: string;
  }> {
    // 1. Try API Key authentication (highest priority)
    try {
      const apiKey = await this.apiKeysService.validateApiKey(token);
      if (apiKey) {
        request.authType = 'api-key';
        // Attach API key details to request for role checking
        request.apiKey = {
          id: apiKey.id,
          description: apiKey.description,
          roles: apiKey.roles,
          validUntil: apiKey.validUntil,
          organization_id: apiKey.organization_id,
        };
        return { success: true, authType: 'api-key', userId: `api-key:${apiKey.id}` };
      }
    } catch {
      // API Key authentication failed, try next method
    }

    // 2. Try Keycloak JWT authentication
    try {
      const keycloakUser = await this.validateKeycloakToken(token);
      if (keycloakUser) {
        request.user = keycloakUser;
        request.authType = 'keycloak-jwt';

        return { success: true, authType: 'keycloak-jwt', userId: keycloakUser.sub };
      }
    } catch {
      // Keycloak JWT authentication failed
    }

    return { success: false };
  }


  private extractTokenFromHeader(authHeader: string | undefined): string | null {
    if (!authHeader) {
      return null;
    }

    const [type, token] = authHeader.split(' ');

    if (type !== 'Bearer' || !token) {
      return null;
    }

    return token;
  }

  /**
   * Check if the current user has admin privileges
   */
  static isAdmin(request: AuthenticatedRequest): boolean {
    if (request.authType === 'keycloak-jwt' && request.user) {
      // Check for admin role in Keycloak token
      const roles = request.user.roles || [];
      const logger = new Logger('KeycloakEnhancedAuthGuard');
      logger.debug(`isAdmin check - authType: ${request.authType}, roles: ${JSON.stringify(roles)}`);
      logger.debug(`isAdmin check - has perfana-admin: ${roles.includes('perfana-admin')}, has admin: ${roles.includes('admin')}`);
      return roles.includes('perfana-admin') || roles.includes('admin');
    }

    if (request.authType === 'api-key' && request.apiKey) {
      // Check if API key has admin role
      return request.apiKey.roles.includes('perfana-admin') || request.apiKey.roles.includes('admin');
    }

    return false;
  }

  /**
   * Check if the current user has specific role
   */
  static hasRole(request: AuthenticatedRequest, role: string): boolean {
    if (request.authType === 'keycloak-jwt' && request.user) {
      const roles = request.user.roles || [];
      return roles.includes(role);
    }

    if (request.authType === 'api-key' && request.apiKey) {
      // Check if API key has the specified role
      return request.apiKey.roles.includes(role);
    }

    return false;
  }

  /**
   * Get the current user ID regardless of auth type
   */
  static getUserId(request: AuthenticatedRequest): string | null | undefined {
    if (request.authType === 'keycloak-jwt' && request.user) {
      return request.user.sub || request.user.preferred_username;
    }

    if (request.authType === 'api-key' && request.apiKey) {
      return `api-key:${request.apiKey.id}`;
    }

    return null;
  }

  /**
   * Get all roles for the current user
   */
  static getRoles(request: AuthenticatedRequest): string[] {
    if (request.authType === 'keycloak-jwt' && request.user) {
      return request.user.roles || [];
    }

    if (request.authType === 'api-key' && request.apiKey) {
      return request.apiKey.roles;
    }

    return [];
  }

  /**
   * Get the current user email regardless of auth type
   */
  static getUserEmail(request: AuthenticatedRequest): string | null | undefined {
    if (request.authType === 'keycloak-jwt' && request.user) {
      return request.user.email;
    }

    return null;
  }

  /**
   * Validate Keycloak JWT token using nest-keycloak-connect
   */
  private async validateKeycloakToken(token: string): Promise<KeycloakUser | null> {
    try {
      // Use the nest-keycloak-connect library's built-in JWT validation
      // This will validate the token against Keycloak's public keys
      const keycloakUrl = this.configService.get('KEYCLOAK_URL') || 'http://localhost:8080';
      const realm = this.configService.get('KEYCLOAK_REALM') || 'perfana-prod';

      // Fetch the public key from Keycloak's JWKS endpoint
      const jwksUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/certs`;

      // Use jose library for JWT verification (already available in dependencies)
      const { createRemoteJWKSet, jwtVerify } = await import('jose');

      const JWKS = createRemoteJWKSet(new URL(jwksUrl));

      // Support multiple issuers for Docker container vs localhost access
      const acceptedIssuersEnv = this.configService.get('KEYCLOAK_ACCEPTED_ISSUERS');
      let acceptedIssuers: string[];

      if (acceptedIssuersEnv) {
        // Parse comma-separated list of accepted issuers
        acceptedIssuers = acceptedIssuersEnv.split(',').map((iss: string) => iss.trim());
      } else {
        // Default: accept both internal (keycloak:8080) and external (localhost:8080) issuers
        acceptedIssuers = [
          `${keycloakUrl}/realms/${realm}`,
          `http://localhost:8080/realms/${realm}`,
        ];
      }

      // Verify the JWT token (issuer + signature + audience)
      const clientId = this.configService.get('KEYCLOAK_CLIENT_ID');
      if (!clientId) {
        this.logger.warn('KEYCLOAK_CLIENT_ID not configured — audience validation disabled');
      }
      const { payload } = await jwtVerify(token, JWKS, {
        issuer: acceptedIssuers,
        audience: clientId || undefined,
        clockTolerance: 60,
      });

      // Extract roles from realm_access and resource_access
      const realmRoles = (payload.realm_access as any)?.roles || [];
      const azp = payload.azp as string | undefined;
      const clientRoles = (azp && (payload.resource_access as any)?.[azp]?.roles) || [];
      const allRoles = [...realmRoles, ...clientRoles];

      this.logger.debug(`Extracted roles from JWT: realm=${JSON.stringify(realmRoles)}, client=${JSON.stringify(clientRoles)}, combined=${JSON.stringify(allRoles)}`);

      // Return KeycloakUser with extracted roles
      return {
        sub: payload.sub!,
        email: payload.email as string,
        preferred_username: payload.preferred_username as string,
        given_name: payload.given_name as string,
        family_name: payload.family_name as string,
        roles: allRoles,
        organizations: (payload as any).organizations || [],
        teams: (payload as any).teams || [],
        sessionId: payload.sid as string,
        exp: payload.exp,
        iat: payload.iat,
        aud: payload.aud,
        iss: payload.iss,
      } as KeycloakUser;
    } catch {
      return null;
    }
  }
}