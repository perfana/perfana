# Grafana Shared Code - Quick Reference Guide

**Package:** `@perfana/shared`
**Purpose:** Shared entities, types, and services for Grafana integration
**Target Consumers:** `apps/grafana-sync`, `apps/api`, `apps/worker`

---

## Import Patterns

### Entities

```typescript
import {
  GrafanaInstance,
  GrafanaDashboard,
  ApplicationDashboard
} from '@perfana/shared/entities';

// Or import all entities
import * as Entities from '@perfana/shared/entities';
```

### Types

```typescript
import {
  GrafanaInstance as GrafanaInstanceType,
  CreateGrafanaInstanceDto,
  GrafanaDashboardQuery,
  ApplicationDashboardWithDetails
} from '@perfana/shared/types';
```

### Grafana Services

```typescript
import {
  GrafanaClient,
  type GrafanaConfig,
  type PanelDocument,
  type PanelMetricsDocument
} from '@perfana/shared/services/grafana';
```

### Utilities

```typescript
import {
  filterSystemTags,
  isSystemTag,
  mergeAndFilterTags,
  cleanObject,
  delay
} from '@perfana/shared/utils';
```

---

## GrafanaClient Usage

### Basic Setup

```typescript
import { GrafanaClient } from '@perfana/shared/services/grafana';

const grafanaClient = new GrafanaClient({
  url: 'https://grafana.example.com',
  apiKey: 'your-api-key',
  orgId: '1',
  timeout: 30000,        // Optional: 30s timeout
  concurrency: 30,       // Optional: 30 concurrent requests
  batchSize: 20,         // Optional: 20 panels per batch
});
```

### Query Panel Data

```typescript
// Prepare panel documents
const panels: PanelDocument[] = [
  {
    test_run_id: 'test-123',
    application_dashboard_id: 'app-dash-456',
    dashboard_uid: 'abc123',
    panel_id: 1,
    panel_title: 'Response Time',
    dashboard_label: 'Performance',
    panel: { /* panel config */ },
    requests: [
      {
        endpoint: '/api/ds/query',
        method: 'POST',
        request_body: {
          queries: [/* queries */],
          from_: '2024-01-01T00:00:00Z',
          to: '2024-01-01T01:00:00Z'
        }
      }
    ]
  }
];

// Query Grafana
const metricsDocuments = await grafanaClient.queryPanelData(panels, testRun);

// Process results
for (const doc of metricsDocuments) {
  if (doc.errors) {
    console.error(`Panel ${doc.panel_id} has errors:`, doc.errors);
  } else {
    console.log(`Panel ${doc.panel_id} has ${doc.data.length} metrics`);
  }
}
```

### Fetch Datasource

```typescript
const datasource = await grafanaClient.getDatasourceByUid('prometheus-uid');

if (datasource) {
  console.log(`Datasource ID: ${datasource.id}`);
  console.log(`Datasource Type: ${datasource.type}`);
}
```

---

## TypeORM Repository Usage

### Using Grafana Entities

```typescript
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GrafanaInstance, GrafanaDashboard } from '@perfana/shared/entities';

@Injectable()
export class GrafanaService {
  constructor(
    @InjectRepository(GrafanaInstance)
    private grafanaInstanceRepo: Repository<GrafanaInstance>,

    @InjectRepository(GrafanaDashboard)
    private grafanaDashboardRepo: Repository<GrafanaDashboard>,
  ) {}

  async findInstanceByLabel(label: string): Promise<GrafanaInstance | null> {
    return this.grafanaInstanceRepo.findOne({
      where: { label }
    });
  }

  async findDashboardsForInstance(instanceId: string): Promise<GrafanaDashboard[]> {
    return this.grafanaDashboardRepo.find({
      where: { grafanaInstanceId: instanceId },
      relations: ['grafanaInstance']
    });
  }
}
```

### Complex Queries

