# Test Run Creation Flow with API Key Authentication

## Overview

When a test run is created via `/api/test` using an API key, the ownership is automatically assigned based on the API key's organization. This document explains the complete flow.

## Authentication Flow

### 1. API Key Request
```bash
POST /api/test
Headers:
  Authorization: Bearer <api_key_token>
Body:
  {
    "testRunId": "PerfanaWebshop-acc-loadTest-00002",
    "systemUnderTest": "PerfanaWebshop",
    "testEnvironment": "acc",
    "workload": "loadTest",
    ...
  }
```

### 2. KeycloakEnhancedAuthGuard
- Validates the API key token
- Loads the API key from database
- Attaches `request.apiKey` to the request object
- API key contains: `organization_id`, `roles[]`, `description`

### 3. UserContext Decorator (`@UserCtx()`)
Priority order for organization resolution:
1. **SessionContext** (database-loaded, for web users)
2. **API Key Organization** ✅ **← Used for /api/test**
3. **JWT Organizations** (if Keycloak manages them in future)

```typescript
// From user-context.decorator.ts lines 71-75
if (request.apiKey?.organization_id) {
  organizations = [request.apiKey.organization_id];
  organizationId = request.apiKey.organization_id;
  console.log('UserCtx: Using API key organization:', organizationId);
}
```

Result:
```typescript
{
  userId: 'api-key:8d98e867-68b0-4550-81ac-6e51c083bb55',
  roles: ['admin'], // or whatever roles the API key has
  organizations: ['fdd0cc25-3239-4721-8e66-96c87f5b5374'],
  organizationId: 'fdd0cc25-3239-4721-8e66-96c87f5b5374',
  teams: [],
  teamId: undefined
}
```

## Test Run Creation Flow

### 4. TestController (`POST /api/test`)
```typescript
// test.controller.ts:34-38
if (!ctx.organizationId) {
  throw new BadRequestException(
    'User must belong to an organization to create test runs',
  );
}
```

Passes `ctx.organizationId` (from API key) to service.

### 5. TestRunsService
```typescript
// test-runs.service.ts:240-250
async updateRunningTest(
  updateDto: UpdateRunningTestDto,
  userId: string,
  roles: string[],
  organizationId: string, // ← API key's organization
): Promise<TestRun>
```

Delegates to mutation service.

### 6. TestRunsMutationService
```typescript
// test-runs-mutation.service.ts:78-82
const systemUnderTest = await this.lookupService.findOrCreateSystemUnderTest(
  updateDto.systemUnderTest,
  userId,                  // 'api-key:xxx'
  organizationId,         // API key's org
);
```

**System Under Test** is created/found with:
- ✅ `organization_id` = API key's organization
- ✅ `created_by` = `api-key:xxx`

Then calls `upsertTestRun()` with organizationId:

```typescript
// test-runs-mutation.service.ts:96-107
const testRun = await this.upsertTestRun({
  testRunId: updateDto.testRunId,
  systemUnderTestId: systemUnderTest.id,
  testEnvironment: updateDto.testEnvironment,
  workload: updateDto.workload,
  updateDto,
  duration,
  plannedDuration,
  existingTestRun,
  userId,
  organizationId,  // ← API key's organization
});
```

### 7. upsertTestRun Method
```typescript
// test-runs-mutation.service.ts:158-176
const common = {
  testRunId,
  systemUnderTestId,
  testEnvironment,
  workload,
  // ... other fields ...

  // Ownership tracking (use API key's organization)
  organizationId: existingTestRun?.organizationId || organizationId,
  createdBy: existingTestRun ? undefined : userId,  // 'api-key:xxx'
  updatedBy: userId,
};
```

