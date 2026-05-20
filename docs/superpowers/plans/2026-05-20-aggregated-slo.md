# Aggregated Test SLO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Aggregated Test SLO" type that checks a single metric (transaction p95, request avg, error %) aggregated across all data in a test run, with pass/fail stored in `check_results` alongside existing SLOs.

**Architecture:** New `benchmark_type = 'aggregated'` with two new nullable columns (`aggregate_metric`, `aggregate_stat`) on the `benchmarks` table. Evaluation runs inside the existing `ChecksPipeline` via a new `AggregatedBenchmarkEvaluator`. Frontend adds a new `AggregatedSloDialog` reached from the Performance Analysis menu and the SUT config SLO tab dropdown.

**Tech Stack:** TypeORM (entity + migration), NestJS (controller/service), Vitest (worker tests), Jest (API + web tests), MUI (dialog), Next.js App Router.

---

## File Map

| File | Change |
|---|---|
| `packages/shared/src/entities/benchmark.entity.ts` | New types + 2 columns + auditableFields |
| `packages/shared/src/database/migrations/<ts>-AddAggregatedBenchmarkColumns.ts` | Generated migration |
| `apps/api/src/modules/benchmarks/services/benchmark-mutation.types.ts` | Add `CreateAggregatedSloDto`, `UpdateAggregatedSloDto` |
| `apps/api/src/modules/benchmarks/services/benchmark-mutation.service.ts` | Add `createAggregatedSlo`, `updateAggregatedSlo` |
| `apps/api/src/modules/benchmarks/benchmarks.service.ts` | Delegate to new mutation methods |
| `apps/api/src/modules/benchmarks/benchmarks.controller.ts` | Add `POST /aggregated`, `PUT /aggregated/:id`; extend enum |
| `apps/api/src/modules/benchmarks/benchmarks.service.spec.ts` | Tests for new delegation |
| `apps/worker/src/pipelines/checks/BenchmarkMatcher.ts` | Extend `BenchmarkType`, `Benchmark` interface, SQL, validity check |
| `apps/worker/src/pipelines/checks/AggregatedBenchmarkEvaluator.ts` | **New file** — evaluator |
| `apps/worker/src/pipelines/ChecksPipeline.ts` | Add `aggregated` branch + `saveAggregatedCheckResult` |
| `apps/web/app/test-runs/[id]/components/performance-analysis/AggregatedSloDialog.tsx` | **New file** — dialog |
| `apps/web/app/test-runs/[id]/components/performance-analysis/components/PerformanceAnalysisMenus.tsx` | Add "Set SLO" item |
| `apps/web/app/test-runs/[id]/components/performance-analysis/components/PerformanceAnalysisDialogs.tsx` | Mount `AggregatedSloDialog` |
| `apps/web/app/test-runs/[id]/components/performance-analysis/PerformanceAnalysisCard.tsx` | Wire state |
| `apps/web/app/systems/[id]/config/components/SLOTable.tsx` | Add Type column |
| `apps/web/app/systems/[id]/config/components/SLOSection.tsx` | Dropdown button + new prop |
| `apps/web/app/systems/[id]/config/page.tsx` | Wire new dialog open/close/submit |

---

## Task 1: Extend the Benchmark entity

**Files:**
- Modify: `packages/shared/src/entities/benchmark.entity.ts`

- [ ] **Step 1: Add the new types and columns**

Open `packages/shared/src/entities/benchmark.entity.ts`. Make these three changes:

**a) Extend the `BenchmarkType` union (line ~11):**
```typescript
export type BenchmarkType = 'metric' | 'apdex' | 'aggregated';
```

**b) Add the two new type exports after `BenchmarkType`:**
```typescript
export type AggregateMetric =
  | 'transaction_response_time'
  | 'request_response_time'
  | 'error_percentage';

export type AggregateStat = 'avg' | 'p50' | 'p90' | 'p95' | 'p99' | 'max';
```

**c) Add `aggregate_metric` and `aggregate_stat` to `auditableFields` array** (after `'min_apdex_score'`):
```typescript
'aggregate_metric',
'aggregate_stat',
```

**d) Add two new column declarations** after the `include_failed_requests` column (~line 216):
```typescript
/**
 * Which aggregated metric this benchmark checks.
 * Only set when benchmark_type = 'aggregated'.
 */
@Column({ type: 'varchar', length: 50, nullable: true })
aggregate_metric?: AggregateMetric;

/**
 * Statistical function to apply to response time metrics.
 * Null for error_percentage (no stat applies).
 * Only set when benchmark_type = 'aggregated'.
 */
@Column({ type: 'varchar', length: 20, nullable: true })
aggregate_stat?: AggregateStat;
```

- [ ] **Step 2: Type-check the shared package**

```bash
cd /Users/daniel/workspace/perfana && npx turbo run type-check --filter=@perfana/shared
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/entities/benchmark.entity.ts
git commit -m "feat(aggregated-slo): add AggregateMetric/AggregateStat types and columns to Benchmark entity"
```

---

## Task 2: Generate and apply the DB migration

**Files:**
- Create: `packages/shared/src/database/migrations/<timestamp>-AddAggregatedBenchmarkColumns.ts`

- [ ] **Step 1: Generate the migration**

```bash
cd /Users/daniel/workspace/perfana && npm run migration:generate -- src/database/migrations/AddAggregatedBenchmarkColumns
```

A new file will appear in `packages/shared/src/database/migrations/`. Open it and verify the `up` method contains:

```sql
ALTER TABLE "benchmarks" ADD "aggregate_metric" character varying(50)
ALTER TABLE "benchmarks" ADD "aggregate_stat" character varying(20)
```

- [ ] **Step 2: Apply via docker psql (migration:run is broken — use this instead)**

```bash
MIGRATION_FILE=$(ls packages/shared/src/database/migrations/*AddAggregatedBenchmarkColumns* | head -1)
echo "Applying: $MIGRATION_FILE"
docker exec -i $(docker ps -qf "name=postgres") psql -U perfana -d perfana -c \
  "ALTER TABLE benchmarks ADD COLUMN IF NOT EXISTS aggregate_metric VARCHAR(50); \
   ALTER TABLE benchmarks ADD COLUMN IF NOT EXISTS aggregate_stat VARCHAR(20);"
```

- [ ] **Step 3: Verify columns exist**

```bash
docker exec -i $(docker ps -qf "name=postgres") psql -U perfana -d perfana -c \
  "\d benchmarks" | grep aggregate
```

Expected output includes `aggregate_metric` and `aggregate_stat`.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/database/migrations/
git commit -m "feat(aggregated-slo): migration to add aggregate_metric and aggregate_stat columns"
```

---

## Task 3: API — DTOs

**Files:**
- Modify: `apps/api/src/modules/benchmarks/services/benchmark-mutation.types.ts`

- [ ] **Step 1: Add the two new DTOs** at the end of the file:

```typescript
/**
 * DTO for creating an Aggregated SLO benchmark
 */
