/**
 * Unit tests for Validation Schemas
 *
 * Tests Zod schemas for form validation:
 * - signInSchema: Email and password validation
 * - signUpSchema: User registration validation
 * - createApiKeySchema: API key creation validation
 * - createGrafanaInstanceSchema: Grafana instance validation
 * - createDynatraceConfigSchema: Dynatrace configuration validation
 */

import {
  signInSchema,
  signUpSchema,
  createApiKeySchema,
  createGrafanaInstanceSchema,
  createDynatraceConfigSchema,
} from '@/lib/validations';

describe('Validation Schemas', () => {
  describe('signInSchema', () => {
    describe('Valid Data', () => {
      it('should validate correct email and password', () => {
        // Arrange
        const data = {
          email: 'test@example.com',
          password: 'password123',
        };

        // Act
        const result = signInSchema.safeParse(data);

        // Assert
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toEqual(data);
        }
      });

      it('should allow various valid email formats', () => {
        const emails = [
          'user@domain.com',
          'test.user@example.org',
          'admin+tag@company.co.uk',
          'user_123@test-domain.com',
        ];

        emails.forEach((email) => {
          const result = signInSchema.safeParse({ email, password: 'pass' });
          expect(result.success).toBe(true);
        });
      });
    });

    describe('Invalid Email', () => {
      it('should reject invalid email addresses', () => {
        const invalidEmails = [
          'not-an-email',
          '@example.com',
          'user@',
          'user @example.com',
          '',
        ];

        invalidEmails.forEach((email) => {
          const result = signInSchema.safeParse({ email, password: 'password' });
          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error.issues[0].message).toContain('Invalid email');
          }
        });
      });

      it('should reject missing email', () => {
        const result = signInSchema.safeParse({ password: 'password' });
        expect(result.success).toBe(false);
      });
    });

    describe('Invalid Password', () => {
      it('should reject empty password', () => {
        const result = signInSchema.safeParse({
          email: 'test@example.com',
          password: '',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain('Password is required');
        }
      });

      it('should reject missing password', () => {
        const result = signInSchema.safeParse({ email: 'test@example.com' });
        expect(result.success).toBe(false);
      });
    });
  });

  describe('signUpSchema', () => {
    describe('Valid Data', () => {
      it('should validate sign up with all fields', () => {
        const data = {
          email: 'newuser@example.com',
          password: 'securePassword123',
          firstName: 'John',
          lastName: 'Doe',
        };

        const result = signUpSchema.safeParse(data);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toEqual(data);
        }
      });

      it('should validate sign up without optional fields', () => {
        const data = {
          email: 'newuser@example.com',
          password: 'securePassword123',
        };

        const result = signUpSchema.safeParse(data);

        expect(result.success).toBe(true);
      });
    });

    describe('Password Requirements', () => {
      it('should enforce minimum password length of 6', () => {
        const result = signUpSchema.safeParse({
          email: 'test@example.com',
          password: '12345', // Only 5 characters
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain(
            'Password must be at least 6 characters'
          );
        }
      });

      it('should accept password with exactly 6 characters', () => {
        const result = signUpSchema.safeParse({
          email: 'test@example.com',
          password: '123456',
        });

        expect(result.success).toBe(true);
      });

      it('should accept long passwords', () => {
        const result = signUpSchema.safeParse({
          email: 'test@example.com',
          password: 'veryLongSecurePassword12345678',
        });

        expect(result.success).toBe(true);
      });
    });

    describe('Optional Fields', () => {
      it('should allow firstName to be undefined', () => {
        const result = signUpSchema.safeParse({
          email: 'test@example.com',
          password: 'password123',
          lastName: 'Doe',
        });

        expect(result.success).toBe(true);
      });

      it('should allow lastName to be undefined', () => {
        const result = signUpSchema.safeParse({
          email: 'test@example.com',
          password: 'password123',
          firstName: 'John',
        });

        expect(result.success).toBe(true);
      });
    });
  });

  describe('createApiKeySchema', () => {
    describe('Valid Data', () => {
      it('should validate API key with description and TTL', () => {
        const data = {
          description: 'My API Key',
          ttl: '90d',
        };

        const result = createApiKeySchema.safeParse(data);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toEqual(data);
        }
      });

      it('should allow various TTL formats', () => {
        const ttls = ['30d', '24h', '60m', '7d', '1y'];

        ttls.forEach((ttl) => {
          const result = createApiKeySchema.safeParse({
            description: 'Test',
            ttl,
          });
          expect(result.success).toBe(true);
        });
      });
    });

    describe('Description Validation', () => {
      it('should reject empty description', () => {
        const result = createApiKeySchema.safeParse({
          description: '',
          ttl: '30d',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain('Description is required');
        }
      });

      it('should reject description over 255 characters', () => {
        const longDescription = 'a'.repeat(256);
        const result = createApiKeySchema.safeParse({
          description: longDescription,
          ttl: '30d',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain(
            'Description must be less than 255 characters'
          );
        }
      });

      it('should accept description with exactly 255 characters', () => {
        const maxDescription = 'a'.repeat(255);
        const result = createApiKeySchema.safeParse({
          description: maxDescription,
          ttl: '30d',
        });

        expect(result.success).toBe(true);
      });
    });

    describe('TTL Validation', () => {
      it('should reject empty TTL', () => {
        const result = createApiKeySchema.safeParse({
          description: 'Test',
          ttl: '',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain('Time to live is required');
        }
      });

      it('should reject missing TTL', () => {
        const result = createApiKeySchema.safeParse({
          description: 'Test',
        });

        expect(result.success).toBe(false);
      });
    });
  });

  describe('createGrafanaInstanceSchema', () => {
    describe('Valid Data', () => {
      it('should validate minimal Grafana instance', () => {
        const data = {
          label: 'Production Grafana',
          clientUrl: 'https://grafana.example.com',
          orgId: '1',
        };

        const result = createGrafanaInstanceSchema.safeParse(data);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toEqual(data);
        }
      });

      it('should validate Grafana instance with all fields', () => {
        const data = {
          label: 'Test Grafana',
          clientUrl: 'https://grafana.test.com',
          serverUrl: 'https://grafana-server.test.com',
          orgId: '2',
          apiKey: 'eyJrIjoitest123',
          username: 'admin',
          password: 'secret',
          snapshotInstance: true,
        };

        const result = createGrafanaInstanceSchema.safeParse(data);

        expect(result.success).toBe(true);
      });
    });

    describe('Label Validation', () => {
      it('should reject empty label', () => {
        const result = createGrafanaInstanceSchema.safeParse({
          label: '',
          clientUrl: 'https://grafana.com',
          orgId: '1',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain('Label is required');
        }
      });

      it('should reject label over 255 characters', () => {
        const result = createGrafanaInstanceSchema.safeParse({
          label: 'a'.repeat(256),
          clientUrl: 'https://grafana.com',
          orgId: '1',
        });

        expect(result.success).toBe(false);
      });
    });

    describe('URL Validation', () => {
      it('should reject invalid clientUrl format', () => {
        const result = createGrafanaInstanceSchema.safeParse({
          label: 'Test',
          clientUrl: 'not-a-url',
          orgId: '1',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain('Invalid URL');
        }
      });

      it('should reject invalid serverUrl format', () => {
        const result = createGrafanaInstanceSchema.safeParse({
          label: 'Test',
          clientUrl: 'https://grafana.com',
          serverUrl: 'invalid-url',
          orgId: '1',
        });

        expect(result.success).toBe(false);
      });

      it('should allow empty string for optional serverUrl', () => {
        const result = createGrafanaInstanceSchema.safeParse({
          label: 'Test',
          clientUrl: 'https://grafana.com',
          serverUrl: '',
          orgId: '1',
        });

        expect(result.success).toBe(true);
      });

      it('should accept various valid URL formats', () => {
        const urls = [
          'http://localhost:3000',
          'https://grafana.example.com',
          'https://grafana.example.com:8080',
          'https://grafana.example.com/path',
        ];

        urls.forEach((url) => {
          const result = createGrafanaInstanceSchema.safeParse({
            label: 'Test',
            clientUrl: url,
            orgId: '1',
          });
          expect(result.success).toBe(true);
        });
      });
    });

    describe('Organization ID Validation', () => {
      it('should reject empty orgId', () => {
        const result = createGrafanaInstanceSchema.safeParse({
          label: 'Test',
          clientUrl: 'https://grafana.com',
          orgId: '',
        });

        expect(result.success).toBe(false);
      });

      it('should reject orgId over 50 characters', () => {
        const result = createGrafanaInstanceSchema.safeParse({
          label: 'Test',
          clientUrl: 'https://grafana.com',
          orgId: 'a'.repeat(51),
        });

        expect(result.success).toBe(false);
      });

      it('should accept orgId with exactly 50 characters', () => {
        const result = createGrafanaInstanceSchema.safeParse({
          label: 'Test',
          clientUrl: 'https://grafana.com',
          orgId: 'a'.repeat(50),
        });

        expect(result.success).toBe(true);
      });
    });

    describe('Optional Fields', () => {
      it('should accept instance without credentials', () => {
        const result = createGrafanaInstanceSchema.safeParse({
          label: 'Test',
          clientUrl: 'https://grafana.com',
          orgId: '1',
        });

        expect(result.success).toBe(true);
      });

      it('should accept instance with API key only', () => {
        const result = createGrafanaInstanceSchema.safeParse({
          label: 'Test',
          clientUrl: 'https://grafana.com',
          orgId: '1',
          apiKey: 'test-key',
        });

        expect(result.success).toBe(true);
      });

      it('should accept instance with username and password', () => {
        const result = createGrafanaInstanceSchema.safeParse({
          label: 'Test',
          clientUrl: 'https://grafana.com',
          orgId: '1',
          username: 'admin',
          password: 'secret',
        });

        expect(result.success).toBe(true);
      });
    });
  });

  describe('createDynatraceConfigSchema', () => {
    describe('Valid Data', () => {
      it('should validate Dynatrace config with required fields', () => {
        const data = {
          label: 'Test Dynatrace',
          host: 'https://dynatrace.example.com',
          apiToken: 'dt0c01.test123',
        };

        const result = createDynatraceConfigSchema.safeParse(data);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.dynatraceType).toBe('saas'); // Default value
        }
      });

      it('should validate with explicit dynatraceType', () => {
        const data = {
          label: 'Test Dynatrace',
          host: 'https://dynatrace.example.com',
          apiToken: 'dt0c01.test123',
          dynatraceType: 'managed' as const,
        };

        const result = createDynatraceConfigSchema.safeParse(data);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.dynatraceType).toBe('managed');
        }
      });
    });

    describe('Host URL Validation', () => {
      it('should reject invalid host URL', () => {
        const result = createDynatraceConfigSchema.safeParse({
          label: 'Test Dynatrace',
          host: 'not-a-url',
          apiToken: 'valid-token-123',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain('Invalid URL');
        }
      });

      it('should accept various valid URLs', () => {
        const urls = [
          'https://abc12345.live.dynatrace.com',
          'https://dynatrace.managed.example.com',
          'http://localhost:8080',
        ];

        urls.forEach((url) => {
          const result = createDynatraceConfigSchema.safeParse({
            label: 'Test Dynatrace',
            host: url,
            apiToken: 'token-1234567890', // At least 10 characters
          });
          if (!result.success) {
            console.error(`URL validation failed for: ${url}`, result.error.errors);
          }
          expect(result.success).toBe(true);
        });
      });
    });

    describe('API Token Validation', () => {
      it('should reject empty API token', () => {
        const result = createDynatraceConfigSchema.safeParse({
          label: 'Test Dynatrace',
          host: 'https://dynatrace.example.com',
          apiToken: '',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain('API token is required');
        }
      });

      it('should reject token shorter than 10 characters', () => {
        const result = createDynatraceConfigSchema.safeParse({
          label: 'Test Dynatrace',
          host: 'https://dynatrace.example.com',
          apiToken: 'short',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain(
            'API token must be at least 10 characters'
          );
        }
      });

      it('should accept token with exactly 10 characters', () => {
        const result = createDynatraceConfigSchema.safeParse({
          label: 'Test Dynatrace',
          host: 'https://dynatrace.example.com',
          apiToken: '1234567890',
        });

        expect(result.success).toBe(true);
      });
    });

    describe('Dynatrace Type Validation', () => {
      it('should default to "saas" when not provided', () => {
        const result = createDynatraceConfigSchema.safeParse({
          label: 'Test Dynatrace',
          host: 'https://dynatrace.example.com',
          apiToken: 'valid-token-123',
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.dynatraceType).toBe('saas');
        }
      });

      it('should accept "saas" type', () => {
        const result = createDynatraceConfigSchema.safeParse({
          label: 'Test Dynatrace',
          host: 'https://dynatrace.example.com',
          apiToken: 'valid-token-123',
          dynatraceType: 'saas',
        });

        expect(result.success).toBe(true);
      });

      it('should accept "managed" type', () => {
        const result = createDynatraceConfigSchema.safeParse({
          label: 'Test Dynatrace',
          host: 'https://dynatrace.example.com',
          apiToken: 'valid-token-123',
          dynatraceType: 'managed',
        });

        expect(result.success).toBe(true);
      });

      it('should reject invalid dynatrace type', () => {
        const result = createDynatraceConfigSchema.safeParse({
          label: 'Test Dynatrace',
          host: 'https://dynatrace.example.com',
          apiToken: 'valid-token-123',
          dynatraceType: 'invalid',
        });

        expect(result.success).toBe(false);
      });
    });
  });

  describe('Type Inference', () => {
    it('should infer correct types from schemas', () => {
      // This test verifies TypeScript type inference works
      // If this compiles, the types are correctly inferred

      const signInData = signInSchema.parse({
        email: 'test@example.com',
        password: 'password',
      });

      // TypeScript should know these properties exist
      const _email: string = signInData.email;
      const _password: string = signInData.password;

      expect(signInData.email).toBeDefined();
      expect(signInData.password).toBeDefined();
    });
  });
});
