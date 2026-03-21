# Grafana Sync Original Implementation Analysis

**Date:** 2025-11-02
**Source:** `/Users/daniel/workspace/perfana-grafana`
**Target:** `apps/grafana-sync` in perfana-next-gen monorepo

## Executive Summary

This document analyzes the original perfana-grafana standalone application to guide the NestJS migration. The application is a well-structured Node.js service with three main workflows: **dashboard synchronization**, **auto-configuration**, and **sanity checking**.

## Architecture Overview

### Entry Point (`index.js`)

The main application follows a simple event loop pattern:

```javascript
main()
  ├── db.connect() - MongoDB/TypeORM connection
  ├── updateVersion() - Track application version
  ├── startSync() - Dashboard synchronization loop
  ├── startTestRunSanityChecker() - Stuck test run detection
  └── startSanityChecker() - General validation tasks
```

**Key Characteristics:**
- Uses `setTimeout` for scheduling (not `setInterval`)
- Each task reschedules itself after completion
- Error handling with retry logic
- Configurable intervals via environment variables

## Core Components

### 1. Dashboard Synchronization (`grafana-sync/grafana-sync.js`)

**Main Flow:**

```
grafanaSync()
  ├── For each Grafana instance:
  │   ├── getDashboardsToAdd() → storeDashboard()
  │   ├── getDashboardsToUpdate() → storeDashboard()
  │   ├── getDashboardsToRestore() → restoreDashboard()
  │   └── getTemplateDashboardsInstancesToUpdate() → updateTemplateDashboardInstances()
  └── AutoConfigService.processAutoConfigDashboards()
```

**Implementation Details:**

#### A. Adding New Dashboards (`get-dashboards-to-add.js`)

Two modes of operation:

1. **Direct Database Access** (MySQL/PostgreSQL to Grafana DB):
   ```javascript
   // Query Grafana database directly
   SELECT DISTINCT uid FROM dashboard
   WHERE dashboard_tag.term ILIKE '%perfana-template%'
   OR dashboard.created > '${last24Hours}'
   ```
   - Faster, more efficient
   - Requires Grafana database credentials
   - Used when `grafanaDbConnection.isEnabled() === true`

2. **HTTP API Fallback**:
   ```javascript
   // Use Grafana HTTP API
   GET /api/search?tag=perfana
   ```
   - Works without database access
   - Slower, rate-limited
   - Default mode

**Key Logic:**
- Filter dashboards with "perfana" tag
- Compare against stored dashboards in Perfana DB
- Return only new dashboards not yet stored

#### B. Storing Dashboards (`store-dashboard.js`)

**Critical Steps:**

1. **Check if already stored** - Avoid duplicates
2. **Fetch datasource information**:
   ```javascript
   const datasource = await grafanaApiGet(
     grafanaInstance,
     '/api/datasources/uid/' + firstGraphPanel.datasource.uid
   );
   ```
3. **Extract dashboard metadata**:
   - Name, UID, tags, slug
   - Panels (id, title, type, description, yAxesFormat)
   - Templating variables (name, type, query, datasource, regex)
4. **Generate random `_id`** using `meteor-random` (legacy MongoDB compatibility)
5. **Store complete dashboard JSON** in `grafanaJson` field
6. **Upsert to database** via `upsertGrafanaDashboard()`

**Important Fields:**
```javascript
{
  _id: Random.secret(),  // Legacy MongoDB ID
  uid: dashboard.uid,    // Grafana UID
  grafana: instance.label,
  name: dashboard.title,
  datasourceType: datasource.type,
  grafanaJson: JSON.stringify(fullDashboard),
  panels: [...],
  variables: [...],
  templatingVariables: [...],
  usedBySUT: [...],
  templateDashboardUid: autoConfigDashboard?.dashboardUid,
  templateProfile: autoConfigDashboard?.profile,
  updated: new Date()
}
```

#### C. Updating Dashboards (`get-dashboards-to-update.js`)

