import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify, JWTPayload, JWTVerifyGetKey } from 'jose';

export interface KeycloakUser {
  sub: string;
  email?: string;
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
  roles?: string[]; // Made optional to match shared type
  organizations?: string[];
  teams?: string[];
  sessionId?: string;
  exp?: number;
  iat?: number;
  aud?: string | string[];
  iss?: string;
}

interface RealmAccess {
  roles: string[];
}

interface ResourceAccess {
  [client: string]: {
    roles: string[];
  };
}

interface JWKSKey {
  kty: string;
  use?: string;
  kid: string;
  n?: string;
  e?: string;
  alg?: string;
}

interface JWKSResponse {
  keys: JWKSKey[];
}

interface OIDCWellKnownConfig {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
  [key: string]: unknown;
}

interface JoseError extends Error {
  code: string;
}

@Injectable()
export class KeycloakJwtService {
  private readonly logger = new Logger(KeycloakJwtService.name);
  private readonly jwks: JWTVerifyGetKey;
  private readonly issuer: string;
  private readonly acceptedIssuers: string[];
  private readonly keycloakUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.keycloakUrl = this.configService.get('KEYCLOAK_URL') || 'http://localhost:8080';
    const realm = this.configService.get('KEYCLOAK_REALM') || 'perfana-prod';
    this.issuer = `${this.keycloakUrl}/realms/${realm}`;

    // Support multiple issuers for Docker container vs localhost access
    const acceptedIssuersEnv = this.configService.get('KEYCLOAK_ACCEPTED_ISSUERS');
    if (acceptedIssuersEnv) {
      // Parse comma-separated list of accepted issuers
      this.acceptedIssuers = acceptedIssuersEnv.split(',').map((iss: string) => iss.trim());
    } else {
      // Default: accept both internal (keycloak:8080) and external (localhost:8080) issuers
      this.acceptedIssuers = [
        this.issuer,
        `http://localhost:8080/realms/${realm}`,
      ];
    }

    const jwksUrl = `${this.issuer}/protocol/openid-connect/certs`;
    this.jwks = createRemoteJWKSet(new URL(jwksUrl));

    this.logger.log(`Keycloak JWT Service initialized`);
    this.logger.log(`Issuer: ${this.issuer}`);
    this.logger.log(`Accepted Issuers: ${this.acceptedIssuers.join(', ')}`);
    this.logger.log(`JWKS URL: ${jwksUrl}`);
  }

  async validateToken(token: string): Promise<KeycloakUser> {
    try {
      // Verify the JWT token using JWKS (issuer + signature)
      // Audience validation is not needed — Perfana is a single-application system
      // where any valid token from the realm is accepted by the API.
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.acceptedIssuers,
        clockTolerance: 60, // Allow 60 seconds clock skew
      });

      // Extract user information from the JWT payload
      const user = this.extractUserFromPayload(payload);

      this.logger.debug(`JWT token validated for user: ${user.sub} (${user.email})`);

      return user;
    } catch (error) {
      this.logger.warn(`JWT validation failed: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);

      if (error && typeof error === 'object' && 'code' in error) {
        const errorCode = (error as JoseError).code;
        if (errorCode === 'ERR_JWT_EXPIRED') {
          throw new UnauthorizedException('JWT token has expired');
        } else if (errorCode === 'ERR_JWT_INVALID') {
          throw new UnauthorizedException('Invalid JWT token');
        } else if (errorCode === 'ERR_JWKS_NO_MATCHING_KEY') {
          throw new UnauthorizedException('No matching key found in JWKS');
        } else if (errorCode === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
          throw new UnauthorizedException('JWT claim validation failed');
        }
      }

      throw new UnauthorizedException('Invalid Keycloak token');
    }
  }

  private extractUserFromPayload(payload: JWTPayload): KeycloakUser {
    // Extract realm roles
    const realmAccess = payload.realm_access as RealmAccess | undefined;
    const roles = realmAccess?.roles || [];

    // Extract resource roles (client-specific roles) from the authorized party
    const resourceAccess = payload.resource_access as ResourceAccess | undefined;
    const azp = payload.azp as string | undefined;
    const clientRoles = (azp && resourceAccess?.[azp]?.roles) || [];

    // Combine realm and client roles
    const allRoles = [...roles, ...clientRoles];

    // Extract custom claims
    const organizations = payload.organizations as string[] || [];
    const teams = payload.teams as string[] || [];

    return {
      sub: payload.sub!,
      email: payload.email as string,
      preferred_username: payload.preferred_username as string,
      given_name: payload.given_name as string,
      family_name: payload.family_name as string,
      roles: allRoles,
      organizations,
      teams,
      sessionId: payload.sid as string,
      exp: payload.exp,
      iat: payload.iat,
      aud: payload.aud,
      iss: payload.iss,
    };
  }

  /**
   * Check if a user has a specific role
   */
  hasRole(user: KeycloakUser, role: string): boolean {
    return user.roles?.includes(role) ?? false;
  }

  /**
   * Check if a user has any of the specified roles
   */
  hasAnyRole(user: KeycloakUser, roles: string[]): boolean {
    return roles.some(role => user.roles?.includes(role) ?? false);
  }

  /**
   * Check if a user has all of the specified roles
   */
  hasAllRoles(user: KeycloakUser, roles: string[]): boolean {
    return roles.every(role => user.roles?.includes(role) ?? false);
  }

  /**
   * Get the well-known OpenID Connect configuration
   */
  async getWellKnownConfig(): Promise<OIDCWellKnownConfig> {
    try {
      const response = await fetch(`${this.issuer}/.well-known/openid_configuration`);
      return await response.json() as OIDCWellKnownConfig;
    } catch (error) {
      this.logger.error(`Failed to fetch well-known config: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
      throw new Error('Failed to fetch Keycloak configuration');
    }
  }

  /**
   * Get JWKS (JSON Web Key Set) for manual key verification
   */
  async getJWKS(): Promise<JWKSResponse> {
    try {
      const response = await fetch(`${this.issuer}/protocol/openid-connect/certs`);
      return await response.json() as JWKSResponse;
    } catch (error) {
      this.logger.error(`Failed to fetch JWKS: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
      throw new Error('Failed to fetch JWKS');
    }
  }

  /**
   * Validate token without throwing exceptions (returns boolean)
   */
  async isValidToken(token: string): Promise<boolean> {
    try {
      await this.validateToken(token);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Extract token from Authorization header
   */
  static extractTokenFromHeader(authHeader: string | undefined): string | null {
    if (!authHeader) {
      return null;
    }

    const [type, token] = authHeader.split(' ');

    if (type !== 'Bearer' || !token) {
      return null;
    }

    return token;
  }
}