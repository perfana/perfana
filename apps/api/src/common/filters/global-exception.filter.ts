import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { BusinessException } from '../exceptions/business.exception';

interface ErrorDetails {
  [key: string]: unknown;
}

interface BusinessExceptionResponse {
  message: string;
  code: string;
  details?: ErrorDetails;
}

interface HttpExceptionResponse {
  message?: string | string[];
  error?: string;
  statusCode?: number;
  details?: ErrorDetails;
}

/**
 * Production-safe error response that hides sensitive details
 * Note: details field may be included if properly sanitized
 */
interface ProductionErrorResponse {
  statusCode: number;
  message: string;
  error: string;
  errorCode: string;
  correlationId: string;
  timestamp: string;
  path: string;
  details?: ErrorDetails;
}

/**
 * Development error response with detailed information for debugging
 */
interface DevelopmentErrorResponse extends ProductionErrorResponse {
  method: string;
  details?: ErrorDetails;
  stack?: string;
}

type ErrorResponse = ProductionErrorResponse | DevelopmentErrorResponse;

/**
 * Global exception filter that handles all exceptions and provides
 * consistent error responses across the application.
 *
 * Security Features:
 * - Hides stack traces and internal details in production
 * - Generates correlation IDs for error tracking
 * - Sanitizes error messages to prevent information disclosure
 * - Prevents PII exposure in error responses
 * - Logs full error details securely server-side
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);
  private readonly isProduction: boolean;
  private readonly isDevelopment: boolean;

  constructor() {
    const env = process.env.NODE_ENV || 'development';
    this.isProduction = env === 'production';
    this.isDevelopment = env === 'development';
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const correlationId = randomUUID();

    const errorResponse = this.handleException(exception, request, correlationId);
    response.status(errorResponse.statusCode).json(errorResponse);
  }

  /**
   * Route exception to appropriate handler based on type
   */
  private handleException(exception: unknown, request: Request, correlationId: string): ErrorResponse {
    if (exception instanceof BusinessException) {
      return this.handleBusinessException(exception, request, correlationId);
    }

    if (exception instanceof HttpException) {
      return this.handleHttpException(exception, request, correlationId);
    }

    if (exception instanceof Error) {
      return this.handleError(exception, request, correlationId);
    }

    return this.handleUnknownException(exception, request, correlationId);
  }

  /**
   * Handle custom business exceptions
   */
  private handleBusinessException(
    exception: BusinessException,
    request: Request,
    correlationId: string,
  ): ErrorResponse {
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse() as BusinessExceptionResponse;

    const sanitizedDetails = this.isProduction
      ? this.sanitizeDetails(exceptionResponse.details)
      : exceptionResponse.details;

    this.logBusinessException(exceptionResponse, request, correlationId, status);

    return this.buildErrorResponse({
      statusCode: status,
      message: exceptionResponse.message,
      error: this.getErrorName(status),
      errorCode: exceptionResponse.code,
      correlationId,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      details: sanitizedDetails,
    });
  }

  /**
   * Handle standard NestJS HTTP exceptions
   */
  private handleHttpException(
    exception: HttpException,
    request: Request,
    correlationId: string,
  ): ErrorResponse {
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    const { message, details } = this.parseHttpExceptionResponse(exceptionResponse, exception);
    const errorCode = `HTTP_${status}`;

    const sanitizedMessage = this.isProduction
      ? this.sanitizeErrorMessage(message, status)
      : message;
    const sanitizedDetails = this.isProduction ? this.sanitizeDetails(details) : details;

    this.logHttpException(message, request, correlationId, status);

    return this.buildErrorResponse({
      statusCode: status,
      message: sanitizedMessage,
      error: this.getErrorName(status),
      errorCode,
      correlationId,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      details: sanitizedDetails,
    });
  }

  /**
   * Handle unexpected Error instances
   */
  private handleError(exception: Error, request: Request, correlationId: string): ErrorResponse {
    const status = HttpStatus.INTERNAL_SERVER_ERROR;

    this.logError(exception, request, correlationId);

    return this.buildErrorResponse({
      statusCode: status,
      message: this.isProduction ? 'An internal server error occurred' : exception.message,
      error: 'Internal Server Error',
      errorCode: 'INTERNAL_SERVER_ERROR',
      correlationId,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      stack: this.isDevelopment ? exception.stack : undefined,
    });
  }

  /**
   * Handle unknown exception types
   */
  private handleUnknownException(
    exception: unknown,
    request: Request,
    correlationId: string,
  ): ErrorResponse {
    const status = HttpStatus.INTERNAL_SERVER_ERROR;

    this.logUnknownException(exception, request, correlationId);

    return this.buildErrorResponse({
      statusCode: status,
      message: this.isProduction ? 'An unexpected error occurred' : 'Unknown error type',
      error: 'Internal Server Error',
      errorCode: 'UNKNOWN_ERROR',
      correlationId,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
    });
  }

  /**
   * Parse HTTP exception response to extract message and details
   */
  private parseHttpExceptionResponse(
    exceptionResponse: string | object,
    exception: HttpException,
  ): { message: string; details: ErrorDetails | undefined } {
    if (typeof exceptionResponse === 'string') {
      return { message: exceptionResponse, details: undefined };
    }

    const responseObj = exceptionResponse as HttpExceptionResponse;
    let message: string;

    if (Array.isArray(responseObj.message)) {
      message = responseObj.message.join(', ');
    } else {
      message = responseObj.message || exception.message;
    }

    return { message, details: responseObj.details };
  }

  /**
   * Log business exception with full context
   */
  private logBusinessException(
    exceptionResponse: BusinessExceptionResponse,
    request: Request,
    correlationId: string,
    status: number,
  ): void {
    this.logger.warn(`Business exception [${correlationId}]: ${exceptionResponse.message}`, {
      correlationId,
      code: exceptionResponse.code,
      path: request.url,
      method: request.method,
      statusCode: status,
      details: exceptionResponse.details,
      userAgent: request.headers['user-agent'],
      ip: request.ip,
    });
  }

  /**
   * Log HTTP exception with full details
   */
  private logHttpException(
    message: string,
    request: Request,
    correlationId: string,
    status: number,
  ): void {
    const logContext: Record<string, unknown> = {
      correlationId,
      statusCode: status,
      path: request.url,
      method: request.method,
      originalMessage: message,
      userAgent: request.headers['user-agent'],
      ip: request.ip,
    };

    // For client errors (4xx), include sanitized request body for debugging validation issues
    if (status >= 400 && status < 500 && request.body) {
      logContext.requestBody = this.sanitizeDetails(request.body as Record<string, unknown>);
    }

    // 2xx status codes thrown as HttpException (e.g., 202 Accepted) are not errors
    if (status >= 200 && status < 300) {
      this.logger.debug(`HTTP ${status} [${correlationId}]: ${message}`, logContext);
    } else {
      this.logger.warn(`HTTP exception [${correlationId}]: ${message}`, logContext);
    }
  }

  /**
   * Log unexpected error with stack trace
   */
  private logError(exception: Error, request: Request, correlationId: string): void {
    this.logger.error(
      `Unexpected error [${correlationId}]: ${exception.message}`,
      exception.stack,
      {
        correlationId,
        path: request.url,
        method: request.method,
        error: exception.message,
        errorName: exception.name,
        userAgent: request.headers['user-agent'],
        ip: request.ip,
      },
    );
  }

  /**
   * Log unknown exception type
   */
  private logUnknownException(exception: unknown, request: Request, correlationId: string): void {
    this.logger.error(`Unknown error [${correlationId}]`, JSON.stringify(exception), {
      correlationId,
      path: request.url,
      method: request.method,
      exceptionType: typeof exception,
      userAgent: request.headers['user-agent'],
      ip: request.ip,
    });
  }

  /**
   * Get human-readable error name based on HTTP status code
   */
  private getErrorName(status: HttpStatus): string {
    const errorNames: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: 'Bad Request',
      [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
      [HttpStatus.FORBIDDEN]: 'Forbidden',
      [HttpStatus.NOT_FOUND]: 'Not Found',
      [HttpStatus.METHOD_NOT_ALLOWED]: 'Method Not Allowed',
      [HttpStatus.CONFLICT]: 'Conflict',
      [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable Entity',
      [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',
      [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
      [HttpStatus.NOT_IMPLEMENTED]: 'Not Implemented',
      [HttpStatus.BAD_GATEWAY]: 'Bad Gateway',
      [HttpStatus.SERVICE_UNAVAILABLE]: 'Service Unavailable',
      [HttpStatus.GATEWAY_TIMEOUT]: 'Gateway Timeout',
    };

    return errorNames[status] || 'Error';
  }

  /**
   * Build error response based on environment (production vs development)
   * Production: Minimal information, no stack traces, but includes sanitized details
   * Development: Full details including stack traces
   */
  private buildErrorResponse(params: {
    statusCode: number;
    message: string;
    error: string;
    errorCode: string;
    correlationId: string;
    timestamp: string;
    path: string;
    method: string;
    details?: ErrorDetails;
    stack?: string;
  }): ErrorResponse {
    const baseResponse: ProductionErrorResponse = {
      statusCode: params.statusCode,
      message: params.message,
      error: params.error,
      errorCode: params.errorCode,
      correlationId: params.correlationId,
      timestamp: params.timestamp,
      path: params.path,
    };

    // Production: Return minimal error information but include sanitized details if present
    if (this.isProduction) {
      // Include sanitized details in production (already sanitized by caller)
      if (params.details && Object.keys(params.details).length > 0) {
        return {
          ...baseResponse,
          details: params.details,
        } as ProductionErrorResponse;
      }
      return baseResponse;
    }

    // Development/Staging: Include detailed debugging information
    const developmentResponse: DevelopmentErrorResponse = {
      ...baseResponse,
      method: params.method,
    };

    // Add details if available
    if (params.details) {
      developmentResponse.details = params.details;
    }

    // Add stack trace if available (only in development)
    if (this.isDevelopment && params.stack) {
      developmentResponse.stack = params.stack;
    }

    return developmentResponse;
  }

  /**
   * Sanitize error message to prevent information disclosure in production
   * Removes file paths, SQL queries, and other sensitive information
   */
  private sanitizeErrorMessage(message: string, status: number): string {
    // For client errors (4xx), return the message as-is since it's user-facing
    if (status >= 400 && status < 500) {
      return this.removeSensitiveData(message);
    }

    // For server errors (5xx), return generic message in production
    return 'An internal server error occurred';
  }

  /**
   * Remove sensitive data from error messages
   * Strips file paths, SQL queries, and other implementation details
   */
  private removeSensitiveData(message: string): string {
    if (!message) return message;

    // Remove file paths (Unix and Windows)
    let sanitized = message.replaceAll(/\/[\w\-./]+\.(ts|js|json)/gi, '[FILE_PATH]');
    sanitized = sanitized.replaceAll(/[A-Z]:\\[\w\-\\]+\.(ts|js|json)/gi, '[FILE_PATH]');

    // Remove absolute paths
    sanitized = sanitized.replaceAll(/\/[\w\-./]+/g, '[PATH]');

    // Remove SQL query fragments
    sanitized = sanitized.replaceAll(/SELECT .+ FROM/gi, 'SELECT [QUERY]');
    sanitized = sanitized.replaceAll(/INSERT INTO .+/gi, 'INSERT [QUERY]');
    sanitized = sanitized.replaceAll(/UPDATE .+ SET/gi, 'UPDATE [QUERY]');
    sanitized = sanitized.replaceAll(/DELETE FROM .+/gi, 'DELETE [QUERY]');

    // Remove connection strings
    sanitized = sanitized.replaceAll(/postgres:\/\/[\w:@]+/gi, 'postgres://[CREDENTIALS]');
    sanitized = sanitized.replaceAll(/mongodb:\/\/[\w:@]+/gi, 'mongodb://[CREDENTIALS]');

    // Remove JWT tokens
    sanitized = sanitized.replaceAll(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g, '[JWT_TOKEN]');

    // Remove UUIDs that might be sensitive
    sanitized = sanitized.replaceAll(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      '[UUID]',
    );

    // Remove email addresses
    sanitized = sanitized.replaceAll(/[\w.-]+@[\w.-]+\.\w+/gi, '[EMAIL]');

    // Remove IP addresses
    sanitized = sanitized.replaceAll(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[IP_ADDRESS]');

    return sanitized;
  }

  /**
   * Sanitize error details to prevent PII and sensitive data exposure
   * Recursively processes object properties
   */
  private sanitizeDetails(details?: ErrorDetails): ErrorDetails | undefined {
    if (!details) return undefined;

    const sanitized: ErrorDetails = {};

    for (const [key, value] of Object.entries(details)) {
      // Skip sensitive keys entirely
      const sensitiveKeys = [
        'password',
        'token',
        'secret',
        'apiKey',
        'api_key',
        'authorization',
        'cookie',
        'session',
        'ssn',
        'creditCard',
        'credit_card',
      ];

      if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk.toLowerCase()))) {
        sanitized[key] = '[REDACTED]';
        continue;
      }

      // Recursively sanitize nested objects
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        sanitized[key] = this.sanitizeDetails(value as ErrorDetails);
      }
      // Sanitize string values
      else if (typeof value === 'string') {
        sanitized[key] = this.removeSensitiveData(value);
      }
      // Keep other primitive values as-is
      else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}