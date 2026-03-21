/**
 * NestJS Guard Test Template
 *
 * This template provides a comprehensive structure for testing NestJS guards
 * that implement CanActivate interface for authentication and authorization.
 *
 * Key Testing Areas:
 * 1. Public route bypass (routes marked with @Public())
 * 2. Missing authentication headers
 * 3. Invalid authentication formats
 * 4. Valid authentication scenarios
 * 5. Expired credentials
 * 6. Role-based access control (if applicable)
 * 7. Error handling and exception messages
 *
 * Usage:
 * - Copy this template
 * - Replace YourGuard with your guard name
 * - Replace YourService with your service dependencies
 * - Customize test cases based on your guard's logic
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { YourGuard } from './your-guard.guard';
import { YourService } from './your-service.service';

describe('YourGuard', () => {
  let guard: YourGuard;
  let service: jest.Mocked<YourService>;
  let reflector: jest.Mocked<Reflector>;

  // Mock execution context helper
  const createMockExecutionContext = (
    headers: Record<string, string> = {},
    isPublic = false,
  ): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers,
          user: undefined,
          authType: undefined,
        }),
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as any;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        YourGuard,
        {
          provide: YourService,
          useValue: {
            validateToken: jest.fn(),
            // Add other service methods
          },
        },
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<YourGuard>(YourGuard);
    service = module.get(YourService);
    reflector = module.get(Reflector);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Public Route Bypass', () => {
    it('should allow access to public routes without authentication', async () => {
      // Arrange
      const context = createMockExecutionContext({}, true);
      reflector.getAllAndOverride.mockReturnValue(true);

      // Act
      const result = await guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
      expect(service.validateToken).not.toHaveBeenCalled();
    });
  });

  describe('Missing Authentication', () => {
    it('should throw UnauthorizedException when Authorization header is missing', async () => {
      // Arrange
      const context = createMockExecutionContext({});
      reflector.getAllAndOverride.mockReturnValue(false);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Missing Authorization header',
      );
    });

    it('should throw UnauthorizedException when Authorization header is empty', async () => {
      // Arrange
      const context = createMockExecutionContext({ authorization: '' });
      reflector.getAllAndOverride.mockReturnValue(false);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('Invalid Authentication Format', () => {
    it('should throw UnauthorizedException for invalid Bearer format', async () => {
      // Arrange
      const context = createMockExecutionContext({
        authorization: 'InvalidFormat token123',
      });
      reflector.getAllAndOverride.mockReturnValue(false);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when token is missing after Bearer', async () => {
      // Arrange
      const context = createMockExecutionContext({
        authorization: 'Bearer ',
      });
      reflector.getAllAndOverride.mockReturnValue(false);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('Valid Authentication', () => {
    it('should allow access with valid token', async () => {
      // Arrange
      const context = createMockExecutionContext({
        authorization: 'Bearer valid-token-123',
      });
      reflector.getAllAndOverride.mockReturnValue(false);
      service.validateToken.mockResolvedValue(true);

      // Act
      const result = await guard.canActivate(context);

      // Assert
      expect(result).toBe(true);
      expect(service.validateToken).toHaveBeenCalledWith('valid-token-123');
    });
  });

  describe('Invalid/Expired Credentials', () => {
    it('should throw UnauthorizedException for invalid token', async () => {
      // Arrange
      const context = createMockExecutionContext({
        authorization: 'Bearer invalid-token',
      });
      reflector.getAllAndOverride.mockReturnValue(false);
      service.validateToken.mockResolvedValue(false);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for expired token', async () => {
      // Arrange
      const context = createMockExecutionContext({
        authorization: 'Bearer expired-token',
      });
      reflector.getAllAndOverride.mockReturnValue(false);
      service.validateToken.mockRejectedValue(
        new UnauthorizedException('Token expired'),
      );

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow('Token expired');
    });
  });

  describe('Error Handling', () => {
    it('should handle service errors gracefully', async () => {
      // Arrange
      const context = createMockExecutionContext({
        authorization: 'Bearer valid-token',
      });
      reflector.getAllAndOverride.mockReturnValue(false);
      service.validateToken.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle null token gracefully', async () => {
      // Arrange
      const context = createMockExecutionContext({
        authorization: 'Bearer null',
      });
      reflector.getAllAndOverride.mockReturnValue(false);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should handle malformed tokens', async () => {
      // Arrange
      const context = createMockExecutionContext({
        authorization: 'Bearer !!!invalid!!!',
      });
      reflector.getAllAndOverride.mockReturnValue(false);
      service.validateToken.mockResolvedValue(false);

      // Act & Assert
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
