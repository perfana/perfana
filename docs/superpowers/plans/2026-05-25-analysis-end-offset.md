# Analysis End Offset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `analysisEndOffset` — a symmetric counterpart to `analysisStartOffset` — so users can exclude a tail period at the end of a test run from all statistical analysis, and set both offsets visually via a new dialog with a chart and dual-handle slider.

**Architecture:** New `ramp_down` DB column on `test_runs`. A unified `PUT /test-runs/:id/analysis-time-range` endpoint writes both offsets atomically and re-enqueues the stats rollup. A `GET /test-runs/:id/summary-timeseries` endpoint serves the chart data. The `TimingInformationSection` replaces its inline text edit with an "Analysis Window" display + "Change analysis time range" button that opens `AnalysisTimeRangeDialog`. Worker pipelines apply the end cutoff wherever the start cutoff is already applied.

**Tech Stack:** TypeORM / NestJS / PostgreSQL (API), Vitest (worker tests), Jest (API tests), Recharts + MUI Slider (frontend dialog)

**Spec:** `docs/superpowers/specs/2026-05-25-analysis-end-offset-design.md`

---

## File Map

| Action | File |
|--------|------|
| Create | `packages/shared/src/database/migrations/1779990000000-AddAnalysisEndOffset.ts` |
| Modify | `packages/shared/src/entities/test-run.entity.ts` |
| Modify | `packages/shared/src/schemas/index.ts` |
| Modify | `apps/api/src/modules/test-runs/types/test-run.types.ts` |
| Modify | `apps/api/src/modules/test-runs/handlers/entity-mapper.ts` |
| Modify | `apps/api/src/modules/test-runs/commands/create-test-run.command.ts` |
| Modify | `apps/api/src/modules/test-runs/dto/update-running-test.dto.ts` |
| Create | `apps/api/src/modules/test-runs/handlers/update-analysis-time-range.handler.ts` |
| Create | `apps/api/src/modules/test-runs/handlers/update-analysis-time-range.handler.spec.ts` |
| Modify | `apps/api/src/modules/test-runs/services/test-runs-mutation.service.ts` |
| Modify | `apps/api/src/modules/test-runs/services/test-runs-mutation.service.spec.ts` |
| Modify | `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts` |
| Modify | `apps/api/src/modules/test-runs/services/test-runs-query.service.ts` |
| Modify | `apps/api/src/modules/test-runs/test-runs.service.ts` |
| Modify | `apps/api/src/modules/test-runs/controllers/test-runs.controller.ts` |
| Modify | `apps/api/src/modules/test-runs/test-runs.module.ts` |
| Modify | `apps/worker/src/pipelines/TransactionStatsRollupPipeline.ts` |
| Modify | `apps/worker/src/test/unit/pipelines/TransactionStatsRollupPipeline.test.ts` |
| Modify | `apps/worker/src/pipelines/helpers/incremental/metric-processor.ts` |
| Modify | `apps/worker/src/test/unit/pipelines/PerformanceTestMetricsPipeline.test.ts` (metric-processor section) |
| Modify | `apps/worker/src/pipelines/helpers/incremental/grafana-collector.ts` |
| Modify | `apps/worker/src/pipelines/helpers/incremental/dynatrace-collector.ts` |
| Modify | `apps/worker/src/pipelines/MetricsPipeline.ts` |
| Modify | `apps/worker/src/services/dynatrace/DataProcessor.ts` |
| Modify | `apps/worker/src/pipelines/DataSanityCheckPipeline.ts` |
| Modify | `apps/web/types/test-runs.ts` |
| Modify | `apps/web/app/test-runs/[id]/components/test-run-details/components/TimingInformationSection.tsx` |
| Create | `apps/web/app/test-runs/[id]/components/test-run-details/components/AnalysisTimeRangeDialog.tsx` |

---

## Task 1: DB migration + entity + Zod schemas

**Files:**
- Create: `packages/shared/src/database/migrations/1779990000000-AddAnalysisEndOffset.ts`
- Modify: `packages/shared/src/entities/test-run.entity.ts`
- Modify: `packages/shared/src/schemas/index.ts`

- [ ] **Step 1: Create the migration file**

```typescript
// packages/shared/src/database/migrations/1779990000000-AddAnalysisEndOffset.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnalysisEndOffset1779990000000 implements MigrationInterface {
  name = 'AddAnalysisEndOffset1779990000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE test_runs
      ADD COLUMN IF NOT EXISTS ramp_down INTEGER DEFAULT 0
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE test_runs DROP COLUMN IF EXISTS ramp_down
    `);
  }
}
```

- [ ] **Step 2: Add the entity column**

In `packages/shared/src/entities/test-run.entity.ts`, add after the existing `ramp_up` column (line ~83):

```typescript
@Column({ name: 'ramp_down', type: 'integer', nullable: true, default: 0 })
analysisEndOffset?: number;
```

Also add `'analysisEndOffset'` to the `auditableFields` array (around line 47, after `'analysisStartOffset'`):

```typescript
static auditableFields = [
  // ... existing fields ...
  'analysisStartOffset',
  'analysisEndOffset',   // ADD THIS
  // ... rest ...
] as const;
```

- [ ] **Step 3: Add to Zod schemas**

In `packages/shared/src/schemas/index.ts`, add `analysisEndOffset: z.number().int().min(0).optional()` to both Zod schemas that currently have `analysisStartOffset: z.number().int().optional()`.

- [ ] **Step 4: Build shared package to verify no type errors**

```bash
cd /Users/daniel/workspace/perfana && npx turbo run type-check --filter=@perfana/shared
```

Expected: passes with no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/database/migrations/1779990000000-AddAnalysisEndOffset.ts \
        packages/shared/src/entities/test-run.entity.ts \
        packages/shared/src/schemas/index.ts
git commit -m "feat(db): add ramp_down column and analysisEndOffset entity field"
```

---

## Task 2: API types, entity mapper, create command, update DTO

**Files:**
- Modify: `apps/api/src/modules/test-runs/types/test-run.types.ts`
- Modify: `apps/api/src/modules/test-runs/handlers/entity-mapper.ts`
- Modify: `apps/api/src/modules/test-runs/commands/create-test-run.command.ts`
- Modify: `apps/api/src/modules/test-runs/dto/update-running-test.dto.ts`
- Modify: `apps/api/src/modules/test-runs/test-runs.service.ts`

- [ ] **Step 1: Add `analysis_end_offset` to the API TestRun response interface**

In `apps/api/src/modules/test-runs/types/test-run.types.ts`, add after `analysis_start_offset?: number`:

```typescript
analysis_end_offset?: number;
```

- [ ] **Step 2: Update the TestRun interface in test-runs.service.ts**

The `TestRun` interface defined locally in `apps/api/src/modules/test-runs/test-runs.service.ts` (around line 40) also needs `analysis_end_offset?: number` added after `analysis_start_offset?: number`.

- [ ] **Step 3: Update entity-mapper.ts**

In `apps/api/src/modules/test-runs/handlers/entity-mapper.ts`, add after `analysis_start_offset: entity.analysisStartOffset,`:

```typescript
analysis_end_offset: entity.analysisEndOffset,
```

- [ ] **Step 4: Update create-test-run.command.ts**

In `apps/api/src/modules/test-runs/commands/create-test-run.command.ts`, add `analysisEndOffset?: number` to the params interface (alongside the existing `analysisStartOffset?: number`). Also propagate it when building the entity — wherever `analysisStartOffset: params.analysisStartOffset` appears, add `analysisEndOffset: params.analysisEndOffset ?? 0`.

- [ ] **Step 5: Update update-running-test.dto.ts**

In `apps/api/src/modules/test-runs/dto/update-running-test.dto.ts`, add after the existing `analysisStartOffset?: number` field:

```typescript
analysisEndOffset?: number;
```

- [ ] **Step 6: Type-check**

