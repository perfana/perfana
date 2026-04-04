import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { ApiKeysService } from '../../api-keys/api-keys.service';

/**
 * Extended Socket interface with authentication data
 * Mirrors the structure used in KeycloakEnhancedAuthGuard
 */
export interface AuthenticatedSocket extends Socket {
  userId?: string;
  authType?: 'api-key' | 'keycloak-jwt';
  email?: string;
  organizationId?: string;
  teamId?: string;
  roles?: string[];
}

/**
 * WebSocket Authentication Guard
 * Validates JWT or API Key tokens for WebSocket connections
 * Mirrors the logic from KeycloakEnhancedAuthGuard but adapted for WebSocket context
 */
@Injectable()
export class WebSocketAuthGuard implements CanActivate {
  private readonly logger = new Logger(WebSocketAuthGuard.name);

  constructor(
    private configService: ConfigService,
    private apiKeysService: ApiKeysService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client: AuthenticatedSocket = context.switchToWs().getClient();
    const token = this.extractToken(client);

    if (!token) {
      this.logger.warn(`WebSocket connection without token: ${client.id}`);
      throw new WsException('Missing authentication token');
    }

    // Try authentication methods (API key first, then Keycloak JWT)
    const authResult = await this.tryAuthentication(token, client);

    if (!authResult.success) {
      this.logger.warn(`WebSocket authentication failed for client: ${client.id}`);
      throw new WsException('Invalid or expired token');
    }

    this.logger.debug(
      `WebSocket authentication successful: ${authResult.authType} for client ${client.id}`,
    );
    return true;
  }

  /**
   * Extract token from WebSocket handshake
   * Token can come from:
   * 1. Handshake auth object (preferred)
   * 2. Query parameters (fallback)
   * 3. Headers (for HTTP long-polling)
   */
  private extractToken(client: AuthenticatedSocket): string | null {
    // Method 1: Auth object (preferred for Socket.IO v4+)
    const auth = client.handshake.auth?.token;
    if (auth) {
      return auth;
    }

    // Method 2: Query parameters (fallback)
    const queryToken = client.handshake.query?.token as string;
    if (queryToken) {
      return queryToken;
    }

    // Method 3: Authorization header (for HTTP long-polling)
    const headerAuth = client.handshake.headers?.authorization;
    if (headerAuth && typeof headerAuth === 'string') {
      const [type, token] = headerAuth.split(' ');
      if (type === 'Bearer' && token) {
        return token;
      }
    }

    return null;
  }

  /**
   * Try both authentication methods (mirrors KeycloakEnhancedAuthGuard.tryAuthentication)
   * Priority: API Key -> Keycloak JWT
   */
  private async tryAuthentication(
    token: string,
    client: AuthenticatedSocket,
  ): Promise<{
    success: boolean;
    authType?: 'api-key' | 'keycloak-jwt';
  }> {
    // 1. Try API Key authentication (highest priority)
    try {
      const isValidApiKey = await this.apiKeysService.validateApiKey(token);
      if (isValidApiKey) {
        client.authType = 'api-key';
        client.userId = 'api-key-user';
        this.logger.debug('WebSocket API Key authentication successful');
        return { success: true, authType: 'api-key' };
      }
    } catch (error) {
      this.logger.debug(
        `WebSocket API Key authentication failed: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
      );
    }

    // 2. Try Keycloak JWT authentication
    try {
      const keycloakUser = await this.validateKeycloakToken(token);
      if (keycloakUser) {
        client.authType = 'keycloak-jwt';
        client.userId = (keycloakUser.sub as string) || (keycloakUser.preferred_username as string);
        client.email = keycloakUser.email as string | undefined;
        const realmAccess = keycloakUser.realm_access as Record<string, unknown> | undefined;
        client.roles = (keycloakUser.roles as string[]) || (realmAccess?.roles as string[]) || [];

        // Extract organization and team from token if available
        // These would be custom claims added to Keycloak tokens
        client.organizationId = keycloakUser.organization_id as string | undefined;
        client.teamId = keycloakUser.team_id as string | undefined;

        this.logger.debug(
          `WebSocket Keycloak JWT authentication successful for user: ${client.userId}`,
        );
        return { success: true, authType: 'keycloak-jwt' };
      }
    } catch (error) {
      this.logger.debug(
        `WebSocket Keycloak JWT authentication failed: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
      );
    }

    return { success: false };
  }

  /**
   * Validate Keycloak JWT token (mirrors KeycloakEnhancedAuthGuard.validateKeycloakToken)
   */
  private async validateKeycloakToken(token: string): Promise<Record<string, unknown> | null> {
    try {
      const keycloakUrl = this.configService.get('KEYCLOAK_URL') || 'http://localhost:8080';
      const realm = this.configService.get('KEYCLOAK_REALM') || 'perfana-prod';
      const jwksUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/certs`;

      const { createRemoteJWKSet, jwtVerify } = await import('jose');
      const JWKS = createRemoteJWKSet(new URL(jwksUrl));

      // Support multiple issuers for Docker container vs localhost access
      const acceptedIssuersEnv = this.configService.get('KEYCLOAK_ACCEPTED_ISSUERS');
      let acceptedIssuers: string[];

      if (acceptedIssuersEnv) {
        acceptedIssuers = acceptedIssuersEnv.split(',').map((iss: string) => iss.trim());
      } else {
        acceptedIssuers = [
          `${keycloakUrl}/realms/${realm}`,
          `http://localhost:8080/realms/${realm}`,
        ];
      }

      // Validate audience to prevent tokens from other Keycloak clients being accepted
      const clientId = this.configService.get('KEYCLOAK_CLIENT_ID');
      const { payload } = await jwtVerify(token, JWKS, {
        issuer: acceptedIssuers,
        audience: clientId || undefined,
        clockTolerance: 60,
      });

      return payload;
    } catch (error) {
      this.logger.debug(
        `Keycloak JWT validation failed: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
      );
      return null;
    }
  }
}
