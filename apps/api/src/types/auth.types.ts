import { KeycloakUser } from '../modules/auth/keycloak-jwt.service';
import { QueryRunner } from 'typeorm';
import { Request } from 'express';

/**
 * Authentication types supported by the API
 */
export type AuthType = 'api-key' | 'keycloak-jwt';

/**
 * API key information extracted during authentication
 */
export interface ApiKeyInfo {
  id: string;
  description: string;
  roles: string[];
  validUntil?: Date;
  organization_id?: string;
}

/**
 * Session context set by DatabaseSessionMiddleware
 */
export interface SessionContext {
  userId?: string;
  email?: string;
  roles?: string[];
  organizations?: string[];
  teams?: string[];
  authType?: string;
  sessionId?: string;
  apiKeyId?: string; // ID of the API key if authenticated via API key
}

/**
 * Extended Express Request interface with authentication information
 * Used by guards and middleware to attach user context
 */
export interface AuthenticatedRequest extends Request {
  user?: KeycloakUser;
  keycloakUser?: KeycloakUser;
  apiKey?: ApiKeyInfo; // API key details if authenticated via API key
  authType?: AuthType;
  queryRunner?: QueryRunner;
  sessionContext?: SessionContext;
}