```bash
npx turbo run type-check --filter=@perfana/api
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/test-runs/types/test-run.types.ts \
        apps/api/src/modules/test-runs/handlers/entity-mapper.ts \
        apps/api/src/modules/test-runs/commands/create-test-run.command.ts \
        apps/api/src/modules/test-runs/dto/update-running-test.dto.ts \
        apps/api/src/modules/test-runs/test-runs.service.ts
git commit -m "feat(api): add analysis_end_offset to TestRun type, mapper, and DTOs"
```

---

## Task 3: UpdateAnalysisTimeRangeHandler

**Files:**
- Create: `apps/api/src/modules/test-runs/handlers/update-analysis-time-range.handler.ts`
- Create: `apps/api/src/modules/test-runs/handlers/update-analysis-time-range.handler.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/modules/test-runs/handlers/update-analysis-time-range.handler.spec.ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UpdateAnalysisTimeRangeHandler } from './update-analysis-time-range.handler';
import { TestRun as TestRunEntity } from '../../../entities';
import { TestRunsGateway } from '../gateways/test-runs.gateway';
import { AuditService } from '../../audit/audit.service';

const mockTestRun = (overrides = {}) => ({
  id: 'uuid-1',
  testRunId: 'run-001',
  analysisStartOffset: 60,
  analysisEndOffset: 0,
  completed: true,
  organizationId: 'org-1',
  systemUnderTest: { team_id: null },
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('UpdateAnalysisTimeRangeHandler', () => {
  let handler: UpdateAnalysisTimeRangeHandler;
  let mockRepo: { findOne: jest.Mock };
  let mockDataSource: { query: jest.Mock };
  let mockGateway: { emitTestRunUpdated: jest.Mock };
  let mockAudit: { logUpdate: jest.Mock };

  beforeEach(async () => {
    mockRepo = { findOne: jest.fn() };
    mockDataSource = { query: jest.fn().mockResolvedValue(undefined) };
    mockGateway = { emitTestRunUpdated: jest.fn() };
    mockAudit = { logUpdate: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        UpdateAnalysisTimeRangeHandler,
        { provide: getRepositoryToken(TestRunEntity), useValue: mockRepo },
        { provide: DataSource, useValue: mockDataSource },
        { provide: TestRunsGateway, useValue: mockGateway },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    handler = module.get(UpdateAnalysisTimeRangeHandler);
  });

  it('updates both ramp_up and ramp_down columns atomically', async () => {
    const pre = mockTestRun({ analysisStartOffset: 60, analysisEndOffset: 0 });
    const post = mockTestRun({ analysisStartOffset: 30, analysisEndOffset: 60 });
    mockRepo.findOne.mockResolvedValueOnce(pre).mockResolvedValueOnce(post);

    await handler.execute({ id: 'uuid-1', analysisStartOffset: 30, analysisEndOffset: 60 });

    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('ramp_up'),
      expect.arrayContaining([30, 60, 'uuid-1']),
    );
  });

  it('throws ResourceNotFoundException when test run not found', async () => {
    mockRepo.findOne.mockResolvedValue(null);

    await expect(
      handler.execute({ id: 'missing', analysisStartOffset: 0, analysisEndOffset: 0 }),
    ).rejects.toThrow();
  });

  it('calls auditService.logUpdate with pre and post entities', async () => {
    const pre = mockTestRun();
    const post = mockTestRun({ analysisStartOffset: 30, analysisEndOffset: 60 });
    mockRepo.findOne.mockResolvedValueOnce(pre).mockResolvedValueOnce(post);

    await handler.execute({ id: 'uuid-1', analysisStartOffset: 30, analysisEndOffset: 60 });

    expect(mockAudit.logUpdate).toHaveBeenCalledWith(pre, post, expect.any(Object));
  });

  it('emits a WebSocket UPDATED event', async () => {
    const entity = mockTestRun();
    mockRepo.findOne.mockResolvedValue(entity);

    await handler.execute({ id: 'uuid-1', analysisStartOffset: 0, analysisEndOffset: 0 });

    expect(mockGateway.emitTestRunUpdated).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/api && npx jest handlers/update-analysis-time-range.handler.spec.ts --no-coverage
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the handler**

```typescript
// apps/api/src/modules/test-runs/handlers/update-analysis-time-range.handler.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { withRequestEm } from '../../../common/db/request-em';
import { TestRun as TestRunEntity, OwnedResource } from '../../../entities';
import { ResourceNotFoundException } from '../../../common/exceptions/business.exception';
import { TestRun } from '../types/test-run.types';
import { TestRunsGateway } from '../gateways/test-runs.gateway';
import { TestRunEventType } from '../types/realtime-events.types';
import { mapEntityToTestRun } from './entity-mapper';
import { AuditService } from '../../audit/audit.service';

export interface UpdateAnalysisTimeRangeData {
  id: string;
  analysisStartOffset: number;
  analysisEndOffset: number;
}

@Injectable()
export class UpdateAnalysisTimeRangeHandler {
  private readonly logger = new Logger(UpdateAnalysisTimeRangeHandler.name);

  constructor(
    @InjectRepository(TestRunEntity)
    private readonly testRunRepo: Repository<TestRunEntity>,
    private readonly dataSource: DataSource,
    private readonly testRunsGateway: TestRunsGateway,
    private readonly auditService: AuditService,
  ) {}

