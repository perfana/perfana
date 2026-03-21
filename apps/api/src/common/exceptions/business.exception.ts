import { HttpException, HttpStatus } from '@nestjs/common';

export interface BusinessExceptionDetails {
  code: string;
  details?: any;
  field?: string;
}

/**
 * Base business exception for domain-specific errors
 */
export class BusinessException extends HttpException {
  constructor(
    message: string,
    public readonly code: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: any,
  ) {
    super(
      {
        statusCode: status,
        message,
        code,
        details,
        timestamp: new Date().toISOString(),
      },
      status,
    );
  }
}

/**
 * Exception for when a requested resource is not found
 */
export class ResourceNotFoundException extends BusinessException {
  constructor(resource: string, identifier?: string) {
    const message = identifier
      ? `${resource} with identifier '${identifier}' not found`
      : `${resource} not found`;
    super(message, 'RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
  }
}

/**
 * Exception for validation errors
 */
export class ValidationException extends BusinessException {
  constructor(message: string, validationErrors?: any[]) {
    super(
      message,
      'VALIDATION_ERROR',
      HttpStatus.BAD_REQUEST,
      validationErrors,
    );
  }
}

/**
 * Exception for when a resource already exists
 */
export class ResourceExistsException extends BusinessException {
  constructor(resource: string, identifier?: string) {
    const message = identifier
      ? `${resource} with identifier '${identifier}' already exists`
      : `${resource} already exists`;
    super(message, 'RESOURCE_EXISTS', HttpStatus.CONFLICT);
  }
}

/**
 * Exception for unauthorized access
 */
export class UnauthorizedException extends BusinessException {
  constructor(message: string = 'Unauthorized access') {
    super(message, 'UNAUTHORIZED', HttpStatus.UNAUTHORIZED);
  }
}

/**
 * Exception for forbidden access (insufficient permissions)
 */
export class ForbiddenException extends BusinessException {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 'FORBIDDEN', HttpStatus.FORBIDDEN);
  }
}

/**
 * Exception for database operation failures
 */
export class DatabaseException extends BusinessException {
  constructor(message: string, originalError?: any) {
    super(
      message,
      'DATABASE_ERROR',
      HttpStatus.INTERNAL_SERVER_ERROR,
      originalError,
    );
  }
}

/**
 * Exception for external service failures
 */
export class ExternalServiceException extends BusinessException {
  constructor(service: string, message: string, originalError?: any) {
    super(
      `External service '${service}' error: ${message}`,
      'EXTERNAL_SERVICE_ERROR',
      HttpStatus.SERVICE_UNAVAILABLE,
      originalError,
    );
  }
}

/**
 * Exception for invalid state transitions
 */
export class InvalidStateException extends BusinessException {
  constructor(message: string, currentState?: string, targetState?: string) {
    const details = currentState && targetState
      ? { currentState, targetState }
      : undefined;
    super(
      message,
      'INVALID_STATE',
      HttpStatus.UNPROCESSABLE_ENTITY,
      details,
    );
  }
}

/**
 * Exception for rate limiting
 */
export class RateLimitException extends BusinessException {
  constructor(message: string = 'Rate limit exceeded') {
    super(message, 'RATE_LIMIT_EXCEEDED', HttpStatus.TOO_MANY_REQUESTS);
  }
}