```typescript
// Find dashboards with specific tags
const dashboards = await this.grafanaDashboardRepo
  .createQueryBuilder('dashboard')
  .where('dashboard.tags && ARRAY[:...tags]', { tags: ['load-test', 'production'] })
  .andWhere('dashboard.name ILIKE :search', { search: '%performance%' })
  .orderBy('dashboard.updated', 'DESC')
  .getMany();

// Find application dashboards for specific SUT and environment
const appDashboards = await this.applicationDashboardRepo
  .createQueryBuilder('ad')
  .leftJoinAndSelect('ad.grafanaInstance', 'gi')
  .leftJoinAndSelect('ad.systemUnderTest', 'sut')
  .where('ad.system_under_test_id = :sutId', { sutId })
  .andWhere('ad.test_environment = :env', { env: 'production' })
  .getMany();
```

---

## Working with JSONB Fields

### Panel Configuration

```typescript
// Panels are stored as JSONB
const dashboard = await dashboardRepo.findOne({ where: { uid } });

// Access panel data
dashboard.panels.forEach((panel: any) => {
  console.log(`Panel ID: ${panel.id}`);
  console.log(`Panel Title: ${panel.title}`);
  console.log(`Panel Type: ${panel.type}`);

  // Access targets
  panel.targets?.forEach((target: any) => {
    console.log(`Query: ${target.query}`);
  });
});
```

### Templating Variables

```typescript
// Templating variables are stored as JSONB array
const variables = dashboard.templatingVariables || [];

variables.forEach((variable: any) => {
  console.log(`Variable: ${variable.name}`);
  console.log(`Type: ${variable.type}`);
  console.log(`Query: ${variable.query}`);
});
```

### Application Dashboard Variables

```typescript
// Application-specific variable overrides
const appDashboard = await appDashboardRepo.findOne({ where: { id } });

const variables = appDashboard.variables || {};
const replacedVars = appDashboard.replacedTemplatingVariables || {};

console.log('Variables:', variables);
console.log('Replaced:', replacedVars);
```

---

## Utility Functions

### Tag Filtering

```typescript
import { filterSystemTags, isSystemTag, mergeAndFilterTags } from '@perfana/shared/utils';

// Filter out system tags
const tags = ['perfana-test', 'production', '$service', 'load-test'];
const filtered = filterSystemTags(tags);
// Result: ['production', 'load-test']

// Check if tag is a system tag
isSystemTag('perfana-test');  // true
isSystemTag('production');     // false
isSystemTag('$service');       // true

// Merge multiple tag arrays
const merged = mergeAndFilterTags(
  ['tag1', 'tag2', 'perfana-system'],
  ['tag2', 'tag3', '$variable'],
  undefined,
  ['tag4']
);
// Result: ['tag1', 'tag2', 'tag3', 'tag4'] (unique, filtered, no system tags)
```

### Object Cleanup

```typescript
import { cleanObject } from '@perfana/shared/utils';

const data = {
  name: 'test',
  value: 123,
  optional: undefined,
  nullable: null,
  empty: ''
};

const cleaned = cleanObject(data);
// Result: { name: 'test', value: 123, empty: '' }
// Removes undefined and null, keeps empty strings
```

### Delays

```typescript
import { delay } from '@perfana/shared/utils';

// Wait for 1 second
await delay(1000);

// Retry with exponential backoff
for (let i = 0; i < 3; i++) {
  try {
    await someOperation();
    break;
  } catch (error) {
    if (i < 2) {
      await delay(Math.pow(2, i) * 1000);
    }
  }
}
```

---

## Type Definitions Reference

### GrafanaInstance

```typescript
interface GrafanaInstance {
  id: string;
  label: string;                    // Display name
  clientUrl: string;                // Frontend URL
  serverUrl?: string;               // Backend URL (if different)
  orgId: string;                    // Grafana org ID
  apiKey?: string;                  // API key for authentication
  username?: string;                // Basic auth username
  password?: string;                // Basic auth password
  snapshotInstance: boolean;        // Is this for snapshots?
  createdAt: string;
  updatedAt: string;
}
```

