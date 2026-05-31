import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Base business exception for domain-specific errors
 */
export class BusinessException extends HttpException {
  constructor(
    message: string,
    public readonly code: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: unknown,
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
  constructor(message: string, validationErrors?: unknown[]) {
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
 * Exception for database operation failures
 */
export class DatabaseException extends BusinessException {
  constructor(message: string, originalError?: unknown) {
    super(
      message,
      'DATABASE_ERROR',
      HttpStatus.INTERNAL_SERVER_ERROR,
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