### 8. CreateTestRunCommand
Command data includes:
```typescript
{
  testRunId: 'PerfanaWebshop-acc-loadTest-00002',
  systemUnderTestId: 'e7cad785-cc7b-4105-92e8-8e0b2950fc5f',
  // ... test details ...

  // Ownership fields
  organizationId: 'fdd0cc25-3239-4721-8e66-96c87f5b5374',  // API key's org
  teamId: undefined,
  createdBy: 'api-key:8d98e867-68b0-4550-81ac-6e51c083bb55',
  updatedBy: 'api-key:8d98e867-68b0-4550-81ac-6e51c083bb55',
}
```

### 9. CreateTestRunHandler
```typescript
// create-test-run.handler.ts:81-103
private async createTestRunEntity(data: CreateTestRunData): Promise<TestRunEntity> {
  const testRunData: Partial<TestRunEntity> = {
    testRunId: data.testRunId,
    systemUnderTestId: data.systemUnderTestId,
    // ... other fields ...

    // Ownership tracking (from API key or user context)
    organizationId: data.organizationId,
    teamId: data.teamId,
    createdBy: data.createdBy,
    updatedBy: data.updatedBy,
  };

  const testRun = this.testRunRepo.create(testRunData);
  return await this.testRunRepo.save(testRun);
}
```

## Final Database State

### API Key
```sql
id: 8d98e867-68b0-4550-81ac-6e51c083bb55
description: fooobaaar
organization_id: fdd0cc25-3239-4721-8e66-96c87f5b5374  -- Perfana org
```

### System Under Test
```sql
id: e7cad785-cc7b-4105-92e8-8e0b2950fc5f
name: PerfanaWebshop
organization_id: fdd0cc25-3239-4721-8e66-96c87f5b5374  -- Perfana org ✅
created_by: api-key:8d98e867-68b0-4550-81ac-6e51c083bb55 ✅
```

### Test Run
```sql
id: <uuid>
test_run_id: PerfanaWebshop-acc-loadTest-00002
system_under_test_id: e7cad785-cc7b-4105-92e8-8e0b2950fc5f
organization_id: fdd0cc25-3239-4721-8e66-96c87f5b5374  -- Perfana org ✅
created_by: api-key:8d98e867-68b0-4550-81ac-6e51c083bb55 ✅
updated_by: api-key:8d98e867-68b0-4550-81ac-6e51c083bb55 ✅
```

## Key Points

1. **API Key Owns Organization**: Each API key belongs to exactly ONE organization
2. **Organization Cascades**: The API key's organization is assigned to:
   - System Under Test (if created new)
   - Test Run (always)
3. **Created By Tracking**: `created_by` format is `api-key:{uuid}` for audit trails
4. **System Sharing**: A system can belong to one org, but multiple API keys from that org can create test runs for it
5. **Backward Compatibility**: All ownership fields are nullable for legacy data

## Authorization (Future Enhancement)

When RBAC Phase 3 is implemented, users will only see test runs where:
- Test run's `organization_id` matches user's accessible organizations
- OR user is a global admin

This ensures multi-tenant isolation where each organization's test data is private.

## Testing the Flow

Create a new test run with an API key:

```bash
# Get your API key token (from API keys page or database)
API_KEY="<your_base64_token>"

# Create a test run
curl -X POST http://localhost:3001/api/test \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "testRunId": "MyApp-prod-loadTest-00001",
    "systemUnderTest": "MyApp",
    "testEnvironment": "prod",
    "workload": "loadTest",
    "start": "2026-02-10T10:00:00Z",
    "duration": 600,
    "rampUp": 60
  }'
```

Verify ownership:
```sql
SELECT
  tr.test_run_id,
  tr.organization_id,
  o.name as org_name,
  tr.created_by
FROM test_runs tr
LEFT JOIN organizations o ON tr.organization_id = o.id
WHERE tr.test_run_id = 'MyApp-prod-loadTest-00001';
```

Expected result:
- `organization_id` = API key's organization
- `created_by` = `api-key:<api_key_uuid>`
- `org_name` = Name of the organization the API key belongs to