  async execute(data: UpdateAnalysisTimeRangeData): Promise<TestRun> {
    const { id, analysisStartOffset, analysisEndOffset } = data;

    const before = await withRequestEm(this.testRunRepo).findOne({ where: { id } });
    if (!before) throw new ResourceNotFoundException('TestRun', id);

    await this.dataSource.query(
      `UPDATE test_runs
       SET ramp_up = $1, ramp_down = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [analysisStartOffset, analysisEndOffset, id],
    );

    const after = await withRequestEm(this.testRunRepo).findOne({
      where: { id },
      relations: ['systemUnderTest'],
    });
    if (!after) throw new ResourceNotFoundException('TestRun', id);

    this.auditService.logUpdate(
      before as unknown as OwnedResource,
      after as unknown as OwnedResource,
      { organizationIdOverride: after.organizationId },
    );

    this.logger.log(
      `Updated analysis time range for ${id}: startOffset=${analysisStartOffset}s, endOffset=${analysisEndOffset}s`,
    );

    const testRun = mapEntityToTestRun(after);
    this.emitUpdateEvent(testRun, after.systemUnderTest?.team_id);
    return testRun;
  }

  private emitUpdateEvent(testRun: TestRun, teamId?: string): void {
    try {
      this.testRunsGateway.emitTestRunUpdated(
        { eventType: TestRunEventType.UPDATED, timestamp: new Date().toISOString(), testRun, teamId },
        undefined, undefined, teamId,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to emit UPDATED event for ${testRun.test_run_id}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/api && npx jest handlers/update-analysis-time-range.handler.spec.ts --no-coverage
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/test-runs/handlers/update-analysis-time-range.handler.ts \
        apps/api/src/modules/test-runs/handlers/update-analysis-time-range.handler.spec.ts
git commit -m "feat(api): add UpdateAnalysisTimeRangeHandler"
```

---

## Task 4: Mutation service + controller + module registration

**Files:**
- Modify: `apps/api/src/modules/test-runs/services/test-runs-mutation.service.ts`
- Modify: `apps/api/src/modules/test-runs/services/test-runs-mutation.service.spec.ts`
- Modify: `apps/api/src/modules/test-runs/controllers/test-runs.controller.ts`
- Modify: `apps/api/src/modules/test-runs/test-runs.module.ts`
- Modify: `apps/api/src/modules/test-runs/test-runs.service.ts`

- [ ] **Step 1: Register the handler in the module**

In `apps/api/src/modules/test-runs/test-runs.module.ts`:

Add import:
```typescript
import { UpdateAnalysisTimeRangeHandler } from './handlers/update-analysis-time-range.handler';
```

Add to `providers` array (alongside the existing `UpdateAnalysisStartOffsetHandler`):
```typescript
UpdateAnalysisTimeRangeHandler,
```

- [ ] **Step 2: Wire the handler into TestRunsMutationService**

In `apps/api/src/modules/test-runs/services/test-runs-mutation.service.ts`:

Add import:
```typescript
import { UpdateAnalysisTimeRangeHandler } from '../handlers/update-analysis-time-range.handler';
```

Add to constructor parameters (after `updateAnalysisStartOffsetHandler`):
```typescript
private readonly updateAnalysisTimeRangeHandler: UpdateAnalysisTimeRangeHandler,
```

Add the new service method (after `updateAnalysisStartOffset`):
```typescript
async updateAnalysisTimeRange(
  id: string,
  analysisStartOffset: number,
  analysisEndOffset: number,
  userId: string,
  _roles: string[],
): Promise<TestRun> {
  this.logger.debug(
    `updateAnalysisTimeRange: id=${id}, startOffset=${analysisStartOffset}, endOffset=${analysisEndOffset}, userId=${userId}`,
  );

  const result = await this.updateAnalysisTimeRangeHandler.execute({
    id,
    analysisStartOffset,
    analysisEndOffset,
  });

  if (result?.completed && result?.test_run_id) {
    try {
      await this.bullmqClientService.enqueueTransactionStatsRollup(result.test_run_id);
    } catch (err) {
      this.logger.error(
        `Failed to re-enqueue stats rollup after time range edit for ${result.test_run_id}:`,
        err,
      );
    }
  }

  return result;
}
```

- [ ] **Step 3: Add facade method to TestRunsService**

In `apps/api/src/modules/test-runs/test-runs.service.ts`, add after the `updateAnalysisStartOffset` method:

```typescript
async updateAnalysisTimeRange(
  id: string,
  analysisStartOffset: number,
  analysisEndOffset: number,
  userId: string,
  roles: string[],
): Promise<TestRun> {
  return this.mutationService.updateAnalysisTimeRange(id, analysisStartOffset, analysisEndOffset, userId, roles);
}
```

(You'll need to check that `mutationService` is the field name injected in `TestRunsService` — look for the constructor parameter of type `TestRunsMutationService`.)

- [ ] **Step 4: Add the controller endpoint**

In `apps/api/src/modules/test-runs/controllers/test-runs.controller.ts`, add a new endpoint after the existing `PUT :id/analysis-start-offset` handler:

```typescript
@Put(':id/analysis-time-range')
@ApiOperation({ summary: 'Update analysis time range (start and end offsets) for a test run' })
async updateAnalysisTimeRange(
  @Param('id') id: string,
  @Body() body: { analysisStartOffset: number; analysisEndOffset: number },
  @UserCtx() ctx: UserContext,
): Promise<TestRun> {
  if (
    typeof body.analysisStartOffset !== 'number' || body.analysisStartOffset < 0 ||
    typeof body.analysisEndOffset !== 'number' || body.analysisEndOffset < 0
  ) {
    throw new ValidationException(
      'analysisStartOffset and analysisEndOffset must be non-negative numbers (seconds)',
    );
  }
  return this.testRunsService.updateAnalysisTimeRange(
    id,
    body.analysisStartOffset,
    body.analysisEndOffset,
    ctx.userId,
    ctx.roles,
  );
}
```

- [ ] **Step 5: Add a test for the mutation service method**

In `apps/api/src/modules/test-runs/services/test-runs-mutation.service.spec.ts`, find the describe block and add:

```typescript
describe('updateAnalysisTimeRange', () => {
  it('calls handler and enqueues rollup when test run is completed', async () => {
    const mockResult = {
      id: 'uuid-1',
      test_run_id: 'run-001',
      completed: true,
      analysis_start_offset: 30,
      analysis_end_offset: 60,
    };
    const mockHandler = { execute: jest.fn().mockResolvedValue(mockResult) };
    // Inject mockHandler via service reconstruction or spy the handler directly
    // The service exposes the handler as updateAnalysisTimeRangeHandler
    (service as any).updateAnalysisTimeRangeHandler = mockHandler;
    (service as any).bullmqClientService = { enqueueTransactionStatsRollup: jest.fn().mockResolvedValue(undefined) };

    const result = await service.updateAnalysisTimeRange('uuid-1', 30, 60, 'user-1', []);

    expect(mockHandler.execute).toHaveBeenCalledWith({ id: 'uuid-1', analysisStartOffset: 30, analysisEndOffset: 60 });
    expect((service as any).bullmqClientService.enqueueTransactionStatsRollup).toHaveBeenCalledWith('run-001');
    expect(result).toBe(mockResult);
  });

  it('does not enqueue rollup when test run is not completed', async () => {
    const mockResult = { id: 'uuid-1', test_run_id: 'run-001', completed: false };
    const mockHandler = { execute: jest.fn().mockResolvedValue(mockResult) };
    const mockBullmq = { enqueueTransactionStatsRollup: jest.fn() };
    (service as any).updateAnalysisTimeRangeHandler = mockHandler;
    (service as any).bullmqClientService = mockBullmq;

    await service.updateAnalysisTimeRange('uuid-1', 0, 0, 'user-1', []);

    expect(mockBullmq.enqueueTransactionStatsRollup).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run the spec**

```bash
cd apps/api && npx jest test-runs-mutation.service.spec.ts --no-coverage
```

Expected: all tests PASS.

- [ ] **Step 7: Type-check**

```bash
npx turbo run type-check --filter=@perfana/api
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/test-runs/services/test-runs-mutation.service.ts \
        apps/api/src/modules/test-runs/services/test-runs-mutation.service.spec.ts \
        apps/api/src/modules/test-runs/controllers/test-runs.controller.ts \
        apps/api/src/modules/test-runs/test-runs.module.ts \
        apps/api/src/modules/test-runs/test-runs.service.ts
git commit -m "feat(api): wire PUT /test-runs/:id/analysis-time-range endpoint"
```

---

## Task 5: Summary timeseries query service + controller endpoint

**Files:**
- Modify: `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts`
- Modify: `apps/api/src/modules/test-runs/services/test-runs-query.service.ts`
- Modify: `apps/api/src/modules/test-runs/test-runs.service.ts`
- Modify: `apps/api/src/modules/test-runs/controllers/test-runs.controller.ts`

- [ ] **Step 1: Write the failing test for getSummaryTimeseries**

Add to `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts`'s spec file (look for `test-runs-performance-query.service.spec.ts` or create it next to the service):

```typescript
// At the top of whichever spec file covers TestRunsPerformanceQueryService,
// or create: apps/api/src/modules/test-runs/services/test-runs-performance-query.service.spec.ts
import { TestRunsPerformanceQueryService } from './test-runs-performance-query.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TestRun as TestRunEntity } from '../../../entities';
import { Test } from '@nestjs/testing';

describe('TestRunsPerformanceQueryService.getSummaryTimeseries', () => {
  let service: TestRunsPerformanceQueryService;
  let mockRepo: { query: jest.Mock };

  beforeEach(async () => {
    mockRepo = { query: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        TestRunsPerformanceQueryService,
        { provide: getRepositoryToken(TestRunEntity), useValue: mockRepo },
        { provide: 'TestRunsMapperService', useValue: { parseInt: parseInt } },
        { provide: 'JobProgressService', useValue: {} },
      ],
    })
      .overrideProvider('TestRunsMapperService').useValue({ parseInt: (v: string) => parseInt(v, 10) })
      .compile();
    service = module.get(TestRunsPerformanceQueryService);
  });

  it('returns null when no transactions exist', async () => {
    // testRunId lookup resolves to the string itself (not a UUID)
    mockRepo.query
      .mockResolvedValueOnce([{ start_time: new Date('2026-01-01T10:00:00Z'), duration: 600 }]) // test run meta
      .mockResolvedValueOnce([]); // empty transactions

    const result = await service.getSummaryTimeseries('run-001');
    expect(result).toBeNull();
  });

  it('returns buckets with throughput, avgResponseTime, errorsPerSecond', async () => {
    mockRepo.query
      .mockResolvedValueOnce([{ start_time: new Date('2026-01-01T10:00:00Z'), duration: 300 }])
      .mockResolvedValueOnce([
        { time_seconds: 30, throughput: '5.0', avg_response_time: '120', errors_per_second: '0.1' },
        { time_seconds: 60, throughput: '6.0', avg_response_time: '130', errors_per_second: '0.0' },
      ]);

    const result = await service.getSummaryTimeseries('run-001');

    expect(result).not.toBeNull();
    expect(result!.buckets).toHaveLength(2);
    expect(result!.buckets[0]).toMatchObject({
      timeSeconds: 30,
      throughput: 5.0,
      avgResponseTime: 120,
      errorsPerSecond: 0.1,
    });
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd apps/api && npx jest test-runs-performance-query.service.spec.ts --no-coverage 2>&1 | tail -20
```

Expected: FAIL — method does not exist.

- [ ] **Step 3: Implement getSummaryTimeseries**

Add the following to `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts`:

First, add the response type (before or after the existing imports):

```typescript
export interface SummaryTimeseriesBucket {
  timeSeconds: number;
  throughput: number;
  avgResponseTime: number;
  errorsPerSecond: number;
}

export interface SummaryTimeseriesResponse {
  duration: number;
  bucketSizeSeconds: number;
  buckets: SummaryTimeseriesBucket[];
}
```

Then add the method to the `TestRunsPerformanceQueryService` class:

```typescript
async getSummaryTimeseries(testRunId: string): Promise<SummaryTimeseriesResponse | null> {
  // Resolve UUID or testRunId string
  const resolvedId = await this.resolveTestRunId(testRunId);

  // Load start_time and duration
  const metaRows = await withRequestEm(this.testRunRepo).query(
    `SELECT start_time, duration FROM test_runs WHERE test_run_id = $1`,
    [resolvedId],
  );
  if (!metaRows?.length || !metaRows[0].start_time || !metaRows[0].duration) {
    return null;
  }

  const duration: number = metaRows[0].duration;
  // Target ~100 buckets; min 5s, max 60s
  const bucketSizeSeconds = Math.max(5, Math.min(60, Math.round(duration / 100)));

  const rows = await withRequestEm(this.testRunRepo).query(
    `SELECT
       ROUND(EXTRACT(EPOCH FROM (t.time - tr.start_time)) / $2) * $2 AS time_seconds,
       COUNT(*)::float / $2                                        AS throughput,
       AVG(t.mean)                                                 AS avg_response_time,
       COALESCE(
         (SELECT COUNT(*)::float / $2
          FROM requests_error re
          WHERE re.test_run_id = t.test_run_id
            AND re.time >= t.time
            AND re.time < t.time + ($2 || ' seconds')::interval
         ), 0
       )                                                           AS errors_per_second
     FROM transactions t
     JOIN test_runs tr ON tr.test_run_id = t.test_run_id
     WHERE t.test_run_id = $1
     GROUP BY 1, t.test_run_id, tr.start_time
     ORDER BY 1`,
    [resolvedId, bucketSizeSeconds],
  );

  if (!rows?.length) return null;

  return {
    duration,
    bucketSizeSeconds,
    buckets: rows.map((r: Record<string, string>) => ({
      timeSeconds: parseFloat(r.time_seconds),
      throughput: parseFloat(r.throughput),
      avgResponseTime: parseFloat(r.avg_response_time),
      errorsPerSecond: parseFloat(r.errors_per_second),
    })),
  };
}
```

- [ ] **Step 4: Add delegation in TestRunsQueryService**

In `apps/api/src/modules/test-runs/services/test-runs-query.service.ts`, add after the `getTransactionStats` delegation:

```typescript
async getSummaryTimeseries(testRunId: string): Promise<SummaryTimeseriesResponse | null> {
  return this.performanceService.getSummaryTimeseries(testRunId);
}
```

Import `SummaryTimeseriesResponse` from the performance query service at the top.

- [ ] **Step 5: Add facade method in TestRunsService**

In `apps/api/src/modules/test-runs/test-runs.service.ts`, add:

```typescript
async getSummaryTimeseries(testRunId: string): Promise<SummaryTimeseriesResponse | null> {
  return this.queryService.getSummaryTimeseries(testRunId);
}
```

Import `SummaryTimeseriesResponse` appropriately.

- [ ] **Step 6: Add the controller endpoint**

In `apps/api/src/modules/test-runs/controllers/test-runs.controller.ts`, add:

```typescript
@Get(':id/summary-timeseries')
@ApiOperation({ summary: 'Get time-bucketed performance summary for the analysis time range dialog' })
async getSummaryTimeseries(@Param('id') id: string): Promise<SummaryTimeseriesResponse> {
  const result = await this.testRunsService.getSummaryTimeseries(id);
  if (!result) {
    throw new NotFoundException(`No performance timeseries data found for test run ${id}`);
  }
  return result;
}
```

Import `NotFoundException` from `@nestjs/common` and `SummaryTimeseriesResponse` from the performance query service.

- [ ] **Step 7: Run tests**

```bash
cd apps/api && npx jest test-runs-performance-query.service.spec.ts --no-coverage
```

Expected: all PASS.

- [ ] **Step 8: Type-check**

```bash
npx turbo run type-check --filter=@perfana/api
```

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts \
        apps/api/src/modules/test-runs/services/test-runs-query.service.ts \
        apps/api/src/modules/test-runs/test-runs.service.ts \
        apps/api/src/modules/test-runs/controllers/test-runs.controller.ts
git commit -m "feat(api): add GET /test-runs/:id/summary-timeseries endpoint"
```

---

## Task 6: Worker — TransactionStatsRollupPipeline end cutoff

**Files:**
- Modify: `apps/worker/src/pipelines/TransactionStatsRollupPipeline.ts`
- Modify: `apps/worker/src/test/unit/pipelines/TransactionStatsRollupPipeline.test.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/worker/src/test/unit/pipelines/TransactionStatsRollupPipeline.test.ts`, add to the `makeTestRun` helper and add new test cases:

```typescript
// Update makeTestRun to support endTime and analysisEndOffset
function makeTestRun(overrides: Record<string, unknown> = {}) {
  return {
    testRunId: 'run-001',
    systemUnderTestId: 'sut-uuid-1',
    testEnvironment: 'production',
    workload: 'default',
    startTime: new Date('2026-04-10T10:00:00Z'),
    endTime: new Date('2026-04-10T10:10:00Z'),  // 600s duration
    analysisStartOffset: 60,
    analysisEndOffset: 0,  // default: no end exclusion
    completed: true,
    ...overrides,
  };
}

// Add these test cases inside the describe block:
describe('end cutoff (analysisEndOffset)', () => {
  it('passes endCutoff to SQL when analysisEndOffset > 0', async () => {
    mockDb.getTestRunByTestRunId.mockResolvedValue(
      makeTestRun({ analysisEndOffset: 60 }) // exclude last 60s
    );
    wireTransaction({ tx: 4, sampler: 4 });

    await pipeline.execute({ testRunId: 'run-001' });

    // The second parameter to the TRANSACTION_ROLLUP_SQL should be startCutoff,
    // and the third should be endCutoff (endTime - 60s = 10:09:00)
    const calls = mockManagerQuery.mock.calls;
    const insertCall = calls.find((c: string[]) =>
      typeof c[0] === 'string' && c[0].includes('INSERT')
    );
    expect(insertCall).toBeDefined();
    // endCutoff = 10:10:00 - 60s = 10:09:00
    const endCutoff = insertCall?.[1]?.[1]; // second param is endCutoff
    expect(new Date(endCutoff).toISOString()).toBe('2026-04-10T10:09:00.000Z');
  });

  it('uses endTime as endCutoff when analysisEndOffset is 0', async () => {
    mockDb.getTestRunByTestRunId.mockResolvedValue(
      makeTestRun({ analysisEndOffset: 0 })
    );
    wireTransaction({ tx: 4, sampler: 4 });

    await pipeline.execute({ testRunId: 'run-001' });

    const calls = mockManagerQuery.mock.calls;
    const insertCall = calls.find((c: string[]) =>
      typeof c[0] === 'string' && c[0].includes('INSERT')
    );
    const endCutoff = insertCall?.[1]?.[1];
    expect(new Date(endCutoff).toISOString()).toBe('2026-04-10T10:10:00.000Z');
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd apps/worker && npx vitest run src/test/unit/pipelines/TransactionStatsRollupPipeline.test.ts
```

Expected: new tests FAIL (endCutoff not yet in SQL params).

- [ ] **Step 3: Update TransactionStatsRollupPipeline.ts**

In `apps/worker/src/pipelines/TransactionStatsRollupPipeline.ts`, find the section that computes `cutoff` (around the comment `// Compute ramp-up cutoff`) and update it:

```typescript
// Before:
const rampUpSeconds = testRun.analysisStartOffset ?? 0;
const cutoff = new Date(
  testRun.startTime.getTime() + rampUpSeconds * 1000
);

// After:
const rampUpSeconds   = testRun.analysisStartOffset ?? 0;
const rampDownSeconds = testRun.analysisEndOffset ?? 0;
const startCutoff = new Date(testRun.startTime.getTime() + rampUpSeconds * 1000);
const endCutoff   = testRun.endTime
  ? new Date(testRun.endTime.getTime() - rampDownSeconds * 1000)
  : new Date(); // fallback: current time (should not happen on completed runs)
```

Then update the SQL call that previously passed `[testRunId, cutoff]` to now pass `[testRunId, startCutoff, endCutoff]`:

```typescript
const txResult = await manager.query<RollupRowCount[]>(
  TRANSACTION_ROLLUP_SQL,
  [testRunId, startCutoff, endCutoff]
);
const samplerResult = await manager.query<RollupRowCount[]>(
  SAMPLER_ROLLUP_SQL,
  [testRunId, startCutoff, endCutoff]
);
```

Also update `TRANSACTION_ROLLUP_SQL` and `SAMPLER_ROLLUP_SQL` constants (search for them in the file) to change their FILTER clause from:

```sql
FILTER (WHERE time >= $2)   -- old: only start cutoff
```

to:

```sql
FILTER (WHERE time >= $2 AND time < $3)  -- new: start AND end cutoff
```

And update the logger line:

```typescript
this.logger.info(
  `🎯 Rolling up transaction stats for ${testRunId} (ramp_up=${rampUpSeconds}s, ramp_down=${rampDownSeconds}s, window=${startCutoff.toISOString()}–${endCutoff.toISOString()})`
);
```

- [ ] **Step 4: Run tests**

```bash
cd apps/worker && npx vitest run src/test/unit/pipelines/TransactionStatsRollupPipeline.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/pipelines/TransactionStatsRollupPipeline.ts \
        apps/worker/src/test/unit/pipelines/TransactionStatsRollupPipeline.test.ts
git commit -m "feat(worker): apply analysisEndOffset end cutoff in TransactionStatsRollupPipeline"
```

---

## Task 7: Worker — MetricProcessor TestRunContext + flatten methods

**Files:**
- Modify: `apps/worker/src/pipelines/helpers/incremental/metric-processor.ts`
- Test: add cases to existing metric-processor tests (search for `PerformanceTestMetricsPipeline.test.ts` or metric-processor unit test)

- [ ] **Step 1: Write failing tests**

Find or create a unit test file for `MetricProcessor`. The existing test may be in `apps/worker/src/test/unit/pipelines/PerformanceTestMetricsPipeline.test.ts` or a dedicated file. Add:

```typescript
// Test for flattenGrafanaMetricsDocument with end exclusion
describe('MetricProcessor — end exclusion', () => {
  const startTime = new Date('2026-01-01T10:00:00Z');
  const endTime   = new Date('2026-01-01T10:10:00Z'); // 600s duration

  it('marks records after (endTime - analysisEndOffset) as ramp_up=true', () => {
    const ctx: TestRunContext = {
      startTime,
      endTime,
      analysisStartOffset: 0,
      analysisEndOffset: 60,  // exclude last 60s
      organizationId: null,
      teamId: null,
    };

    const doc = {
      test_run_id: 'run-001',
      application_dashboard_id: 'dash-1',
      metrics_source_id: null,
      dashboard_uid: 'uid-1',
      panel_id: 1,
      panel_title: 'RT',
      dashboard_label: 'test',
      benchmark_ids: null,
      data: [
        { metric_name: 'rt', time: new Date('2026-01-01T10:08:00Z'), timestep: 480, value: 100 }, // 480s — inside window
        { metric_name: 'rt', time: new Date('2026-01-01T10:09:30Z'), timestep: 570, value: 200 }, // 570s — excluded (> 540s)
      ],
    };

    const processor = new MetricProcessor(mockLogger as any, {} as any);
    const records = processor.flattenGrafanaMetricsDocument(doc, ctx);

    expect(records[0].ramp_up).toBe(false); // 480s is inside window
    expect(records[1].ramp_up).toBe(true);  // 570s > 600-60=540s
  });

  it('does not exclude tail when analysisEndOffset is 0', () => {
    const ctx: TestRunContext = {
      startTime, endTime,
      analysisStartOffset: 0, analysisEndOffset: 0,
      organizationId: null, teamId: null,
    };
    const doc = {
      test_run_id: 'run-001', application_dashboard_id: 'dash-1', metrics_source_id: null,
      dashboard_uid: 'uid-1', panel_id: 1, panel_title: 'RT', dashboard_label: 'test',
      benchmark_ids: null,
      data: [
        { metric_name: 'rt', time: new Date('2026-01-01T10:09:30Z'), timestep: 570, value: 200 },
      ],
    };
    const processor = new MetricProcessor(mockLogger as any, {} as any);
    const records = processor.flattenGrafanaMetricsDocument(doc, ctx);
    expect(records[0].ramp_up).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd apps/worker && npx vitest run --reporter=verbose 2>&1 | grep -A5 "end exclusion"
```

Expected: tests FAIL — `analysisEndOffset` not yet in `TestRunContext`.

- [ ] **Step 3: Update TestRunContext interface**

In `apps/worker/src/pipelines/helpers/incremental/metric-processor.ts`, update the `TestRunContext` interface:

```typescript
export interface TestRunContext {
  startTime?: Date;
  endTime?: Date;              // NEW: used for end-exclusion cutoff
  analysisStartOffset?: number;
  analysisEndOffset?: number;  // NEW: seconds from end to exclude
  organizationId?: string | null;
  teamId?: string | null;
}
```

- [ ] **Step 4: Update flattenGrafanaMetricsDocument**

Find the `isRampUp` calculation inside `flattenGrafanaMetricsDocument` (around line 151-153):

```typescript
// Before:
if (testRun.analysisStartOffset !== undefined) {
  isRampUp = elapsedSeconds < testRun.analysisStartOffset;
}

// After:
const startOffset = testRun.analysisStartOffset ?? 0;
const endOffset   = testRun.analysisEndOffset ?? 0;
const durationSeconds = testRun.endTime
  ? (testRun.endTime.getTime() - testRun.startTime!.getTime()) / 1000
  : Infinity;
isRampUp = elapsedSeconds < startOffset
  || (endOffset > 0 && elapsedSeconds > durationSeconds - endOffset);
```

- [ ] **Step 5: Apply the same change to flattenDynatraceMetricsDocument**

Find the analogous block (around line 213-215) and apply the same replacement:

```typescript
const startOffset = testRun.analysisStartOffset ?? 0;
const endOffset   = testRun.analysisEndOffset ?? 0;
const durationSeconds = testRun.endTime
  ? (testRun.endTime.getTime() - testRun.startTime!.getTime()) / 1000
  : Infinity;
isRampUp = elapsedSeconds < startOffset
  || (endOffset > 0 && elapsedSeconds > durationSeconds - endOffset);
```

- [ ] **Step 6: Run tests**

```bash
cd apps/worker && npx vitest run src/test/unit/pipelines/
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/pipelines/helpers/incremental/metric-processor.ts
git commit -m "feat(worker): add analysisEndOffset support to MetricProcessor TestRunContext and flatten methods"
```

---

## Task 8: Worker — grafana-collector, dynatrace-collector, MetricsPipeline, DataProcessor

**Files:**
- Modify: `apps/worker/src/pipelines/helpers/incremental/grafana-collector.ts`
- Modify: `apps/worker/src/pipelines/helpers/incremental/dynatrace-collector.ts`
- Modify: `apps/worker/src/pipelines/MetricsPipeline.ts`
- Modify: `apps/worker/src/services/dynatrace/DataProcessor.ts`

- [ ] **Step 1: Update grafana-collector.ts TestRunData interface**

In `grafana-collector.ts`, find the `TestRunData` or similar interface (the one containing `analysisStartOffset?: number`) and add:

```typescript
endTime?: Date;              // NEW
analysisEndOffset?: number;  // NEW
```

Then in the section that builds `testRunContext` (around line 134):

```typescript
const testRunContext: TestRunContext = {
  startTime: testRun.startTime,
  endTime: testRun.endTime,               // NEW
  analysisStartOffset: testRun.analysisStartOffset,
  analysisEndOffset: testRun.analysisEndOffset,    // NEW
  organizationId: testRun.organizationId || null,
  teamId: testRun.teamId || null,
};
```

- [ ] **Step 2: Update dynatrace-collector.ts TestRunData interface**

In `dynatrace-collector.ts` (the `TestRunData` interface at lines 24-33), add:

```typescript
endTime?: Date;              // NEW
analysisEndOffset?: number;  // NEW
```

Find where `testRunContext` is built (similar pattern to grafana-collector) and add `endTime` and `analysisEndOffset`.

- [ ] **Step 3: Update MetricsPipeline.ts — clip Grafana end time**

In `MetricsPipeline.ts`, find the section building `testRunAdapter` (around lines 110-122) and add `ramp_down`:

```typescript
const testRunAdapter = {
  test_run_id: testRun.testRunId,
  system_under_test_id: testRun.systemUnderTestId,
  workload: testRun.workload,
  test_environment: testRun.testEnvironment,
  start_time: testRun.startTime,
  end_time: testRun.endTime,
  ramp_up: testRun.analysisStartOffset || 0,
  ramp_down: testRun.analysisEndOffset || 0,  // NEW
  created_at: testRun.createdAt,
  updated_at: testRun.updatedAt,
  organization_id: testRun.organizationId || null,
  team_id: testRun.teamId || null,
};
```

Find the Grafana query time range (around line 164-169) and clip the end time:

```typescript
// Before:
{ from: testRun.startTime, to: testRun.endTime }

// After:
const rampDownSeconds = testRun.analysisEndOffset ?? 0;
const effectiveEndTime = testRun.endTime && rampDownSeconds > 0
  ? new Date(testRun.endTime.getTime() - rampDownSeconds * 1000)
  : testRun.endTime;
// ... then:
{ from: testRun.startTime, to: effectiveEndTime }
```

Find `flattenSingleDocument` signature (line ~314) and extend the inline type:

```typescript
private flattenSingleDocument(
  document: PanelMetricsDocument,
  testRun: { start_time?: Date; end_time?: Date; ramp_up?: number; ramp_down?: number; organization_id?: string | null; team_id?: string | null }
): unknown[]
```

Inside `flattenSingleDocument`, find the `isRampUp` calculation (line ~340-343) and update:

```typescript
// Before:
if (testRun.start_time && testRun.ramp_up !== undefined) {
  const recordTime = new Date(record.time);
  const elapsedSeconds = (recordTime.getTime() - testRun.start_time.getTime()) / 1000;
  isRampUp = elapsedSeconds < testRun.ramp_up;
}

// After:
if (testRun.start_time) {
  const recordTime = new Date(record.time);
  const elapsedSeconds = (recordTime.getTime() - testRun.start_time.getTime()) / 1000;
  const startOffset = testRun.ramp_up ?? 0;
  const endOffset   = testRun.ramp_down ?? 0;
  const durationSeconds = testRun.end_time
    ? (testRun.end_time.getTime() - testRun.start_time.getTime()) / 1000
    : Infinity;
  isRampUp = elapsedSeconds < startOffset
    || (endOffset > 0 && elapsedSeconds > durationSeconds - endOffset);
}
```

Also update `getPanelMetricsAsRecords` signature (line ~242) to include `end_time` and `ramp_down` in its inline type.

- [ ] **Step 4: Update DataProcessor.ts**

In `apps/worker/src/services/dynatrace/DataProcessor.ts`, find the cast around line 275:

```typescript
const tr = testRun as { startTime?: Date | string; start_time?: Date | string; analysisStartOffset?: number; ramp_up?: number };
```

Update it to:

```typescript
const tr = testRun as {
  startTime?: Date | string; start_time?: Date | string;
  endTime?: Date | string; end_time?: Date | string;
  analysisStartOffset?: number; ramp_up?: number;
  analysisEndOffset?: number; ramp_down?: number;
};
```

Then find the `rampUp` computation (around line 290-291):

```typescript
// Before:
const analysisStartOffsetSeconds = tr.analysisStartOffset || tr.ramp_up || 0;
const rampUp = roundedTimestep < analysisStartOffsetSeconds;

// After:
const startOffsetSeconds = tr.analysisStartOffset || tr.ramp_up || 0;
const endOffsetSeconds   = tr.analysisEndOffset   || tr.ramp_down || 0;
const rawEndTime = tr.endTime || tr.end_time;
const rawStartTime = tr.startTime || tr.start_time;
const durationSeconds = rawEndTime && rawStartTime
  ? (new Date(rawEndTime).getTime() - new Date(rawStartTime).getTime()) / 1000
  : Infinity;
const rampUp = roundedTimestep < startOffsetSeconds
  || (endOffsetSeconds > 0 && roundedTimestep > durationSeconds - endOffsetSeconds);
```

- [ ] **Step 5: Type-check worker**

```bash
npx turbo run type-check --filter=@perfana/worker
```

Expected: no errors.

- [ ] **Step 6: Run worker tests**

```bash
cd apps/worker && npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/pipelines/helpers/incremental/grafana-collector.ts \
        apps/worker/src/pipelines/helpers/incremental/dynatrace-collector.ts \
        apps/worker/src/pipelines/MetricsPipeline.ts \
        apps/worker/src/services/dynatrace/DataProcessor.ts
git commit -m "feat(worker): propagate analysisEndOffset through Grafana/Dynatrace collectors and MetricsPipeline"
```

---

## Task 9: Worker — DataSanityCheckPipeline zero-window warning

**Files:**
- Modify: `apps/worker/src/pipelines/DataSanityCheckPipeline.ts`

- [ ] **Step 1: Add the warning**

In `DataSanityCheckPipeline.ts`, after the existing time window check (the block that checks `!testRun.startTime || !testRun.endTime`), add:

```typescript
// Zero/negative analysis window warning
if (testRun.startTime && testRun.endTime) {
  const durationSeconds =
    (new Date(testRun.endTime).getTime() - new Date(testRun.startTime).getTime()) / 1000;
  const startOffset = testRun.analysisStartOffset ?? 0;
  const endOffset   = testRun.analysisEndOffset ?? 0;
  if (startOffset + endOffset >= durationSeconds) {
    warnings.push(
      `Analysis window is zero or negative: start offset (${startOffset}s) + end offset (${endOffset}s) ` +
      `>= total duration (${Math.round(durationSeconds)}s). No data will be included in analysis.`
    );
  }
}
```

Note: this pushes to `warnings` (not `reasons`), so the run stays valid — this is informational only.

- [ ] **Step 2: Run worker tests**

```bash
cd apps/worker && npx vitest run src/test/unit/pipelines/DataSanityCheckPipeline.test.ts
```

Expected: all existing tests PASS. If the test file doesn't exist, skip to the commit.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/pipelines/DataSanityCheckPipeline.ts
git commit -m "feat(worker): warn when analysis window is zero due to combined offsets"
```

---

## Task 10: Web type + TimingInformationSection refactor

**Files:**
- Modify: `apps/web/types/test-runs.ts`
- Modify: `apps/web/app/test-runs/[id]/components/test-run-details/components/TimingInformationSection.tsx`

- [ ] **Step 1: Add `analysis_end_offset` to web TestRun type**

In `apps/web/types/test-runs.ts`, add after `analysis_start_offset?: number` in the `TestRun` interface:

```typescript
analysis_end_offset?: number;
```

- [ ] **Step 2: Update TimingInformationSection.tsx**

Replace the entire file with the following. It removes the inline edit for `analysisStartOffset`, replaces it with a read-only "Analysis Window" display row, and adds a "Change analysis time range" button that conditionally shows based on whether summary-timeseries data is available:

```typescript
'use client';

import { useState, useEffect } from 'react';
import { Box, Typography, Divider, Button, CircularProgress, Tooltip, useTheme } from '@mui/material';
import { Timeline } from '@mui/icons-material';
import { TestRun } from '@/types/test-runs';
import { authenticatedFetch } from '@/lib/api';
import { formatDuration } from '../utils/test-run-formatters';
import { AnalysisTimeRangeDialog } from './AnalysisTimeRangeDialog';

interface SummaryTimeseriesResponse {
  duration: number;
  bucketSizeSeconds: number;
  buckets: { timeSeconds: number; throughput: number; avgResponseTime: number; errorsPerSecond: number }[];
}

interface TimingInformationSectionProps {
  testRun: TestRun;
  onTestRunUpdate?: (updatedTestRun: TestRun) => void;
  showToast?: (message: string) => void;
}

export function TimingInformationSection({ testRun, onTestRunUpdate, showToast }: TimingInformationSectionProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const [timeseriesData, setTimeseriesData] = useState<SummaryTimeseriesResponse | null>(null);
  const [timeseriesLoading, setTimeseriesLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (!testRun.completed) return;
    setTimeseriesLoading(true);
    authenticatedFetch(`/test-runs/${testRun.id}/summary-timeseries`)
      .then(res => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data: SummaryTimeseriesResponse | null) => setTimeseriesData(data))
      .catch(() => setTimeseriesData(null))
      .finally(() => setTimeseriesLoading(false));
  }, [testRun.id, testRun.completed]);

  const startOffset = testRun.analysis_start_offset ?? 0;
  const endOffset   = testRun.analysis_end_offset ?? 0;
  const duration    = testRun.duration ?? 0;
  const effectiveEnd = duration - endOffset;
  const effectiveDuration = effectiveEnd - startOffset;

  const showButton = testRun.completed && !timeseriesLoading && timeseriesData !== null;

  return (
    <Box sx={{
      p: 3,
      backgroundColor: isDark ? 'rgba(76, 175, 80, 0.04)' : 'rgba(255, 255, 255, 0.7)',
      backdropFilter: 'blur(10px)',
      border: isDark ? '1px solid rgba(76, 175, 80, 0.15)' : '1px solid rgba(76, 175, 80, 0.08)',
      borderRadius: 3,
      borderLeft: '4px solid',
      borderLeftColor: isDark ? '#81c784' : '#4caf50',
      boxShadow: isDark ? '0 2px 8px rgba(0, 0, 0, 0.2)' : '0 2px 8px rgba(0, 0, 0, 0.04)',
      transition: 'all 0.2s ease',
      '&:hover': {
        boxShadow: isDark ? '0 4px 12px rgba(0, 0, 0, 0.3)' : '0 4px 12px rgba(0, 0, 0, 0.08)',
        borderLeftColor: isDark ? '#a5d6a7' : '#388e3c',
      }
    }}>
      <Typography variant="overline" sx={{ display: 'block', fontSize: '0.875rem', fontWeight: 700, letterSpacing: '0.5px', color: '#4caf50', mb: 2.5 }}>
        Timing Information
      </Typography>

      {/* Total Duration */}
      <Box sx={{ mb: 2.5 }}>
        <Typography variant="caption" sx={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'text.secondary', mb: 0.75, opacity: 0.8 }}>
          Total Duration
        </Typography>
        <Typography variant="h6" sx={{ fontSize: '1.5rem', fontWeight: 700, color: 'text.primary', lineHeight: 1, fontFamily: '"SF Mono", "Monaco", monospace' }}>
          {formatDuration(testRun.duration)}
        </Typography>
      </Box>

      {/* Analysis Window */}
      <Box sx={{ mb: 2.5 }}>
        <Typography variant="caption" sx={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'text.secondary', mb: 0.75, opacity: 0.8 }}>
          Analysis Window
        </Typography>
        <Typography variant="body2" sx={{ fontSize: '0.9375rem', fontWeight: 600, color: 'text.primary', lineHeight: 1.4 }}>
          {formatDuration(startOffset)} → {formatDuration(effectiveEnd)}
          <Typography component="span" variant="caption" sx={{ ml: 1, color: 'text.secondary', fontWeight: 400 }}>
            ({formatDuration(Math.max(0, effectiveDuration))} effective)
          </Typography>
        </Typography>
        <Box sx={{ mt: 0.75 }}>
          {timeseriesLoading ? (
            <CircularProgress size={14} sx={{ mt: 0.25 }} />
          ) : showButton ? (
            <Button
              size="small"
              variant="outlined"
              startIcon={<Timeline sx={{ fontSize: 14 }} />}
              onClick={() => setDialogOpen(true)}
              sx={{ fontSize: '0.75rem', py: 0.25, px: 1, borderRadius: 1.5, borderColor: 'primary.main', color: 'primary.main', textTransform: 'none' }}
            >
              Change analysis time range
            </Button>
          ) : null}
        </Box>
      </Box>

      <Divider sx={{ my: 2, opacity: 0.4 }} />

      {/* Start Time */}
      <Box sx={{ mb: 2.5 }}>
        <Typography variant="caption" sx={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'text.secondary', mb: 0.75, opacity: 0.8 }}>
          Start Time
        </Typography>
        <Typography variant="body2" sx={{ fontSize: '0.9375rem', fontWeight: 600, color: 'text.primary', lineHeight: 1.4 }}>
          {testRun.start_time ? new Date(testRun.start_time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }) : <span style={{ fontStyle: 'italic', opacity: 0.5 }}>Not available</span>}
        </Typography>
      </Box>

      {/* End Time */}
      <Box>
        <Typography variant="caption" sx={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'text.secondary', mb: 0.75, opacity: 0.8 }}>
          End Time
        </Typography>
        <Typography variant="body2" sx={{ fontSize: '0.9375rem', fontWeight: 600, color: 'text.primary', lineHeight: 1.4 }}>
          {testRun.end_time ? new Date(testRun.end_time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }) : <span style={{ fontStyle: 'italic', opacity: 0.5 }}>Not available</span>}
        </Typography>
      </Box>

      {dialogOpen && timeseriesData && (
        <AnalysisTimeRangeDialog
          open={dialogOpen}
          testRun={testRun}
          timeseriesData={timeseriesData}
          onClose={() => setDialogOpen(false)}
          onSaved={(updated) => {
            onTestRunUpdate?.(updated);
            setDialogOpen(false);
            showToast?.('Analysis time range updated — re-analysis enqueued');
          }}
        />
      )}
    </Box>
  );
}
```

- [ ] **Step 3: Type-check web**

```bash
npx turbo run type-check --filter=@perfana/web
```

Expected: no errors (AnalysisTimeRangeDialog not yet created, so expect an import error — proceed to Task 11 first if this step fails).

- [ ] **Step 4: Commit**

```bash
git add apps/web/types/test-runs.ts \
        apps/web/app/test-runs/[id]/components/test-run-details/components/TimingInformationSection.tsx