### GrafanaDashboard

```typescript
interface GrafanaDashboard {
  id: string;
  grafanaInstanceId: string;
  grafanaId: number;                // Grafana's internal ID
  datasourceType?: string;
  uid: string;                      // Grafana UID
  slug?: string;
  name: string;
  uri?: string;
  templatingVariables?: TemplatingVariable[];
  panels: DashboardPanel[];         // JSONB array
  variables?: DashboardVariable[];
  tags?: string[];
  usedBySut?: string[];            // System names
  updated: string;
  createdAt: string;
}
```

### ApplicationDashboard

```typescript
interface ApplicationDashboard {
  id: string;
  systemUnderTestId: string;
  testEnvironment: string;
  grafanaInstanceId: string;
  grafanaDashboardId: string;
  dashboardName: string;
  dashboardId?: number;
  dashboardUid?: string;
  dashboardLabel: string;
  tags?: string[];
  templateDashboardUid?: string;
  variables?: ApplicationDashboardVariable[];
  replacedTemplatingVariables?: ReplacedTemplatingVariable[];
  snapshotTimeout: number;          // Default: 4 minutes
  createdAt: string;
  updatedAt: string;
}
```

---

## NestJS Module Setup

### Import Entities in Module

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  GrafanaInstance,
  GrafanaDashboard,
  ApplicationDashboard,
  SystemUnderTest
} from '@perfana/shared/entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      GrafanaInstance,
      GrafanaDashboard,
      ApplicationDashboard,
      SystemUnderTest
    ])
  ],
  providers: [GrafanaService],
  exports: [GrafanaService]
})
export class GrafanaModule {}
```

### Using TypeORM Config

```typescript
import { dataSource } from '@perfana/shared/config';

// In main.ts or app.module.ts
TypeOrmModule.forRoot({
  ...dataSource.options,
  autoLoadEntities: true,
})
```

---

## Error Handling Patterns

### GrafanaClient Errors

```typescript
import { GrafanaClient } from '@perfana/shared/services/grafana';

try {
  const metrics = await grafanaClient.queryPanelData(panels, testRun);

  // Check for panel-level errors
  for (const doc of metrics) {
    if (doc.errors && doc.errors.length > 0) {
      for (const error of doc.errors) {
        console.error(`Panel ${doc.panel_id} error:`, {
          message: error.message,
          type: error.type,
          statusCode: error.status_code,
          targetIndex: error.target_index
        });
      }
    }
  }
} catch (error) {
  // Client-level error (complete failure)
  console.error('Grafana client error:', error);
}
```

### Error Types

- **Client errors:** Network issues, timeouts, connection failures
- **Batch errors:** HTTP 4xx/5xx responses from Grafana API
- **Query errors:** Individual query failures within successful batch
- **Missing results:** Query didn't return expected data

---

## Performance Considerations

### Batching

- Default batch size: 20 panels per request
- Configurable via `batchSize` in GrafanaClient config
- Balances request size vs. number of API calls

### Concurrency

- Default concurrency: 30 simultaneous requests
- Configurable via `concurrency` in GrafanaClient config
- Uses undici connection pooling for HTTP keep-alive

### Connection Pooling

- 10x concurrency connections in pool (300 default)
- 60s keep-alive timeout
- Automatic retry with exponential backoff

### Query Optimization

```typescript
// Good: Use indexes
dashboard.where('uid = :uid', { uid });
dashboard.where('grafanaInstanceId = :id', { id });

// Good: Use array operators for tags
dashboard.where('tags && ARRAY[:...tags]', { tags });

// Avoid: Full table scans
dashboard.where('name LIKE :search', { search: '%test%' });  // Use full-text search instead
```

---

## Testing Patterns

### Mock GrafanaClient

```typescript
import { GrafanaClient } from '@perfana/shared/services/grafana';

jest.mock('@perfana/shared/services/grafana');

