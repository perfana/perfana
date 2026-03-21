/**
 * Unit tests for Error Handling Utilities
 *
 * Tests custom error classes and error handling utilities:
 * - PerfanaError and subclasses (AuthenticationError, ValidationError, etc.)
 * - createErrorFromResponse: Creates appropriate errors based on HTTP status
 * - isKnownError: Type guard for PerfanaError instances
 * - getErrorMessage: Safe error message extraction
 */

import {
  PerfanaError,
  AuthenticationError,
  AuthorizationError,
  NetworkError,
  ValidationError,
  NotFoundError,
  ConflictError,
  ServerError,
  createErrorFromResponse,
  isKnownError,
  getErrorMessage,
} from '@/lib/errors';

describe('Error Handling Utilities', () => {
  describe('PerfanaError', () => {
    it('should create error with message, code, and status', () => {
      // Arrange & Act
      const error = new PerfanaError('Test error', 'TEST_ERROR', 400);

      // Assert
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.statusCode).toBe(400);
      expect(error.name).toBe('PerfanaError');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(PerfanaError);
    });

    it('should create error without status code', () => {
      // Arrange & Act
      const error = new PerfanaError('Test error', 'TEST_ERROR');

      // Assert
      expect(error.statusCode).toBeUndefined();
    });

    it('should have proper stack trace', () => {
      // Arrange & Act
      const error = new PerfanaError('Test error', 'TEST_ERROR');

      // Assert
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('PerfanaError');
    });
  });

  describe('AuthenticationError', () => {
    it('should create authentication error with default message', () => {
      // Arrange & Act
      const error = new AuthenticationError();

      // Assert
      expect(error.message).toBe('Authentication failed');
      expect(error.code).toBe('AUTH_ERROR');
      expect(error.statusCode).toBe(401);
      expect(error.name).toBe('AuthenticationError');
      expect(error).toBeInstanceOf(PerfanaError);
      expect(error).toBeInstanceOf(AuthenticationError);
    });

    it('should create authentication error with custom message', () => {
      // Arrange & Act
      const error = new AuthenticationError('Invalid credentials');

      // Assert
      expect(error.message).toBe('Invalid credentials');
      expect(error.statusCode).toBe(401);
    });
  });

  describe('AuthorizationError', () => {
    it('should create authorization error with default message', () => {
      // Arrange & Act
      const error = new AuthorizationError();

      // Assert
      expect(error.message).toBe('Insufficient permissions');
      expect(error.code).toBe('AUTH_FORBIDDEN');
      expect(error.statusCode).toBe(403);
      expect(error.name).toBe('AuthorizationError');
    });

    it('should create authorization error with custom message', () => {
      // Arrange & Act
      const error = new AuthorizationError('Admin access required');

      // Assert
      expect(error.message).toBe('Admin access required');
      expect(error.statusCode).toBe(403);
    });
  });

  describe('NetworkError', () => {
    it('should create network error with default message', () => {
      // Arrange & Act
      const error = new NetworkError();

      // Assert
      expect(error.message).toBe('Network request failed');
      expect(error.code).toBe('NETWORK_ERROR');
      expect(error.statusCode).toBe(0);
      expect(error.name).toBe('NetworkError');
    });

    it('should create network error with custom message', () => {
      // Arrange & Act
      const error = new NetworkError('Connection timeout');

      // Assert
      expect(error.message).toBe('Connection timeout');
      expect(error.statusCode).toBe(0);
    });
  });

  describe('ValidationError', () => {
    it('should create validation error without field', () => {
      // Arrange & Act
      const error = new ValidationError('Invalid input');

      // Assert
      expect(error.message).toBe('Invalid input');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.statusCode).toBe(400);
      expect(error.name).toBe('ValidationError');
      expect(error.field).toBeUndefined();
    });

    it('should create validation error with field', () => {
      // Arrange & Act
      const error = new ValidationError('Email is required', 'email');

      // Assert
      expect(error.message).toBe('Email is required');
      expect(error.field).toBe('email');
      expect(error.statusCode).toBe(400);
    });
  });

  describe('NotFoundError', () => {
    it('should create not found error with default resource', () => {
      // Arrange & Act
      const error = new NotFoundError();

      // Assert
      expect(error.message).toBe('Resource not found');
      expect(error.code).toBe('NOT_FOUND');
      expect(error.statusCode).toBe(404);
      expect(error.name).toBe('NotFoundError');
    });

    it('should create not found error with custom resource', () => {
      // Arrange & Act
      const error = new NotFoundError('User');

      // Assert
      expect(error.message).toBe('User not found');
      expect(error.statusCode).toBe(404);
    });
  });

  describe('ConflictError', () => {
    it('should create conflict error with default message', () => {
      // Arrange & Act
      const error = new ConflictError();

      // Assert
      expect(error.message).toBe('Resource conflict');
      expect(error.code).toBe('CONFLICT');
      expect(error.statusCode).toBe(409);
      expect(error.name).toBe('ConflictError');
    });

    it('should create conflict error with custom message', () => {
      // Arrange & Act
      const error = new ConflictError('Email already exists');

      // Assert
      expect(error.message).toBe('Email already exists');
      expect(error.statusCode).toBe(409);
    });
  });

  describe('ServerError', () => {
    it('should create server error with default message', () => {
      // Arrange & Act
      const error = new ServerError();

      // Assert
      expect(error.message).toBe('Internal server error');
      expect(error.code).toBe('SERVER_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.name).toBe('ServerError');
    });

    it('should create server error with custom message', () => {
      // Arrange & Act
      const error = new ServerError('Database connection failed');

      // Assert
      expect(error.message).toBe('Database connection failed');
      expect(error.statusCode).toBe(500);
    });
  });

  describe('createErrorFromResponse()', () => {
    it('should create AuthenticationError for 401 status', () => {
      // Arrange
      const response = new Response(null, { status: 401 });

      // Act
      const error = createErrorFromResponse(response, 'Default message');

      // Assert
      expect(error).toBeInstanceOf(AuthenticationError);
      expect(error.statusCode).toBe(401);
    });

    it('should create AuthorizationError for 403 status', () => {
      // Arrange
      const response = new Response(null, { status: 403 });

      // Act
      const error = createErrorFromResponse(response, 'Default message');

      // Assert
      expect(error).toBeInstanceOf(AuthorizationError);
      expect(error.statusCode).toBe(403);
    });

    it('should create NotFoundError for 404 status', () => {
      // Arrange
      const response = new Response(null, { status: 404 });

      // Act
      const error = createErrorFromResponse(response, 'Default message');

      // Assert
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.statusCode).toBe(404);
    });

    it('should create ConflictError for 409 status', () => {
      // Arrange
      const response = new Response(null, { status: 409 });

      // Act
      const error = createErrorFromResponse(response, 'Default message');

      // Assert
      expect(error).toBeInstanceOf(ConflictError);
      expect(error.statusCode).toBe(409);
    });

    it('should create ServerError for 500 status', () => {
      // Arrange
      const response = new Response(null, { status: 500 });

      // Act
      const error = createErrorFromResponse(response, 'Default message');

      // Assert
      expect(error).toBeInstanceOf(ServerError);
      expect(error.statusCode).toBe(500);
    });

    it('should create ServerError for 502 status', () => {
      // Arrange
      const response = new Response(null, { status: 502 });

      // Act
      const error = createErrorFromResponse(response, 'Default message');

      // Assert
      expect(error).toBeInstanceOf(ServerError);
    });

    it('should create ServerError for 503 status', () => {
      // Arrange
      const response = new Response(null, { status: 503 });

      // Act
      const error = createErrorFromResponse(response, 'Default message');

      // Assert
      expect(error).toBeInstanceOf(ServerError);
    });

    it('should create ServerError for 504 status', () => {
      // Arrange
      const response = new Response(null, { status: 504 });

      // Act
      const error = createErrorFromResponse(response, 'Default message');

      // Assert
      expect(error).toBeInstanceOf(ServerError);
    });

    it('should create generic PerfanaError for unknown status codes', () => {
      // Arrange
      const response = new Response(null, { status: 418 }); // I'm a teapot

      // Act
      const error = createErrorFromResponse(response, 'Custom default message');

      // Assert
      expect(error).toBeInstanceOf(PerfanaError);
      expect(error).not.toBeInstanceOf(ServerError);
      expect(error.message).toBe('Custom default message');
      expect(error.code).toBe('API_ERROR');
      expect(error.statusCode).toBe(418);
    });

    it('should use default message for unhandled status codes', () => {
      // Arrange
      const response = new Response(null, { status: 400 });

      // Act
      const error = createErrorFromResponse(response, 'Bad request occurred');

      // Assert
      expect(error.message).toBe('Bad request occurred');
      expect(error.statusCode).toBe(400);
    });
  });

  describe('isKnownError()', () => {
    it('should return true for PerfanaError instances', () => {
      // Arrange
      const error = new PerfanaError('Test', 'TEST_ERROR');

      // Act
      const result = isKnownError(error);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true for AuthenticationError instances', () => {
      // Arrange
      const error = new AuthenticationError();

      // Act
      const result = isKnownError(error);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true for all PerfanaError subclasses', () => {
      // Arrange
      const errors = [
        new AuthenticationError(),
        new AuthorizationError(),
        new NetworkError(),
        new ValidationError('test'),
        new NotFoundError(),
        new ConflictError(),
        new ServerError(),
      ];

      // Act & Assert
      errors.forEach((error) => {
        expect(isKnownError(error)).toBe(true);
      });
    });

    it('should return false for standard Error instances', () => {
      // Arrange
      const error = new Error('Standard error');

      // Act
      const result = isKnownError(error);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false for non-error objects', () => {
      // Arrange
      const notAnError = { message: 'Not an error' };

      // Act
      const result = isKnownError(notAnError);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false for null', () => {
      // Act
      const result = isKnownError(null);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false for undefined', () => {
      // Act
      const result = isKnownError(undefined);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('getErrorMessage()', () => {
    it('should extract message from PerfanaError', () => {
      // Arrange
      const error = new PerfanaError('Custom error message', 'CODE');

      // Act
      const message = getErrorMessage(error);

      // Assert
      expect(message).toBe('Custom error message');
    });

    it('should extract message from standard Error', () => {
      // Arrange
      const error = new Error('Standard error message');

      // Act
      const message = getErrorMessage(error);

      // Assert
      expect(message).toBe('Standard error message');
    });

    it('should extract message from error-like objects', () => {
      // Arrange
      const error = { message: 'Error-like object message' };

      // Act
      const message = getErrorMessage(error);

      // Assert
      expect(message).toBe('Error-like object message');
    });

    it('should return default message for non-error objects', () => {
      // Arrange
      const notAnError = { code: 'ERROR' };

      // Act
      const message = getErrorMessage(notAnError);

      // Assert
      expect(message).toBe('An unexpected error occurred');
    });

    it('should return default message for null', () => {
      // Act
      const message = getErrorMessage(null);

      // Assert
      expect(message).toBe('An unexpected error occurred');
    });

    it('should return default message for undefined', () => {
      // Act
      const message = getErrorMessage(undefined);

      // Assert
      expect(message).toBe('An unexpected error occurred');
    });

    it('should return default message for strings', () => {
      // Act
      const message = getErrorMessage('string error');

      // Assert
      expect(message).toBe('An unexpected error occurred');
    });

    it('should return default message for numbers', () => {
      // Act
      const message = getErrorMessage(404);

      // Assert
      expect(message).toBe('An unexpected error occurred');
    });

    it('should handle all error subclasses correctly', () => {
      // Arrange
      const errors = [
        new AuthenticationError('Auth failed'),
        new AuthorizationError('Access denied'),
        new ValidationError('Invalid field', 'email'),
        new NotFoundError('User'),
        new ServerError('DB error'),
      ];

      // Act & Assert
      errors.forEach((error) => {
        const message = getErrorMessage(error);
        expect(message).toBe(error.message);
        expect(message).not.toBe('An unexpected error occurred');
      });
    });
  });

  describe('Type Safety and Inheritance', () => {
    it('should maintain instanceof relationships', () => {
      // Arrange
      const authError = new AuthenticationError();

      // Assert
      expect(authError instanceof Error).toBe(true);
      expect(authError instanceof PerfanaError).toBe(true);
      expect(authError instanceof AuthenticationError).toBe(true);
    });

    it('should not be instance of other error types', () => {
      // Arrange
      const authError = new AuthenticationError();

      // Assert
      expect(authError instanceof ValidationError).toBe(false);
      expect(authError instanceof NotFoundError).toBe(false);
    });

    it('should work with type guards correctly', () => {
      // Arrange
      const errors: unknown[] = [
        new PerfanaError('test', 'TEST'),
        new Error('standard'),
        'not an error',
        null,
      ];

      // Act
      const knownErrors = errors.filter(isKnownError);

      // Assert
      expect(knownErrors).toHaveLength(1);
      expect(knownErrors[0]).toBeInstanceOf(PerfanaError);
    });
  });
});
