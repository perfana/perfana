# SQL Injection Security Audit Report

**Date:** 2025-10-21
**Severity:** HIGH
**Status:** FIXED

## Executive Summary

A critical SQL injection vulnerability was identified and fixed in the TestRunRepository. The vulnerability could have allowed an attacker to execute arbitrary SQL commands through unsanitized field name input. A comprehensive audit of all repository files confirmed this was the only instance of this vulnerability pattern in the codebase.

## Vulnerability Details

### Location
- **File:** `/apps/api/src/repositories/test-run.repository.ts`
- **Method:** `findByStatusField()`
- **Line:** 348 (original)
- **Severity:** HIGH - SQL Injection Risk

### Vulnerable Code

```typescript
async findByStatusField(fieldName: string, fieldValue: string | number | boolean | null): Promise<TestRun[]> {
  return await this.repository.createQueryBuilder('tr')
    .where(`tr.status->>'${fieldName}' = :value`, { value: String(fieldValue) })
    // ^^^ fieldName is interpolated directly into SQL - VULNERABLE!
    .leftJoinAndSelect('tr.systemUnderTest', 'system')
    .getMany();
}
```

### Attack Vector

If `fieldName` contains malicious input like:
```
'; DROP TABLE test_runs; --
```

The resulting SQL would be:
```sql
WHERE tr.status->>''; DROP TABLE test_runs; --' = :value
```

This would execute the DROP TABLE command, destroying data.

### Impact Assessment

- **Exploitability:** HIGH - Direct string interpolation with no validation
- **Current Risk:** LOW - Method is not currently called anywhere in the codebase
- **Potential Impact:** CRITICAL - Could lead to:
  - Data exfiltration
  - Data deletion/corruption
  - Privilege escalation
  - Complete database compromise

## Fix Implementation

### Changes Made

1. **Added field name whitelist validation**
2. **Imported ValidationException**
3. **Added comprehensive JSDoc documentation**
4. **Maintained backward compatibility**

### Fixed Code

```typescript
/**
 * Find test runs with JSONB field conditions
 *
 * @param fieldName - The status field name to query. Must be one of the allowed fields.
 * @param fieldValue - The value to match against the field
 * @returns Test runs matching the status field condition
 * @throws ValidationException if fieldName is not in the allowed list
 *
 * Allowed status fields:
 * - evaluatingAdapt: ADAPT evaluation status
 */
async findByStatusField(fieldName: string, fieldValue: string | number | boolean | null): Promise<TestRun[]> {
  // Whitelist of allowed JSONB status fields to prevent SQL injection
  const allowedFields = ['evaluatingAdapt'] as const;

  if (!allowedFields.includes(fieldName as any)) {
    throw new ValidationException(
      `Invalid status field: '${fieldName}'. Allowed fields: ${allowedFields.join(', ')}`
    );
  }

  try {
    return await this.repository.createQueryBuilder('tr')
      .where(`tr.status->>'${fieldName}' = :value`, { value: String(fieldValue) })
      .leftJoinAndSelect('tr.systemUnderTest', 'system')
      .getMany();
  } catch (error) {
    this.logger.error('Failed to find test runs by status field:', error);
    throw new DatabaseException('Failed to retrieve test runs', error);
  }
}
```

### Validation Logic

- **Whitelist approach:** Only allows predefined field names
- **Based on TypeRunStatus interface:** Currently only `evaluatingAdapt` field
- **Fail-fast:** Throws ValidationException before SQL execution
- **Clear error messages:** Tells developers which fields are allowed

## Comprehensive Repository Audit

All repository files were audited for similar SQL injection patterns. The following queries were reviewed:

### Safe Patterns (No SQL Injection Risk)

All other instances use **parameterized queries** correctly:

1. **test-run-configuration.repository.ts**
   ```typescript
   .where('config.key ILIKE :pattern', { pattern: `%${pattern}%` })
   ```
   ✅ SAFE - Variable in parameter value, not SQL structure

