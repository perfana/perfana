/**
 * Unit tests for Environment Configuration
 *
 * Tests environment variable validation and configuration:
 * - Required environment variables validation
 * - Default values fallback
 * - Type-safe environment configuration
 * - Runtime config support (window.__ENV__)
 */

describe('Environment Configuration', () => {
  const originalEnv = process.env;
  const originalWindow = global.window;

  beforeEach(() => {
    // Reset modules to clear any cached env
    jest.resetModules();

    // Clear environment variables
    process.env = { ...originalEnv };

    // Setup window for client-side tests (without __ENV__)
    (global as any).window = {} as any;
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    (global as any).window = originalWindow;
  });

  describe('Environment Variable Defaults', () => {
    it('should use default values when env vars are not set', () => {
      // Arrange - delete window to skip client-side validation
      delete (global as any).window;
      delete process.env.NEXT_PUBLIC_API_URL;
      delete process.env.NEXT_PUBLIC_KEYCLOAK_URL;
      delete process.env.NEXT_PUBLIC_KEYCLOAK_REALM;
      delete process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID;
      delete process.env.NEXT_PUBLIC_USE_KEYCLOAK_AUTH;

      // Act
      const { env } = require('@/lib/env');

      // Assert
      expect(env.API_URL).toBe('http://localhost:3001/api');
      expect(env.KEYCLOAK_URL).toBe('http://localhost:8080');
      expect(env.KEYCLOAK_REALM).toBe('perfana-prod');
      expect(env.KEYCLOAK_CLIENT_ID).toBe('perfana-web');
      expect(env.USE_KEYCLOAK_AUTH).toBe(false);
    });

    it('should use environment variables when provided', () => {
      // Arrange
      process.env.NEXT_PUBLIC_API_URL = 'https://api.production.com/api';
      process.env.NEXT_PUBLIC_KEYCLOAK_URL = 'https://keycloak.production.com';
      process.env.NEXT_PUBLIC_KEYCLOAK_REALM = 'production-realm';
      process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID = 'prod-client';
      process.env.NEXT_PUBLIC_USE_KEYCLOAK_AUTH = 'true';

      // Act
      const { env } = require('@/lib/env');

      // Assert
      expect(env.API_URL).toBe('https://api.production.com/api');
      expect(env.KEYCLOAK_URL).toBe('https://keycloak.production.com');
      expect(env.KEYCLOAK_REALM).toBe('production-realm');
      expect(env.KEYCLOAK_CLIENT_ID).toBe('prod-client');
      expect(env.USE_KEYCLOAK_AUTH).toBe(true);
    });
  });

  describe('Runtime Configuration (window.__ENV__)', () => {
    it('should use window.__ENV__ values when available', () => {
      // Arrange - set window.__ENV__ with runtime values
      (global as any).window = {
        __ENV__: {
          NEXT_PUBLIC_API_URL: 'https://runtime-api.example.com/api',
          NEXT_PUBLIC_KEYCLOAK_URL: 'https://runtime-keycloak.example.com',
          NEXT_PUBLIC_KEYCLOAK_REALM: 'runtime-realm',
          NEXT_PUBLIC_KEYCLOAK_CLIENT_ID: 'runtime-client',
          NEXT_PUBLIC_USE_KEYCLOAK_AUTH: 'true',
        },
      } as any;

      // Act
      const { env } = require('@/lib/env');

      // Assert - should use window.__ENV__ values
      expect(env.API_URL).toBe('https://runtime-api.example.com/api');
      expect(env.KEYCLOAK_URL).toBe('https://runtime-keycloak.example.com');
      expect(env.KEYCLOAK_REALM).toBe('runtime-realm');
      expect(env.KEYCLOAK_CLIENT_ID).toBe('runtime-client');
      expect(env.USE_KEYCLOAK_AUTH).toBe(true);
    });

    it('should prioritize window.__ENV__ over process.env', () => {
      // Arrange - set both window.__ENV__ and process.env
      process.env.NEXT_PUBLIC_API_URL = 'https://build-time.example.com/api';
      (global as any).window = {
        __ENV__: {
          NEXT_PUBLIC_API_URL: 'https://runtime.example.com/api',
        },
      } as any;

      // Act
      const { env } = require('@/lib/env');

      // Assert - window.__ENV__ should win
      expect(env.API_URL).toBe('https://runtime.example.com/api');
    });

    it('should fall back to process.env when window.__ENV__ is empty', () => {
      // Arrange
      process.env.NEXT_PUBLIC_API_URL = 'https://build-time.example.com/api';
      (global as any).window = {
        __ENV__: {},
      } as any;

      // Act
      const { env } = require('@/lib/env');

      // Assert - should use process.env
      expect(env.API_URL).toBe('https://build-time.example.com/api');
    });

    it('should ignore placeholder values in process.env', () => {
      // Arrange - set placeholder values (as set during Docker build)
      process.env.NEXT_PUBLIC_API_URL = '__RUNTIME_NEXT_PUBLIC_API_URL__';
      delete (global as any).window;

      // Act
      const { env } = require('@/lib/env');

      // Assert - should use default, not placeholder
      expect(env.API_URL).toBe('http://localhost:3001/api');
    });
  });

  describe('Boolean Conversion', () => {
    it('should convert "true" string to true boolean', () => {
      // Arrange
      process.env.NEXT_PUBLIC_USE_KEYCLOAK_AUTH = 'true';

      // Act
      const { env } = require('@/lib/env');

      // Assert
      expect(env.USE_KEYCLOAK_AUTH).toBe(true);
      expect(typeof env.USE_KEYCLOAK_AUTH).toBe('boolean');
    });

    it('should convert non-"true" values to false boolean', () => {
      const falseValues = ['false', 'FALSE', '0', '', 'anything'];

      falseValues.forEach((value) => {
        jest.resetModules();
        // Delete window to skip client-side validation for empty string case
        delete (global as any).window;
        // Set other required env vars to pass validation when window exists
        process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001/api';
        process.env.NEXT_PUBLIC_KEYCLOAK_URL = 'http://localhost:8080';
        process.env.NEXT_PUBLIC_KEYCLOAK_REALM = 'perfana';
        process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID = 'perfana-web';
        process.env.NEXT_PUBLIC_USE_KEYCLOAK_AUTH = value;

        const { env } = require('@/lib/env');

        expect(env.USE_KEYCLOAK_AUTH).toBe(false);
      });
    });

    it('should default to false when USE_KEYCLOAK_AUTH is not set', () => {
      // Arrange - delete window to skip client-side validation
      delete (global as any).window;
      delete process.env.NEXT_PUBLIC_USE_KEYCLOAK_AUTH;

      // Act
      const { env } = require('@/lib/env');

      // Assert
      expect(env.USE_KEYCLOAK_AUTH).toBe(false);
    });
  });

  describe('Validation', () => {
    it('should warn on client side when env vars are missing (not throw)', () => {
      // Arrange
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      delete process.env.NEXT_PUBLIC_API_URL;
      delete process.env.NEXT_PUBLIC_KEYCLOAK_URL;
      (global as any).window = {} as any;

      // Act - should not throw, just warn
      expect(() => {
        require('@/lib/env');
      }).not.toThrow();

      // Assert - warning should be logged
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Missing environment variables')
      );

      consoleSpy.mockRestore();
    });

    it('should not validate on server side', () => {
      // Arrange
      delete process.env.NEXT_PUBLIC_API_URL;
      delete (global as any).window; // Server-side

      // Act & Assert - Should not throw
      expect(() => {
        require('@/lib/env');
      }).not.toThrow();
    });

    it('should list missing environment variables in warning', () => {
      // Arrange
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      (global as any).window = {} as any;
      delete process.env.NEXT_PUBLIC_API_URL;
      delete process.env.NEXT_PUBLIC_KEYCLOAK_URL;

      // Act
      require('@/lib/env');

      // Assert
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('NEXT_PUBLIC_API_URL'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('NEXT_PUBLIC_KEYCLOAK_URL'));

      consoleSpy.mockRestore();
    });

    it('should not warn when all required variables are present', () => {
      // Arrange
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      (global as any).window = {} as any;
      process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001/api';
      process.env.NEXT_PUBLIC_KEYCLOAK_URL = 'http://localhost:8080';
      process.env.NEXT_PUBLIC_KEYCLOAK_REALM = 'perfana';
      process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID = 'perfana-web';
      process.env.NEXT_PUBLIC_USE_KEYCLOAK_AUTH = 'false';

      // Act
      require('@/lib/env');

      // Assert - no warning
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Missing environment variables')
      );

      consoleSpy.mockRestore();
    });

    it('should skip validation when using runtime config placeholders', () => {
      // Arrange - simulate Docker build with placeholders
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      process.env.NEXT_PUBLIC_API_URL = '__RUNTIME_NEXT_PUBLIC_API_URL__';
      (global as any).window = {} as any;

      // Act
      require('@/lib/env');

      // Assert - should warn about missing window.__ENV__, not missing env vars
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Runtime config mode detected')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('Immutability', () => {
    it('should export const env object', () => {
      // Arrange
      process.env.NEXT_PUBLIC_API_URL = 'http://test.com/api';

      // Act
      const { env } = require('@/lib/env');

      // Assert - TypeScript const assertion makes it readonly
      expect(env).toBeDefined();
      expect(env.API_URL).toBeDefined();

      // Attempting to modify should fail in TypeScript
      // env.API_URL = 'new value'; // This would be a TypeScript error
    });
  });

  describe('Configuration Scenarios', () => {
    it('should configure for local development', () => {
      // Arrange
      process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001/api';
      process.env.NEXT_PUBLIC_KEYCLOAK_URL = 'http://localhost:8080';
      process.env.NEXT_PUBLIC_KEYCLOAK_REALM = 'perfana-dev';
      process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID = 'perfana-web-dev';
      process.env.NEXT_PUBLIC_USE_KEYCLOAK_AUTH = 'false';

      // Act
      const { env } = require('@/lib/env');

      // Assert
      expect(env.API_URL).toContain('localhost');
      expect(env.KEYCLOAK_URL).toContain('localhost');
      expect(env.USE_KEYCLOAK_AUTH).toBe(false);
    });

    it('should configure for production with Keycloak', () => {
      // Arrange
      process.env.NEXT_PUBLIC_API_URL = 'https://api.perfana.io/api';
      process.env.NEXT_PUBLIC_KEYCLOAK_URL = 'https://auth.perfana.io';
      process.env.NEXT_PUBLIC_KEYCLOAK_REALM = 'perfana-prod';
      process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID = 'perfana-web-prod';
      process.env.NEXT_PUBLIC_USE_KEYCLOAK_AUTH = 'true';

      // Act
      const { env } = require('@/lib/env');

      // Assert
      expect(env.API_URL).toBe('https://api.perfana.io/api');
      expect(env.KEYCLOAK_URL).toBe('https://auth.perfana.io');
      expect(env.KEYCLOAK_REALM).toBe('perfana-prod');
      expect(env.KEYCLOAK_CLIENT_ID).toBe('perfana-web-prod');
      expect(env.USE_KEYCLOAK_AUTH).toBe(true);
    });

    it('should handle staging environment', () => {
      // Arrange
      process.env.NEXT_PUBLIC_API_URL = 'https://api.staging.perfana.io/api';
      process.env.NEXT_PUBLIC_KEYCLOAK_URL = 'https://auth.staging.perfana.io';
      process.env.NEXT_PUBLIC_KEYCLOAK_REALM = 'perfana-staging';
      process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID = 'perfana-web-staging';
      process.env.NEXT_PUBLIC_USE_KEYCLOAK_AUTH = 'true';

      // Act
      const { env } = require('@/lib/env');

      // Assert
      expect(env.API_URL).toContain('staging');
      expect(env.KEYCLOAK_URL).toContain('staging');
      expect(env.KEYCLOAK_REALM).toBe('perfana-staging');
    });

    it('should handle Docker runtime configuration', () => {
      // Arrange - simulate Docker container with runtime config
      (global as any).window = {
        __ENV__: {
          NEXT_PUBLIC_API_URL: 'https://api.k8s-cluster.internal/api',
          NEXT_PUBLIC_KEYCLOAK_URL: 'https://keycloak.k8s-cluster.internal',
          NEXT_PUBLIC_KEYCLOAK_REALM: 'k8s-realm',
          NEXT_PUBLIC_KEYCLOAK_CLIENT_ID: 'k8s-client',
          NEXT_PUBLIC_USE_KEYCLOAK_AUTH: 'true',
        },
      } as any;

      // Build-time placeholders
      process.env.NEXT_PUBLIC_API_URL = '__RUNTIME_NEXT_PUBLIC_API_URL__';

      // Act
      const { env } = require('@/lib/env');

      // Assert - should use window.__ENV__ values
      expect(env.API_URL).toBe('https://api.k8s-cluster.internal/api');
      expect(env.KEYCLOAK_URL).toBe('https://keycloak.k8s-cluster.internal');
    });
  });

  describe('Type Safety', () => {
    it('should provide typed environment configuration', () => {
      // This test verifies TypeScript type safety at compile time
      // If this compiles, types are correctly defined

      const { env } = require('@/lib/env');

      // These should all be type-safe
      const _apiUrl: string = env.API_URL;
      const _keycloakUrl: string = env.KEYCLOAK_URL;
      const _realm: string = env.KEYCLOAK_REALM;
      const _clientId: string = env.KEYCLOAK_CLIENT_ID;
      const _useKeycloak: boolean = env.USE_KEYCLOAK_AUTH;

      expect(typeof env.API_URL).toBe('string');
      expect(typeof env.USE_KEYCLOAK_AUTH).toBe('boolean');
    });
  });
});