describe('GrafanaService', () => {
  let mockGrafanaClient: jest.Mocked<GrafanaClient>;

  beforeEach(() => {
    mockGrafanaClient = {
      queryPanelData: jest.fn(),
      getDatasourceByUid: jest.fn(),
    } as any;
  });

  it('should query panel data', async () => {
    mockGrafanaClient.queryPanelData.mockResolvedValue([
      {
        test_run_id: 'test-123',
        panel_id: 1,
        data: [/* metrics */],
        errors: null
      }
    ]);

    const result = await service.queryPanels(panels);
    expect(result).toHaveLength(1);
  });
});
```

### Mock Repository

```typescript
import { Repository } from 'typeorm';
import { GrafanaDashboard } from '@perfana/shared/entities';

const mockRepository: Partial<Repository<GrafanaDashboard>> = {
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
};
```

---

## Common Patterns

### Sync Dashboards from Grafana

```typescript
async syncDashboardsFromGrafana(instanceId: string): Promise<void> {
  // 1. Get instance
  const instance = await this.grafanaInstanceRepo.findOne({
    where: { id: instanceId }
  });

  if (!instance) {
    throw new Error('Instance not found');
  }

  // 2. Create client
  const client = new GrafanaClient({
    url: instance.clientUrl,
    apiKey: instance.apiKey,
    orgId: instance.orgId
  });

  // 3. Fetch dashboards from Grafana API
  const grafanaDashboards = await this.fetchDashboardsFromGrafana(client);

  // 4. Store in database
  for (const dash of grafanaDashboards) {
    await this.grafanaDashboardRepo.upsert({
      grafanaInstanceId: instanceId,
      grafanaId: dash.id,
      uid: dash.uid,
      name: dash.title,
      panels: dash.panels,
      tags: filterSystemTags(dash.tags || []),
      updated: new Date(dash.updated)
    }, ['uid']);
  }
}
```

### Create Application Dashboard

```typescript
async createApplicationDashboard(
  dto: CreateApplicationDashboardDto
): Promise<ApplicationDashboard> {
  // 1. Validate references exist
  const [sut, instance, dashboard] = await Promise.all([
    this.sutRepo.findOne({ where: { id: dto.systemUnderTestId } }),
    this.grafanaInstanceRepo.findOne({ where: { id: dto.grafanaInstanceId } }),
    this.grafanaDashboardRepo.findOne({ where: { id: dto.grafanaDashboardId } })
  ]);

  if (!sut || !instance || !dashboard) {
    throw new Error('Invalid references');
  }

  // 2. Create with clean data
  const appDashboard = this.applicationDashboardRepo.create({
    ...dto,
    tags: filterSystemTags(dto.tags || []),
    snapshotTimeout: dto.snapshotTimeout || 4
  });

  return this.applicationDashboardRepo.save(appDashboard);
}
```

---

## Troubleshooting

### Build Errors

```bash
# Clear dist and rebuild
cd packages/shared
rm -rf dist
npm run build
```

### Import Errors

```typescript
// ❌ Wrong
import { GrafanaInstance } from '@perfana/shared';
import { GrafanaInstance } from '@perfana/shared/dist/entities';

// ✅ Correct
import { GrafanaInstance } from '@perfana/shared/entities';
```

### Type Errors with JSONB

```typescript
// JSONB fields are typed as 'any' in entities
// Cast to specific types when using

interface PanelConfig {
  id: number;
  title: string;
  targets: any[];
}

const panel = dashboard.panels[0] as PanelConfig;
```

---

## Additional Resources

- **Entity Definitions:** `packages/shared/src/entities/`
- **Type Definitions:** `packages/shared/src/types/grafana.ts`
- **Service Implementation:** `packages/shared/src/services/grafana/`
- **Migration Plan:** `GRAFANA_SYNC_MIGRATION_PLAN.md`
- **Phase 2 Report:** `GRAFANA_SYNC_PHASE2_COMPLETION.md`

---

**Last Updated:** November 2, 2025
**Package Version:** 0.1.0
**Maintained by:** Perfana Platform Team