git commit -m "feat(web): add analysis_end_offset type; refactor TimingInformationSection to Analysis Window display"
```

---

## Task 11: AnalysisTimeRangeDialog component

**Files:**
- Create: `apps/web/app/test-runs/[id]/components/test-run-details/components/AnalysisTimeRangeDialog.tsx`

- [ ] **Step 1: Create the dialog component**

```typescript
// apps/web/app/test-runs/[id]/components/test-run-details/components/AnalysisTimeRangeDialog.tsx
'use client';

import { useState, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Slider, Typography, Box, CircularProgress, useTheme,
} from '@mui/material';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, ResponsiveContainer, Legend,
} from 'recharts';
import { TestRun } from '@/types/test-runs';
import { authenticatedFetch } from '@/lib/api';

interface SummaryBucket {
  timeSeconds: number;
  throughput: number;
  avgResponseTime: number;
  errorsPerSecond: number;
}

interface SummaryTimeseriesResponse {
  duration: number;
  bucketSizeSeconds: number;
  buckets: SummaryBucket[];
}

interface Props {
  open: boolean;
  testRun: TestRun;
  timeseriesData: SummaryTimeseriesResponse;
  onClose: () => void;
  onSaved: (updated: TestRun) => void;
}

function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

export function AnalysisTimeRangeDialog({ open, testRun, timeseriesData, onClose, onSaved }: Props) {
  const theme = useTheme();
  const duration = timeseriesData.duration;

  const [localStart, setLocalStart] = useState(testRun.analysis_start_offset ?? 0);
  const [localEnd, setLocalEnd]     = useState(testRun.analysis_end_offset ?? 0);
  const [saving, setSaving]         = useState(false);

  // Slider value: [startOffset, duration - endOffset]
  const sliderValue: [number, number] = [localStart, duration - localEnd];

  const handleSliderChange = useCallback((_: Event, value: number | number[]) => {
    const [left, right] = value as [number, number];
    setLocalStart(Math.max(0, left));
    setLocalEnd(Math.max(0, duration - right));
  }, [duration]);

  const effectiveDuration = Math.max(0, duration - localStart - localEnd);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await authenticatedFetch(`/test-runs/${testRun.id}/analysis-time-range`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisStartOffset: localStart, analysisEndOffset: localEnd }),
      });
      if (!res.ok) throw new Error('Failed to save');
      const updated: TestRun = await res.json();
      onSaved(updated);
    } catch {
      // Parent toast handles errors via the saving state
    } finally {
      setSaving(false);
    }
  };

  const chartData = timeseriesData.buckets.map(b => ({
    ...b,
    name: formatSeconds(b.timeSeconds),
  }));

  const startLine = localStart;
  const endLine   = duration - localEnd;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Change Analysis Time Range</DialogTitle>

      <DialogContent sx={{ pb: 0 }}>
        {/* Chart */}
        <Box sx={{ height: 220, mb: 2, background: theme.palette.mode === 'dark' ? '#0f172a' : '#f8fafc', borderRadius: 1, p: 1 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.mode === 'dark' ? '#1e293b' : '#e2e8f0'} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} interval="preserveStartEnd" />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: 'none', borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: '#94a3b8' }}
              />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />

              {/* Excluded start region */}
              {localStart > 0 && (
                <ReferenceArea yAxisId="left" x1={chartData[0]?.name} x2={formatSeconds(startLine)} fill="rgba(0,0,0,0.35)" ifOverflow="extendDomain" />
              )}
              {/* Excluded end region */}
              {localEnd > 0 && (
                <ReferenceArea yAxisId="left" x1={formatSeconds(endLine)} x2={chartData[chartData.length - 1]?.name} fill="rgba(0,0,0,0.35)" ifOverflow="extendDomain" />
              )}

              <Area yAxisId="left" type="monotone" dataKey="throughput" name="Throughput (tx/s)" fill="rgba(16,185,129,0.15)" stroke="#10b981" strokeWidth={1.5} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="avgResponseTime" name="Avg RT (ms)" stroke="#6366f1" strokeWidth={1.5} dot={false} />
              <Area yAxisId="left" type="monotone" dataKey="errorsPerSecond" name="Errors/s" fill="rgba(239,68,68,0.15)" stroke="#ef4444" strokeWidth={1} dot={false} />

              {/* Boundary lines */}
              <ReferenceLine yAxisId="left" x={formatSeconds(startLine)} stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 3" />
              <ReferenceLine yAxisId="left" x={formatSeconds(endLine)} stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </Box>

        {/* Slider */}
        <Box sx={{ px: 2, pb: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
            <Typography variant="caption" color="text.secondary">0s</Typography>
            <Typography variant="caption" color="text.secondary">{formatSeconds(duration)}</Typography>
          </Box>
          <Slider
            value={sliderValue}
            onChange={handleSliderChange}
            min={0}
            max={duration}
            step={1}
            sx={{ color: '#6366f1', '& .MuiSlider-thumb': { backgroundColor: '#f59e0b' } }}
          />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
            <Typography variant="caption">
              <span style={{ color: '#94a3b8' }}>Start offset: </span>
              <strong>{formatSeconds(localStart)}</strong>
            </Typography>
            <Typography variant="caption" color="success.main">
              Effective: <strong>{formatSeconds(effectiveDuration)}</strong>
            </Typography>
            <Typography variant="caption">
              <span style={{ color: '#94a3b8' }}>End offset: </span>
              <strong>{formatSeconds(localEnd)}</strong>
            </Typography>
          </Box>
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={handleSave} variant="contained" disabled={saving} startIcon={saving ? <CircularProgress size={16} /> : undefined}>
          Save &amp; Re-analyse
        </Button>
      </DialogActions>
    </Dialog>
  );
}
```

- [ ] **Step 2: Type-check web**

```bash
npx turbo run type-check --filter=@perfana/web
```

Expected: no errors.

- [ ] **Step 3: Run full preflight**

```bash
npm run preflight
```

Expected: lint + type-check pass across the monorepo.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/test-runs/[id]/components/test-run-details/components/AnalysisTimeRangeDialog.tsx
git commit -m "feat(web): add AnalysisTimeRangeDialog with chart and dual-handle slider"
```