export interface CreateAggregatedSloDto {
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
  aggregateMetric: AggregateMetric;
  aggregateStat?: AggregateStat;  // required when aggregateMetric !== 'error_percentage'
  requirementOperator: string;    // default '<=', can be '<', '>', '>='
  requirementValue: number;       // ms for response times, % for error_percentage
  excludeRampUpTime?: boolean;    // default true
  description?: string;
  tags?: string[];
}

/**
 * DTO for updating an Aggregated SLO benchmark
 */
export interface UpdateAggregatedSloDto {
  aggregateStat?: AggregateStat;
  requirementOperator?: string;
  requirementValue?: number;
  excludeRampUpTime?: boolean;
  enabled?: boolean;
  description?: string;
  tags?: string[];
}
```

The `benchmark-mutation.types.ts` file has no imports currently — keep it that way and inline the types directly in the DTOs (do NOT add an import from `@perfana/shared`; those types aren't re-exported from the shared index).

- [ ] **Step 2: Type-check**

```bash
cd /Users/daniel/workspace/perfana && npx turbo run type-check --filter=@perfana/api
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/benchmarks/services/benchmark-mutation.types.ts
git commit -m "feat(aggregated-slo): add CreateAggregatedSloDto and UpdateAggregatedSloDto"
```

---

## Task 4: API — mutation service methods

**Files:**
- Modify: `apps/api/src/modules/benchmarks/services/benchmark-mutation.service.ts`
- Modify: `apps/api/src/modules/benchmarks/benchmarks.service.ts`

- [ ] **Step 1: Write failing tests** in `apps/api/src/modules/benchmarks/benchmarks.service.spec.ts`

Add these tests inside the existing describe block (find the apdex section and add after it):

```typescript
describe('createAggregatedSlo', () => {
  it('creates a benchmark with benchmark_type aggregated', async () => {
    const mockSystem = { organization_id: 'org-1', team_id: undefined };
    jest.spyOn(service as any, 'findAll').mockResolvedValue([]);
    // Use the real mutation service via the test module — or mock it:
    const createSpy = jest.spyOn((service as any).mutationService, 'createAggregatedSlo')
      .mockResolvedValue({ id: 'bench-1', benchmark_type: 'aggregated' });

    const result = await service.createAggregatedSlo('user-1', ['user'], {
      systemUnderTestId: 'sut-1',
      testEnvironment: 'staging',
      workload: 'baseline',
      aggregateMetric: 'transaction_response_time',
      aggregateStat: 'p95',
      requirementOperator: '<=',
      requirementValue: 2000,
      excludeRampUpTime: true,
    });

    expect(createSpy).toHaveBeenCalledWith('user-1', ['user'], expect.objectContaining({
      aggregateMetric: 'transaction_response_time',
      aggregateStat: 'p95',
      requirementValue: 2000,
    }));
    expect(result).toMatchObject({ benchmark_type: 'aggregated' });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /Users/daniel/workspace/perfana/apps/api && npx jest --testPathPattern="benchmarks.service.spec" --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `service.createAggregatedSlo is not a function`.

- [ ] **Step 3: Add `createAggregatedSlo` to the mutation service**

In `apps/api/src/modules/benchmarks/services/benchmark-mutation.service.ts`, add after `updateApdexSlo`:

```typescript
async createAggregatedSlo(userId: string, roles: string[], dto: CreateAggregatedSloDto): Promise<Benchmark> {
  try {
    if (dto.aggregateMetric !== 'error_percentage' && !dto.aggregateStat) {
      throw new Error('aggregateStat is required for response time metrics');
    }

    const system = await this.validateSystemAccess(dto.systemUnderTestId, userId, roles);

    const label = dto.aggregateMetric === 'error_percentage'
      ? 'Aggregated Error Percentage'
      : `Aggregated ${dto.aggregateMetric === 'transaction_response_time' ? 'Transaction' : 'Request'} Response Times (${dto.aggregateStat})`;

    const benchmark = this.benchmarkRepo.create({
      system_under_test_id: dto.systemUnderTestId,
      test_environment: dto.testEnvironment,
      workload: dto.workload,
      source: 'custom',
      benchmark_type: 'aggregated',
      aggregate_metric: dto.aggregateMetric,
      aggregate_stat: dto.aggregateStat,
      requirement_operator: dto.requirementOperator,
      requirement_value: dto.requirementValue,
      exclude_ramp_up_time: dto.excludeRampUpTime ?? true,
      description: dto.description || '',
      tags: dto.tags || [],
      enabled: true,
      valid: true,
      panel_title: label,
      config_title: label,
      configuration: { type: 'aggregated', title: label },
      metadata: {},
      organizationId: system.organization_id,
      teamId: system.team_id,
      created_by: userId,
      updated_by: userId,
    });

    const result = await withRequestEm(this.benchmarkRepo).save(benchmark);

    this.auditService.logCreate(result as unknown as OwnedResource, {
      organizationIdOverride: result.organizationId,
    });

    this.logger.log(`Created Aggregated SLO: ${label}`);
    return BenchmarkMapper.mapEntityToBenchmark(result);
  } catch (error) {
    this.logger.error('Failed to create Aggregated SLO:', error);
    throw error;
  }
}

async updateAggregatedSlo(id: string, userId: string, roles: string[], dto: UpdateAggregatedSloDto): Promise<Benchmark> {
  try {
    const existing = await this.findBenchmarkForUpdate(id, userId, roles);
    if (existing.benchmark_type !== 'aggregated') {
      throw new Error('Benchmark is not an aggregated SLO');
    }

    const updates: Partial<typeof existing> = { updated_by: userId };
    if (dto.aggregateStat !== undefined) updates.aggregate_stat = dto.aggregateStat;
    if (dto.requirementOperator !== undefined) updates.requirement_operator = dto.requirementOperator;
    if (dto.requirementValue !== undefined) updates.requirement_value = dto.requirementValue;
    if (dto.excludeRampUpTime !== undefined) updates.exclude_ramp_up_time = dto.excludeRampUpTime;
    if (dto.enabled !== undefined) updates.enabled = dto.enabled;
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.tags !== undefined) updates.tags = dto.tags;

    const updated = await withRequestEm(this.benchmarkRepo).save({ ...existing, ...updates });

    this.auditService.logUpdate(existing as unknown as OwnedResource, updated as unknown as OwnedResource, {
      organizationIdOverride: existing.organizationId,
    });

    this.logger.log(`Updated Aggregated SLO ${id}`);
    return BenchmarkMapper.mapEntityToBenchmark(updated);
  } catch (error) {
    this.logger.error('Failed to update Aggregated SLO:', error);
    throw error;
  }
}
```

Also add the imports at the top of the mutation service file (alongside existing imports):
```typescript
import type { CreateAggregatedSloDto, UpdateAggregatedSloDto } from './benchmark-mutation.types';
```

- [ ] **Step 4: Add delegation in `benchmarks.service.ts`**

In `apps/api/src/modules/benchmarks/benchmarks.service.ts`, add after `updateApdexSlo`:

```typescript
async createAggregatedSlo(userId: string, roles: string[], dto: CreateAggregatedSloDto): Promise<Benchmark> {
  return this.mutationService.createAggregatedSlo(userId, roles, dto);
}

async updateAggregatedSlo(id: string, userId: string, roles: string[], dto: UpdateAggregatedSloDto): Promise<Benchmark> {
  return this.mutationService.updateAggregatedSlo(id, userId, roles, dto);
}
```

Also add the imports at the top of `benchmarks.service.ts`:
```typescript
import type { CreateAggregatedSloDto, UpdateAggregatedSloDto } from './services/benchmark-mutation.types';
```

- [ ] **Step 5: Run tests**

```bash
cd /Users/daniel/workspace/perfana/apps/api && npx jest --testPathPattern="benchmarks.service.spec" --no-coverage 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 6: Type-check**

```bash
cd /Users/daniel/workspace/perfana && npx turbo run type-check --filter=@perfana/api
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/benchmarks/services/benchmark-mutation.service.ts \
        apps/api/src/modules/benchmarks/benchmarks.service.ts \
        apps/api/src/modules/benchmarks/benchmarks.service.spec.ts
git commit -m "feat(aggregated-slo): add createAggregatedSlo/updateAggregatedSlo to mutation service"
```

---

## Task 5: API — controller routes

**Files:**
- Modify: `apps/api/src/modules/benchmarks/benchmarks.controller.ts`

- [ ] **Step 1: Update the `benchmarkType` enum in `@ApiQuery`**

Find the `@ApiQuery({ name: 'benchmarkType' ... })` decorator on `findAll` and update the enum:

```typescript
@ApiQuery({ name: 'benchmarkType', required: false, enum: ['metric', 'apdex', 'aggregated'], description: 'Filter by benchmark type' })
```

- [ ] **Step 2: Add the two new routes** after the `@Put('apdex/:id')` block:

```typescript
@Post('aggregated')
@ApiOperation({ summary: 'Create a new Aggregated Test SLO' })
@ApiResponse({ status: 201, description: 'Aggregated SLO created successfully' })
@ApiResponse({ status: 400, description: 'Invalid input data' })
async createAggregatedSlo(
  @UserCtx() ctx: UserContext,
  @Body() dto: {
    systemUnderTestId: string;
    testEnvironment: string;
    workload: string;
    aggregateMetric: string;
    aggregateStat?: string;
    requirementOperator: string;
    requirementValue: number;
    excludeRampUpTime?: boolean;
    description?: string;
    tags?: string[];
  },
) {
  try {
    return await this.benchmarksService.createAggregatedSlo(ctx.userId, ctx.roles, dto as CreateAggregatedSloDto);
  } catch (error) {
    this.logger.error('Failed to create Aggregated SLO:', error);
    if (error instanceof HttpException) throw error;
    throw new HttpException('Failed to create Aggregated SLO', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}

@Put('aggregated/:id')
@ApiOperation({ summary: 'Update an existing Aggregated Test SLO' })
@ApiResponse({ status: 200, description: 'Aggregated SLO updated successfully' })
@ApiResponse({ status: 404, description: 'SLO not found' })
async updateAggregatedSlo(
  @Param('id') id: string,
  @UserCtx() ctx: UserContext,
  @Body() dto: {
    aggregateStat?: string;
    requirementOperator?: string;
    requirementValue?: number;
    excludeRampUpTime?: boolean;
    enabled?: boolean;
    description?: string;
    tags?: string[];
  },
) {
  try {
    const result = await this.benchmarksService.updateAggregatedSlo(id, ctx.userId, ctx.roles, dto as UpdateAggregatedSloDto);
    if (!result) throw new HttpException('SLO not found', HttpStatus.NOT_FOUND);
    return result;
  } catch (error) {
    this.logger.error('Failed to update Aggregated SLO:', error);
    if (error instanceof HttpException) throw error;
    throw new HttpException('Failed to update Aggregated SLO', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
```

Add to the imports at the top of the controller:
```typescript
import type { CreateAggregatedSloDto, UpdateAggregatedSloDto } from './services/benchmark-mutation.types';
```

- [ ] **Step 3: Type-check and test**

```bash
cd /Users/daniel/workspace/perfana && npx turbo run type-check --filter=@perfana/api
cd /Users/daniel/workspace/perfana/apps/api && npx jest --testPathPattern="benchmarks.controller.spec" --no-coverage 2>&1 | tail -20
```

Expected: no type errors, tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/benchmarks/benchmarks.controller.ts
git commit -m "feat(aggregated-slo): add POST /benchmarks/aggregated and PUT /benchmarks/aggregated/:id routes"
```

---

## Task 6: Worker — extend BenchmarkMatcher

**Files:**
- Modify: `apps/worker/src/pipelines/checks/BenchmarkMatcher.ts`

- [ ] **Step 1: Extend `BenchmarkType` and `Benchmark` interface**

**a) Change `BenchmarkType` (line ~16):**
```typescript
export type BenchmarkType = 'metric' | 'apdex' | 'aggregated';
```

**b) Add fields to `Benchmark` interface** after `include_failed_requests`:
```typescript
// Aggregated SLO fields
aggregate_metric?: string;
aggregate_stat?: string;
```

- [ ] **Step 2: Update SQL query** to select the new columns. In the `benchmarksSql` string, add after `COALESCE(include_failed_requests, false) as include_failed_requests`:

```sql
        aggregate_metric,
        aggregate_stat
```

- [ ] **Step 3: Update the WHERE clause** to include aggregated benchmarks. Find:

```typescript
`(
  (COALESCE(benchmark_type, 'metric') = 'metric' AND (requirement_operator IS NOT NULL OR requirement_value IS NOT NULL))
  OR
  (benchmark_type = 'apdex' AND min_apdex_score IS NOT NULL)
)`
```

Replace with:

```typescript
`(
  (COALESCE(benchmark_type, 'metric') = 'metric' AND (requirement_operator IS NOT NULL OR requirement_value IS NOT NULL))
  OR
  (benchmark_type = 'apdex' AND min_apdex_score IS NOT NULL)
  OR
  (benchmark_type = 'aggregated' AND aggregate_metric IS NOT NULL AND requirement_value IS NOT NULL)
)`
```

- [ ] **Step 4: Update row mapping** in the `.map()` call after the `include_failed_requests` entry:

```typescript
aggregate_metric: row.aggregate_metric as string | undefined,
aggregate_stat: row.aggregate_stat as string | undefined,
```

- [ ] **Step 5: Update `isBenchmarkValid`** to accept aggregated type. Find the `isBenchmarkValid` method and add the aggregated check:

```typescript
if (benchmark.benchmark_type === 'aggregated') {
  return !!(benchmark.aggregate_metric && benchmark.requirement_value !== undefined);
}
```

(Add this before the existing `if (benchmark.benchmark_type === 'apdex')` block or alongside it.)

- [ ] **Step 6: Type-check**

```bash
cd /Users/daniel/workspace/perfana && npx turbo run type-check --filter=@perfana/worker
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/pipelines/checks/BenchmarkMatcher.ts
git commit -m "feat(aggregated-slo): extend BenchmarkMatcher to support aggregated benchmark type"
```

---

## Task 7: Worker — AggregatedBenchmarkEvaluator

**Files:**
- Create: `apps/worker/src/pipelines/checks/AggregatedBenchmarkEvaluator.ts`
- Create: `apps/worker/src/test/unit/pipelines/AggregatedBenchmarkEvaluator.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/worker/src/test/unit/pipelines/AggregatedBenchmarkEvaluator.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { EntityManager } from 'typeorm';
import pino from 'pino';
import { AggregatedBenchmarkEvaluator, AggregatedBenchmark } from '../../../pipelines/checks/AggregatedBenchmarkEvaluator.js';
import { TestRun } from '../../../pipelines/checks/BenchmarkMatcher.js';

const logger = pino({ level: 'silent' });

const makeManager = (queryResult: unknown[]) =>
  ({ query: vi.fn().mockResolvedValue(queryResult) }) as unknown as EntityManager;

const testRun: TestRun = {
  test_run_id: 'tr-1',
  system_under_test_id: 'sut-1',
  test_environment: 'staging',
  workload: 'baseline',
  ramp_up: 60,
};

const baseBenchmark: AggregatedBenchmark = {
  id: 'b-1',
  aggregate_metric: 'transaction_response_time',
  aggregate_stat: 'p95',
  requirement_operator: '<=',
  requirement_value: 2000,
  exclude_ramp_up_time: true,
};

describe('AggregatedBenchmarkEvaluator', () => {
  it('returns PASS when p95 is under threshold', async () => {
    const manager = makeManager([{ result: '1500' }]);
    const evaluator = new AggregatedBenchmarkEvaluator(logger, manager);
    const result = await evaluator.evaluate(testRun, baseBenchmark);
    expect(result.meets_requirement).toBe(true);
    expect(result.actual_value).toBe(1500);
    expect(result.status).toBe('COMPLETE');
  });

  it('returns FAIL when p95 exceeds threshold', async () => {
    const manager = makeManager([{ result: '2500' }]);
    const evaluator = new AggregatedBenchmarkEvaluator(logger, manager);
    const result = await evaluator.evaluate(testRun, baseBenchmark);
    expect(result.meets_requirement).toBe(false);
    expect(result.actual_value).toBe(2500);
  });

  it('returns NO_DATA when query returns null', async () => {
    const manager = makeManager([{ result: null }]);
    const evaluator = new AggregatedBenchmarkEvaluator(logger, manager);
    const result = await evaluator.evaluate(testRun, baseBenchmark);
    expect(result.status).toBe('NO_DATA');
    expect(result.meets_requirement).toBeNull();
  });

  it('evaluates error_percentage without aggregate_stat', async () => {
    const manager = makeManager([{ result: '0.5' }]);
    const evaluator = new AggregatedBenchmarkEvaluator(logger, manager);
    const errBenchmark: AggregatedBenchmark = {
      ...baseBenchmark,
      aggregate_metric: 'error_percentage',
      aggregate_stat: undefined,
      requirement_value: 1,
    };
    const result = await evaluator.evaluate(testRun, errBenchmark);
    expect(result.meets_requirement).toBe(true);  // 0.5 <= 1
    expect(result.actual_value).toBe(0.5);
  });

  it('applies >= operator correctly', async () => {
    const manager = makeManager([{ result: '1800' }]);
    const evaluator = new AggregatedBenchmarkEvaluator(logger, manager);
    const result = await evaluator.evaluate(testRun, {
      ...baseBenchmark,
      requirement_operator: '>=',
      requirement_value: 2000,
    });
    expect(result.meets_requirement).toBe(false);  // 1800 is not >= 2000
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /Users/daniel/workspace/perfana/apps/worker && npx vitest run src/test/unit/pipelines/AggregatedBenchmarkEvaluator.test.ts 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module`.

- [ ] **Step 3: Create `AggregatedBenchmarkEvaluator.ts`**

Create `apps/worker/src/pipelines/checks/AggregatedBenchmarkEvaluator.ts`:

```typescript
import { EntityManager } from 'typeorm';
import type { Logger } from 'pino';
import { BaseCheckService } from './BaseCheckService.js';
import { TestRun } from './BenchmarkMatcher.js';

export interface AggregatedBenchmark {
  id: string;
  aggregate_metric: 'transaction_response_time' | 'request_response_time' | 'error_percentage';
  aggregate_stat?: string;  // avg | p50 | p90 | p95 | p99 | max — null for error_percentage
  requirement_operator: string;
  requirement_value: number;
  exclude_ramp_up_time: boolean;
}

export interface AggregatedCheckResult {
  benchmark_id: string;
  test_run_id: string;
  actual_value: number | null;
  meets_requirement: boolean | null;
  status: 'COMPLETE' | 'NO_DATA' | 'ERROR';
  message: string;
}

const STAT_SQL: Record<string, string> = {
  avg: 'AVG(elapsed)',
  p50: 'PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY elapsed)',
  p90: 'PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY elapsed)',
  p95: 'PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY elapsed)',
  p99: 'PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY elapsed)',
  max: 'MAX(elapsed)',
};

export class AggregatedBenchmarkEvaluator extends BaseCheckService {
  constructor(logger: Logger, private manager: EntityManager) {
    super(logger);
  }

  async evaluate(testRun: TestRun, benchmark: AggregatedBenchmark): Promise<AggregatedCheckResult> {
    try {
      const actualValue = await this.computeMetric(testRun, benchmark);

      if (actualValue === null) {
        return {
          benchmark_id: benchmark.id,
          test_run_id: testRun.test_run_id,
          actual_value: null,
          meets_requirement: null,
          status: 'NO_DATA',
          message: 'No data found for aggregated metric',
        };
      }

      const meetsRequirement = this.applyOperator(
        actualValue,
        benchmark.requirement_operator,
        benchmark.requirement_value,
      );

      const unit = benchmark.aggregate_metric === 'error_percentage' ? '%' : 'ms';
      const label = benchmark.aggregate_stat
        ? `${benchmark.aggregate_stat.toUpperCase()} ${actualValue.toFixed(2)}${unit}`
        : `${actualValue.toFixed(2)}${unit}`;

      return {
        benchmark_id: benchmark.id,
        test_run_id: testRun.test_run_id,
        actual_value: actualValue,
        meets_requirement: meetsRequirement,
        status: 'COMPLETE',
        message: `${label} ${benchmark.requirement_operator} ${benchmark.requirement_value}${unit}: ${meetsRequirement ? 'PASS' : 'FAIL'}`,
      };
    } catch (error) {
      this.logger.error(`AggregatedBenchmarkEvaluator failed for benchmark ${benchmark.id}: ${error}`);
      return {
        benchmark_id: benchmark.id,
        test_run_id: testRun.test_run_id,
        actual_value: null,
        meets_requirement: null,
        status: 'ERROR',
        message: `Evaluation failed: ${error}`,
      };
    }
  }

  private async computeMetric(testRun: TestRun, benchmark: AggregatedBenchmark): Promise<number | null> {
    const rampUpFilter = benchmark.exclude_ramp_up_time && testRun.ramp_up && testRun.start_time
      ? `AND timestamp >= $2 + INTERVAL '${testRun.ramp_up} seconds'`
      : '';

    const params: unknown[] = [testRun.test_run_id];

    if (benchmark.aggregate_metric === 'error_percentage') {
      const sql = `
        SELECT (COUNT(*) FILTER (WHERE success = false))::float / NULLIF(COUNT(*), 0) * 100 AS result
        FROM requests_raw
        WHERE test_run_id = $1 ${rampUpFilter}
      `;
      const rows = await this.manager.query(sql, params) as { result: string | null }[];
      return rows[0]?.result !== null ? parseFloat(String(rows[0].result)) : null;
    }

    const statSql = STAT_SQL[benchmark.aggregate_stat ?? 'avg'] ?? 'AVG(elapsed)';
    const transactionFilter = benchmark.aggregate_metric === 'transaction_response_time'
      ? `AND is_transaction = true`
      : `AND is_transaction = false`;

    const sql = `
      SELECT ${statSql} AS result
      FROM requests_raw
      WHERE test_run_id = $1 ${transactionFilter} ${rampUpFilter}
    `;
    const rows = await this.manager.query(sql, params) as { result: string | null }[];
    return rows[0]?.result !== null ? parseFloat(String(rows[0].result)) : null;
  }

  private applyOperator(actual: number, operator: string, threshold: number): boolean {
    switch (operator) {
      case '<=': return actual <= threshold;
      case '<':  return actual <  threshold;
      case '>=': return actual >= threshold;
      case '>':  return actual >  threshold;
      default:   return actual <= threshold;
    }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/daniel/workspace/perfana/apps/worker && npx vitest run src/test/unit/pipelines/AggregatedBenchmarkEvaluator.test.ts 2>&1 | tail -20
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/pipelines/checks/AggregatedBenchmarkEvaluator.ts \
        apps/worker/src/test/unit/pipelines/AggregatedBenchmarkEvaluator.test.ts
git commit -m "feat(aggregated-slo): add AggregatedBenchmarkEvaluator with tests"
```

---

## Task 8: Worker — wire evaluator into ChecksPipeline

**Files:**
- Modify: `apps/worker/src/pipelines/ChecksPipeline.ts`

- [ ] **Step 1: Add import** at the top of `ChecksPipeline.ts` after the ApdexCalculator import:

```typescript
import { AggregatedBenchmarkEvaluator } from './checks/AggregatedBenchmarkEvaluator.js';
```

- [ ] **Step 2: Instantiate evaluator** in `processSingleTestRun`. In the block where `benchmarkMatcher`, `dataAggregator`, `requirementChecker`, `apdexCalculator` are instantiated, add:

```typescript
const aggregatedEvaluator = new AggregatedBenchmarkEvaluator(this.logger, manager);
```

- [ ] **Step 3: Add the `aggregated` branch** in the benchmark loop. After the `if (benchmark.benchmark_type === 'apdex')` block and before the `else` (metric) block, insert:

```typescript
} else if (benchmark.benchmark_type === 'aggregated') {
  this.logger.info(`Processing Aggregated benchmark ${benchmark.id}: ${benchmark.aggregate_metric} (${benchmark.aggregate_stat ?? 'n/a'})`);

  const aggResult = await aggregatedEvaluator.evaluate(testRun, {
    id: benchmark.id,
    aggregate_metric: benchmark.aggregate_metric as 'transaction_response_time' | 'request_response_time' | 'error_percentage',
    aggregate_stat: benchmark.aggregate_stat,
    requirement_operator: benchmark.requirement_operator ?? '<=',
    requirement_value: benchmark.requirement_value ?? 0,
    exclude_ramp_up_time: benchmark.exclude_ramp_up_time,
  });

  results.processed_benchmarks += 1;
  await this.saveAggregatedCheckResult(manager, testRun, benchmark, aggResult);
  checkResults.push({
    status: aggResult.status,
    meets_requirement: aggResult.meets_requirement,
  });
  results.created_check_results += 1;

  this.logger.info(
    `Created Aggregated check result for benchmark ${benchmark.id}: ` +
    `value=${aggResult.actual_value?.toFixed(2) ?? 'N/A'}, ` +
    `meets_requirement=${aggResult.meets_requirement}`
  );
```

- [ ] **Step 4: Add `saveAggregatedCheckResult` method** at the bottom of the class (after `saveApdexCheckResult`):

```typescript
private async saveAggregatedCheckResult(
  manager: EntityManager,
  testRun: TestRunInterface,
  benchmark: Benchmark,
  aggResult: import('./checks/AggregatedBenchmarkEvaluator.js').AggregatedCheckResult,
): Promise<void> {
  const unit = benchmark.aggregate_metric === 'error_percentage' ? '%' : 'ms';
  const label = benchmark.panel_title ?? benchmark.aggregate_metric ?? 'Aggregated SLO';

  const insertSql = `
    INSERT INTO check_results (
      system_under_test_id, test_environment, workload, test_run_id,
      dashboard_label, dashboard_uid, application_dashboard_id, panel_title, panel_id, panel_type,
      panel_y_axes_format, metric_name, metric_unit, benchmark_id, status, message,
      average_all, evaluate_type, exclude_ramp_up_time, ramp_up,
      match_pattern, requirement, panel_average, meets_requirement,
      targets, validate_with_default_if_no_data, validate_with_default_if_no_data_value,
      tags, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
      $21, $22, $23, $24, $25, $26, $27, $28, NOW(), NOW()
    )
  `;

  await manager.query(insertSql, [
    testRun.system_under_test_id,
    testRun.test_environment,
    testRun.workload,
    testRun.test_run_id,
    'Aggregated SLO',
    null,
    null,
    label,
    null,
    'aggregated',
    null,
    benchmark.aggregate_metric ?? null,
    unit,
    benchmark.id,
    aggResult.status,
    aggResult.message,
    false,
    'aggregated',
    benchmark.exclude_ramp_up_time,
    testRun.ramp_up ?? 0,
    null,
    JSON.stringify({
      type: 'aggregated',
      aggregate_metric: benchmark.aggregate_metric,
      aggregate_stat: benchmark.aggregate_stat,
      operator: benchmark.requirement_operator,
      threshold: benchmark.requirement_value,
    }),
    aggResult.actual_value,
    aggResult.meets_requirement,
    JSON.stringify([{
      target: label,
      value: aggResult.actual_value,
      meets_requirement: aggResult.meets_requirement,
    }]),
    false,
    0,
    [],
  ]);
}
```

- [ ] **Step 5: Type-check**

```bash
cd /Users/daniel/workspace/perfana && npx turbo run type-check --filter=@perfana/worker
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/pipelines/ChecksPipeline.ts
git commit -m "feat(aggregated-slo): wire AggregatedBenchmarkEvaluator into ChecksPipeline"
```

---

## Task 9: Frontend — AggregatedSloDialog

**Files:**
- Create: `apps/web/app/test-runs/[id]/components/performance-analysis/AggregatedSloDialog.tsx`

This dialog handles both entry points:
- **Performance Analysis menu** → pass `testRunId`; dialog fetches system/env/workload internally; always create mode.
- **SUT config** → pass `systemUnderTestId + testEnvironment + workload` directly; optionally pass `existingBenchmark` for edit mode.

- [ ] **Step 1: Create the dialog**

Create `apps/web/app/test-runs/[id]/components/performance-analysis/AggregatedSloDialog.tsx`:

```tsx
'use client';

import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Box, Typography, Alert, CircularProgress,
  Switch, FormControlLabel, TextField, Autocomplete,
} from '@mui/material';
import { authenticatedFetch } from '@/lib/api';

type AggregateMetric = 'transaction_response_time' | 'request_response_time' | 'error_percentage';
type AggregateStat = 'avg' | 'p50' | 'p90' | 'p95' | 'p99' | 'max';

interface WorkloadContext {
  systemUnderTestId: string;
  systemName: string;
  testEnvironment: string;
  workload: string;
}

export interface ExistingAggregatedBenchmark {
  id: string;
  aggregate_metric: AggregateMetric;
  aggregate_stat?: AggregateStat;
  requirement_operator: string;
  requirement_value: number;
  exclude_ramp_up_time: boolean;
  enabled: boolean;
}

interface AggregatedSloDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  // Entry point A: Performance Analysis menu (create only)
  testRunId?: string;
  // Entry point B: SUT config (create or edit)
  systemUnderTestId?: string;
  systemName?: string;
  testEnvironment?: string;
  workload?: string;
  existingBenchmark?: ExistingAggregatedBenchmark;
}

const METRIC_OPTIONS: { value: AggregateMetric; label: string }[] = [
  { value: 'transaction_response_time', label: 'Aggregated transaction response times' },
  { value: 'request_response_time', label: 'Aggregated request response times' },
  { value: 'error_percentage', label: 'Aggregated error percentage' },
];

const STAT_OPTIONS: { value: AggregateStat; label: string }[] = [
  { value: 'avg', label: 'avg' },
  { value: 'p50', label: 'p50' },
  { value: 'p90', label: 'p90' },
  { value: 'p95', label: 'p95' },
  { value: 'p99', label: 'p99' },
  { value: 'max', label: 'max' },
];

const OPERATOR_OPTIONS = ['<=', '<', '>=', '>'];

export default function AggregatedSloDialog({
  open, onClose, onSuccess,
  testRunId,
  systemUnderTestId: propSystemId,
  systemName: propSystemName,
  testEnvironment: propEnv,
  workload: propWorkload,
  existingBenchmark,
}: AggregatedSloDialogProps) {
  const isEditMode = !!existingBenchmark;

  const [ctx, setCtx] = useState<WorkloadContext | null>(null);
  const [loadingCtx, setLoadingCtx] = useState(false);

  const [metric, setMetric] = useState<AggregateMetric>('transaction_response_time');
  const [stat, setStat] = useState<AggregateStat>('p95');
  const [operator, setOperator] = useState('<=');
  const [threshold, setThreshold] = useState<string>('2000');
  const [excludeRampUp, setExcludeRampUp] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSuccess(false);

    if (existingBenchmark) {
      setMetric(existingBenchmark.aggregate_metric);
      setStat((existingBenchmark.aggregate_stat as AggregateStat) ?? 'p95');
      setOperator(existingBenchmark.requirement_operator);
      setThreshold(String(existingBenchmark.requirement_value));
      setExcludeRampUp(existingBenchmark.exclude_ramp_up_time);
    } else {
      setMetric('transaction_response_time');
      setStat('p95');
      setOperator('<=');
      setThreshold('2000');
      setExcludeRampUp(true);
    }

    if (propSystemId && propEnv && propWorkload) {
      setCtx({
        systemUnderTestId: propSystemId,
        systemName: propSystemName ?? propSystemId,
        testEnvironment: propEnv,
        workload: propWorkload,
      });
    } else if (testRunId) {
      fetchCtxFromTestRun(testRunId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fetchCtxFromTestRun = async (id: string) => {
    try {
      setLoadingCtx(true);
      const res = await authenticatedFetch(`/test-runs/${id}`);
      if (!res.ok) throw new Error('Failed to load test run');
      const data = await res.json();
      setCtx({
        systemUnderTestId: data.system_under_test_id,
        systemName: data.system_name ?? data.systems_under_test?.name ?? data.system_under_test_id,
        testEnvironment: data.test_environment,
        workload: data.workload,
      });
    } catch (err) {
      setError('Failed to load test run details');
    } finally {
      setLoadingCtx(false);
    }
  };

  const thresholdUnit = metric === 'error_percentage' ? '%' : 'ms';
  const showStat = metric !== 'error_percentage';

  const isValid = () => {
    if (!ctx) return false;
    const val = parseFloat(threshold);
    if (isNaN(val)) return false;
    if (showStat && !stat) return false;
    return true;
  };

  const handleSave = async () => {
    if (!ctx || !isValid()) return;
    try {
      setLoading(true);
      setError(null);
      const body = {
        systemUnderTestId: ctx.systemUnderTestId,
        testEnvironment: ctx.testEnvironment,
        workload: ctx.workload,
        aggregateMetric: metric,
        aggregateStat: showStat ? stat : undefined,
        requirementOperator: operator,
        requirementValue: parseFloat(threshold),
        excludeRampUpTime: excludeRampUp,
      };

      let res: Response;
      if (isEditMode && existingBenchmark) {
        res = await authenticatedFetch(`/benchmarks/aggregated/${existingBenchmark.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            aggregateStat: showStat ? stat : undefined,
            requirementOperator: operator,
            requirementValue: parseFloat(threshold),
            excludeRampUpTime: excludeRampUp,
          }),
        });
      } else {
        res = await authenticatedFetch('/benchmarks/aggregated', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message ?? 'Failed to save SLO');
      }

      setSuccess(true);
      setTimeout(() => { onSuccess(); onClose(); }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save SLO');
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    if (!existingBenchmark) return;
    try {
      setLoading(true);
      setError(null);
      const res = await authenticatedFetch(`/benchmarks/aggregated/${existingBenchmark.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      if (!res.ok) throw new Error('Failed to disable SLO');
      setSuccess(true);
      setTimeout(() => { onSuccess(); onClose(); }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disable SLO');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Set Aggregated Test SLO</DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {loadingCtx && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={16} />
              <Typography variant="body2" color="text.secondary">Loading...</Typography>
            </Box>
          )}

          <Alert severity="info">
            <Typography variant="body2">
              <strong>Aggregated Test SLO</strong> checks a single metric aggregated across all
              {metric !== 'error_percentage' ? ' transactions or requests' : ' requests'} in the test run.
            </Typography>
          </Alert>

          {/* Metric — read-only in edit mode */}
          <Autocomplete
            options={METRIC_OPTIONS}
            getOptionLabel={(o) => o.label}
            isOptionEqualToValue={(o, v) => o.value === v.value}
            value={METRIC_OPTIONS.find(o => o.value === metric) ?? null}
            onChange={(_, v) => { if (v) setMetric(v.value); }}
            disabled={isEditMode || loading}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Metric"
                required
                helperText={isEditMode ? 'Metric cannot be changed after creation' : undefined}
              />
            )}
          />

          <Box sx={{ display: 'grid', gridTemplateColumns: showStat ? '1fr 80px 1fr' : '80px 1fr', gap: 1.5 }}>
            {showStat && (
              <Autocomplete
                options={STAT_OPTIONS}
                getOptionLabel={(o) => o.label}
                isOptionEqualToValue={(o, v) => o.value === v.value}
                value={STAT_OPTIONS.find(o => o.value === stat) ?? null}
                onChange={(_, v) => { if (v) setStat(v.value); }}
                disabled={loading}
                renderInput={(params) => <TextField {...params} label="Statistic" required />}
              />
            )}
            <Autocomplete
              options={OPERATOR_OPTIONS}
              value={operator}
              onChange={(_, v) => { if (v) setOperator(v); }}
              disabled={loading}
              renderInput={(params) => <TextField {...params} label="Operator" />}
            />
            <TextField
              label={`Threshold (${thresholdUnit})`}
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              disabled={loading}
              required
            />
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={excludeRampUp}
                  onChange={(e) => setExcludeRampUp(e.target.checked)}
                  disabled={loading}
                  size="small"
                />
              }
              label={
                <Box>
                  <Typography variant="body2" fontWeight={500}>Exclude ramp-up period</Typography>
                  <Typography variant="caption" color="text.secondary">Requests during ramp-up phase are excluded</Typography>
                </Box>
              }
            />
          </Box>

          {ctx && (
            <Box sx={{ bgcolor: 'grey.50', borderRadius: 1, p: 1.5, fontSize: 12, color: 'text.secondary' }}>
              Applies to all future test runs matching:<br />
              • System: <strong>{ctx.systemName}</strong> · Environment: <strong>{ctx.testEnvironment}</strong> · Workload: <strong>{ctx.workload}</strong>
            </Box>
          )}

          {error && <Alert severity="error">{error}</Alert>}
          {success && <Alert severity="success">SLO saved successfully!</Alert>}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, justifyContent: isEditMode ? 'space-between' : 'flex-end' }}>
        {isEditMode && (
          <Button onClick={handleDisable} color="error" disabled={loading}>
            Disable SLO
          </Button>
        )}
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button onClick={onClose} disabled={loading}>Cancel</Button>
          <Button
            onClick={handleSave}
            variant="contained"
            disabled={loading || success || !isValid() || loadingCtx}
            startIcon={loading ? <CircularProgress size={16} /> : null}
          >
            {loading ? 'Saving...' : isEditMode ? 'Update SLO' : 'Create SLO'}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/daniel/workspace/perfana && npx turbo run type-check --filter=@perfana/web
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/test-runs/\[id\]/components/performance-analysis/AggregatedSloDialog.tsx
git commit -m "feat(aggregated-slo): add AggregatedSloDialog component"
```

---

## Task 10: Frontend — Performance Analysis menu wiring

**Files:**
- Modify: `apps/web/app/test-runs/[id]/components/performance-analysis/components/PerformanceAnalysisMenus.tsx`
- Modify: `apps/web/app/test-runs/[id]/components/performance-analysis/components/PerformanceAnalysisDialogs.tsx`
- Modify: `apps/web/app/test-runs/[id]/components/performance-analysis/PerformanceAnalysisCard.tsx`

- [ ] **Step 1: Add "Set SLO" to `PerformanceAnalysisMenus.tsx`**

In `PerformanceAnalysisMenusProps`, add the new prop after `onOpenSloDialog`:
```typescript
onOpenAggregatedSloDialog: () => void;
```

In the destructure list, add:
```typescript
onOpenAggregatedSloDialog,
```

In the Apdex actions `<Menu>`, add a new `<MenuItem>` after "Set Apdex SLO":
```tsx
<MenuItem onClick={onOpenAggregatedSloDialog}>
  <ListItemIcon>
    <AssessmentIcon fontSize="small" />
  </ListItemIcon>
  <ListItemText>Set SLO</ListItemText>
</MenuItem>
```

- [ ] **Step 2: Add `AggregatedSloDialog` to `PerformanceAnalysisDialogs.tsx`**

Add the import at the top:
```typescript
import AggregatedSloDialog from '../AggregatedSloDialog';
```

Add to `PerformanceAnalysisDialogsProps`:
```typescript
aggregatedSloDialogOpen: boolean;
onAggregatedSloDialogClose: () => void;
```

Add to the destructure list:
```typescript
aggregatedSloDialogOpen,
onAggregatedSloDialogClose,
```

Add inside the returned fragment, after `<ApdexSloDialog .../>`:
```tsx
{/* Aggregated SLO Dialog */}
<AggregatedSloDialog
  open={aggregatedSloDialogOpen}
  onClose={onAggregatedSloDialogClose}
  testRunId={testRunId}
  onSuccess={onConfigSuccess}
/>
```

- [ ] **Step 3: Wire state in `PerformanceAnalysisCard.tsx`**

Find the file at `apps/web/app/test-runs/[id]/components/performance-analysis/PerformanceAnalysisCard.tsx`.

Add state near the other dialog states:
```typescript
const [aggregatedSloDialogOpen, setAggregatedSloDialogOpen] = useState(false);
```

Pass `onOpenAggregatedSloDialog` to `<PerformanceAnalysisMenus>`:
```tsx
onOpenAggregatedSloDialog={() => setAggregatedSloDialogOpen(true)}
```

Pass the two new props to `<PerformanceAnalysisDialogs>`:
```tsx
aggregatedSloDialogOpen={aggregatedSloDialogOpen}
onAggregatedSloDialogClose={() => setAggregatedSloDialogOpen(false)}
```

- [ ] **Step 4: Type-check**

```bash
cd /Users/daniel/workspace/perfana && npx turbo run type-check --filter=@perfana/web
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/test-runs/\[id\]/components/performance-analysis/components/PerformanceAnalysisMenus.tsx \
        apps/web/app/test-runs/\[id\]/components/performance-analysis/components/PerformanceAnalysisDialogs.tsx \
        apps/web/app/test-runs/\[id\]/components/performance-analysis/PerformanceAnalysisCard.tsx
git commit -m "feat(aggregated-slo): wire Set SLO item and dialog into PerformanceAnalysisCard"
```

---

## Task 11: Frontend — SUT config SLO tab

**Files:**
- Modify: `apps/web/app/systems/[id]/config/components/SLOTable.tsx`
- Modify: `apps/web/app/systems/[id]/config/components/SLOSection.tsx`
- Modify: `apps/web/app/systems/[id]/config/page.tsx`

- [ ] **Step 1: Add Type column to `SLOTable.tsx`**

In the `Benchmark` type/interface used here (imported from `./types`), check that `benchmark_type` is already present. If not, it will come from the API response.

In the table header row, add a `<TableCell>` for Type (insert after the metric/panel cell):
```tsx
<TableCell>Type</TableCell>
```

In each table body row, add a matching `<TableCell>` that renders a `<Chip>`:
```tsx
<TableCell>
  <Chip
    label={benchmark.benchmark_type ?? 'metric'}
    size="small"
    variant="outlined"
    color={
      benchmark.benchmark_type === 'aggregated' ? 'success' :
      benchmark.benchmark_type === 'apdex' ? 'info' : 'default'
    }
    sx={{ fontSize: 11 }}
  />
</TableCell>
```

Also make aggregated rows clickable for editing. In the row's `onClick` handler (if one exists), or add one via the `onEdit` prop — ensure that when `benchmark.benchmark_type === 'aggregated'`, clicking the edit icon calls `onEdit(benchmark)` as usual. The parent page will decide which dialog to open based on `benchmark_type`.

- [ ] **Step 2: Update `SLOSection.tsx`**

**a) Add new prop to `SLOSectionProps`:**
```typescript
onAddAggregatedSLO: () => void;
```

**b) Add to destructure:**
```typescript
onAddAggregatedSLO,
```

**c) Replace the `FilterBar` `showAddButton` / `onAddClick` block** with a split-button. Find the `<FilterBar>` usage and change `showAddButton={true}` to `showAddButton={false}`. Then add a split-button directly above `<FilterBar>` or as an `endAdornment` prop. The cleanest approach is to add it inside the `FilterBar` container. Replace the `addButtonText="Add SLO"` / `onAddClick={onAddSLO}` props with `showAddButton={false}`, and add the split button inside the `SLOSection` JSX, just before `<FilterBar>`:

```tsx
{/* Split "Add SLO" dropdown button */}
<Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
  <ButtonGroup variant="contained" size="small">
    <Button startIcon={<AddIcon />} onClick={onAddSLO}>
      Add Metric SLO
    </Button>
    <Button
      size="small"
      onClick={(e) => setSplitMenuAnchor(e.currentTarget)}
      sx={{ px: 0.5 }}
    >
      <ArrowDropDownIcon />
    </Button>
  </ButtonGroup>
  <Menu
    anchorEl={splitMenuAnchor}
    open={Boolean(splitMenuAnchor)}
    onClose={() => setSplitMenuAnchor(null)}
  >
    <MenuItem onClick={() => { onAddSLO(); setSplitMenuAnchor(null); }}>
      Add Metric SLO
    </MenuItem>
    <MenuItem onClick={() => { onAddAggregatedSLO(); setSplitMenuAnchor(null); }}>
      Add Aggregated SLO
    </MenuItem>
  </Menu>
</Box>
```

Add `splitMenuAnchor` state:
```typescript
const [splitMenuAnchor, setSplitMenuAnchor] = useState<HTMLElement | null>(null);
```

Add imports: `ButtonGroup`, `ArrowDropDownIcon` from `@mui/icons-material/ArrowDropDown`, `Menu`, `MenuItem`.

Also update the empty-state "Add First SLO" button to be the plain metric SLO button (no change needed — it already calls `onAddSLO`).

- [ ] **Step 3: Wire in `page.tsx`**

Open `apps/web/app/systems/[id]/config/page.tsx`. 

**a) Add import:**
```typescript
import AggregatedSloDialog from '../../../test-runs/[id]/components/performance-analysis/AggregatedSloDialog';
```

Wait — the path would be wrong since this is in `app/systems/[id]/config/`. Use a relative path:
```typescript
import AggregatedSloDialog, { ExistingAggregatedBenchmark } from '@/app/test-runs/[id]/components/performance-analysis/AggregatedSloDialog';
```

**b) Add state:**
```typescript
const [aggregatedSloDialogOpen, setAggregatedSloDialogOpen] = useState(false);
const [selectedAggregatedBenchmark, setSelectedAggregatedBenchmark] = useState<ExistingAggregatedBenchmark | null>(null);
```

**c) Add handler** for when a SLO row is clicked (the existing `onEditSLO` callback). Update the `handleEditSLO` (or equivalent) function to branch on `benchmark_type`:
```typescript
const handleEditSLO = (benchmark: Benchmark) => {
  if (benchmark.benchmark_type === 'aggregated') {
    setSelectedAggregatedBenchmark({
      id: benchmark.id,
      aggregate_metric: benchmark.aggregate_metric as AggregateMetric,
      aggregate_stat: benchmark.aggregate_stat as AggregateStat | undefined,
      requirement_operator: benchmark.requirement_operator ?? '<=',
      requirement_value: benchmark.requirement_value ?? 0,
      exclude_ramp_up_time: benchmark.exclude_ramp_up_time ?? true,
      enabled: benchmark.enabled ?? true,
    });
    setAggregatedSloDialogOpen(true);
  } else {
    setSelectedSloForEdit(benchmark);
    setEditSloDialogOpen(true);
  }
};
```

