# SUT Export/Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a perfana-admin export a System Under Test + selected test runs as a portable gzipped-NDJSON file, and import that file into a dev database for standalone analysis.

**Architecture:** One canonical resource-graph descriptor (`sut-resource-graph.ts`) lists every SUT-keyed table in dependency (insert) order. Export walks it forward, streaming each table as `row_to_json` NDJSON through gzip. Import parses the stream and replays it in the same order via `json_populate_recordset`, rewriting only `organization_id`/`team_id`. All original UUIDs/keys are preserved, so no FK remapping is needed. Both endpoints are perfana-admin only and gated by an env flag.

**Tech Stack:** NestJS, TypeORM (raw `DataSource`/`queryRunner`), PostgreSQL (`row_to_json` / `json_populate_recordset`), `pg-query-stream` (streaming reads), Node `zlib` (gzip), multer (`@nestjs/platform-express` FileInterceptor), Next.js + React Query (frontend).

## Global Constraints

- New backend code lives in `apps/api/src/modules/sut-transfer/`. Reuse the existing SUT delete handler's table enumeration as the source of truth — do NOT rewire the delete handler in this plan.
- Preserve all original UUIDs and business keys on import. Rewrite ONLY `organization_id` (→ target org) and `team_id` (→ null) — and only on rows that actually have those columns.
- Serialization is done entirely by Postgres: export via `SELECT row_to_json(t) AS r`, import via `json_populate_recordset(null::<table>, $1::json)`. Never hand-serialize jsonb/array/timestamp columns in JS.
- Access: `@AdminOnly()` on every endpoint (guard is global) + env flag `SUT_TRANSFER_ENABLED` (backend, default `'false'`) / `NEXT_PUBLIC_SUT_TRANSFER_ENABLED` (frontend). Disabled → `ForbiddenException`.
- `apps/api` has `noUncheckedIndexedAccess`. Jest won't catch it — every backend task ends with `npx tsc --noEmit` (via `npm run type-check`).
- Table/column names are snake_case (raw SQL). Entity property remapping does not apply — we bypass the ORM entity layer and use raw rows.
- Commit after every task. Branch is `feat/sut-export-import` (already created).

---

### Task 1: Resource-graph descriptor + ordering unit test

The single source of truth for which tables move and in what order. Pure data + a pure helper; no DB, no DI. Test is a fast unit test.

**Files:**
- Create: `apps/api/src/modules/sut-transfer/sut-resource-graph.ts`
- Test: `apps/api/src/modules/sut-transfer/sut-resource-graph.spec.ts`

**Interfaces:**
- Produces:
  - `type SutFilter = 'bySut' | 'byTestRunVarchar' | 'byTestRunUuid' | 'byAppDashboard' | 'byReference'`
  - `type SutGroup = 'core' | 'optional' | 'raw' | 'shared'`
  - `interface SutResource { table: string; filter: SutFilter; group: SutGroup; customSql?: string }`
  - `const SUT_RESOURCES: SutResource[]` — in insert (dependency) order
  - `function selectResources(opts: { includeOptional: boolean; includeRaw: boolean }): SutResource[]` — always keeps `core` + `shared`, conditionally adds `optional`/`raw`, preserving array order

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/modules/sut-transfer/sut-resource-graph.spec.ts
import { SUT_RESOURCES, selectResources, SutResource } from './sut-resource-graph';

const idx = (table: string): number => SUT_RESOURCES.findIndex((r) => r.table === table);