**Two-Phase Process:**

1. **Find updated dashboards**:
   - **Direct DB**: Query dashboards updated in last hour
   - **HTTP API**: Fetch all dashboards with 'perfana' tag

2. **Compare timestamps**:
   ```javascript
   // For each dashboard, fetch full details
   const details = await grafanaApiGet(
     grafana,
     `/api/dashboards/uid/${uid}`
   );

   // Compare update timestamps
   if (storedDashboard.updated < details.meta.updated) {
     // Dashboard needs update
   }
   ```

**Concurrency Control:**
- Processes dashboards in batches (default 20 parallel requests)
- Configurable via `PARALLEL_GET_DASHBOARD_CALLS` env var
- Uses `Promise.allSettled()` to handle failures gracefully

#### D. Restoring Dashboards (`restore-dashboard.js`)

**Purpose:** Restore dashboards deleted from Grafana but still needed

**Logic:**

1. **Find missing dashboards**:
   - Get all dashboard UIDs from Grafana
   - Compare with stored dashboards
   - Identify those missing in Grafana

2. **Filter candidates for restoration**:
   ```javascript
   // Only restore if:
   // 1. Used by application dashboards
   const applicationDashboards = await getApplicationDashboardsByUid(uid);

   // OR 2. Is a template dashboard
   if (dashboard.grafanaJson.dashboard.tags.includes('perfana-template')) {
     // Restore it
   }
   ```

3. **Restore to Grafana**:
   ```javascript
   // Parse stored JSON
   dashboard.grafanaJson = JSON.parse(dashboard.grafanaJson);

   // Remove ID (let Grafana assign new one)
   delete dashboard.grafanaJson.dashboard.id;

   // Restore folder
   dashboard.grafanaJson.folderId = dashboard.grafanaJson.meta.folderId;

   // Post to Grafana
   await grafanaApiPost(grafana, '/api/dashboards/db', dashboard.grafanaJson);
   ```

**Error Handling:**
- If restore fails with 412 (precondition failed), remove from Perfana DB
- Prevents infinite restoration loops

### 2. Auto-Configuration (`auto-config/auto-config-service.js`)

**Purpose:** Automatically create and configure dashboards for new test runs

**Main Workflow:**

```
processAutoConfigDashboards()
  ├── findRecentTestRuns(last5Minutes)
  ├── findProfiles()
  ├── findAutoConfigGrafanaDashboards()
  ├── For each test run:
  │   ├── Match profiles by tags
  │   ├── processAutoConfigDashboardsForTestRun()
  │   ├── processAutoConfigGenericChecks()
  │   ├── processAutoConfigGenericDeepLinks()
  │   └── processAutoConfigGenericReportPanels()
```

#### A. Dashboard Auto-Configuration

**Core Logic:**

1. **Find template dashboard**:
   ```javascript
   const templateDashboard = await findGrafanaDashboardOrNull(
     autoConfigDashboard.grafana,
     [autoConfigDashboard.dashboardUid]
   );
   ```

2. **Variable Discovery** (`get-application-dashboard-variables.js`):
   - Discover variable values from Grafana datasources
   - Match test run variables to dashboard templating variables
   - Support for: system_under_test, test_environment, workload, etc.

3. **Check if dashboard exists**:
   ```javascript
   const dashboardUid = DashboardUid.from(testRun, autoConfigDashboard).dashboardUid;
   const applicationDashboards = await findApplicationDashboards(dashboardUid);
   ```

4. **Create or Update**:
   - If exists: Update variables if needed
   - If not exists: Create new dashboard in Grafana + store in Perfana DB

#### B. Dashboard Creation Logic

**Two Modes:**

1. **Read-Only Mode** (`autoConfigDashboard.readOnly === true`):
   - Reuse template dashboard
   - Update `usedBySUT` field
   - Create application dashboard entry pointing to template