**d) Pass `onAddAggregatedSLO` to `<SLOSection>`:**
```tsx
onAddAggregatedSLO={() => {
  setSelectedAggregatedBenchmark(null);
  setAggregatedSloDialogOpen(true);
}}
```

**e) Mount the dialog** near the other dialogs:
```tsx
<AggregatedSloDialog
  open={aggregatedSloDialogOpen}
  onClose={() => {
    setAggregatedSloDialogOpen(false);
    setSelectedAggregatedBenchmark(null);
  }}
  onSuccess={() => {
    setAggregatedSloDialogOpen(false);
    setSelectedAggregatedBenchmark(null);
    slo.fetchBenchmarks(); // slo comes from the useSLOSection hook already wired in the page
  }}
  systemUnderTestId={selectedSystemId}
  systemName={selectedSystemName}
  testEnvironment={selectedEnvironment}
  workload={selectedWorkload}
  existingBenchmark={selectedAggregatedBenchmark ?? undefined}
/>
```

- [ ] **Step 4: Type-check**

```bash
cd /Users/daniel/workspace/perfana && npx turbo run type-check --filter=@perfana/web
```

Expected: no errors. Fix any prop name mismatches by reading the actual state/prop names in `page.tsx`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/systems/\[id\]/config/components/SLOTable.tsx \
        apps/web/app/systems/\[id\]/config/components/SLOSection.tsx \
        apps/web/app/systems/\[id\]/config/page.tsx
