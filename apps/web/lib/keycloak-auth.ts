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
    // Store debug logs for the current session (cleared when tab closes)
    const persistLog = (message: string, data?: any) => {
      const timestamp = new Date().toISOString();
      const logs = JSON.parse(sessionStorage.getItem('perfana_debug_logs') || '[]');
      logs.push({ timestamp, message, data });
      // Keep only last 50 logs
      if (logs.length > 50) logs.splice(0, logs.length - 50);
      sessionStorage.setItem('perfana_debug_logs', JSON.stringify(logs));
      console.log(message, data);
    };

    persistLog('🚀 Keycloak init() called', {
      url: env.KEYCLOAK_URL,
      realm: env.KEYCLOAK_REALM,
      clientId: env.KEYCLOAK_CLIENT_ID,
      currentUrl: window.location.href
    });

    try {
      const initConfig = {
        onLoad: 'check-sso' as const,
        // Disable silent SSO check - causes iframe timeout issues in some environments
        // silentCheckSsoRedirectUri: window.location.origin + '/silent-check-sso.html',
        silentCheckSsoFallback: false,
        pkceMethod: 'S256' as const,
        checkLoginIframe: false, // Disable iframe check for better compatibility
        enableLogging: true,
        flow: 'standard' as const
      };

      persistLog('🔧 Keycloak init config:', initConfig);

      const keycloak = this.getKeycloak();
      const authenticated = await keycloak.init(initConfig);

      persistLog('🔐 Keycloak init result:', {
        authenticated,
        token: keycloak.token ? 'present' : 'missing',
        refreshToken: keycloak.refreshToken ? 'present' : 'missing',
        subject: keycloak.subject
      });

      if (authenticated) {
        this.setupTokenRefresh();
        this.storeTokens();
        persistLog('✅ Keycloak authentication successful');
      } else {
        persistLog('❌ Keycloak authentication failed or user not authenticated');
      }

      return authenticated;
    } catch (error) {
      persistLog('🚨 Keycloak initialization failed', error);
      return false;
    }
  }

  private setupTokenRefresh() {
    // Check token validity every minute and refresh if needed
    setInterval(() => {
      this.getKeycloak().updateToken(30).then(refreshed => {
        if (refreshed) {
          this.storeTokens();
          console.log('Token refreshed successfully');
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
  getAuthHeader(): { Authorization: string } | {} {
    const token = this.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
}

export default KeycloakAuthService.getInstance();
export type { UserInfo };