/**
 * Type definitions for Keycloak authentication
 *
 * These types provide proper TypeScript typing for Keycloak JWT tokens and
 * authentication-related structures, replacing the use of `any` types.
 */

/**
 * Keycloak JWT token payload
 * Based on standard OpenID Connect claims plus Keycloak-specific fields
 */
export interface KeycloakUser {
  /**
   * Subject - unique identifier for the user
   */
  sub: string;

  /**
   * User's email address
   */
  email?: string;

  /**
   * Full name of the user
   */
  name?: string;

  /**
   * Preferred username
   */
  preferred_username?: string;

  /**
   * Given name (first name)
   */
  given_name?: string;

  /**
   * Family name (last name)
   */
  family_name?: string;

  /**
   * Realm-level role assignments
   */
  realm_access?: {
    roles: string[];
  };

  /**
   * Client-specific role assignments
   */
  resource_access?: {
    [clientId: string]: {
      roles: string[];
    };
  };

  /**
   * Issuer of the token
   */
  iss?: string;

  /**
   * Audience - who the token is intended for
   */
  aud?: string | string[];

  /**
   * Issued at timestamp
   */
  iat?: number;

  /**
   * Expiration timestamp
   */
  exp?: number;

  /**
   * Direct role assignments (custom field)
   */
  roles?: string[];

  /**
   * Additional custom claims
   */
  [key: string]: unknown;
}

/**
 * HTTP request headers with authentication
 * Extends standard headers with authentication-specific fields
 */
export interface AuthRequestHeaders {
  /**
   * Authorization header (Bearer token)
   */
  authorization?: string;

  /**
   * API key header (alternative auth method)
   */
  'x-api-key'?: string;

  /**
   * Content-Type header
   */
  'content-type'?: string;

  /**
   * Additional headers
   */
  [key: string]: string | string[] | undefined;
}
