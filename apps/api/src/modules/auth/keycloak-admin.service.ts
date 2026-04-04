import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export interface KeycloakUserInfo {
  id: string; // Keycloak user ID (sub claim)
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
  emailVerified: boolean;
}

export interface UserSearchParams {
  search?: string; // Search in username, email, first/last name
  email?: string; // Exact email match
  username?: string; // Exact username match
  first?: number; // Pagination offset
  max?: number; // Max results (default 20)
}

@Injectable()
export class KeycloakAdminService {
  private readonly logger = new Logger(KeycloakAdminService.name);
  private readonly keycloakUrl: string;
  private readonly realm: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private accessToken: string | null = null;
  private tokenExpiry: number | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.keycloakUrl = this.configService.get('KEYCLOAK_URL') || 'http://localhost:8080';
    this.realm = this.configService.get('KEYCLOAK_REALM') || 'perfana';
    this.clientId = this.configService.get('KEYCLOAK_ADMIN_CLIENT_ID') || 'admin-cli';
    this.clientSecret = this.configService.get('KEYCLOAK_ADMIN_CLIENT_SECRET') || '';

    if (!this.clientSecret) {
      this.logger.warn('KEYCLOAK_ADMIN_CLIENT_SECRET not configured - user search will not work');
    }

    this.logger.log('Keycloak Admin Service initialized');
  }

  /**
   * Get an admin access token using client credentials
   */
  private async getAdminToken(): Promise<string> {
    // Return cached token if still valid
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken; // TypeScript knows this is string here due to truthiness check
    }

    try {
      const tokenUrl = `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/token`;

      const response = await firstValueFrom(
        this.httpService.post(
          tokenUrl,
          new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: this.clientId,
            client_secret: this.clientSecret,
          }),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          },
        ),
      );

      const token: string = response.data.access_token;
      this.accessToken = token;

      // Set expiry to 90% of the token lifetime to ensure we refresh before it expires
      const expiresIn = response.data.expires_in || 300; // Default 5 minutes
      this.tokenExpiry = Date.now() + expiresIn * 1000 * 0.9;

      this.logger.debug('Admin token acquired successfully');
      return token;
    } catch (error) {
      this.logger.error(
        `Failed to get admin token: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
      );
      throw new Error('Failed to authenticate with Keycloak Admin API');
    }
  }

  /**
   * Search for users in Keycloak
   */
  async searchUsers(params: UserSearchParams): Promise<KeycloakUserInfo[]> {
    if (!this.clientSecret) {
      this.logger.warn('KEYCLOAK_ADMIN_CLIENT_SECRET not configured - returning empty results');
      return [];
    }

    try {
      const token = await this.getAdminToken();

      const queryParams = new URLSearchParams();
      if (params.search) queryParams.append('search', params.search);
      if (params.email) queryParams.append('email', params.email);
      if (params.username) queryParams.append('username', params.username);
      queryParams.append('first', String(params.first || 0));
      queryParams.append('max', String(params.max || 20));

      const searchUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/users?${queryParams.toString()}`;

      this.logger.debug(`Searching users with params: ${JSON.stringify(params)}`);

      const response = await firstValueFrom(
        this.httpService.get(searchUrl, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }),
      );

      const users: KeycloakUserInfo[] = response.data.map((user: Record<string, unknown>) => ({
        id: user.id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        enabled: user.enabled,
        emailVerified: user.emailVerified,
      }));

      this.logger.debug(`Found ${users.length} users`);

      return users;
    } catch (error) {
      this.logger.error(
        `Failed to search users: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
      );
      throw new Error('Failed to search users in Keycloak');
    }
  }

  /**
   * Get a single user by ID
   */
  async getUserById(userId: string): Promise<KeycloakUserInfo | null> {
    if (!this.clientSecret) {
      this.logger.warn('KEYCLOAK_ADMIN_CLIENT_SECRET not configured');
      return null;
    }

    try {
      const token = await this.getAdminToken();

      const userUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}`;

      const response = await firstValueFrom(
        this.httpService.get(userUrl, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }),
      );

      const user = response.data;

      return {
        id: user.id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        enabled: user.enabled,
        emailVerified: user.emailVerified,
      };
    } catch (error) {
      if (error && typeof error === 'object' && 'response' in error) {
        const httpError = error as { response: { status: number } };
        if (httpError.response.status === 404) {
          return null;
        }
      }

      this.logger.error(
        `Failed to get user by ID: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
      );
      throw new Error('Failed to get user from Keycloak');
    }
  }
}
