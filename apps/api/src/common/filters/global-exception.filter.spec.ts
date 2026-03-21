import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';
import { BusinessException, ResourceNotFoundException } from '../exceptions/business.exception';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let mockResponse: any;
  let mockRequest: any;
  let mockHost: ArgumentsHost;
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.NODE_ENV;
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    mockRequest = {
      url: '/api/test',
      method: 'GET',
      headers: {
        'user-agent': 'test-agent',
      },
      ip: '127.0.0.1',
    };

    mockHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: jest.fn().mockReturnValue(mockResponse),
        getRequest: jest.fn().mockReturnValue(mockRequest),
      }),
    } as unknown as ArgumentsHost;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    jest.clearAllMocks();
  });

  describe('Production Environment - Security Features', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      filter = new GlobalExceptionFilter();
    });

    it('should hide stack traces in production for Error instances', () => {
      const exception = new Error('Database connection failed');

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      const response = mockResponse.json.mock.calls[0][0];

      expect(response).toMatchObject({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'An internal server error occurred',
        error: 'Internal Server Error',
        errorCode: 'INTERNAL_SERVER_ERROR',
        path: '/api/test',
      });

      // Critical: stack should NOT be present in production
      expect(response.stack).toBeUndefined();
      expect(response.method).toBeUndefined();
      expect(response.details).toBeUndefined();
      expect(response.correlationId).toBeDefined();
      expect(response.timestamp).toBeDefined();
    });

    it('should return generic message for server errors in production', () => {
      const exception = new Error('SELECT * FROM users WHERE password = "secret"');

      filter.catch(exception, mockHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.message).toBe('An internal server error occurred');
      // Should NOT expose SQL query
      expect(response.message).not.toContain('SELECT');
      expect(response.message).not.toContain('password');
    });

    it('should hide internal file paths in production', () => {
      const exception = new HttpException(
        'Error at /usr/src/app/src/modules/users/users.service.ts:42',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );

      filter.catch(exception, mockHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.message).toBe('An internal server error occurred');
      // Should NOT expose file paths
      expect(response.message).not.toContain('/usr/src/app');
      expect(response.message).not.toContain('.ts');
    });

    it('should sanitize error details in production', () => {
      const exception = new BusinessException(
        'Operation failed',
        'OPERATION_FAILED',
        HttpStatus.BAD_REQUEST,
        {
          field: 'email',
          password: 'secret123',
          apiKey: 'key-123',
          token: 'jwt-token',
        },
      );

      filter.catch(exception, mockHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.details).toBeDefined();
      expect(response.details.field).toBe('email');
      // Sensitive fields should be redacted
      expect(response.details.password).toBe('[REDACTED]');
      expect(response.details.apiKey).toBe('[REDACTED]');
      expect(response.details.token).toBe('[REDACTED]');
    });

    it('should remove JWT tokens from error messages', () => {
      const exception = new HttpException(
        'Invalid token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
        HttpStatus.UNAUTHORIZED,
      );

      filter.catch(exception, mockHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.message).toContain('[JWT_TOKEN]');
      expect(response.message).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    });

    it('should remove database credentials from error messages', () => {
      const exception = new HttpException(
        'Connection failed to postgres://admin:password123@localhost:5432/db',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );

      filter.catch(exception, mockHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.message).toBe('An internal server error occurred');
      expect(response.message).not.toContain('admin');
      expect(response.message).not.toContain('password123');
    });

    it('should remove email addresses from error messages', () => {
      const exception = new HttpException(
        'User user@example.com already exists',
        HttpStatus.CONFLICT,
      );

      filter.catch(exception, mockHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.message).toContain('[EMAIL]');
      expect(response.message).not.toContain('user@example.com');
    });

    it('should remove IP addresses from error messages', () => {
      const exception = new HttpException(
        'Request from 192.168.1.100 was blocked',
        HttpStatus.FORBIDDEN,
      );

      filter.catch(exception, mockHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.message).toContain('[IP_ADDRESS]');
      expect(response.message).not.toContain('192.168.1.100');
    });

    it('should include correlation ID for tracking', () => {
      const exception = new Error('Test error');

      filter.catch(exception, mockHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.correlationId).toBeDefined();
      expect(typeof response.correlationId).toBe('string');
      expect(response.correlationId.length).toBeGreaterThan(0);
    });

    it('should handle unknown error types securely', () => {
      const exception = { weird: 'object', password: 'secret' };

      filter.catch(exception, mockHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response).toMatchObject({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'An unexpected error occurred',
        error: 'Internal Server Error',
        errorCode: 'UNKNOWN_ERROR',
      });
      expect(response.stack).toBeUndefined();
      expect(response.weird).toBeUndefined();
      expect(response.password).toBeUndefined();
    });
  });

  describe('Development Environment - Debugging Features', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
      filter = new GlobalExceptionFilter();
    });

    it('should include stack traces in development', () => {
      const exception = new Error('Database connection failed');

      filter.catch(exception, mockHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(response.message).toBe('Database connection failed');
      expect(response.stack).toBeDefined();
      expect(typeof response.stack).toBe('string');
      expect(response.stack).toContain('Error: Database connection failed');
    });

    it('should include method in development', () => {
      const exception = new Error('Test error');

      filter.catch(exception, mockHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.method).toBe('GET');
    });

    it('should include detailed error messages in development', () => {
      const exception = new Error('Detailed error with /path/to/file.ts');

      filter.catch(exception, mockHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.message).toContain('/path/to/file.ts');
      expect(response.message).not.toBe('An internal server error occurred');
    });

    it('should include error details in development', () => {
      const exception = new BusinessException(
        'Operation failed',
        'OPERATION_FAILED',
        HttpStatus.BAD_REQUEST,
        {
          field: 'email',
          reason: 'Invalid format',
          sqlQuery: 'SELECT * FROM users',
        },
      );

      filter.catch(exception, mockHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.details).toBeDefined();
      expect(response.details.field).toBe('email');
      expect(response.details.reason).toBe('Invalid format');
      expect(response.details.sqlQuery).toBe('SELECT * FROM users');
    });
  });

  describe('Business Exceptions', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      filter = new GlobalExceptionFilter();
    });

    it('should handle BusinessException correctly', () => {
      const exception = new ResourceNotFoundException('User', '123');

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      const response = mockResponse.json.mock.calls[0][0];

      expect(response).toMatchObject({
        statusCode: HttpStatus.NOT_FOUND,
        message: "User with identifier '123' not found",
        error: 'Not Found',
        errorCode: 'RESOURCE_NOT_FOUND',
        path: '/api/test',
        correlationId: expect.any(String),
        timestamp: expect.any(String),
      });
    });

    it('should sanitize BusinessException details in production', () => {
      const exception = new BusinessException(
        'Operation failed',
        'OPERATION_FAILED',
        HttpStatus.BAD_REQUEST,
        {
          email: 'user@example.com',
          password: 'secret',
          filePath: '/usr/src/app/config.json',
        },
      );

      filter.catch(exception, mockHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.details.email).toBe('[EMAIL]');
      expect(response.details.password).toBe('[REDACTED]');
      expect(response.details.filePath).not.toContain('/usr/src/app');
    });
  });

  describe('HTTP Exceptions', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      filter = new GlobalExceptionFilter();
    });

    it('should handle standard HttpException', () => {
      const exception = new HttpException('Bad request', HttpStatus.BAD_REQUEST);

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      const response = mockResponse.json.mock.calls[0][0];

      expect(response).toMatchObject({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Bad request',
        error: 'Bad Request',
        errorCode: 'HTTP_400',
        path: '/api/test',
      });
    });

    it('should handle HttpException with array messages', () => {
      const exception = new HttpException(
        { message: ['Field 1 is required', 'Field 2 is invalid'] },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, mockHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.message).toBe('Field 1 is required, Field 2 is invalid');
    });

    it('should preserve client error messages (4xx)', () => {
      const exception = new HttpException('Resource not found', HttpStatus.NOT_FOUND);

      filter.catch(exception, mockHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.message).toBe('Resource not found');
    });

    it('should hide server error details (5xx) in production', () => {
      const exception = new HttpException(
        'Database query failed: SELECT * FROM users',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );

      filter.catch(exception, mockHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.message).toBe('An internal server error occurred');
      expect(response.message).not.toContain('Database query failed');
      expect(response.message).not.toContain('SELECT');
    });
  });

  describe('Error Response Structure', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      filter = new GlobalExceptionFilter();
    });

    it('should always include required production fields', () => {
      const exception = new Error('Test error');

      filter.catch(exception, mockHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response).toHaveProperty('statusCode');
      expect(response).toHaveProperty('message');
      expect(response).toHaveProperty('error');
      expect(response).toHaveProperty('errorCode');
      expect(response).toHaveProperty('correlationId');
      expect(response).toHaveProperty('timestamp');
      expect(response).toHaveProperty('path');
    });

    it('should format timestamp as ISO-8601', () => {
      const exception = new Error('Test error');

      filter.catch(exception, mockHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should include request path', () => {
      mockRequest.url = '/api/users/123';
      const exception = new Error('Test error');

      filter.catch(exception, mockHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.path).toBe('/api/users/123');
    });
  });

  describe('Nested Object Sanitization', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      filter = new GlobalExceptionFilter();
    });

    it('should recursively sanitize nested objects', () => {
      const exception = new BusinessException(
        'Validation failed',
        'VALIDATION_ERROR',
        HttpStatus.BAD_REQUEST,
        {
          user: {
            email: 'test@example.com',
            profile: {
              apiKey: 'secret-key',
              name: 'John Doe',
            },
          },
        },
      );

      filter.catch(exception, mockHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.details.user.email).toBe('[EMAIL]');
      expect(response.details.user.profile.apiKey).toBe('[REDACTED]');
      expect(response.details.user.profile.name).toBe('John Doe');
    });

    it('should handle arrays in error details', () => {
      const exception = new BusinessException(
        'Multiple errors',
        'MULTIPLE_ERRORS',
        HttpStatus.BAD_REQUEST,
        {
          errors: ['Error 1', 'Error 2'],
          count: 2,
        },
      );

      filter.catch(exception, mockHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.details.errors).toEqual(['Error 1', 'Error 2']);
      expect(response.details.count).toBe(2);
    });
  });
});
