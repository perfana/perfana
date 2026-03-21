import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

/**
 * Authentication Bypass Security Tests
 *
 * Tests various authentication bypass attempts including:
 * - Missing authorization headers
 * - Invalid token formats
 * - Malformed bearer tokens
 * - Token injection attempts
 * - Role escalation attempts
 * - Public endpoint abuse
 */
describe('Authentication Bypass Security Tests', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Missing Authorization Headers', () => {
    it('should reject requests without authorization header', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/test-runs')
        .expect(401);

      expect(response.body).toMatchObject({
        statusCode: 401,
        message: expect.stringContaining('authorization'),
      });
    });

    it('should reject POST requests without authorization', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/test')
        .send({ testRunId: 'test-1' })
        .expect(401);

      expect(response.body.statusCode).toBe(401);
    });

    it('should reject DELETE requests without authorization', async () => {
      await request(app.getHttpServer())
        .delete('/api/test-runs/550e8400-e29b-41d4-a716-446655440000')
        .expect(401);
    });
  });

  describe('Invalid Authorization Header Formats', () => {
    it('should reject authorization header without Bearer prefix', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs')
        .set('Authorization', 'invalid-token-123')
        .expect(401);
    });

    it('should reject authorization header with wrong scheme', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs')
        .set('Authorization', 'Basic dXNlcjpwYXNzd29yZA==')
        .expect(401);
    });

    it('should reject authorization header with empty Bearer token', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs')
        .set('Authorization', 'Bearer ')
        .expect(401);
    });

    it('should reject authorization header with only whitespace', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs')
        .set('Authorization', '   ')
        .expect(401);
    });

    it('should reject malformed Bearer format', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs')
        .set('Authorization', 'BearerToken123')
        .expect(401);
    });
  });

  describe('Token Injection Attempts', () => {
    it('should reject SQL injection in token', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs')
        .set('Authorization', "Bearer ' OR '1'='1")
        .expect(401);
    });

    it('should reject XSS attempt in token', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs')
        .set('Authorization', 'Bearer <script>alert("xss")</script>')
        .expect(401);
    });

    it('should reject NoSQL injection in token', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs')
        .set('Authorization', 'Bearer {"$ne": null}')
        .expect(401);
    });

    it('should reject token with null bytes', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs')
        .set('Authorization', 'Bearer token\x00admin')
        .expect(401);
    });

    it('should reject very long token (>10000 chars)', async () => {
      const longToken = 'a'.repeat(10001);
      await request(app.getHttpServer())
        .get('/api/test-runs')
        .set('Authorization', `Bearer ${longToken}`)
        .expect(401);
    });
  });

  describe('Expired and Invalid Tokens', () => {
    it('should reject expired JWT token', async () => {
      // This is an expired JWT token (exp claim in the past)
      const expiredToken = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiZXhwIjoxNTE2MjM5MDIyfQ.invalid';

      await request(app.getHttpServer())
        .get('/api/test-runs')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);
    });

    it('should reject invalid API key format', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs')
        .set('Authorization', 'Bearer invalid-api-key')
        .expect(401);
    });

    it('should reject malformed JWT token', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs')
        .set('Authorization', 'Bearer not.a.jwt')
        .expect(401);
    });

    it('should reject JWT with invalid signature', async () => {
      // Valid JWT structure but invalid signature
      const invalidJwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.tampered_signature';

      await request(app.getHttpServer())
        .get('/api/test-runs')
        .set('Authorization', `Bearer ${invalidJwt}`)
        .expect(401);
    });
  });

  describe('Multiple Authorization Headers', () => {
    it('should handle multiple authorization headers gracefully', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/test-runs')
        .set('Authorization', 'Bearer token1')
        .set('Authorization', 'Bearer token2')
        .expect(401);

      expect(response.body.statusCode).toBe(401);
    });
  });

  describe('Case Sensitivity', () => {
    it('should reject lowercase bearer scheme', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs')
        .set('Authorization', 'bearer token123')
        .expect(401);
    });

    it('should reject mixed case bearer scheme', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs')
        .set('Authorization', 'BeArEr token123')
        .expect(401);
    });

    it('should reject uppercase bearer scheme', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs')
        .set('Authorization', 'BEARER token123')
        .expect(401);
    });
  });

  describe('Unicode and Special Characters', () => {
    it('should reject token with unicode characters', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs')
        .set('Authorization', 'Bearer token🔑admin')
        .expect(401);
    });

    it('should reject token with zero-width characters', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs')
        .set('Authorization', 'Bearer token\u200badmin')
        .expect(401);
    });

    it('should reject token with RTL override characters', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs')
        .set('Authorization', 'Bearer token\u202eadmin')
        .expect(401);
    });
  });

  describe('Public Endpoint Verification', () => {
    it('should allow access to health endpoint without auth', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/auth/health')
        .expect(200);

      expect(response.body).toHaveProperty('status');
    });

    it('should not allow bypassing protected endpoints by adding /health', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs/health')
        .expect(401);
    });
  });

  describe('Header Injection Attempts', () => {
    it('should reject authorization with newline injection', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs')
        .set('Authorization', 'Bearer token\nX-Admin: true')
        .expect(401);
    });

    it('should reject authorization with carriage return injection', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs')
        .set('Authorization', 'Bearer token\rX-Admin: true')
        .expect(401);
    });

    it('should reject authorization with CRLF injection', async () => {
      await request(app.getHttpServer())
        .get('/api/test-runs')
        .set('Authorization', 'Bearer token\r\nX-Admin: true')
        .expect(401);
    });
  });
});