2. **Create Mode** (default):
   ```javascript
   // Create folder for systemUnderTest
   const folderId = await createOrFindFolder(grafanaInstance, testRun);

   // Clone template dashboard
   const newDashboard = {
     dashboard: {
       ...templateDashboard.dashboard,
       id: null,  // Let Grafana assign new ID
       uid: generatedUid,
       title: `${dashboardName} - ${systemUnderTest} ${environment}`,
       tags: tags.filter(tag => tag !== 'perfana-template')
     },
     folderId: folderId,
     overwrite: false
   };

   // Create in Grafana
   await grafanaApiPost(grafana, '/api/dashboards/db', newDashboard);

   // Store in Perfana DB
   await upsertGrafanaDashboard({...});
   ```

#### C. Separate Dashboard per Variable

**Feature:** Create multiple dashboards when variable has multiple values

Example: If `createSeparateDashboardForVariable: "service_name"` and service_name has values `[api, worker, web]`, create 3 dashboards.

**Implementation:**

```javascript
setOfVariablesPerCreateSeparateDashboardForVariable(separateVariable, variables) {
  const variablesToProcess = {};

  if (!separateVariable) {
    variablesToProcess['null'] = variables;
  } else {
    const separateVar = variables.find(v => v.name === separateVariable);

    separateVar.values.forEach(value => {
      const newVariables = [...otherVariables, { name: separateVariable, values: [value] }];
      variablesToProcess[separateVariable + value] = newVariables;
    });
  }

  return variablesToProcess;
}
```

**Dashboard UID Generation:**
```javascript
// Include variable value in UID for separate dashboards
createDashboardUid(testRun, autoConfigDashboard, applicationDashboardVariables)
// Example: "perfana-jvm-memory-api-prod-api-service"
```

#### D. Application Dashboard Storage

**Data Structure:**

```javascript
{
  _id: Random.secret(),
  application: testRun.systemUnderTestName,
  testEnvironment: testRun.testEnvironment,
  grafana: grafanaInstance.label,
  dashboardName: "JVM Memory Usage - my-api prod",
  dashboardId: 123,
  dashboardUid: "perfana-jvm-memory-my-api-prod",
  dashboardLabel: "JVM Memory Usage",
  templateDashboardUid: "template-jvm-memory",
  snapshotTimeout: 4,
  tags: [...],
  variables: [
    { name: "system_under_test", values: ["my-api"] },
    { name: "test_environment", values: ["prod"] },
    { name: "service_name", values: ["api", "worker"] }
  ],
  perfanaInfo: "Created or updated by Perfana Node.js 2025-11-02T..."
}
```

### 3. Grafana API Helper (`helpers/grafana-api.js`)

**Simple HTTP Client:**

```javascript
module.exports.grafanaApiGet = async (grafana, endpoint) => {
  const token = 'Bearer ' + grafana.apiKey;
  const apiUrl = (grafana.serverUrl || grafana.clientUrl) + endpoint;

  const response = await fetch(apiUrl, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: token
    }
  });

  if (!response.ok) {
    throw new Error(`statusCode: ${response.status} statusText: ${response.statusText}`);
  }

  return response.json();
};
```

**Available Methods:**
- `grafanaApiGet(grafana, endpoint)` - GET request
- `grafanaApiPost(grafana, endpoint, postData)` - POST request
- `grafanaApiDelete(grafana, endpoint)` - DELETE request

**Key Features:**
- Uses `serverUrl` if available, falls back to `clientUrl`
- Bearer token authentication
- Error handling with status codes
- No retries or rate limiting (handled at higher level)

### 4. Database Wrapper (`helpers/sync-database-wrapper.js`)

**Purpose:** Abstraction layer supporting both MongoDB and TypeORM

**Key Operations:**