2. **application-dashboard.repository.ts**
   ```typescript
   .where('ad.dashboardName ILIKE :search', { search: `%${searchTerm}%` })
   ```
   ✅ SAFE - Parameterized query

3. **api-key.repository.ts**
   ```typescript
   .where('ak.description ILIKE :search', { search: `%${searchTerm}%` })
   ```
   ✅ SAFE - Parameterized query

4. **compare-filter-preset.repository.ts**
   ```typescript
   .where('preset.name ILIKE :search', { search: `%${searchTerm}%` })
   ```
   ✅ SAFE - Parameterized query

5. **trends-filter-preset.repository.ts**
   ```typescript
   .where('preset.name ILIKE :search', { search: `%${searchTerm}%` })
   ```
   ✅ SAFE - Parameterized query

6. **dynatrace.repository.ts**
   ```typescript
   queryBuilder.where(`(${conditions.join(' OR ')})`, { systemId, environment, workload });
   ```
   ✅ SAFE - Conditions array contains only hardcoded strings (lines 341-349)

### Key Difference: Safe vs. Unsafe

**UNSAFE (SQL Injection):**
```typescript
.where(`tr.status->>'${fieldName}' = :value`, { ... })
//                    ^^^^^^^^^^^ User input in SQL structure
```

**SAFE (Parameterized):**
```typescript
.where('config.key ILIKE :pattern', { pattern: `%${pattern}%` })
//                                            ^^^^^^^^^^^ User input in parameter value only
```

## Verification

### TypeScript Compilation
```bash
✅ npx tsc --noEmit (apps/api) - PASSED
```

### Code Review Checklist
- [x] Field name whitelist implemented
- [x] ValidationException imported and used
- [x] JSDoc documentation added
- [x] Allowed fields documented
- [x] TypeScript compilation successful
- [x] No breaking changes to API
- [x] Comprehensive repository audit completed
- [x] No other SQL injection vulnerabilities found

## Recommendations

### Immediate Actions (Completed)
1. ✅ Implement field name whitelist in `findByStatusField()`
2. ✅ Add comprehensive documentation
3. ✅ Verify TypeScript compilation
4. ✅ Audit all repository files for similar patterns

### Future Best Practices

1. **Code Review Process**
   - Flag any QueryBuilder queries with template literal WHERE clauses
   - Require explicit review for JSONB field access patterns
   - Use static analysis tools to detect SQL injection patterns

2. **Development Guidelines**
   - Always use parameterized queries for user input
   - Use whitelists for dynamic field/table names
   - Never interpolate user input directly into SQL strings
   - Consider using TypeORM's safer query methods when possible

3. **Testing**
   - Add security tests for SQL injection attempts
   - Test validation exceptions for invalid field names
   - Include negative test cases in unit tests

4. **Documentation**
   - Document all JSONB field access patterns
   - Maintain whitelist documentation in JSDoc comments
   - Keep security audit reports up to date

## Additional Notes

- The vulnerable method `findByStatusField()` was not currently being called anywhere in the codebase
- The `TestRunStatus` interface (from `types/test-run.types.ts`) only defines one field: `evaluatingAdapt`
- If additional status fields are added to the `TestRunStatus` interface in the future, they must be explicitly added to the `allowedFields` whitelist
- All legitimate use cases will continue to work with the fix

## References

- OWASP SQL Injection: https://owasp.org/www-community/attacks/SQL_Injection
- TypeORM Security Best Practices: https://typeorm.io/security
- PostgreSQL JSONB Operators: https://www.postgresql.org/docs/current/functions-json.html

## Sign-off

**Audited by:** Claude Code (Anthropic)
**Reviewed:** All repository files in `/apps/api/src/repositories/`
**Status:** No additional SQL injection vulnerabilities found
**Verification:** TypeScript compilation successful
