import { KeycloakUser } from '../modules/auth/keycloak-jwt.service';
import { Request } from 'express';

/**
 * Authentication types supported by the API
 */
type AuthType = 'api-key' | 'keycloak-jwt';

/**
 * API key information extracted during authentication
 */
interface ApiKeyInfo {
  id: string;
  description: string;
  roles: string[];
  validUntil?: Date;
  organization_id?: string;
}

/**
 * Extended Express Request interface with authentication information
 * Used by guards to attach user context
 */
export interface AuthenticatedRequest extends Request {
  user?: KeycloakUser;
  keycloakUser?: KeycloakUser;
  apiKey?: ApiKeyInfo; // API key details if authenticated via API key
  authType?: AuthType;
}
