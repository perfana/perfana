# Input Validation Implementation

This document describes the comprehensive input validation implemented across 5 critical API endpoints to prevent security vulnerabilities.

## Security Issues Addressed

1. **SQL Injection** - Prevented through pattern validation and SQL keyword detection
2. **XSS Attacks** - Prevented through HTML tag sanitization and character validation
3. **Path Traversal** - Prevented through detection of `..`, `/`, and `\` characters
4. **ReDoS (Regular Expression Denial of Service)** - Prevented through safe regex validation
5. **Data Integrity Issues** - Prevented through length limits, format validation, and business rule enforcement

## Implementation Overview

### Custom Validators

Located in `/apps/api/src/common/validators/`:

#### 1. `test-run-id.validator.ts`
- Validates test run ID format
- Alphanumeric with dots, hyphens, underscores only
- Max length: 255 characters
- Prevents path traversal and SQL injection

**Usage:**
```typescript
@IsValidTestRunId()
testRunId: string;
```

#### 2. `config-key.validator.ts`
- Validates configuration key format
- Alphanumeric with dots, hyphens, underscores only
- Max length: 255 characters
- Prevents HTML injection and path traversal

**Usage:**
```typescript
@IsValidConfigKey()
key: string;
```

#### 3. `safe-regex.validator.ts`
- Validates regex patterns for ReDoS vulnerabilities
- Detects nested quantifiers, excessive backtracking
- Max length: 500 characters
- Validates regex compilation

**Usage:**
```typescript
@IsSafeRegex({ each: true })
patterns: string[];
```

#### 4. `json-depth.validator.ts`
- Validates JSON object depth
- Max depth: 10 levels
- Prevents stack overflow and performance issues

**Usage:**
```typescript
@HasValidJsonDepth()
json: Record<string, any>;
```

#### 5. `iso-date.validator.ts`
- Validates ISO 8601 date format
- Year range: 1970-2100
- Format: `YYYY-MM-DDTHH:mm:ss.sssZ`

**Usage:**
```typescript
@IsValidISODate()
startTime: string;
```

### Validation Pipes

Located in `/apps/api/src/common/pipes/`:

#### 1. `UuidValidationPipe`
- Validates UUID v4 format or test_run_id format
- Used for route parameters
- Prevents injection attacks

**Usage:**
```typescript
@Param('id', UuidValidationPipe) id: string
```

#### 2. `StringSanitizationPipe`
- Sanitizes string query parameters
- Removes XSS vectors and SQL injection attempts
- Configurable max length and pattern validation

**Usage:**
```typescript
@Query('name', new StringSanitizationPipe({ maxLength: 100 })) name: string
```

## Enhanced Endpoints

### 1. POST /api/test (Test Run Creation)

**Endpoint:** `POST /api/test`

**DTO:** `UpdateRunningTestDto`

**Validations Applied:**
- `testRunId`: Custom validator, max 255 chars, prevents injection
- `systemUnderTest`: Alphanumeric pattern, max 255 chars
- `workload`: Alphanumeric pattern, max 255 chars
- `testEnvironment`: Alphanumeric pattern, max 255 chars
- `version`: Alphanumeric pattern, max 100 chars
- `start/end`: ISO date format, range 1970-2100
- `duration`: Integer, 0-604800 seconds (7 days)
- `rampUp`: Integer, 0-86400 seconds (1 day)
- `annotations`: Max 5000 chars
- `tags`: Max 50 items, each 1-100 chars
- `variables`: Max 50 items, validated nested
- `deepLinks`: Max 20 items, URL validation
- `CIBuildResultsUrl`: URL validation, max 2048 chars

**Example:**
```typescript
{
  "testRunId": "PaymentService-prod-loadTest-001",
  "systemUnderTest": "PaymentService",
  "workload": "loadTest",
  "testEnvironment": "production",
  "start": "2024-01-15T10:00:00.000Z",
  "duration": 3600,
  "completed": false,
  "tags": ["performance", "production"]
}
```

### 2. POST /api/config/key (Single Config)

**Endpoint:** `POST /api/config/key`

**DTO:** `AddTestRunConfigDto`

**Validations Applied:**
- `application`: Alphanumeric pattern, max 255 chars
- `testEnvironment`: Alphanumeric pattern, max 255 chars
- `workload`: Alphanumeric pattern, max 255 chars
- `testRunId`: Custom validator, max 255 chars
- `tags`: Max 50 items, each 1-100 chars
- `key`: Custom config key validator
- `value`: Max 5000 chars

**Example:**
```typescript
{
  "application": "PaymentService",
  "testEnvironment": "production",
  "workload": "loadTest",
  "testRunId": "test-001",
  "tags": ["config"],
  "key": "jvm.heap.size",
  "value": "2048m"
}
```

### 3. POST /api/config/keys (Multiple Configs)

**Endpoint:** `POST /api/config/keys`

**DTO:** `AddTestRunConfigsDto`

**Validations Applied:**
- Same as single config
- `configItems`: Min 1, max 200 items
- Each item validated with nested validation

**Example:**
```typescript
{
  "application": "PaymentService",
  "testEnvironment": "production",
  "workload": "loadTest",
  "testRunId": "test-001",
  "tags": ["config"],
  "configItems": [
    { "key": "jvm.heap.size", "value": "2048m" },
    { "key": "database.pool.size", "value": "50" }
  ]
}
```

### 4. POST /api/config/json (Bulk JSON Config)

**Endpoint:** `POST /api/config/json`

**DTO:** `AddTestRunConfigJsonDto`

**Validations Applied:**
- Same base validations as other config endpoints
- `includes`: Max 20 patterns, each max 500 chars, ReDoS validated
- `excludes`: Max 20 patterns, each max 500 chars, ReDoS validated
- `json`: Object depth max 10 levels

**ReDoS Prevention:**
```typescript
// These patterns are rejected:
"(a+)+", ".*.*", "(test|testing)+"