describe('SUT_RESOURCES', () => {
  it('lists every SUT-keyed table exactly once', () => {
    const tables = SUT_RESOURCES.map((r) => r.table);
    expect(new Set(tables).size).toBe(tables.length);
    // Drift guard: this is the full set the delete handler touches, plus shared refs.
    // If you add a table to the delete cascade, add it here too.
    const expected = [
      'pyroscope_instances', 'grafana_instances', 'grafana_dashboards',
      'systems_under_test', 'metrics_sources', 'test_runs', 'application_dashboards',
      'benchmarks', 'expected_config_changes', 'events', 'tracing_services',
      'deep_links', 'notification_channels', 'dynatrace_entity_mappings',
      'dynatrace_queries', 'workload_apdex_thresholds', 'workload_transaction_apdex_thresholds',
      'system_under_test_test_environments', 'system_under_test_workloads',
      'scaling_sessions', 'sparse_metric_exclusions', 'alert_tag_filters',
      'trends_filter_presets', 'compare_filter_presets',
      'ds_compare_config', 'provisioned_template_ds_compare_configs',
      'ds_control_groups', 'ds_control_group_statistics',
      'ds_metrics', 'test_run_configs', 'awr_reports', 'generated_reports',
      'test_run_alerts', 'test_run_events', 'graph_presets',
      'requests_raw', 'requests_error', 'transactions', 'virtual_users',
      'ds_adapt_results', 'ds_adapt_conclusion', 'ds_adapt_tracked_results',
      'ds_change_points', 'check_results', 'ds_metric_statistics',
      'ds_metric_collection_status', 'ds_panels', 'ds_query_executions',
      'ds_tracked_differences',
    ].sort();
    expect([...tables].sort()).toEqual(expected);
  });

  it('orders parents before children (FK-safe insert order)', () => {
    expect(idx('pyroscope_instances')).toBeLessThan(idx('systems_under_test'));
    expect(idx('grafana_instances')).toBeLessThan(idx('application_dashboards'));
    expect(idx('grafana_dashboards')).toBeLessThan(idx('application_dashboards'));
    expect(idx('systems_under_test')).toBeLessThan(idx('metrics_sources'));
    expect(idx('metrics_sources')).toBeLessThan(idx('test_runs'));
    expect(idx('metrics_sources')).toBeLessThan(idx('application_dashboards'));
    expect(idx('metrics_sources')).toBeLessThan(idx('benchmarks'));
    expect(idx('application_dashboards')).toBeLessThan(idx('benchmarks'));
    expect(idx('application_dashboards')).toBeLessThan(idx('trends_filter_presets'));
    expect(idx('test_runs')).toBeLessThan(idx('ds_metrics'));
    expect(idx('test_runs')).toBeLessThan(idx('check_results'));
    expect(idx('ds_control_groups')).toBeLessThan(idx('ds_control_group_statistics'));
  });

  it('raw tables are excluded unless includeRaw', () => {
    const withoutRaw = selectResources({ includeOptional: true, includeRaw: false }).map((r) => r.table);
    expect(withoutRaw).not.toContain('requests_raw');
    expect(withoutRaw).toContain('ds_metrics'); // core, always present
    const withRaw = selectResources({ includeOptional: true, includeRaw: true }).map((r) => r.table);
    expect(withRaw).toContain('requests_raw');
  });

  it('optional tables are excluded unless includeOptional, but core+shared always present', () => {
    const coreOnly = selectResources({ includeOptional: false, includeRaw: false });
    const tables = coreOnly.map((r) => r.table);
    expect(tables).not.toContain('events'); // optional
    expect(tables).toContain('systems_under_test'); // core
    expect(tables).toContain('grafana_instances'); // shared
    expect(coreOnly.every((r: SutResource) => r.group === 'core' || r.group === 'shared')).toBe(true);
  });

  it('selectResources preserves SUT_RESOURCES order', () => {
    const selected = selectResources({ includeOptional: true, includeRaw: true }).map((r) => r.table);
    const full = SUT_RESOURCES.map((r) => r.table);
    // selected is full here (everything included); order must match
    expect(selected).toEqual(full);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest src/modules/sut-transfer/sut-resource-graph.spec.ts`
Expected: FAIL — cannot find module `./sut-resource-graph`.

- [ ] **Step 3: Write the descriptor**

```ts
// apps/api/src/modules/sut-transfer/sut-resource-graph.ts
export type SutFilter = 'bySut' | 'byTestRunVarchar' | 'byTestRunUuid' | 'byAppDashboard' | 'byReference';
export type SutGroup = 'core' | 'optional' | 'raw' | 'shared';

export interface SutResource {
  table: string;
  filter: SutFilter;
  group: SutGroup;
  /** Only for group: 'shared' (filter: 'byReference'). $1 = sutId. Must SELECT row_to_json(t) AS r. */
  customSql?: string;
}

// Insert (dependency) order. This is the REVERSE of the delete cascade in
// apps/api/src/modules/systems-under-test/handlers/delete-system-under-test.handler.ts.
// Keep the two in sync: adding a table to the delete cascade means adding it here.
export const SUT_RESOURCES: SutResource[] = [
  // --- shared reference rows (must exist before the SUT / dashboards) ---
  { table: 'pyroscope_instances', filter: 'byReference', group: 'shared',
    customSql: `SELECT row_to_json(t) AS r FROM pyroscope_instances t
                WHERE t.id = (SELECT pyroscope_instance_id FROM systems_under_test WHERE id = $1)` },
  { table: 'grafana_instances', filter: 'byReference', group: 'shared',
    customSql: `SELECT DISTINCT row_to_json(t) AS r FROM grafana_instances t
                JOIN application_dashboards ad ON ad.grafana_instance_id = t.id
                WHERE ad.system_under_test_id = $1` },
  { table: 'grafana_dashboards', filter: 'byReference', group: 'shared',
    customSql: `SELECT DISTINCT row_to_json(t) AS r FROM grafana_dashboards t
                JOIN application_dashboards ad ON ad.grafana_dashboard_id = t.id
                WHERE ad.system_under_test_id = $1` },

  // --- the SUT itself ---
  { table: 'systems_under_test', filter: 'bySut', group: 'core' },

  // --- metrics_sources FIRST among SUT children (NO ACTION FK; dependents need it) ---
  { table: 'metrics_sources', filter: 'bySut', group: 'core' },

  // --- test runs (parents of all per-run data) ---
  { table: 'test_runs', filter: 'bySut', group: 'core' },

  // --- application dashboards (depend on grafana + metrics_sources) ---
  { table: 'application_dashboards', filter: 'bySut', group: 'core' },

  // --- remaining SUT children ---
  { table: 'benchmarks', filter: 'bySut', group: 'core' },
  { table: 'expected_config_changes', filter: 'bySut', group: 'optional' },
  { table: 'events', filter: 'bySut', group: 'optional' },
  { table: 'tracing_services', filter: 'bySut', group: 'optional' },
  { table: 'deep_links', filter: 'bySut', group: 'optional' },
  { table: 'notification_channels', filter: 'bySut', group: 'optional' },
  { table: 'dynatrace_entity_mappings', filter: 'bySut', group: 'optional' },
  { table: 'dynatrace_queries', filter: 'bySut', group: 'optional' },
  { table: 'workload_apdex_thresholds', filter: 'bySut', group: 'optional' },
  { table: 'workload_transaction_apdex_thresholds', filter: 'bySut', group: 'optional' },
  { table: 'system_under_test_test_environments', filter: 'bySut', group: 'optional' },
  { table: 'system_under_test_workloads', filter: 'bySut', group: 'optional' },
  { table: 'scaling_sessions', filter: 'bySut', group: 'optional' },
  { table: 'sparse_metric_exclusions', filter: 'bySut', group: 'optional' },
  { table: 'alert_tag_filters', filter: 'bySut', group: 'optional' },
  { table: 'trends_filter_presets', filter: 'byAppDashboard', group: 'optional' },
  { table: 'compare_filter_presets', filter: 'byAppDashboard', group: 'optional' },

  // --- DS SUT-scoped tables ---
  { table: 'ds_compare_config', filter: 'bySut', group: 'core' },
  { table: 'provisioned_template_ds_compare_configs', filter: 'bySut', group: 'core' },
  { table: 'ds_control_groups', filter: 'bySut', group: 'core' },
  { table: 'ds_control_group_statistics', filter: 'bySut', group: 'core' },

  // --- per-test-run child data (uuid key) ---
  { table: 'ds_metrics', filter: 'byTestRunVarchar', group: 'core' },
  { table: 'test_run_configs', filter: 'byTestRunUuid', group: 'core' },
  { table: 'awr_reports', filter: 'byTestRunUuid', group: 'optional' },
  { table: 'generated_reports', filter: 'byTestRunUuid', group: 'optional' },
  { table: 'test_run_alerts', filter: 'byTestRunUuid', group: 'optional' },
  { table: 'test_run_events', filter: 'byTestRunUuid', group: 'optional' },
  { table: 'graph_presets', filter: 'byTestRunVarchar', group: 'optional' },

  // --- raw sample hypertables (off by default) ---
  { table: 'requests_raw', filter: 'byTestRunVarchar', group: 'raw' },
  { table: 'requests_error', filter: 'byTestRunVarchar', group: 'raw' },
  { table: 'transactions', filter: 'byTestRunVarchar', group: 'raw' },
  { table: 'virtual_users', filter: 'byTestRunVarchar', group: 'raw' },

  // --- DS per-test-run analysis tables ---
  { table: 'ds_adapt_results', filter: 'byTestRunVarchar', group: 'core' },
  { table: 'ds_adapt_conclusion', filter: 'byTestRunVarchar', group: 'core' },
  { table: 'ds_adapt_tracked_results', filter: 'byTestRunVarchar', group: 'core' },
  { table: 'ds_change_points', filter: 'byTestRunVarchar', group: 'core' },
  { table: 'check_results', filter: 'byTestRunVarchar', group: 'core' },
  { table: 'ds_metric_statistics', filter: 'byTestRunVarchar', group: 'core' },
  { table: 'ds_metric_collection_status', filter: 'byTestRunVarchar', group: 'core' },
  { table: 'ds_panels', filter: 'byTestRunVarchar', group: 'core' },
  { table: 'ds_query_executions', filter: 'byTestRunUuid', group: 'core' },
  { table: 'ds_tracked_differences', filter: 'byTestRunUuid', group: 'core' },
];

export function selectResources(opts: { includeOptional: boolean; includeRaw: boolean }): SutResource[] {
  return SUT_RESOURCES.filter((r) => {
    if (r.group === 'core' || r.group === 'shared') return true;
    if (r.group === 'optional') return opts.includeOptional;
    if (r.group === 'raw') return opts.includeRaw;
    return false;
  });
}
```

> **Note on the drift-guard set:** the expected-tables list in the test is copied verbatim from the delete handler's Phase 1–7 enumeration plus the three shared refs. If the FK-discovery step in Task 3 reveals another shared table is required (e.g. `dynatrace_configs`), add it to `SUT_RESOURCES`, the test's `expected` list, and Task 3's shared handling together.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest src/modules/sut-transfer/sut-resource-graph.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Type-check**

Run: `cd apps/api && npm run type-check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/sut-transfer/sut-resource-graph.ts apps/api/src/modules/sut-transfer/sut-resource-graph.spec.ts
git commit -m "feat(sut-transfer): resource-graph descriptor + ordering tests"
```

---

### Task 2: Backend env flag + module skeleton + DTOs

Adds the `SUT_TRANSFER_ENABLED` backend flag, the empty module, and both request DTOs. No logic yet — this is the wiring a reviewer can approve independently.

**Files:**
- Modify: `apps/api/src/config/env.validation.ts` (after the `LOG_VIEWER_ENABLED` block, ~line 118)
- Create: `apps/api/src/modules/sut-transfer/dto/export-sut.dto.ts`
- Create: `apps/api/src/modules/sut-transfer/dto/import-sut.dto.ts`
- Create: `apps/api/src/modules/sut-transfer/sut-transfer.module.ts`
- Modify: the root app module (find with `grep -rl "SystemsUnderTestModule" apps/api/src/app.module.ts apps/api/src/*.module.ts`) — add `SutTransferModule` to `imports`

**Interfaces:**
- Produces:
  - `class ExportSutDto { testRunIds: string[]; includeOptional: boolean; includeRaw: boolean }`
  - `class ImportSutDto { targetOrganizationId: string }`
  - `class SutTransferModule`

- [ ] **Step 1: Add the Joi flag**

In `apps/api/src/config/env.validation.ts`, directly after the `LOG_VIEWER_ENABLED` validator:

```ts
  SUT_TRANSFER_ENABLED: Joi.string()
    .valid('true', 'false')
    .default('false')
    .description('Enable admin SUT export/import feature (exports production data to a file)'),
```

- [ ] **Step 2: Create the DTOs**

```ts
// apps/api/src/modules/sut-transfer/dto/export-sut.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsBoolean, IsUUID } from 'class-validator';

export class ExportSutDto {
  @ApiProperty({ type: [String], description: 'test_runs.id (uuid) values to include' })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  testRunIds!: string[];

  @ApiProperty({ default: true })
  @IsBoolean()
  includeOptional!: boolean;

  @ApiProperty({ default: false })
  @IsBoolean()
  includeRaw!: boolean;
}
```

```ts
// apps/api/src/modules/sut-transfer/dto/import-sut.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ImportSutDto {
  @ApiProperty({ description: 'Organization to attach all imported rows to' })
  @IsUUID()
  targetOrganizationId!: string;
}
```

- [ ] **Step 3: Create the module (controller/services added in later tasks)**

```ts
// apps/api/src/modules/sut-transfer/sut-transfer.module.ts
import { Module } from '@nestjs/common';

@Module({})
export class SutTransferModule {}
```

- [ ] **Step 4: Register in the app module**

Run: `grep -n "SystemsUnderTestModule" apps/api/src/app.module.ts`
Add `import { SutTransferModule } from './modules/sut-transfer/sut-transfer.module';` and add `SutTransferModule` to the `imports` array next to `SystemsUnderTestModule`.

- [ ] **Step 5: Type-check + boot**

Run: `cd apps/api && npm run type-check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/config/env.validation.ts apps/api/src/modules/sut-transfer apps/api/src/app.module.ts
git commit -m "feat(sut-transfer): env flag, module skeleton, request DTOs"
```

---

### Task 3: Export service + endpoint (streaming NDJSON.gz)

**Files:**
- Verify/install dep: `apps/api/package.json` — ensure `pg-query-stream` is present (TypeORM's `queryRunner.stream()` requires it)
- Create: `apps/api/src/modules/sut-transfer/sut-export.service.ts`
- Create: `apps/api/src/modules/sut-transfer/sut-transfer.controller.ts`
- Modify: `apps/api/src/modules/sut-transfer/sut-transfer.module.ts`
- Test: `apps/api/src/modules/sut-transfer/sut-export.service.spec.ts` (integration — real DataSource)

**Interfaces:**
- Consumes: `SUT_RESOURCES`, `selectResources`, `SutResource` (Task 1); `ExportSutDto` (Task 2)
- Produces:
  - `class SutExportService { export(sutId: string, opts: { testRunIds: string[]; includeOptional: boolean; includeRaw: boolean }): Promise<Readable> }` — resolves the gzip Readable immediately; rows stream asynchronously
  - `class SutTransferController` with `POST systems-under-test/:id/export`

- [ ] **Step 1: Ensure `pg-query-stream` is installed**

Run: `node -e "require.resolve('pg-query-stream')" && echo present || echo missing`
If missing:
```bash
cd apps/api && npm install pg-query-stream
```
Then from repo root commit the lockfile change with this task. (Per repo memory: add via `npm install`, never regenerate the whole lockfile.)

- [ ] **Step 2: Write the failing integration test**

```ts
// apps/api/src/modules/sut-transfer/sut-export.service.spec.ts
import { DataSource } from 'typeorm';
import { createGunzip } from 'zlib';
import * as readline from 'readline';
import { createTestApp, closeTestApp, IntegrationTestContext } from '../../../test/helpers/integration-test.helper';
import { SutExportService } from './sut-export.service';

describe('SutExportService (integration)', () => {
  let ctx: IntegrationTestContext;
  let dataSource: DataSource;
  let service: SutExportService;
  const sutId = '11111111-1111-1111-1111-111111111111';
  const runUuid = '22222222-2222-2222-2222-222222222222';
  const runKey = 'export-it-run-1';
  const orgId = '33333333-3333-3333-3333-333333333333';

  beforeAll(async () => {
    ctx = await createTestApp([], [], [SutExportService]);
    dataSource = ctx.dataSource;
    service = ctx.module.get(SutExportService);
    await dataSource.query(`INSERT INTO systems_under_test (id, name, organization_id) VALUES ($1,'export-it-sut',$2)`, [sutId, orgId]);
    await dataSource.query(`INSERT INTO test_runs (id, test_run_id, system_under_test_id, organization_id) VALUES ($1,$2,$3,$4)`, [runUuid, runKey, sutId, orgId]);
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM test_runs WHERE id = $1`, [runUuid]);
    await dataSource.query(`DELETE FROM systems_under_test WHERE id = $1`, [sutId]);
    await closeTestApp(ctx);
  });

  async function readBundle(stream: NodeJS.ReadableStream): Promise<{ manifest: any; rowsByTable: Record<string, any[]> }> {
    const rl = readline.createInterface({ input: (stream as any).pipe(createGunzip()) });
    let manifest: any = null;
    let current: string | null = null;
    const rowsByTable: Record<string, any[]> = {};
    for await (const line of rl) {
      if (!line.trim()) continue;
      const obj = JSON.parse(line);
      if (obj.__manifest__) { manifest = obj.__manifest__; continue; }
      if (obj.__table__) { current = obj.__table__ as string; rowsByTable[current] = []; continue; }
      if (obj.__summary__) continue;
      if (current) rowsByTable[current]!.push(obj);
    }
    return { manifest, rowsByTable };
  }

  it('streams the SUT and selected test run as NDJSON, manifest first', async () => {
    const stream = await service.export(sutId, { testRunIds: [runUuid], includeOptional: true, includeRaw: false });
    const { manifest, rowsByTable } = await readBundle(stream);
    expect(manifest.sourceSutId).toBe(sutId);
    expect(manifest.sutName).toBe('export-it-sut');
    expect(rowsByTable['systems_under_test']).toHaveLength(1);
    expect(rowsByTable['systems_under_test']![0].id).toBe(sutId);
    expect(rowsByTable['test_runs']).toHaveLength(1);
    expect(rowsByTable['test_runs']![0].test_run_id).toBe(runKey);
    expect(rowsByTable['requests_raw']).toBeUndefined(); // raw not requested
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/api && npx jest src/modules/sut-transfer/sut-export.service.spec.ts`
Expected: FAIL — cannot find `./sut-export.service`.
(Requires a reachable test DB per `apps/api/test/helpers/integration-test.helper.ts`.)

- [ ] **Step 4: Implement the export service**

```ts
// apps/api/src/modules/sut-transfer/sut-export.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createGzip } from 'zlib';
import { Readable } from 'stream';
import { selectResources, SutResource } from './sut-resource-graph';

interface ExportContext {
  sutId: string;
  testRunUuids: string[];
  testRunKeys: string[];
  appDashboardIds: string[];
}

@Injectable()
export class SutExportService {
  private readonly logger = new Logger(SutExportService.name);

  constructor(private readonly dataSource: DataSource) {}

  async export(
    sutId: string,
    opts: { testRunIds: string[]; includeOptional: boolean; includeRaw: boolean },
  ): Promise<Readable> {
    const sutRows: Array<{ name: string }> = await this.dataSource.query(
      `SELECT name FROM systems_under_test WHERE id = $1`,
      [sutId],
    );
    if (sutRows.length === 0) throw new NotFoundException(`SUT ${sutId} not found`);
    const sutName = sutRows[0]!.name;

    // Resolve + validate the selected runs belong to this SUT; grab both key flavors.
    const runRows: Array<{ id: string; test_run_id: string }> = await this.dataSource.query(
      `SELECT id, test_run_id FROM test_runs WHERE system_under_test_id = $1 AND id = ANY($2)`,
      [sutId, opts.testRunIds],
    );
    const appDashRows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM application_dashboards WHERE system_under_test_id = $1`,
      [sutId],
    );
    const ctx: ExportContext = {
      sutId,
      testRunUuids: runRows.map((r) => r.id),
      testRunKeys: runRows.map((r) => r.test_run_id),
      appDashboardIds: appDashRows.map((r) => r.id),
    };

    const gzip = createGzip();
    // Fire-and-forget writer; errors destroy the stream so the controller surfaces them.
    void this.writeBundle(gzip, sutName, ctx, opts).catch((err) => gzip.destroy(err as Error));
    return gzip;
  }

  private async writeBundle(
    sink: NodeJS.WritableStream,
    sutName: string,
    ctx: ExportContext,
    opts: { testRunIds: string[]; includeOptional: boolean; includeRaw: boolean },
  ): Promise<void> {
    const write = (obj: unknown): Promise<void> =>
      new Promise((resolve, reject) =>
        sink.write(JSON.stringify(obj) + '\n', (e) => (e ? reject(e) : resolve())),
      );

    await write({
      __manifest__: {
        schemaVersion: 1,
        appVersion: process.env.APP_VERSION ?? 'dev',
        sourceSutId: ctx.sutId,
        sutName,
        testRunIds: ctx.testRunUuids,
        includeOptional: opts.includeOptional,
        includeRaw: opts.includeRaw,
        exportedAt: new Date().toISOString(),
      },
    });

    const counts: Record<string, number> = {};
    for (const resource of selectResources(opts)) {
      const { sql, params } = this.buildQuery(resource, ctx);
      await write({ __table__: resource.table });
      const count = await this.streamRows(sink, sql, params, write);
      counts[resource.table] = count;
    }
    await write({ __summary__: { counts } });
    await new Promise<void>((resolve, reject) => sink.end((e?: Error) => (e ? reject(e) : resolve())));
  }

  private buildQuery(resource: SutResource, ctx: ExportContext): { sql: string; params: unknown[] } {
    switch (resource.filter) {
      case 'byReference':
        return { sql: resource.customSql!, params: [ctx.sutId] };
      case 'bySut':
        return {
          sql: `SELECT row_to_json(t) AS r FROM ${resource.table} t WHERE t.system_under_test_id = $1`,
          params: [ctx.sutId],
        };
      case 'byTestRunVarchar':
        return {
          sql: `SELECT row_to_json(t) AS r FROM ${resource.table} t WHERE t.test_run_id = ANY($1)`,
          params: [ctx.testRunKeys],
        };
      case 'byTestRunUuid':
        return {
          sql: `SELECT row_to_json(t) AS r FROM ${resource.table} t WHERE t.test_run_id = ANY($1)`,
          params: [ctx.testRunUuids],
        };
      case 'byAppDashboard':
        return {
          sql: `SELECT row_to_json(t) AS r FROM ${resource.table} t WHERE t.application_dashboard_id = ANY($1)`,
          params: [ctx.appDashboardIds],
        };
      case 'byTestEnvironment':
        // system_under_test_workloads has no system_under_test_id; it hangs off
        // test environments (grandchild). Filter via the SUT's environments.
        return {
          sql: `SELECT row_to_json(t) AS r FROM ${resource.table} t
                WHERE t.system_under_test_test_environment_id IN (
                  SELECT id FROM system_under_test_test_environments WHERE system_under_test_id = $1)`,
          params: [ctx.sutId],
        };
    }
  }

  private async streamRows(
    sink: NodeJS.WritableStream,
    sql: string,
    params: unknown[],
    write: (obj: unknown) => Promise<void>,
  ): Promise<number> {
    // Empty ANY([]) short-circuit: skip the query entirely.
    if (params.length === 1 && Array.isArray(params[0]) && params[0].length === 0) return 0;
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    let count = 0;
    try {
      // ponytail: pg-query-stream cursor keeps ds_metrics memory-bounded; swap to
      // Postgres COPY only if export of huge runs is measurably too slow.
      const stream = await qr.stream(sql, params as any[]);
      for await (const row of stream as AsyncIterable<{ r: unknown }>) {
        await write(row.r);
        count++;
      }
    } finally {
      await qr.release();
    }
    return count;
  }
}
```

- [ ] **Step 5: Add the controller + register providers**

```ts
// apps/api/src/modules/sut-transfer/sut-transfer.controller.ts
import { Body, Controller, ForbiddenException, Logger, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { AdminOnly } from '../../decorators/admin-only.decorator';
import { ExportSutDto } from './dto/export-sut.dto';
import { SutExportService } from './sut-export.service';

@ApiTags('sut-transfer')
@ApiBearerAuth()
@AdminOnly()
@Controller('systems-under-test')
export class SutTransferController {
  private readonly logger = new Logger(SutTransferController.name);

  constructor(
    private readonly exportService: SutExportService,
    private readonly config: ConfigService,
  ) {}

  private assertEnabled(): void {
    if (this.config.get<string>('SUT_TRANSFER_ENABLED', 'false') !== 'true') {
      throw new ForbiddenException('SUT transfer is disabled');
    }
  }

  @Post(':id/export')
  @ApiOperation({ summary: 'Export a SUT + selected test runs as a gzipped NDJSON bundle (admin, toggle-gated)' })
  async export(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExportSutDto,
    @Res() res: Response,
  ): Promise<void> {
    this.assertEnabled();
    const date = new Date().toISOString().slice(0, 10);
    const stream = await this.exportService.export(id, dto);
    const safeId = id.replace(/[^a-z0-9-]/gi, '');
    res.set({
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="sut-${safeId}-${date}.ndjson.gz"`,
    });
    stream.pipe(res);
    stream.on('error', (err) => {
      this.logger.error(`Export stream failed: ${err.message}`);
      if (!res.headersSent) res.status(500);
      res.destroy(err);
    });
  }
}
```

```ts
// apps/api/src/modules/sut-transfer/sut-transfer.module.ts
import { Module } from '@nestjs/common';
import { SutTransferController } from './sut-transfer.controller';
import { SutExportService } from './sut-export.service';

@Module({
  controllers: [SutTransferController],
  providers: [SutExportService],
})
export class SutTransferModule {}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/api && npx jest src/modules/sut-transfer/sut-export.service.spec.ts`
Expected: PASS.

- [ ] **Step 7: Type-check**

Run: `cd apps/api && npm run type-check`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/sut-transfer apps/api/package.json package-lock.json
git commit -m "feat(sut-transfer): streaming NDJSON.gz export service + endpoint"
```

---

### Task 4: Import service + endpoint (transactional, org remap)

**Files:**
- Create: `apps/api/src/modules/sut-transfer/sut-import.service.ts`
- Modify: `apps/api/src/modules/sut-transfer/sut-transfer.controller.ts` (add import endpoint)
- Modify: `apps/api/src/modules/sut-transfer/sut-transfer.module.ts` (add `SutImportService`)
- Test: `apps/api/src/modules/sut-transfer/sut-import.service.spec.ts` (integration)

**Interfaces:**
- Consumes: `SutExportService` (to produce a bundle in the test); `ImportSutDto` (Task 2)
- Produces:
  - `interface ImportSummary { sutId: string; sutName: string; rowCounts: Record<string, number> }`
  - `class SutImportService { import(fileBuffer: Buffer, targetOrganizationId: string): Promise<ImportSummary> }`
  - `POST systems-under-test/import` on the controller

- [ ] **Step 1: FK-discovery check (guards the shared-refs list)**

Run this against the dev DB to confirm no owned table FKs into a shared table missing from `SUT_RESOURCES` (currently pyroscope_instances, grafana_instances, grafana_dashboards):

```sql
SELECT conrelid::regclass AS from_table, confrelid::regclass AS references_table
FROM pg_constraint
WHERE contype = 'f'
  AND conrelid::regclass::text IN (
    'systems_under_test','metrics_sources','application_dashboards','benchmarks',
    'dynatrace_queries','dynatrace_entity_mappings')
  AND confrelid::regclass::text NOT IN (
    'systems_under_test','metrics_sources','application_dashboards','test_runs',
    'pyroscope_instances','grafana_instances','grafana_dashboards','teams','organizations');
```

If this returns rows (e.g. `metrics_sources → dynatrace_configs`), add each referenced table to `SUT_RESOURCES` as a `shared` `byReference` entry (with a `customSql` selecting the rows referenced by this SUT), and to the drift-guard `expected` list in `sut-resource-graph.spec.ts`. Commit that as part of this task.

- [ ] **Step 2: Write the failing integration test (export → import round-trip)**

```ts
// apps/api/src/modules/sut-transfer/sut-import.service.spec.ts
import { DataSource } from 'typeorm';
import { createTestApp, closeTestApp, IntegrationTestContext } from '../../../test/helpers/integration-test.helper';
import { SutExportService } from './sut-export.service';
import { SutImportService } from './sut-import.service';

describe('SutImportService (integration)', () => {
  let ctx: IntegrationTestContext;
  let dataSource: DataSource;
  let exportService: SutExportService;
  let importService: SutImportService;
  const sutId = '44444444-4444-4444-4444-444444444444';
  const runUuid = '55555555-5555-5555-5555-555555555555';
  const runKey = 'roundtrip-run-1';
  const srcOrg = '66666666-6666-6666-6666-666666666666';
  const targetOrg = '77777777-7777-7777-7777-777777777777';

  const streamToBuffer = (s: NodeJS.ReadableStream): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      s.on('data', (c) => chunks.push(Buffer.from(c)));
      s.on('end', () => resolve(Buffer.concat(chunks)));
      s.on('error', reject);
    });

  beforeAll(async () => {
    ctx = await createTestApp([], [], [SutExportService, SutImportService]);
    dataSource = ctx.dataSource;
    exportService = ctx.module.get(SutExportService);
    importService = ctx.module.get(SutImportService);
    await dataSource.query(`INSERT INTO systems_under_test (id, name, organization_id) VALUES ($1,'roundtrip-sut',$2)`, [sutId, srcOrg]);
    await dataSource.query(`INSERT INTO test_runs (id, test_run_id, system_under_test_id, organization_id) VALUES ($1,$2,$3,$4)`, [runUuid, runKey, sutId, srcOrg]);
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM test_runs WHERE id = $1`, [runUuid]);
    await dataSource.query(`DELETE FROM systems_under_test WHERE id = $1`, [sutId]);
    await closeTestApp(ctx);
  });

  it('round-trips a SUT and remaps organization_id to the target org', async () => {
    const stream = await exportService.export(sutId, { testRunIds: [runUuid], includeOptional: true, includeRaw: false });
    const bundle = await streamToBuffer(stream);

    // Simulate a clean dev DB: delete the source rows, then import.
    await dataSource.query(`DELETE FROM test_runs WHERE id = $1`, [runUuid]);
    await dataSource.query(`DELETE FROM systems_under_test WHERE id = $1`, [sutId]);

    const summary = await importService.import(bundle, targetOrg);
    expect(summary.sutId).toBe(sutId);
    expect(summary.rowCounts['test_runs']).toBe(1);

    const sut = await dataSource.query(`SELECT organization_id FROM systems_under_test WHERE id = $1`, [sutId]);
    expect(sut[0].organization_id).toBe(targetOrg); // remapped, not srcOrg
    const run = await dataSource.query(`SELECT test_run_id, organization_id FROM test_runs WHERE id = $1`, [runUuid]);
    expect(run[0].test_run_id).toBe(runKey); // key preserved
    expect(run[0].organization_id).toBe(targetOrg);
  });

  it('rejects import when the SUT already exists', async () => {
    const stream = await exportService.export(sutId, { testRunIds: [runUuid], includeOptional: false, includeRaw: false });
    const bundle = await streamToBuffer(stream);
    await expect(importService.import(bundle, targetOrg)).rejects.toThrow(/already exists/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/api && npx jest src/modules/sut-transfer/sut-import.service.spec.ts`
Expected: FAIL — cannot find `./sut-import.service`.

- [ ] **Step 4: Implement the import service**

```ts
// apps/api/src/modules/sut-transfer/sut-import.service.ts
import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { createGunzip } from 'zlib';
import { Readable } from 'stream';
import * as readline from 'readline';

export interface ImportSummary {
  sutId: string;
  sutName: string;
  rowCounts: Record<string, number>;
}

const BATCH_SIZE = 1000;

@Injectable()
export class SutImportService {
  private readonly logger = new Logger(SutImportService.name);

  constructor(private readonly dataSource: DataSource) {}

  async import(fileBuffer: Buffer, targetOrganizationId: string): Promise<ImportSummary> {
    const rl = readline.createInterface({
      input: Readable.from(fileBuffer).pipe(createGunzip()),
      crlfDelay: Infinity,
    });

    let manifest: { sourceSutId: string; sutName: string; schemaVersion: number } | null = null;
    const rowCounts: Record<string, number> = {};

    // Read the manifest first (line 1) so we can run the conflict check before writing.
    // We buffer per-table batches and flush inside a single transaction.
    const iterator = rl[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.done) throw new BadRequestException('Empty bundle');
    const firstObj = JSON.parse(first.value);
    if (!firstObj.__manifest__) throw new BadRequestException('Bundle missing manifest');
    manifest = firstObj.__manifest__;
    if (manifest!.schemaVersion !== 1) {
      throw new BadRequestException(`Unsupported bundle schemaVersion ${manifest!.schemaVersion}`);
    }

    const exists: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM systems_under_test WHERE id = $1`,
      [manifest!.sourceSutId],
    );
    if (exists.length > 0) {
      throw new ConflictException(`SUT ${manifest!.sourceSutId} already exists — delete it first`);
    }

    await this.dataSource.transaction(async (manager) => {
      let currentTable: string | null = null;
      let batch: Record<string, unknown>[] = [];

      const flush = async (): Promise<void> => {
        if (!currentTable || batch.length === 0) return;
        await this.insertBatch(manager, currentTable, batch, targetOrganizationId);
        rowCounts[currentTable] = (rowCounts[currentTable] ?? 0) + batch.length;
        batch = [];
      };

      for await (const line of { [Symbol.asyncIterator]: () => iterator }) {
        if (!line.trim()) continue;
        const obj = JSON.parse(line);
        if (obj.__table__) {
          await flush();
          currentTable = obj.__table__ as string;
          if (rowCounts[currentTable] === undefined) rowCounts[currentTable] = 0;
          continue;
        }
        if (obj.__summary__ || obj.__manifest__) continue;
        // Remap ownership on any row that carries these columns.
        if ('organization_id' in obj) obj.organization_id = targetOrganizationId;
        if ('team_id' in obj) obj.team_id = null;
        batch.push(obj);
        if (batch.length >= BATCH_SIZE) await flush();
      }
      await flush();
    });

    return { sutId: manifest!.sourceSutId, sutName: manifest!.sutName, rowCounts };
  }

  private async insertBatch(
    manager: EntityManager,
    table: string,
    rows: Record<string, unknown>[],
    _targetOrg: string,
  ): Promise<void> {
    // Postgres reconstructs each row (jsonb/array/timestamp types) from JSON.
    // Shared reference rows may already exist in dev → ON CONFLICT DO NOTHING.
    const isShared = SHARED_TABLES.has(table);
    const conflict = isShared ? 'ON CONFLICT DO NOTHING' : '';
    await manager.query(
      `INSERT INTO ${table} SELECT * FROM json_populate_recordset(null::${table}, $1::json) ${conflict}`,
      [JSON.stringify(rows)],
    );
  }
}

// Kept local (not derived from the descriptor import) to avoid a circular concern;
// mirror the group:'shared' entries in sut-resource-graph.ts.
const SHARED_TABLES = new Set<string>(['pyroscope_instances', 'grafana_instances', 'grafana_dashboards']);
```

> If Task 4 Step 1 added shared tables (e.g. `dynatrace_configs`), add them to `SHARED_TABLES` here too.

- [ ] **Step 5: Add the import endpoint to the controller**

Add to `SutTransferController` (imports: `Post`, `UploadedFile`, `UseInterceptors`, `Body` already present as needed; `FileInterceptor` from `@nestjs/platform-express`; `ApiConsumes` from swagger; `ImportSutDto`; `SutImportService`; inject `SutImportService` in the constructor):

```ts
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 500 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Import a SUT bundle into this environment (admin, toggle-gated)' })
  async import(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: ImportSutDto,
  ): Promise<import('./sut-import.service').ImportSummary> {
    this.assertEnabled();
    if (!file?.buffer) throw new BadRequestException('No file uploaded');
    return this.importService.import(file.buffer, dto.targetOrganizationId);
  }
```

Add `SutImportService` to `providers` in `sut-transfer.module.ts`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/api && npx jest src/modules/sut-transfer/`
Expected: PASS (descriptor unit + export + import specs).

- [ ] **Step 7: RLS check**

Run the RLS suite to confirm imports insert cleanly under the role-based policies (Phase 5b):

Run: `cd apps/api && DB_ENABLE_RLS_ROLE=true npx jest src/test/rls/`
Expected: PASS. If the import fails under RLS, the transaction must set the request org context to `targetOrganizationId` before inserting (see repo memory on `withRequestEm`/GUC plumbing) — wrap the transaction body accordingly and re-run.

- [ ] **Step 8: Type-check + commit**

Run: `cd apps/api && npm run type-check`

```bash
git add apps/api/src/modules/sut-transfer apps/api/src/modules/sut-transfer/sut-resource-graph.ts apps/api/src/modules/sut-transfer/sut-resource-graph.spec.ts
git commit -m "feat(sut-transfer): transactional import with org remap + round-trip test"
```

---

### Task 5: Frontend env flag plumbing + export dialog

**Files:**
- Modify: `apps/web/app/api/config/route.ts` (~line 39 — add key)
- Modify: `apps/web/lib/runtime-config.ts` (`RUNTIME_ENV_KEYS`, ~line 22)
- Modify: `apps/web/scripts/start-server.js` (`RUNTIME_ENV_KEYS`, ~line 27)
- Modify: `apps/web/lib/env.ts` (key union ~line 29, getter ~line 100, `Env` type ~line 110)
- Create: `apps/web/app/systems/[id]/config/components/ExportSystemDialog.tsx`
- Modify: `apps/web/app/systems/[id]/config/page.tsx` (add an "Export (admin)" button that opens the dialog, gated by `env.SUT_TRANSFER_ENABLED && isGlobalAdmin`)

**Interfaces:**
- Consumes: backend `POST /systems-under-test/:id/export`; `authenticatedFetch` from `@/lib/api`; `env.SUT_TRANSFER_ENABLED`
- Produces: `ExportSystemDialog` component `{ systemId: string; systemName: string; open: boolean; onClose: () => void }`

- [ ] **Step 1: Add the four env-plumbing entries**

`apps/web/app/api/config/route.ts` — add to the `config` object:
```ts
    NEXT_PUBLIC_SUT_TRANSFER_ENABLED: getEnvValue('SUT_TRANSFER_ENABLED', 'false'),
```
`apps/web/lib/runtime-config.ts` — add to `RUNTIME_ENV_KEYS`:
```ts
  'NEXT_PUBLIC_SUT_TRANSFER_ENABLED',
```
`apps/web/scripts/start-server.js` — add to its `RUNTIME_ENV_KEYS`:
```js
  'NEXT_PUBLIC_SUT_TRANSFER_ENABLED',
```
`apps/web/lib/env.ts` — add to the key union, add the getter, add the `Env` field:
```ts
    | 'NEXT_PUBLIC_SUT_TRANSFER_ENABLED',
```
```ts
  get SUT_TRANSFER_ENABLED(): boolean {
    return getEnvValue('NEXT_PUBLIC_SUT_TRANSFER_ENABLED', 'false') === 'true';
  },
```
```ts
  SUT_TRANSFER_ENABLED: boolean;
```

- [ ] **Step 2: Write the export dialog**

Model on `DeleteSystemDialog.tsx` (same directory). It fetches the SUT's test runs (reuse the `/test-runs?system=<name>` endpoint), shows a checklist, two group toggles, and an Export button that POSTs and triggers a browser download from the response blob.

```tsx
// apps/web/app/systems/[id]/config/components/ExportSystemDialog.tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { authenticatedFetch } from '@/lib/api';

interface TestRunRow { id: string; testRunId: string; }
interface Props { systemId: string; systemName: string; open: boolean; onClose: () => void; }

export function ExportSystemDialog({ systemId, systemName, open, onClose }: Props) {
  const [runs, setRuns] = useState<TestRunRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [includeOptional, setIncludeOptional] = useState(true);
  const [includeRaw, setIncludeRaw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const params = new URLSearchParams({ page: '1', pageSize: '200', system: systemName, sortBy: 'createdAt', sortOrder: 'DESC' });
      const res = await authenticatedFetch(`/test-runs?${params.toString()}`, { method: 'GET' });
      const data = await res.json();
      const rows: TestRunRow[] = (data.data ?? data.items ?? data).map((r: any) => ({ id: r.id, testRunId: r.testRunId ?? r.test_run_id }));
      setRuns(rows);
    })();
  }, [open, systemName]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }, []);

  const doExport = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const res = await authenticatedFetch(`/systems-under-test/${systemId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testRunIds: [...selected], includeOptional, includeRaw }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? res.statusText);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sut-${systemId}-${new Date().toISOString().slice(0, 10)}.ndjson.gz`;
      a.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  }, [systemId, selected, includeOptional, includeRaw, onClose]);

  if (!open) return null;
  return (
    <div role="dialog" aria-label="Export system under test">
      <h2>Export “{systemName}”</h2>
      <p>Select test runs to include:</p>
      <ul>
        {runs.map((r) => (
          <li key={r.id}>
            <label>
              <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
              {r.testRunId}
            </label>
          </li>
        ))}
      </ul>
      <label><input type="checkbox" checked={includeOptional} onChange={(e) => setIncludeOptional(e.target.checked)} /> Include optional resources (events, deep links, dynatrace, presets…)</label>
      <label><input type="checkbox" checked={includeRaw} onChange={(e) => setIncludeRaw(e.target.checked)} /> Include raw sample data (large: requests, transactions, virtual users)</label>
      {error && <p role="alert">{error}</p>}
      <button onClick={onClose} disabled={busy}>Cancel</button>
      <button onClick={doExport} disabled={busy || selected.size === 0}>{busy ? 'Exporting…' : 'Export'}</button>
    </div>
  );
}
```

> Style this to match the existing config-page dialogs (MUI/Radix as used in `DeleteSystemDialog.tsx`) — the markup above is functional scaffolding; apply the sibling dialog's component library and classes when integrating.

- [ ] **Step 3: Wire the button into the config page**

In `apps/web/app/systems/[id]/config/page.tsx`, add state `const [exportOpen, setExportOpen] = useState(false);`, render `{env.SUT_TRANSFER_ENABLED && isGlobalAdmin && <button onClick={() => setExportOpen(true)}>Export (admin)</button>}` near the existing Delete action, and render `<ExportSystemDialog systemId={id} systemName={systemName} open={exportOpen} onClose={() => setExportOpen(false)} />`. Use the page's existing admin/role check (same source the Delete action uses; import `env` from `@/lib/env`).

- [ ] **Step 4: Type-check + lint**

Run: `cd apps/web && npm run type-check && npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/config/route.ts apps/web/lib/runtime-config.ts apps/web/scripts/start-server.js apps/web/lib/env.ts apps/web/app/systems/[id]/config
git commit -m "feat(sut-transfer): frontend env flag + SUT export dialog"
```

---

### Task 6: Frontend import page + nav gating

**Files:**
- Create: `apps/web/app/admin/sut-import/page.tsx`
- Modify: `apps/web/components/layout/sidebar.tsx` (add a nav item gated by `env.SUT_TRANSFER_ENABLED && isGlobalAdmin`, ~line 108 pattern)

**Interfaces:**
- Consumes: backend `POST /systems-under-test/import`; `useOrganizations()` from `@/lib/hooks/use-organizations`; `authenticatedFetch`

- [ ] **Step 1: Write the import page**

```tsx
// apps/web/app/admin/sut-import/page.tsx
'use client';
import { useState } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { useOrganizations } from '@/lib/hooks/use-organizations';

export default function SutImportPage() {
  const { data: orgs = [] } = useOrganizations();
  const [file, setFile] = useState<File | null>(null);
  const [targetOrg, setTargetOrg] = useState('');
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<{ sutName: string; rowCounts: Record<string, number> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doImport = async () => {
    if (!file || !targetOrg) return;
    setBusy(true); setError(null); setSummary(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('targetOrganizationId', targetOrg);
      const res = await authenticatedFetch('/systems-under-test/import', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? res.statusText);
      setSummary(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main>
      <h1>Import System Under Test</h1>
      <input type="file" accept=".gz,.ndjson.gz" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <select value={targetOrg} onChange={(e) => setTargetOrg(e.target.value)}>
        <option value="">Select target organization…</option>
        {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <button onClick={doImport} disabled={busy || !file || !targetOrg}>{busy ? 'Importing…' : 'Import'}</button>
      {error && <p role="alert">{error}</p>}
      {summary && (
        <div>
          <p>Imported “{summary.sutName}”.</p>
          <ul>{Object.entries(summary.rowCounts).map(([t, n]) => <li key={t}>{t}: {n}</li>)}</ul>
        </div>
      )}
    </main>
  );
}
```

> Apply the app's page layout/components (as other `app/admin/*` or `app/settings/*` pages do) when integrating — the markup above is functional scaffolding.

- [ ] **Step 2: Add the nav item**

In `apps/web/components/layout/sidebar.tsx`, mirror the log-viewer gating (~line 107):
```tsx
  // SUT Import — admin-only, feature-flagged (NEXT_PUBLIC_SUT_TRANSFER_ENABLED).
  ...(env.SUT_TRANSFER_ENABLED && isGlobalAdmin ? [{ label: 'SUT Import', href: '/admin/sut-import', icon: /* reuse an existing icon */ }] : []),
```
(Match the exact nav-item shape used by neighboring entries in this file.)

- [ ] **Step 3: Type-check + lint**

Run: `cd apps/web && npm run type-check && npm run lint`
Expected: no errors.

- [ ] **Step 4: Manual smoke test (real app)**

With `SUT_TRANSFER_ENABLED=true` / `NEXT_PUBLIC_SUT_TRANSFER_ENABLED=true` and logged in as perfana-admin:
1. Open a SUT config page → Export (admin) → select a run → Export → a `.ndjson.gz` downloads.
2. Go to /admin/sut-import → pick the file + a target org → Import → summary shows row counts.
3. Confirm the imported SUT appears under the target org.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/admin/sut-import apps/web/components/layout/sidebar.tsx
git commit -m "feat(sut-transfer): SUT import page + admin nav item"
```

---

### Task 7: Docs + version bump + PR

**Files:**
- Modify: `CLAUDE.md` (Environment Configuration → add `SUT_TRANSFER_ENABLED` / `NEXT_PUBLIC_SUT_TRANSFER_ENABLED` like the `LOG_VIEWER_ENABLED` entries, noting it exports production data incl. integration connection rows)
- Modify: `VERSION` (patch bump from current `0.2.61.44`)

- [ ] **Step 1: Document the env flags**

Add to CLAUDE.md's backend + frontend env var lists, mirroring the `LOG_VIEWER_ENABLED` wording, with the security note (admin-only, off by default, exports production data including grafana/dynatrace connection rows).

- [ ] **Step 2: Bump VERSION**

Set `VERSION` to `0.2.61.45`.

- [ ] **Step 3: Full preflight**

Run: `npm run preflight`
Expected: lint + type-check pass; RLS suite passes.

- [ ] **Step 4: Commit + push + PR**

```bash
git add CLAUDE.md VERSION
git commit -m "docs: SUT_TRANSFER_ENABLED env flags + v0.2.61.45"
git push -u origin feat/sut-export-import
gh pr create --fill --base main
```

---

## Self-Review Notes

- **Spec coverage:** descriptor+reuse (T1), gzip-NDJSON format (T3), group toggles (T1 selectResources + T5 UI), preserve-IDs + org remap (T4), fail-on-existing-SUT (T4), shared refs (T1 + T4 FK-discovery), env-flag + admin gate (T2/T3/T5/T6), export endpoint (T3), import endpoint (T4), export dialog (T5), import page (T6), round-trip integration test (T4), ordering unit test (T1), RLS validation (T4 S7), ds_metrics streaming/compression (T3 cursor), secrets note (T7). All spec sections mapped.
- **Type consistency:** `SutExportService.export(sutId, {testRunIds, includeOptional, includeRaw})` and `SutImportService.import(fileBuffer, targetOrganizationId)` are used identically in controller and specs. `ImportSummary` shape (`sutId`, `sutName`, `rowCounts`) matches T6 UI consumption. `selectResources` signature matches T1 test and T3 usage.
- **Known deferrals:** `pg-query-stream` dependency (T3 S1) is the one new dep, justified for memory-bounded streaming. Shared-table completeness depends on the T4 S1 FK-discovery check — the round-trip test is the guard.
