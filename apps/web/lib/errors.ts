export class PerfanaError extends Error {
  public readonly code: string;
  public readonly statusCode?: number;

  constructor(message: string, code: string, statusCode?: number) {
    super(message);
    this.name = 'PerfanaError';
    this.code = code;
    this.statusCode = statusCode;
    Error.captureStackTrace(this, PerfanaError);
  }
}

export class AuthenticationError extends PerfanaError {
  constructor(message: string = 'Authentication failed') {
    super(message, 'AUTH_ERROR', 401);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends PerfanaError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 'AUTH_FORBIDDEN', 403);
    this.name = 'AuthorizationError';
  }
}

export class NetworkError extends PerfanaError {
  constructor(message: string = 'Network request failed') {
    super(message, 'NETWORK_ERROR', 0);
    this.name = 'NetworkError';
  }
}

export class ValidationError extends PerfanaError {
  public readonly field?: string;

  constructor(message: string, field?: string) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
    this.field = field;
  }
}

export class NotFoundError extends PerfanaError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends PerfanaError {
  constructor(message: string = 'Resource conflict') {
    super(message, 'CONFLICT', 409);
    this.name = 'ConflictError';
  }
}

export class ServerError extends PerfanaError {
  constructor(message: string = 'Internal server error') {
    super(message, 'SERVER_ERROR', 500);
    this.name = 'ServerError';
  }
}

export function createErrorFromResponse(response: Response, defaultMessage: string): PerfanaError {
  switch (response.status) {
    case 401:
      return new AuthenticationError();
    case 403:
      return new AuthorizationError();
    case 404:
      return new NotFoundError();
    case 409:
      return new ConflictError();
    case 500:
    case 502:
    case 503:
    case 504:
      return new ServerError();
    default:
      return new PerfanaError(defaultMessage, 'API_ERROR', response.status);
  }
}

export function isKnownError(error: unknown): error is PerfanaError {
  return error instanceof PerfanaError;
}

export function getErrorMessage(error: unknown): string {
  if (isKnownError(error)) {
    return error.message;
  }
  
  if (error && typeof error === 'object' && 'message' in error) {
    return (error as Error).message;
  }
  
  return 'An unexpected error occurred';
}
/**
 * The reason a NestJS endpoint gave for refusing, or `fallback`.
 *
 * `createErrorFromResponse` above maps a status to a generic sentence and throws the body
 * away, which is the wrong trade for a 400/409 whose whole value is what the server said
 * (e.g. why an SLO is a duplicate). Nest puts that in `message` — a string, or an array of
 * strings from class-validator. The body may not be JSON at all (a proxy error page, an
 * empty 502), so parsing is guarded.
 *
 * Consumes the response body; call it once, on a response you are not going to read again.
 */
export async function serverErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json();
    const message = (body as { message?: unknown } | null)?.message;
    if (Array.isArray(message)) {
      const joined = message.filter((m) => typeof m === 'string').join(', ');
      if (joined) return joined;
    }
    if (typeof message === 'string' && message.trim()) return message;
  } catch {
    // Not JSON — fall through to the caller's wording.
  }
  return fallback;
}