---

## Self-Review Checklist

- [x] **Spec coverage:**
  - DB `ramp_down` column → Task 1
  - Entity `analysisEndOffset` → Task 1
  - Zod schemas → Task 1
  - API `analysis_end_offset` in types/mapper/DTOs → Task 2
  - `UpdateAnalysisTimeRangeHandler` → Task 3
  - `PUT /analysis-time-range` endpoint → Task 4
  - Rollup re-enqueue on save → Task 4
  - `GET /summary-timeseries` endpoint → Task 5
  - `TransactionStatsRollupPipeline` end cutoff → Task 6
  - `MetricProcessor` `TestRunContext` + flatten end exclusion → Task 7
  - grafana-collector / dynatrace-collector → Task 8
  - MetricsPipeline Grafana end time clip → Task 8
  - DataProcessor → Task 8
  - DataSanityCheckPipeline warning → Task 9
  - Web type `analysis_end_offset` → Task 10
  - `TimingInformationSection` replacement → Task 10
  - `AnalysisTimeRangeDialog` → Task 11
  - Old `/analysis-start-offset` endpoint preserved → not deleted (no task needed)

- [x] **Type consistency:** `analysisEndOffset` in entity, `analysis_end_offset` in API/web response types, `ramp_down` in DB — consistent throughout all tasks.

- [x] **No placeholders:** all code blocks are complete implementations.
