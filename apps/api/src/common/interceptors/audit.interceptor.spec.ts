/**
 * AuditInterceptor Test Suite
 *
 * Comprehensive tests for the global audit interceptor including:
 * - HTTP method to AuditAction mapping
 * - Request context extraction
 * - Fire-and-forget pattern validation
 * - Error handling
 * - Excluded paths and methods
 *
 * Part of RBAC Phase 5: Row-Level Security, Audit Logging & Hardening
 * Subtask 6-3: Verify audit logging captures all CRUD operations
 */

import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from '../../modules/audit/audit.service';
import { AuditAction } from '@perfana/shared/entities';

describe('AuditInterceptor', () => {
  let interceptor: AuditInterceptor;
  let auditService: jest.Mocked<AuditService>;

  // Mock request factory
  const createMockRequest = (overrides?: Partial<any>) => ({
    method: 'GET',
    path: '/api/test-runs',
    url: '/api/test-runs',
    headers: {
      'user-agent': 'Mozilla/5.0',
    },
    ip: '127.0.0.1',
    connection: { remoteAddress: '127.0.0.1' },
    user: {
      sub: 'user-123',
      email: 'test@example.com',
    },
    authType: 'keycloak-jwt',
    ...overrides,
  });

  // Mock execution context factory
  const createMockContext = (request: any): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    }) as unknown as ExecutionContext;

  // Mock call handler factory
  const createMockCallHandler = (result: any = {}): CallHandler => ({
    handle: () => of(result),
  });

  // Mock call handler that throws an error
  const createErrorCallHandler = (error: Error): CallHandler => ({
    handle: () => throwError(() => error),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditInterceptor,
        {
          provide: AuditService,
          useValue: {
            log: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    interceptor = module.get<AuditInterceptor>(AuditInterceptor);
    auditService = module.get(AuditService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should be defined', () => {
      expect(interceptor).toBeDefined();
    });
  });

  describe('HTTP method to AuditAction mapping', () => {
    it('should map POST to CREATE action', (done) => {
      // Arrange
      const request = createMockRequest({ method: 'POST' });
      const context = createMockContext(request);
      const handler = createMockCallHandler();

      // Act
      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          // Assert
          expect(auditService.log).toHaveBeenCalledWith(
            expect.objectContaining({ action: AuditAction.CREATE }),
          );
          done();
        },
      });
    });

    it('should map PUT to UPDATE action', (done) => {
      // Arrange
      const request = createMockRequest({ method: 'PUT' });
      const context = createMockContext(request);
      const handler = createMockCallHandler();

      // Act
      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          // Assert
          expect(auditService.log).toHaveBeenCalledWith(
            expect.objectContaining({ action: AuditAction.UPDATE }),
          );
          done();
        },
      });
    });

    it('should map PATCH to UPDATE action', (done) => {
      // Arrange
      const request = createMockRequest({ method: 'PATCH' });
      const context = createMockContext(request);
      const handler = createMockCallHandler();

      // Act
      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          // Assert
          expect(auditService.log).toHaveBeenCalledWith(
            expect.objectContaining({ action: AuditAction.UPDATE }),
          );
          done();
        },
      });
    });

    it('should map DELETE to DELETE action', (done) => {
      // Arrange
      const request = createMockRequest({ method: 'DELETE' });
      const context = createMockContext(request);
      const handler = createMockCallHandler();

      // Act
      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          // Assert
          expect(auditService.log).toHaveBeenCalledWith(
            expect.objectContaining({ action: AuditAction.DELETE }),
          );
          done();
        },
      });
    });

    it('should map GET to ACCESS action', (done) => {
      // Arrange
      const request = createMockRequest({ method: 'GET' });
      const context = createMockContext(request);
      const handler = createMockCallHandler();

      // Act
      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          // Assert
          expect(auditService.log).toHaveBeenCalledWith(
            expect.objectContaining({ action: AuditAction.ACCESS }),
          );
          done();
        },
      });
    });
  });

  describe('resource extraction from path', () => {
    it('should extract resource type from path /api/test-runs', (done) => {
      // Arrange
      const request = createMockRequest({ path: '/api/test-runs' });
      const context = createMockContext(request);
      const handler = createMockCallHandler();

      // Act
      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          // Assert
          expect(auditService.log).toHaveBeenCalledWith(
            expect.objectContaining({ resourceType: 'test-runs' }),
          );
          done();
        },
      });
    });

    it('should extract resource type and ID from path /api/test-runs/123e4567-e89b-12d3-a456-426614174000', (done) => {
      // Arrange
      const uuid = '123e4567-e89b-12d3-a456-426614174000';
      const request = createMockRequest({ path: `/api/test-runs/${uuid}` });
      const context = createMockContext(request);
      const handler = createMockCallHandler();

      // Act
      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          // Assert
          expect(auditService.log).toHaveBeenCalledWith(
            expect.objectContaining({
              resourceType: 'test-runs',
              resourceId: uuid,
            }),
          );
          done();
        },
      });
    });

    it('should extract resource type and numeric ID', (done) => {
      // Arrange
      const request = createMockRequest({ path: '/api/test-runs/12345' });
      const context = createMockContext(request);
      const handler = createMockCallHandler();

      // Act
      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          // Assert
          expect(auditService.log).toHaveBeenCalledWith(
            expect.objectContaining({
              resourceType: 'test-runs',
              resourceId: '12345',
            }),
          );
          done();
        },
      });
    });

    it('should handle root path', (done) => {
      // Arrange
      const request = createMockRequest({ path: '/' });
      const context = createMockContext(request);
      const handler = createMockCallHandler();

      // Act
      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          // Assert
          expect(auditService.log).toHaveBeenCalledWith(
            expect.objectContaining({ resourceType: 'root' }),
          );
          done();
        },
      });
    });
  });

  describe('excluded paths', () => {
    const excludedPaths = [
      '/health',
      '/api/health',
      '/metrics',
      '/docs',
      '/api/docs',
      '/favicon.ico',
    ];

    excludedPaths.forEach((path) => {
      it(`should skip auditing for ${path}`, (done) => {
        // Arrange
        const request = createMockRequest({ path });
        const context = createMockContext(request);
        const handler = createMockCallHandler();

        // Act
        interceptor.intercept(context, handler).subscribe({
          complete: () => {
            // Assert
            expect(auditService.log).not.toHaveBeenCalled();
            done();
          },
        });
      });
    });
  });

  describe('excluded methods', () => {
    const excludedMethods = ['OPTIONS', 'HEAD'];

    excludedMethods.forEach((method) => {
      it(`should skip auditing for ${method} method`, (done) => {
        // Arrange
        const request = createMockRequest({ method });
        const context = createMockContext(request);
        const handler = createMockCallHandler();

        // Act
        interceptor.intercept(context, handler).subscribe({
          complete: () => {
            // Assert
            expect(auditService.log).not.toHaveBeenCalled();
            done();
          },
        });
      });
    });
  });

  describe('request context extraction', () => {
    it('should extract IP address from request.ip', (done) => {
      // Arrange
      const request = createMockRequest({ ip: '192.168.1.100' });
      const context = createMockContext(request);
      const handler = createMockCallHandler();

      // Act
      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          // Assert
          expect(auditService.log).toHaveBeenCalledWith(
            expect.objectContaining({ ipAddress: '192.168.1.100' }),
          );
          done();
        },
      });
    });

    it('should extract IP address from X-Forwarded-For header', (done) => {
      // Arrange
      const request = createMockRequest({
        ip: undefined,
        headers: {
          'x-forwarded-for': '10.0.0.1, 10.0.0.2',
          'user-agent': 'Mozilla/5.0',
        },
      });
      const context = createMockContext(request);
      const handler = createMockCallHandler();

      // Act
      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          // Assert
          expect(auditService.log).toHaveBeenCalledWith(
            expect.objectContaining({ ipAddress: '10.0.0.1' }),
          );
          done();
        },
      });
    });

    it('should extract IP address from X-Real-IP header', (done) => {
      // Arrange
      const request = createMockRequest({
        ip: undefined,
        headers: {
          'x-real-ip': '172.16.0.1',
          'user-agent': 'Mozilla/5.0',
        },
      });
      const context = createMockContext(request);
      const handler = createMockCallHandler();

      // Act
      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          // Assert
          expect(auditService.log).toHaveBeenCalledWith(
            expect.objectContaining({ ipAddress: '172.16.0.1' }),
          );
          done();
        },
      });
    });

    it('should extract user agent from headers', (done) => {
      // Arrange
      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
      const request = createMockRequest({
        headers: { 'user-agent': userAgent },
      });
      const context = createMockContext(request);
      const handler = createMockCallHandler();

      // Act
      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          // Assert
          expect(auditService.log).toHaveBeenCalledWith(
            expect.objectContaining({ userAgent }),
          );
          done();
        },
      });
    });

    it('should capture auth type in metadata', (done) => {
      // Arrange
      const request = createMockRequest({ authType: 'api-key' });
      const context = createMockContext(request);
      const handler = createMockCallHandler();

      // Act
      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          // Assert
          expect(auditService.log).toHaveBeenCalledWith(
            expect.objectContaining({
              metadata: expect.objectContaining({ auth_type: 'api-key' }),
            }),
          );
          done();
        },
      });
    });
  });

  describe('success/failure handling', () => {
    it('should log success=true on successful request', (done) => {
      // Arrange
      const request = createMockRequest();
      const context = createMockContext(request);
      const handler = createMockCallHandler({ data: 'success' });

      // Act
      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          // Assert
          expect(auditService.log).toHaveBeenCalledWith(
            expect.objectContaining({ success: true }),
          );
          done();
        },
      });
    });

    it('should log success=false on failed request', (done) => {
      // Arrange
      const request = createMockRequest();
      const context = createMockContext(request);
      const error = new Error('Test error');
      const handler = createErrorCallHandler(error);

      // Act
      interceptor.intercept(context, handler).subscribe({
        error: () => {
          // Assert
          expect(auditService.log).toHaveBeenCalledWith(
            expect.objectContaining({
              success: false,
              errorMessage: 'Test error',
            }),
          );
          done();
        },
      });
    });

    it('should extract error message from Error object', (done) => {
      // Arrange
      const request = createMockRequest();
      const context = createMockContext(request);
      const error = new Error('Detailed error message');
      const handler = createErrorCallHandler(error);

      // Act
      interceptor.intercept(context, handler).subscribe({
        error: () => {
          // Assert
          expect(auditService.log).toHaveBeenCalledWith(
            expect.objectContaining({ errorMessage: 'Detailed error message' }),
          );
          done();
        },
      });
    });

    it('should handle non-Error objects thrown', (done) => {
      // Arrange
      const request = createMockRequest();
      const context = createMockContext(request);
      const handler: CallHandler = {
        handle: () => throwError(() => 'string error'),
      };

      // Act
      interceptor.intercept(context, handler).subscribe({
        error: () => {
          // Assert
          expect(auditService.log).toHaveBeenCalledWith(
            expect.objectContaining({ errorMessage: 'Unknown error' }),
          );
          done();
        },
      });
    });
  });

  describe('fire-and-forget pattern', () => {
    it('should not block on audit service errors', (done) => {
      // Arrange
      auditService.log.mockRejectedValue(new Error('Audit service error'));
      const request = createMockRequest();
      const context = createMockContext(request);
      const handler = createMockCallHandler({ data: 'success' });

      // Act
      interceptor.intercept(context, handler).subscribe({
        next: (result) => {
          // Assert - request should still succeed
          expect(result).toEqual({ data: 'success' });
        },
        complete: () => {
          done();
        },
      });
    });
  });

  describe('metadata capture', () => {
    it('should capture route and method in metadata', (done) => {
      // Arrange
      const request = createMockRequest({
        method: 'POST',
        path: '/api/test-runs',
      });
      const context = createMockContext(request);
      const handler = createMockCallHandler();

      // Act
      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          // Assert
          expect(auditService.log).toHaveBeenCalledWith(
            expect.objectContaining({
              metadata: expect.objectContaining({
                route: '/api/test-runs',
                method: 'POST',
              }),
            }),
          );
          done();
        },
      });
    });

    it('should capture duration in metadata', (done) => {
      // Arrange
      const request = createMockRequest();
      const context = createMockContext(request);
      const handler = createMockCallHandler();

      // Act
      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          // Assert
          expect(auditService.log).toHaveBeenCalledWith(
            expect.objectContaining({
              metadata: expect.objectContaining({
                duration_ms: expect.any(Number),
              }),
            }),
          );
          done();
        },
      });
    });
  });

  describe('user context extraction', () => {
    it('should extract anonymous user ID when user not authenticated', (done) => {
      // Arrange
      const request = createMockRequest({ user: undefined });
      const context = createMockContext(request);
      const handler = createMockCallHandler();

      // Act
      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          // Assert
          expect(auditService.log).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'anonymous' }),
          );
          done();
        },
      });
    });
  });

  describe('edge cases', () => {
    it('should handle missing headers gracefully', (done) => {
      // Arrange
      const request = createMockRequest({ headers: undefined });
      const context = createMockContext(request);
      const handler = createMockCallHandler();

      // Act
      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          // Assert
          expect(auditService.log).toHaveBeenCalled();
          done();
        },
      });
    });

    it('should handle missing path gracefully', (done) => {
      // Arrange
      const request = createMockRequest({ path: undefined, url: '/fallback' });
      const context = createMockContext(request);
      const handler = createMockCallHandler();

      // Act
      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          // Assert
          expect(auditService.log).toHaveBeenCalledWith(
            expect.objectContaining({
              metadata: expect.objectContaining({ route: '/fallback' }),
            }),
          );
          done();
        },
      });
    });

    it('should handle missing method gracefully', (done) => {
      // Arrange
      const request = createMockRequest({ method: undefined });
      const context = createMockContext(request);
      const handler = createMockCallHandler();

      // Act
      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          // Assert
          expect(auditService.log).toHaveBeenCalledWith(
            expect.objectContaining({ action: AuditAction.ACCESS }),
          );
          done();
        },
      });
    });
  });
});