```javascript
module.exports = {
  // Grafana Instances
  getGrafanaInstances: () => db.getGrafanaInstances(),
  getGrafanaInstance: (label) => db.getGrafanaInstance(label),

  // Dashboards
  getGrafanaDashboardsForGrafanaInstance: (label) => db.getGrafanaDashboardsForGrafanaInstance(label),
  upsertGrafanaDashboard: (dashboard) => db.upsertGrafanaDashboard(dashboard),
  getGrafanaDashboardByUid: (grafanaLabel, uid) => db.getGrafanaDashboardByUid(grafanaLabel, uid),
  removeGrafanaDashboard: (id) => db.removeGrafanaDashboard(id),

  // Application Dashboards
  getApplicationDashboards: (filter) => db.getApplicationDashboards(filter),
  findApplicationDashboard: (filter) => db.findApplicationDashboard(filter),
  updateApplicationDashboardVariables: (id, variables) => db.updateApplicationDashboardVariables(id, variables),
  getApplicationDashboardsByUid: (uid) => db.getApplicationDashboardsByUid(uid),

  // Template Operations
  getTemplateGrafanaDashboardInstancesForGrafanaInstance: (label, uids) =>
    db.getTemplateGrafanaDashboardInstancesForGrafanaInstance(label, uids)
};
```

**Factory Pattern:**
- `database/factory.js` determines which implementation to use (MongoDB, TypeORM, etc.)
- All sync code uses wrapper, enabling database migration without code changes

## Key Configuration

### Environment Variables

```bash
# Sync Interval
SYNC_INTERVAL=30000  # 30 seconds

# Direct Grafana DB Access (optional)
PG_HOST=grafana-db.example.com
PG_PORT=5432
PG_USER=grafana
PG_PASSWORD=secret
PG_SCHEMA=public

# MySQL Alternative
MYSQL_HOST=grafana-db.example.com
MYSQL_USER=grafana
MYSQL_PASSWORD=secret
MYSQL_DATABASE=grafana

# Concurrency
PARALLEL_GET_DASHBOARD_CALLS=20  # Parallel HTTP requests
```

### Scheduling Configuration

```javascript
// config/default.js
module.exports = {
  sync: {
    interval: 30000  // 30 seconds
  },
  testRunSanityChecker: {
    enabled: false,
    delayInMinutes: 10,
    interval: 300000  // 5 minutes
  },
  sanityChecker: {
    enabled: false,
    interval: 3600000  // 1 hour
  }
};
```

## Migration Recommendations

### 1. Reuse Existing Infrastructure

**DO:**
- ✅ Use worker's `GrafanaClient` for HTTP API calls (has connection pooling, retries)
- ✅ Use shared entities from `packages/shared/src/entities/`
- ✅ Use shared types from `packages/shared/src/types/grafana.ts`

**DON'T:**
- ❌ Recreate HTTP client (worker already has it)
- ❌ Duplicate entity definitions
- ❌ Copy-paste database wrapper logic

### 2. NestJS Service Architecture

Map original files to NestJS services:

```
grafana-sync/
├── store-dashboard/
│   ├── get-dashboards-to-add.js → StoreDashboardService.getDashboardsToAdd()
│   └── store-dashboard.js → StoreDashboardService.storeDashboard()
│
├── update-dashboards/
│   └── get-dashboards-to-update.js → UpdateDashboardsService.getDashboardsToUpdate()
│
├── restore-dashboard/
│   ├── get-dashboards-to-restore.js → RestoreDashboardService.getDashboardsToRestore()
│   └── restore-dashboard.js → RestoreDashboardService.restoreDashboard()
│
└── grafana-sync.js → GrafanaSyncService.handleGrafanaSync()

auto-config/
├── auto-config-service.js → AutoConfigService.processAutoConfigDashboards()
├── auto-config-finders.js → AutoConfigFindersService (database queries)
└── auto-config-updates.js → AutoConfigUpdatesService (database updates)

helpers/
├── grafana-api.js → Use worker's GrafanaClient instead
└── sync-database-wrapper.js → Use TypeORM repositories directly
```

### 3. Scheduled Tasks with @nestjs/schedule

Replace `setTimeout` loops with decorators:

```typescript
@Injectable()
export class GrafanaSyncService {
  @Interval('grafana-sync', 30000)
  async handleGrafanaSync() {
    // Original grafana-sync.js logic
  }

  @Cron('*/5 * * * *')  // Every 5 minutes
  async handleTemplateUpdates() {
    // Template update logic
  }
}
```

### 4. Database Access Patterns

**Original Pattern:**
```javascript
const dashboards = await getGrafanaDashboardsForGrafanaInstance(grafanaLabel);
await upsertGrafanaDashboard(dashboard);
```

**NestJS Pattern:**
```typescript
@Injectable()
export class StoreDashboardService {
  constructor(
    @InjectRepository(GrafanaDashboard)
    private dashboardRepo: Repository<GrafanaDashboard>,
  ) {}

  async getDashboardsForInstance(instanceId: string) {
    return this.dashboardRepo.find({
      where: { grafanaInstance: { id: instanceId } }
    });
  }

  async upsertDashboard(dashboard: GrafanaDashboard) {
    return this.dashboardRepo.save(dashboard);
  }
}
```

### 5. Grafana API Client Integration

**Use Worker's Client:**

```typescript
import { GrafanaClient } from '../../../worker/src/lib/grafana/client';

@Injectable()
export class GrafanaApiService {
  private clients: Map<string, GrafanaClient> = new Map();

  async getClient(instanceId: string): Promise<GrafanaClient> {
    if (!this.clients.has(instanceId)) {
      const instance = await this.grafanaInstanceRepo.findOne({ where: { id: instanceId } });

      const client = new GrafanaClient({
        url: instance.client_url,
        apiKey: instance.api_key,
        concurrency: 30,
        batchSize: 20
      });

      this.clients.set(instanceId, client);
    }

    return this.clients.get(instanceId);
  }

  async getDashboard(instanceId: string, uid: string) {
    const client = await this.getClient(instanceId);
    return client.getDashboardByUid(uid);
  }
}
```

### 6. Error Handling & Resilience

**Original Pattern:**
```javascript
try {
  await storeDashboard(grafana, dashboard);
} catch (err) {
  logger.logError(err, 'Storing dashboard failed');
  // Continue with next dashboard
}
```

**NestJS Pattern:**
```typescript
async storeDashboard(dashboard: GrafanaDashboard) {
  try {
    return await this.dashboardRepo.save(dashboard);
  } catch (error) {
    this.logger.error(`Failed to store dashboard ${dashboard.uid}`, error.stack);
    throw new InternalServerErrorException('Dashboard storage failed');
  }
}
```

### 7. Direct Grafana DB Access (Optional)

**Implementation Strategy:**

1. **Create separate service** for direct DB access:
   ```typescript
   @Injectable()
   export class GrafanaDbService {
     private connection: Connection;

     async connect() {
       this.connection = await createConnection({
         type: 'postgres',
         host: this.config.get('GRAFANA_PG_HOST'),
         // ...
       });
     }

     async getRecentDashboards(since: Date): Promise<string[]> {
       const results = await this.connection.query(
         `SELECT uid FROM dashboard WHERE created > $1`,
         [since]
       );
       return results.map(r => r.uid);
     }
   }
   ```

2. **Make it optional** via configuration flag
3. **Fallback to HTTP API** if not configured

## Implementation Priorities

### Phase 1: Core Sync Logic (HIGH PRIORITY)

1. **StoreDashboardService** - Most critical, adds new dashboards
2. **UpdateDashboardsService** - Keeps dashboards in sync
3. **RestoreDashboardService** - Prevents data loss
4. **GrafanaApiService** - Wrapper around worker's client

### Phase 2: Auto-Configuration (MEDIUM PRIORITY)

1. **AutoConfigService** - Main orchestrator
2. **AutoConfigFindersService** - Database queries
3. **AutoConfigUpdatesService** - Database updates
4. **Variable discovery logic** - Complex but isolated

### Phase 3: Direct DB Access (LOW PRIORITY)

