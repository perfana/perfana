/**
 * Unit tests for Keycloak Authentication Service
 *
 * Tests the KeycloakAuthService singleton class that manages:
 * - Keycloak initialization and configuration
 * - Authentication state and token management
 * - Token refresh logic
 * - User information retrieval
 * - Role-based access control
 */

// Declare mock variables that will be assigned in jest.mock factory
// Using var for proper hoisting and module-level scope
var mockKeycloakInstance: any;
var mockKeycloakInit: jest.Mock;
var mockKeycloakLogin: jest.Mock;
var mockKeycloakLogout: jest.Mock;
var mockKeycloakUpdateToken: jest.Mock;
var mockKeycloakHasRealmRole: jest.Mock;
var mockKeycloakCreateAccountUrl: jest.Mock;

// Mock Keycloak constructor - assign to module-level vars
jest.mock('keycloak-js', () => {
  const init = jest.fn();
  const login = jest.fn();
  const logout = jest.fn();
  const updateToken = jest.fn();
  const hasRealmRole = jest.fn();
  const createAccountUrl = jest.fn();

  const instance = {
    init,
    login,
    logout,
    updateToken,
    hasRealmRole,
    createAccountUrl,
    token: undefined as string | undefined,
    refreshToken: undefined as string | undefined,
    authenticated: false,
    subject: undefined as string | undefined,
    tokenParsed: undefined as any,
  };

  // Assign to module-level variables for test access
  mockKeycloakInit = init;
  mockKeycloakLogin = login;
  mockKeycloakLogout = logout;
  mockKeycloakUpdateToken = updateToken;
  mockKeycloakHasRealmRole = hasRealmRole;
  mockKeycloakCreateAccountUrl = createAccountUrl;
  mockKeycloakInstance = instance;

  return jest.fn(() => instance);
});

import KeycloakAuthService from '@/lib/keycloak-auth';
import type { UserInfo } from '@/lib/keycloak-auth';

// Mock sessionStorage (implementation uses sessionStorage, not localStorage)
const sessionStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'sessionStorage', {
  value: sessionStorageMock,
  writable: true,
});

// Mock window.location
delete (window as any).location;
window.location = {
  href: 'http://localhost:3000',
  origin: 'http://localhost:3000',
} as any;

