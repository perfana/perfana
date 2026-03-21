# Security: Error Handling & Stack Trace Protection

## Overview

This document describes the production-safe error handling implementation in Perfana's API service. The global exception filter implements comprehensive security measures to prevent information disclosure while maintaining excellent debugging capabilities in development.

## Security Issue Addressed

**Vulnerability**: Stack Trace and Internal Information Exposure
**Severity**: HIGH
**OWASP Category**: A05:2021 - Security Misconfiguration
**Impact**: Information disclosure that helps attackers map application architecture and plan attacks

### What Was Exposed Before
- Full stack traces with file paths
- Internal application structure
- Database query details
- Technology stack and versions
- Framework internals
- Implementation details

## Implementation

### File Location
`apps/api/src/common/filters/global-exception.filter.ts`

### Key Security Features

#### 1. Environment-Aware Error Responses

**Production Mode** (`NODE_ENV=production`):
- Generic error messages for server errors (5xx)
- No stack traces exposed
- No internal file paths
- No implementation details
- Correlation IDs for error tracking
- Sanitized error details

**Development Mode** (`NODE_ENV=development`):
- Detailed error messages
- Full stack traces
- Request method information
- Unsanitized details for debugging
- All contextual information

#### 2. Sensitive Data Sanitization

The filter automatically sanitizes error responses to prevent exposure of:

**Credentials & Secrets:**
- Passwords (`password`, `Password`, etc.)
- API keys (`apiKey`, `api_key`, etc.)
- Tokens (`token`, `authorization`, etc.)
- Session identifiers
- Secrets of any kind

**PII (Personally Identifiable Information):**
- Email addresses (replaced with `[EMAIL]`)
- IP addresses (replaced with `[IP_ADDRESS]`)
- SSN, credit card numbers
- UUIDs that might identify users

**Implementation Details:**
- File paths (replaced with `[FILE_PATH]` or `[PATH]`)
- SQL queries (replaced with `[QUERY]`)
- Database connection strings (replaced with `[CREDENTIALS]`)
- JWT tokens (replaced with `[JWT_TOKEN]`)

#### 3. Correlation IDs

Every error response includes a unique correlation ID (UUID v4) that:
- Allows tracking errors across distributed systems
- Enables log correlation without exposing implementation details
- Helps debugging without revealing sensitive information
- Appears in both client responses and server-side logs

## Response Format

### Production Response (5xx Errors)

```json
{
  "statusCode": 500,
  "message": "An internal server error occurred",
  "error": "Internal Server Error",
  "errorCode": "INTERNAL_SERVER_ERROR",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2025-11-06T22:30:00.000Z",
  "path": "/api/test-runs"
}
```

### Production Response (4xx Errors with Details)

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request",
  "errorCode": "VALIDATION_ERROR",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2025-11-06T22:30:00.000Z",
  "path": "/api/test-runs",
  "details": {
    "field": "email",
    "reason": "Invalid format"
  }
}
```

### Development Response

```json
{
  "statusCode": 500,
  "message": "Database connection failed at connection.ts:42",
  "error": "Internal Server Error",
  "errorCode": "INTERNAL_SERVER_ERROR",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2025-11-06T22:30:00.000Z",
  "path": "/api/test-runs",
  "method": "GET",
  "stack": "Error: Database connection failed\n    at DatabaseService.connect (...)\n    at ...",
  "details": {
    "connectionString": "postgres://localhost:5432/perfana",
    "error": "ECONNREFUSED"
  }
}
```

## Server-Side Logging

All errors are logged server-side with full details for debugging:

```typescript
// Production: Client sees generic message
// Client response: "An internal server error occurred"

