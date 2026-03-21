import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Base business exception class
 * All custom business exceptions should extend this class
 */
export class BusinessException extends HttpException {
  constructor(message: string, statusCode: HttpStatus = HttpStatus.BAD_REQUEST, public readonly details?: any) {
    super({ message, details }, statusCode);
  }
}

/**
 * Exception thrown when a requested resource is not found
 */
export class ResourceNotFoundException extends BusinessException {
  constructor(resourceType: string, identifier: string) {
    super(
      `${resourceType} with identifier '${identifier}' not found`,
      HttpStatus.NOT_FOUND,
      { resourceType, identifier }
    );
  }
}

/**
 * Exception thrown when a database operation fails
 */
export class DatabaseException extends BusinessException {
  constructor(message: string, public readonly originalError?: any) {
    super(
      message,
      HttpStatus.INTERNAL_SERVER_ERROR,
      { originalError: originalError?.message || originalError }
    );
  }
}

/**
 * Exception thrown when validation fails
 */
export class ValidationException extends BusinessException {
  constructor(message: string, validationErrors?: any) {
    super(message, HttpStatus.BAD_REQUEST, validationErrors);
  }
}

/**
 * Exception thrown when a business rule is violated
 */
export class BusinessRuleException extends BusinessException {
  constructor(message: string, details?: any) {
    super(message, HttpStatus.UNPROCESSABLE_ENTITY, details);
  }
}