1. **GrafanaDbService** - Optional optimization
2. **Connection management**
3. **Query optimization**

### Phase 4: Sanity Checkers (LOW PRIORITY)

1. **TestRunSanityCheckerService**
2. **GeneralSanityCheckerService**

## Testing Strategy

### Unit Tests

```typescript
describe('StoreDashboardService', () => {
  it('should store new dashboard', async () => {
    const dashboard = await service.storeDashboard(grafanaInstance, dashboardData);
    expect(dashboard.uid).toBe('test-uid');
  });

  it('should skip if already stored', async () => {
    // Mock existing dashboard
    const result = await service.storeDashboard(grafanaInstance, dashboardData, false);
    expect(result).toBe(existingDashboard);
  });
});
```

### Integration Tests

```typescript
describe('GrafanaSync Integration', () => {
  it('should sync all dashboards from instance', async () => {
    const result = await service.handleGrafanaSync();
    expect(result.added).toBeGreaterThan(0);
  });
});
```

## Critical Implementation Notes

### 1. MongoDB Legacy IDs

The original code uses `meteor-random` to generate `_id` fields for MongoDB compatibility:

```javascript
const Random = require('meteor-random');
grafanaDashboard['_id'] = Random.secret();
```

**Migration Strategy:**
- PostgreSQL uses UUIDs for primary keys
- **Don't port** meteor-random
- Use TypeORM's `@PrimaryGeneratedColumn('uuid')`
- Update existing migration scripts if they reference `_id`

### 2. Dashboard UID Generation

**Critical:** UIDs must be deterministic for auto-config to work:

```javascript
// Original: dashboard-uid.js
DashboardUid.from(testRun, autoConfigDashboard)
// Generates: "perfana-${dashboardName}-${systemUnderTest}-${environment}"
```

**Port this logic exactly** - changing UID generation breaks existing dashboard lookups.

### 3. Concurrent Processing

The original code carefully controls concurrency:

```javascript
const parallelGetDashboardCalls = process.env.PARALLEL_GET_DASHBOARD_CALLS || 20;

// Process in batches
for (let i = 0; i < dashboards.length; i += batchSize) {
  const batch = dashboards.slice(i, i + batchSize);
  const batchPromises = batch.map(async (dashboard) => {
    // Process dashboard
  });
  await Promise.allSettled(batchPromises);
}
```

**Why:** Grafana API has rate limits. Too many parallel requests cause failures.

**NestJS Implementation:**
- Use `p-limit` library or similar
- Make concurrency configurable
- Handle `Promise.allSettled()` results properly

### 4. Template Dashboard Propagation

**Feature:** When a template dashboard updates, optionally update all instances

```javascript
if (process.env.GRAFANA_PROPAGATE_TEMPLATE_UPDATES === 'true') {
  await updateTemplateDashboardInstances(grafana, updateSpec);
}
```

**Implementation:** Separate scheduled task, disabled by default

### 5. Folder Management

Auto-config creates Grafana folders per system-under-test:

```javascript
const folderUid = systemUnderTestName.toLowerCase().replace(/ /g, '-');
```

**Important:**
- Use deterministic UIDs
- Handle folder creation failures gracefully (fallback to General folder)
- Don't create duplicate folders

## Summary

The original perfana-grafana application is well-designed with clear separation of concerns:

1. **Sync workflows** are independent and can run in parallel
2. **Database abstraction** allows easy migration to TypeORM
3. **Grafana API client** is simple (use worker's instead)
4. **Auto-configuration** is complex but well-documented
5. **Error handling** is defensive with retry logic

**Key Success Factors:**
- ✅ Reuse worker's Grafana infrastructure
- ✅ Maintain deterministic UID generation
- ✅ Control concurrency to respect API limits
- ✅ Implement both HTTP API and direct DB modes
- ✅ Comprehensive error handling and logging

**Estimated Effort:** 3-4 days with code reuse, as per migration plan