describe('Runtime Config Module', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  describe('isPlaceholder', () => {
    it('should detect placeholder values', () => {
      const { isPlaceholder } = require('@/lib/runtime-config');

      expect(isPlaceholder('__RUNTIME_NEXT_PUBLIC_API_URL__')).toBe(true);
      expect(isPlaceholder('__RUNTIME_FOO__')).toBe(true);
    });

    it('should return false for normal values', () => {
      const { isPlaceholder } = require('@/lib/runtime-config');

      expect(isPlaceholder('https://api.example.com')).toBe(false);
      expect(isPlaceholder('')).toBe(false);
      expect(isPlaceholder(undefined)).toBe(false);
    });
  });

  describe('generateEnvScript', () => {
    it('should generate valid JavaScript', () => {
      const { generateEnvScript } = require('@/lib/runtime-config');

      const script = generateEnvScript({
        NEXT_PUBLIC_API_URL: 'https://api.example.com',
        NEXT_PUBLIC_KEYCLOAK_URL: 'https://keycloak.example.com',
      });

      expect(script).toContain('window.__ENV__');
      expect(script).toContain('https://api.example.com');
      expect(script).toContain('https://keycloak.example.com');
    });

    it('should exclude placeholder values', () => {
      const { generateEnvScript } = require('@/lib/runtime-config');

      const script = generateEnvScript({
        NEXT_PUBLIC_API_URL: '__RUNTIME_NEXT_PUBLIC_API_URL__',
        NEXT_PUBLIC_KEYCLOAK_URL: 'https://keycloak.example.com',
      });

      expect(script).not.toContain('__RUNTIME_');
      expect(script).toContain('https://keycloak.example.com');
    });

    it('should only include known runtime env keys', () => {
      const { generateEnvScript } = require('@/lib/runtime-config');

      const script = generateEnvScript({
        NEXT_PUBLIC_API_URL: 'https://api.example.com',
        SOME_OTHER_VAR: 'should-be-excluded',
        SECRET_KEY: 'definitely-excluded',
      });

      expect(script).toContain('NEXT_PUBLIC_API_URL');
      expect(script).not.toContain('SOME_OTHER_VAR');
      expect(script).not.toContain('SECRET_KEY');
    });
  });
});