// Server log includes full context:
logger.error(
  'Unexpected error [550e8400-e29b-41d4-a716-446655440000]: Database connection failed',
  exception.stack,
  {
    correlationId: '550e8400-e29b-41d4-a716-446655440000',
    path: '/api/test-runs',
    method: 'GET',
    error: 'Database connection failed',
    errorName: 'Error',
    userAgent: 'Mozilla/5.0...',
    ip: '10.0.0.1',
  }
);
```

## Exception Types Handled

### 1. BusinessException
Custom business logic exceptions with error codes:
- Details are sanitized in production
- Error messages preserved (they're user-facing)
- Error codes included for client handling
- Full context logged server-side

### 2. HttpException (NestJS)
Standard HTTP exceptions:
- 4xx errors: Messages preserved (user-facing)
- 5xx errors: Generic messages in production
- Array messages joined with commas
- Details sanitized if present

### 3. Error (JavaScript)
Unexpected runtime errors:
- Generic message in production
- Full stack trace logged server-side
- Correlation ID for tracking
- No implementation details exposed

### 4. Unknown Types
Non-standard error objects:
- Most restrictive handling
- Generic "unexpected error" message
- Full object logged server-side
- No data leaked to client

## Testing

Comprehensive test coverage ensures security features work correctly:

### Production Security Tests
- Stack trace hiding
- Sensitive data sanitization
- PII removal (emails, IPs)
- Credential stripping (passwords, tokens)
- File path removal
- SQL query sanitization
- Generic messages for 5xx errors

### Development Debugging Tests
- Stack traces included
- Detailed messages
- Full error context
- Request method included
- Unsanitized details

### Sanitization Tests
- Nested object sanitization
- Recursive detail cleaning
- Array handling
- Sensitive key detection

**Test File**: `apps/api/src/common/filters/global-exception.filter.spec.ts`
**Coverage**: 25 test cases covering all security features

## Usage in Controllers

The global exception filter is automatically applied to all endpoints:

```typescript
// No special handling needed - just throw exceptions
@Get(':id')
async getTestRun(@Param('id') id: string) {
  const testRun = await this.service.findOne(id);

  if (!testRun) {
    // Will be caught and sanitized automatically
    throw new ResourceNotFoundException('TestRun', id);
  }

  return testRun;
}
```

### Custom Business Exceptions

Use BusinessException for domain-specific errors:

```typescript
import { BusinessException } from '../common/exceptions/business.exception';

// Safe: message is user-facing, details will be sanitized in production
throw new BusinessException(
  'Invalid configuration',
  'INVALID_CONFIG',
  HttpStatus.BAD_REQUEST,
  {
    field: 'dashboard_url',
    reason: 'Must be a valid URL',
    apiKey: 'secret-key-123', // Will be [REDACTED] in production
  }
);
```

## Best Practices

### DO:
✅ Throw exceptions with user-friendly messages
✅ Include correlation IDs in logs for tracking
✅ Use BusinessException for domain errors
✅ Trust the filter to sanitize details
✅ Log full context server-side
✅ Test error handling in both environments

### DON'T:
❌ Include sensitive data in exception messages
❌ Expose file paths in user-facing messages
❌ Return different error details based on authentication state
❌ Log passwords or tokens even server-side
❌ Create custom error responses that bypass the filter
❌ Use error messages for debugging in production

## Configuration

### Environment Variables

Set `NODE_ENV` to control error handling behavior:

```bash
# Production: Secure, minimal responses
NODE_ENV=production

# Development: Detailed debugging
NODE_ENV=development

# Staging: Treated as production
NODE_ENV=staging
```

### Filter Registration

The filter is registered globally in `main.ts`:

```typescript
app.useGlobalFilters(new GlobalExceptionFilter());
```

## Monitoring & Alerting

### Recommended Practices

1. **Log Aggregation**: Send logs to centralized system (ELK, Datadog, etc.)
2. **Error Tracking**: Use correlation IDs to track error occurrences
3. **Alerting**: Set up alerts for high error rates
4. **Metrics**: Track error rates by status code and error code
5. **Security Monitoring**: Alert on unusual error patterns

### Correlation ID Usage

```bash
# Find all logs related to an error
grep "550e8400-e29b-41d4-a716-446655440000" /var/log/perfana/*.log

# Search in log aggregation system
correlationId:"550e8400-e29b-41d4-a716-446655440000"
```

## Security Checklist

- [x] Stack traces hidden in production
- [x] File paths sanitized
- [x] Database credentials removed
- [x] SQL queries redacted
- [x] Passwords/secrets/tokens redacted
- [x] Email addresses sanitized
- [x] IP addresses sanitized
- [x] UUIDs sanitized when sensitive
- [x] JWT tokens removed
- [x] Generic 5xx error messages
- [x] Correlation IDs for tracking
- [x] Full server-side logging
- [x] Environment-aware responses
- [x] Recursive detail sanitization
- [x] Comprehensive test coverage

## Maintenance

### Adding New Sensitive Patterns

To add new patterns to sanitize, update the `removeSensitiveData` method:

```typescript
private removeSensitiveData(message: string): string {
  // Add new pattern here
  sanitized = sanitized.replace(/YOUR_PATTERN/gi, '[REPLACEMENT]');
  return sanitized;
}
```

### Adding Sensitive Keys

To add new sensitive keys that should be redacted, update the `sanitizeDetails` method:

```typescript
const sensitiveKeys = [
  'password',
  'token',
  'secret',
  'your_new_key', // Add here
];
```

## References

- **OWASP Top 10**: A05:2021 - Security Misconfiguration
- **CWE-209**: Generation of Error Message Containing Sensitive Information
- **OWASP Logging Cheat Sheet**: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- **NestJS Exception Filters**: https://docs.nestjs.com/exception-filters

## Version History

- **v1.0** (2025-11-06): Initial production-safe implementation with comprehensive sanitization
