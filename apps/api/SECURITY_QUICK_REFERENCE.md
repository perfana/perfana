# Security Error Handling - Quick Reference

## TL;DR

✅ **Stack traces are now hidden in production**
✅ **Sensitive data is automatically sanitized**
✅ **Use correlation IDs for debugging**
✅ **Full details logged server-side**

## For Developers

### When You Get an Error Response

**Production:**
```json
{
  "statusCode": 500,
  "message": "An internal server error occurred",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  ...
}
```

**What to do:**
1. Copy the `correlationId`
2. Search server logs: `grep "550e8400-e29b-41d4-a716-446655440000" logs/*.log`
3. Find full error details with stack trace

### Throwing Exceptions

**Good Examples:**

```typescript
// User-facing message (safe to expose)
throw new ResourceNotFoundException('TestRun', id);

// Business exception with details (will be sanitized)
throw new BusinessException(
  'Invalid configuration',
  'INVALID_CONFIG',
  HttpStatus.BAD_REQUEST,
  { field: 'url', reason: 'Must be valid' }
);

// Standard HTTP exception
throw new HttpException('Resource not found', HttpStatus.NOT_FOUND);
```

**Don't Worry About:**
- Including error details - they'll be sanitized automatically
- File paths in stack traces - hidden in production
- Sensitive data in details - automatically redacted

### Environment Modes

| Mode | Stack Traces | Details | Messages |
|------|--------------|---------|----------|
| `production` | ❌ No | Sanitized | Generic |
| `development` | ✅ Yes | Full | Detailed |
| `staging` | ❌ No | Sanitized | Generic |

### What Gets Sanitized Automatically

- ❌ Passwords, API keys, tokens, secrets
- ❌ Email addresses → `[EMAIL]`
- ❌ IP addresses → `[IP_ADDRESS]`
- ❌ File paths → `[FILE_PATH]`
- ❌ SQL queries → `[QUERY]`
- ❌ Database credentials → `[CREDENTIALS]`
- ❌ JWT tokens → `[JWT_TOKEN]`
- ❌ Stack traces (production only)

## For Support Team

### When a User Reports an Error

1. **Ask for Correlation ID**
   - Found in error response: `"correlationId": "..."`
   - Unique identifier for each error

2. **Search Logs**
   ```bash
   grep "CORRELATION_ID" /var/log/perfana/*.log
   ```

3. **Find Full Details**
   - Complete stack trace
   - Request context
   - All error details
   - User agent & IP

### Example

**User sees:**
```json
{
  "statusCode": 500,
  "message": "An internal server error occurred",
  "correlationId": "abc-123-xyz"
}
```

**You find in logs:**
```
[ERROR] Unexpected error [abc-123-xyz]: Database connection failed
Stack: Error: Database connection failed
    at DatabaseService.connect (database.service.ts:42)
    at TestRunController.getTestRun (test-runs.controller.ts:89)
Context: {
  "correlationId": "abc-123-xyz",
  "path": "/api/test-runs/123",
  "method": "GET",
  "userAgent": "Mozilla/5.0...",
  "ip": "10.0.0.1"
}
```

## For Security Team

### Protections Implemented

1. **Information Disclosure** - Prevented
   - No stack traces in production
   - No file paths exposed
   - No internal structure revealed

2. **Credential Exposure** - Prevented
   - Passwords redacted
   - API keys redacted
   - Tokens redacted
   - Connection strings sanitized

3. **PII Protection** - Implemented
   - Email addresses sanitized
   - IP addresses sanitized
   - Sensitive fields redacted

4. **Attack Surface Mapping** - Prevented
   - Technology stack hidden
   - Module structure hidden
   - Database schema hidden

### Compliance

- ✅ OWASP Top 10: A05:2021 - Security Misconfiguration
- ✅ CWE-209: Generation of Error Message Containing Sensitive Information
- ✅ GDPR: PII protection in error responses
- ✅ PCI DSS: No sensitive data in logs sent to clients

### Verification Commands

```bash
# Test production mode
NODE_ENV=production npm start

# Trigger an error and verify response
curl http://localhost:3001/api/test-runs/invalid

# Should NOT contain:
# - Stack traces
# - File paths (e.g., /usr/src/app/...)
# - SQL queries (e.g., SELECT ...)
# - Passwords, tokens, keys
# - Email addresses (e.g., user@domain.com)
# - Internal IP addresses
```

## Testing

```bash
# Run security tests
cd apps/api
npm test -- global-exception.filter.spec.ts

# Should pass all 25 tests:
# - 10 production security tests
# - 4 development debugging tests
# - 2 business exception tests
# - 4 HTTP exception tests
# - 3 response structure tests
# - 2 nested sanitization tests
```

## Configuration

### Environment Variable

```bash
# Production (secure mode)
export NODE_ENV=production

# Development (debugging mode)
export NODE_ENV=development

# Staging (secure mode)
export NODE_ENV=staging
```

### Verify Current Mode

```typescript
const env = process.env.NODE_ENV;
console.log(`Running in ${env} mode`);

if (env === 'production') {
  console.log('✅ Secure mode: Stack traces hidden');
} else {
  console.log('⚠️ Debug mode: Stack traces visible');
}
```

## Common Questions

### Q: Why am I seeing "An internal server error occurred" in production?
**A:** This is intentional security. Use the correlation ID to find details in server logs.

### Q: How do I debug errors in production?
**A:** Use correlation IDs. Full error details are logged server-side.

### Q: Will this break my error handling?
**A:** No. All exceptions are still caught and handled. Only the response format changes.

### Q: What if I need to show specific error details to users?
**A:** Use 4xx status codes. Client errors (400-499) preserve their messages. Only server errors (500-599) get generic messages.

### Q: Can I bypass the filter for specific endpoints?
**A:** This is a global filter - it applies to all endpoints. This is intentional for security. Use BusinessException with user-friendly messages instead.

## Files

- **Implementation**: `apps/api/src/common/filters/global-exception.filter.ts`
- **Tests**: `apps/api/src/common/filters/global-exception.filter.spec.ts`
- **Full Documentation**: `apps/api/SECURITY_ERROR_HANDLING.md`
- **Before/After Examples**: `apps/api/SECURITY_FIX_SUMMARY.md`

## Need Help?

1. Read full documentation: `apps/api/SECURITY_ERROR_HANDLING.md`
2. Check examples: `apps/api/SECURITY_FIX_SUMMARY.md`
3. Review tests: `apps/api/src/common/filters/global-exception.filter.spec.ts`
4. Contact security team with correlation IDs

---

**Remember**: Correlation IDs are your friend for debugging production errors!