// These patterns are accepted:
"jvm.*", "database\\..*", "^config\\."
```

**Example:**
```typescript
{
  "application": "PaymentService",
  "testEnvironment": "production",
  "workload": "loadTest",
  "testRunId": "test-001",
  "tags": ["config"],
  "includes": ["jvm.*", "database.*"],
  "excludes": ["*.password", "*.secret"],
  "json": {
    "jvm": {
      "heap": { "size": "2048m" }
    }
  }
}
```

### 5. GET /api/test-runs/:testRunId

**Endpoint:** `GET /api/test-runs/:testRunId`

**Validations Applied:**
- `testRunId` (param): UuidValidationPipe
- `system` (query): TestRunQueryDto validation
- `environment` (query): TestRunQueryDto validation
- `workload` (query): TestRunQueryDto validation

**Example:**
```
GET /api/test-runs/PaymentService-prod-loadTest-001?system=PaymentService&environment=production&workload=loadTest
```

### 6. DELETE /api/test-runs/:id

**Endpoint:** `DELETE /api/test-runs/:id`

**Validations Applied:**
- `id` (param): ParseUUIDPipe (strict UUID v4 format)

**Example:**
```
DELETE /api/test-runs/550e8400-e29b-41d4-a716-446655440000
```

## Validation Error Messages

The implementation provides clear, specific error messages:

```json
{
  "statusCode": 400,
  "message": [
    "Test run ID must contain only alphanumeric characters, hyphens, underscores, and dots (max 255 characters)",
    "Duration must not exceed 7 days (604800 seconds)",
    "Maximum 50 tags allowed",
    "Regex pattern is invalid or potentially dangerous (ReDoS risk detected)"
  ],
  "error": "Bad Request"
}
```

## Testing

### Unit Tests

All validators include comprehensive unit tests:

- `test-run-id.validator.spec.ts` - 20+ test cases
- `config-key.validator.spec.ts` - 15+ test cases
- `safe-regex.validator.spec.ts` - 15+ test cases
- `json-depth.validator.spec.ts` - 10+ test cases
- `iso-date.validator.spec.ts` - 15+ test cases

**Run tests:**
```bash
cd apps/api
npm test -- --testPathPattern=validators
```

### Test Coverage

The validators test:
- Valid inputs (happy path)
- Invalid inputs (edge cases)
- Injection attempts (SQL, XSS, path traversal)
- Boundary conditions (length limits, depth limits)
- Type safety (non-string inputs)

## Security Best Practices

### 1. Defense in Depth
- Multiple layers: DTO validation, custom validators, pipes
- Fail-safe defaults: reject on any suspicious input

### 2. Principle of Least Privilege
- Strict format requirements (alphanumeric + limited special chars)
- Conservative length limits
- Narrow regex patterns

### 3. Input Sanitization
- Trim whitespace
- Remove HTML tags
- Validate before processing

### 4. Clear Error Messages
- Specific validation failures
- No information leakage about system internals
- User-friendly guidance

## Performance Considerations

- Validators are synchronous (no async overhead)
- Regex patterns optimized for performance
- Early rejection of invalid inputs
- No excessive string operations

## Migration Notes

### Breaking Changes

None. The validation is additive and backward compatible with existing API contracts.

### Recommendations

1. Update API clients to handle validation errors
2. Review existing data for compliance
3. Monitor validation error rates
4. Add client-side validation to match server-side rules

## Future Enhancements

1. **Rate Limiting**: Add per-endpoint rate limits
2. **Request Size Limits**: Enforce maximum payload sizes
3. **Content-Type Validation**: Strict content-type checking
4. **Authorization Enhancements**: Fine-grained permission checks for DELETE operations
5. **Audit Logging**: Log validation failures for security monitoring

## Maintenance

### Adding New Validators

1. Create validator in `/apps/api/src/common/validators/`
2. Implement `ValidatorConstraintInterface`
3. Add comprehensive unit tests
4. Document in this file
5. Export from `index.ts`

### Updating Validation Rules

1. Update validator logic
2. Update unit tests
3. Run full test suite
4. Update API documentation
5. Consider backward compatibility

## References

- [OWASP Input Validation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)
- [class-validator Documentation](https://github.com/typestack/class-validator)
- [NestJS Validation Pipes](https://docs.nestjs.com/techniques/validation)
- [ReDoS Prevention](https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS)
