import Keycloak from 'keycloak-js';
import { env } from './env';

interface UserInfo {
  sub: string;
  email: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  roles: string[];
  organizations?: string[];
  teams?: string[];
}

class KeycloakAuthService {
  private keycloak: Keycloak | null = null;
  private static instance: KeycloakAuthService;

  private constructor() {
    // Keycloak instance is created lazily in init() to ensure runtime config is loaded first
  }

  static getInstance(): KeycloakAuthService {
    if (!KeycloakAuthService.instance) {
      KeycloakAuthService.instance = new KeycloakAuthService();
    }
    return KeycloakAuthService.instance;
  }

  private getKeycloak(): Keycloak {
    if (!this.keycloak) {
      // Create Keycloak instance with current env values (after runtime config is loaded)
      this.keycloak = new Keycloak({
        url: env.KEYCLOAK_URL,
        realm: env.KEYCLOAK_REALM,
        clientId: env.KEYCLOAK_CLIENT_ID,
      });
    }
    return this.keycloak;
  }

  async init(): Promise<boolean> {
    try {
      const initConfig = {
        onLoad: 'check-sso' as const,
        silentCheckSsoFallback: false,
        pkceMethod: 'S256' as const,
        checkLoginIframe: false,
        enableLogging: true,
        flow: 'standard' as const
      };

      const keycloak = this.getKeycloak();
      const authenticated = await keycloak.init(initConfig);

      if (authenticated) {
        this.setupTokenRefresh();
        this.storeTokens();
      }

      return authenticated;
    } catch (error) {
      console.warn('Keycloak initialization failed:', error);
      return false;
    }
  }

  private setupTokenRefresh() {
    // Check token validity every minute and refresh if needed
    setInterval(() => {
      this.getKeycloak().updateToken(30).then(refreshed => {
        if (refreshed) {
          this.storeTokens();
        }
      }).catch(() => {
        console.warn('Failed to refresh token, logging out');
        this.logout();
      });
    }, 60000);
  }

  private storeTokens() {
    const keycloak = this.getKeycloak();
    if (keycloak.token) {
      sessionStorage.setItem('perfana_access_token', keycloak.token);
    }
    if (keycloak.refreshToken) {
      sessionStorage.setItem('perfana_refresh_token', keycloak.refreshToken);
    }
  }

  login(): Promise<void> {
    const returnTo = sessionStorage.getItem('perfana_return_to');
    sessionStorage.removeItem('perfana_return_to');

    let redirectUri: string;
    if (returnTo) {
      redirectUri = window.location.origin + returnTo;
    } else if (window.location.pathname === '/signin') {
      redirectUri = window.location.origin;
    } else {
      // Called from 401 handler while still on the original page
      redirectUri = window.location.href;
    }

    return this.getKeycloak().login({ redirectUri });
  }

  logout(): Promise<void> {
    sessionStorage.removeItem('perfana_access_token');
    sessionStorage.removeItem('perfana_refresh_token');
    return this.getKeycloak().logout({
      redirectUri: window.location.origin
    });
  }

  getToken(): string | undefined {
    return this.getKeycloak().token;
  }

  async updateToken(minValidity: number = 5): Promise<boolean> {
    try {
      const refreshed = await this.getKeycloak().updateToken(minValidity);
      if (refreshed) {
        this.storeTokens();
      }
      return refreshed;
    } catch (error) {
      console.error('Token update failed', error);
      return false;
    }
  }

  getUserInfo(): UserInfo | null {
    const tokenParsed = this.getKeycloak().tokenParsed;
    if (!tokenParsed) return null;

    return {
      sub: tokenParsed.sub!,
      email: tokenParsed.email!,
      name: tokenParsed.name,
      given_name: tokenParsed.given_name,
      family_name: tokenParsed.family_name,
      roles: tokenParsed.realm_access?.roles || [],
      organizations: tokenParsed.organizations || [],
      teams: tokenParsed.teams || []
    };
  }

  hasRole(role: string): boolean {
    return this.getKeycloak().hasRealmRole(role);
  }

  hasAnyRole(roles: string[]): boolean {
    return roles.some(role => this.hasRole(role));
  }

  isAuthenticated(): boolean {
    return this.getKeycloak().authenticated || false;
  }

  getAccountUrl(): string {
    return this.getKeycloak().createAccountUrl();
  }

  // Method to handle token for API calls
  getAuthHeader(): { Authorization: string } | Record<string, unknown> {
    const token = this.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
}

export default KeycloakAuthService.getInstance();
export type { UserInfo };