git commit -m "feat(aggregated-slo): add dropdown button and aggregated SLO dialog to SUT config SLO tab"
```

---

## Task 12: End-to-end smoke test

- [ ] **Step 1: Start the stack**

```bash
lsof -ti:3001,3002,4001 | xargs kill -9; npm run dev
```

Wait for all services to start (API on 3001, Web on 4001).

- [ ] **Step 2: Open a test run and set an aggregated SLO**

1. Navigate to `http://localhost:4001`
2. Open any test run → Performance Analysis card
3. Click the gear icon → "Set SLO"
4. Select "Aggregated transaction response times", stat "p95", operator "≤", threshold "2000"
5. Toggle "Exclude ramp-up period" on
6. Click "Create SLO"
7. Verify: success toast, no console errors

- [ ] **Step 3: Verify the SLO appears in SUT config**

1. Navigate to the System Under Test config for that test run's system
2. Go to the SLO tab
3. Verify the new aggregated SLO appears in the table with type chip "aggregated"
4. Click its row → edit dialog opens pre-filled
5. Change threshold to "1800" → click "Update SLO" → verify success

- [ ] **Step 4: Trigger a re-evaluation**

Re-trigger the checks pipeline for the test run (via API or by re-running the test). Verify a new check result appears in the check results view with the aggregated SLO result.

- [ ] **Step 5: Final preflight**

```bash
npm run preflight
```

Expected: lint + type-check pass.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat(aggregated-slo): smoke test verified, feature complete"
```