describe('KeycloakAuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorageMock.clear();

    // Reset mock instance state
    mockKeycloakInstance.token = undefined;
    mockKeycloakInstance.refreshToken = undefined;
    mockKeycloakInstance.authenticated = false;
    mockKeycloakInstance.subject = undefined;
    mockKeycloakInstance.tokenParsed = undefined;
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance when getInstance is called multiple times', () => {
      const instance1 = KeycloakAuthService;
      const instance2 = KeycloakAuthService;

      expect(instance1).toBe(instance2);
    });
  });

  describe('init()', () => {
    it('should initialize Keycloak with correct configuration', async () => {
      // Arrange
      mockKeycloakInit.mockResolvedValue(true);
      mockKeycloakInstance.authenticated = true;
      mockKeycloakInstance.token = 'mock-token-123';
      mockKeycloakInstance.refreshToken = 'mock-refresh-token-456';
      mockKeycloakInstance.subject = 'user-123';

      // Act
      const authenticated = await KeycloakAuthService.init();

      // Assert - silentCheckSsoRedirectUri is disabled in implementation
      expect(mockKeycloakInit).toHaveBeenCalledWith(
        expect.objectContaining({
          onLoad: 'check-sso',
          silentCheckSsoFallback: false,
          pkceMethod: 'S256',
          checkLoginIframe: false,
          enableLogging: true,
          flow: 'standard',
        })
      );
      expect(authenticated).toBe(true);
    });

    it('should store tokens in localStorage when authentication succeeds', async () => {
      // Arrange
      mockKeycloakInit.mockResolvedValue(true);
      mockKeycloakInstance.authenticated = true;
      mockKeycloakInstance.token = 'mock-token-123';
      mockKeycloakInstance.refreshToken = 'mock-refresh-token-456';

      // Act
      await KeycloakAuthService.init();

      // Assert
      expect(sessionStorageMock.getItem('perfana_access_token')).toBe('mock-token-123');
      expect(sessionStorageMock.getItem('perfana_refresh_token')).toBe('mock-refresh-token-456');
    });

    it('should return false when user is not authenticated', async () => {
      // Arrange
      mockKeycloakInit.mockResolvedValue(false);
      mockKeycloakInstance.authenticated = false;

      // Act
      const authenticated = await KeycloakAuthService.init();

      // Assert
      expect(authenticated).toBe(false);
      expect(sessionStorageMock.getItem('perfana_access_token')).toBeNull();
    });

    it('should handle initialization errors gracefully', async () => {
      // Arrange
      const error = new Error('Keycloak initialization failed');
      mockKeycloakInit.mockRejectedValue(error);

      // Act
      const authenticated = await KeycloakAuthService.init();

      // Assert
      expect(authenticated).toBe(false);
    });

    it('should setup token refresh interval when authentication succeeds', async () => {
      // Arrange
      jest.useFakeTimers();
      mockKeycloakInit.mockResolvedValue(true);
      mockKeycloakInstance.authenticated = true;
      mockKeycloakInstance.token = 'mock-token-123';
      mockKeycloakUpdateToken.mockResolvedValue(true);

      // Act
      await KeycloakAuthService.init();

      // Fast-forward time by 60 seconds
      jest.advanceTimersByTime(60000);

      // Assert
      expect(mockKeycloakUpdateToken).toHaveBeenCalledWith(30);

      jest.useRealTimers();
    });
  });

  describe('login()', () => {
    it('should call Keycloak login with redirect URI', async () => {
      // Arrange
      mockKeycloakLogin.mockResolvedValue(undefined);

      // Act
      await KeycloakAuthService.login();

      // Assert
      expect(mockKeycloakLogin).toHaveBeenCalledWith({
        redirectUri: 'http://localhost:3000',
      });
    });
  });

  describe('logout()', () => {
    it('should clear tokens from localStorage and call Keycloak logout', async () => {
      // Arrange
      sessionStorageMock.setItem('perfana_access_token', 'token-123');
      sessionStorageMock.setItem('perfana_refresh_token', 'refresh-token-456');
      mockKeycloakLogout.mockResolvedValue(undefined);

      // Act
      await KeycloakAuthService.logout();

      // Assert
      expect(sessionStorageMock.getItem('perfana_access_token')).toBeNull();
      expect(sessionStorageMock.getItem('perfana_refresh_token')).toBeNull();
      expect(mockKeycloakLogout).toHaveBeenCalledWith({
        redirectUri: 'http://localhost:3000',
      });
    });
  });

  describe('getToken()', () => {
    it('should return the current token', () => {
      // Arrange
      mockKeycloakInstance.token = 'mock-token-abc';

      // Act
      const token = KeycloakAuthService.getToken();

      // Assert
      expect(token).toBe('mock-token-abc');
    });

    it('should return undefined when no token exists', () => {
      // Arrange
      mockKeycloakInstance.token = undefined;

      // Act
      const token = KeycloakAuthService.getToken();

      // Assert
      expect(token).toBeUndefined();
    });
  });

  describe('updateToken()', () => {
    it('should update token with default minValidity of 5 seconds', async () => {
      // Arrange
      mockKeycloakUpdateToken.mockResolvedValue(true);
      mockKeycloakInstance.token = 'new-token-123';
      mockKeycloakInstance.refreshToken = 'new-refresh-token-456';

      // Act
      const refreshed = await KeycloakAuthService.updateToken();

      // Assert
      expect(mockKeycloakUpdateToken).toHaveBeenCalledWith(5);
      expect(refreshed).toBe(true);
    });

    it('should update token with custom minValidity', async () => {
      // Arrange
      mockKeycloakUpdateToken.mockResolvedValue(true);
      mockKeycloakInstance.token = 'new-token-123';

      // Act
      const refreshed = await KeycloakAuthService.updateToken(30);

      // Assert
      expect(mockKeycloakUpdateToken).toHaveBeenCalledWith(30);
      expect(refreshed).toBe(true);
    });

    it('should store new tokens in localStorage when refresh succeeds', async () => {
      // Arrange
      mockKeycloakUpdateToken.mockResolvedValue(true);
      mockKeycloakInstance.token = 'new-token-123';
      mockKeycloakInstance.refreshToken = 'new-refresh-token-456';

      // Act
      await KeycloakAuthService.updateToken();

      // Assert
      expect(sessionStorageMock.getItem('perfana_access_token')).toBe('new-token-123');
      expect(sessionStorageMock.getItem('perfana_refresh_token')).toBe('new-refresh-token-456');
    });

    it('should return false when token refresh fails', async () => {
      // Arrange
      mockKeycloakUpdateToken.mockRejectedValue(new Error('Token refresh failed'));

      // Act
      const refreshed = await KeycloakAuthService.updateToken();

      // Assert
      expect(refreshed).toBe(false);
    });

    it('should not update localStorage when refresh returns false', async () => {
      // Arrange
      mockKeycloakUpdateToken.mockResolvedValue(false);
      sessionStorageMock.setItem('perfana_access_token', 'old-token');

      // Act
      const refreshed = await KeycloakAuthService.updateToken();

      // Assert
      expect(refreshed).toBe(false);
      expect(sessionStorageMock.getItem('perfana_access_token')).toBe('old-token');
    });
  });

  describe('getUserInfo()', () => {
    it('should return user info from parsed token', () => {
      // Arrange
      mockKeycloakInstance.tokenParsed = {
        sub: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        given_name: 'Test',
        family_name: 'User',
        realm_access: {
          roles: ['user', 'admin'],
        },
        organizations: ['org-1', 'org-2'],
        teams: ['team-a', 'team-b'],
      };

      // Act
      const userInfo = KeycloakAuthService.getUserInfo();

      // Assert
      expect(userInfo).toEqual({
        sub: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        given_name: 'Test',
        family_name: 'User',
        roles: ['user', 'admin'],
        organizations: ['org-1', 'org-2'],
        teams: ['team-a', 'team-b'],
      });
    });

    it('should return null when token is not parsed', () => {
      // Arrange
      mockKeycloakInstance.tokenParsed = undefined;

      // Act
      const userInfo = KeycloakAuthService.getUserInfo();

      // Assert
      expect(userInfo).toBeNull();
    });

    it('should handle missing optional fields', () => {
      // Arrange
      mockKeycloakInstance.tokenParsed = {
        sub: 'user-123',
        email: 'test@example.com',
        // name, given_name, family_name are optional
        realm_access: {
          roles: ['user'],
        },
        // organizations and teams are optional
      };

      // Act
      const userInfo = KeycloakAuthService.getUserInfo();

      // Assert
      expect(userInfo).toEqual({
        sub: 'user-123',
        email: 'test@example.com',
        name: undefined,
        given_name: undefined,
        family_name: undefined,
        roles: ['user'],
        organizations: [],
        teams: [],
      });
    });

    it('should handle missing realm_access', () => {
      // Arrange
      mockKeycloakInstance.tokenParsed = {
        sub: 'user-123',
        email: 'test@example.com',
        // realm_access is missing
      };

      // Act
      const userInfo = KeycloakAuthService.getUserInfo();

      // Assert
      expect(userInfo?.roles).toEqual([]);
    });
  });

  describe('hasRole()', () => {
    it('should return true when user has the specified role', () => {
      // Arrange
      mockKeycloakHasRealmRole.mockReturnValue(true);

      // Act
      const hasRole = KeycloakAuthService.hasRole('admin');

      // Assert
      expect(mockKeycloakHasRealmRole).toHaveBeenCalledWith('admin');
      expect(hasRole).toBe(true);
    });

    it('should return false when user does not have the specified role', () => {
      // Arrange
      mockKeycloakHasRealmRole.mockReturnValue(false);

      // Act
      const hasRole = KeycloakAuthService.hasRole('admin');

      // Assert
      expect(mockKeycloakHasRealmRole).toHaveBeenCalledWith('admin');
      expect(hasRole).toBe(false);
    });
  });

  describe('hasAnyRole()', () => {
    it('should return true when user has at least one of the specified roles', () => {
      // Arrange
      mockKeycloakHasRealmRole.mockImplementation((role: string) => {
        return role === 'user';
      });

      // Act
      const hasAnyRole = KeycloakAuthService.hasAnyRole(['admin', 'user', 'guest']);

      // Assert
      expect(hasAnyRole).toBe(true);
    });

    it('should return false when user has none of the specified roles', () => {
      // Arrange
      mockKeycloakHasRealmRole.mockReturnValue(false);

      // Act
      const hasAnyRole = KeycloakAuthService.hasAnyRole(['admin', 'moderator']);

      // Assert
      expect(hasAnyRole).toBe(false);
    });

    it('should return false when roles array is empty', () => {
      // Act
      const hasAnyRole = KeycloakAuthService.hasAnyRole([]);

      // Assert
      expect(hasAnyRole).toBe(false);
    });
  });

  describe('isAuthenticated()', () => {
    it('should return true when user is authenticated', () => {
      // Arrange
      mockKeycloakInstance.authenticated = true;

      // Act
      const isAuthenticated = KeycloakAuthService.isAuthenticated();

      // Assert
      expect(isAuthenticated).toBe(true);
    });

    it('should return false when user is not authenticated', () => {
      // Arrange
      mockKeycloakInstance.authenticated = false;

      // Act
      const isAuthenticated = KeycloakAuthService.isAuthenticated();

      // Assert
      expect(isAuthenticated).toBe(false);
    });

    it('should return false when authenticated property is undefined', () => {
      // Arrange
      mockKeycloakInstance.authenticated = undefined as any;

      // Act
      const isAuthenticated = KeycloakAuthService.isAuthenticated();

      // Assert
      expect(isAuthenticated).toBe(false);
    });
  });

  describe('getAccountUrl()', () => {
    it('should return the Keycloak account URL', () => {
      // Arrange
      const accountUrl = 'http://keycloak.example.com/account';
      mockKeycloakCreateAccountUrl.mockReturnValue(accountUrl);

      // Act
      const url = KeycloakAuthService.getAccountUrl();

      // Assert
      expect(mockKeycloakCreateAccountUrl).toHaveBeenCalled();
      expect(url).toBe(accountUrl);
    });
  });

  describe('getAuthHeader()', () => {
    it('should return Authorization header with Bearer token when token exists', () => {
      // Arrange
      mockKeycloakInstance.token = 'mock-token-xyz';

      // Act
      const header = KeycloakAuthService.getAuthHeader();

      // Assert
      expect(header).toEqual({
        Authorization: 'Bearer mock-token-xyz',
      });
    });

    it('should return empty object when token does not exist', () => {
      // Arrange
      mockKeycloakInstance.token = undefined;

      // Act
      const header = KeycloakAuthService.getAuthHeader();

      // Assert
      expect(header).toEqual({});
    });
  });

  describe('Token Refresh Interval', () => {
    it('should call logout when token refresh fails during interval check', async () => {
      // Arrange
      jest.useFakeTimers();
      mockKeycloakInit.mockResolvedValue(true);
      mockKeycloakInstance.authenticated = true;
      mockKeycloakInstance.token = 'mock-token-123';
      mockKeycloakLogout.mockResolvedValue(undefined);

      await KeycloakAuthService.init();

      // Simulate token refresh failure
      mockKeycloakUpdateToken.mockRejectedValue(new Error('Token refresh failed'));

      // Act - advance timers to trigger the interval
      jest.advanceTimersByTime(60000);

      // Flush the promise queue to let the catch handler execute
      await jest.runOnlyPendingTimersAsync();

      // Assert
      expect(mockKeycloakLogout).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('should update tokens in localStorage when auto-refresh succeeds', async () => {
      // Arrange
      jest.useFakeTimers();
      mockKeycloakInit.mockResolvedValue(true);
      mockKeycloakInstance.authenticated = true;
      mockKeycloakInstance.token = 'old-token';

      await KeycloakAuthService.init();

      // Update token for refresh
      mockKeycloakUpdateToken.mockResolvedValue(true);
      mockKeycloakInstance.token = 'refreshed-token';
      mockKeycloakInstance.refreshToken = 'refreshed-refresh-token';

      // Act
      jest.advanceTimersByTime(60000);
      await Promise.resolve();

      // Assert
      expect(sessionStorageMock.getItem('perfana_access_token')).toBe('refreshed-token');
      expect(sessionStorageMock.getItem('perfana_refresh_token')).toBe('refreshed-refresh-token');

      jest.useRealTimers();
    });
  });
});
