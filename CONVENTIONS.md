# Code Conventions

## File Structure

- Max ~300 lines per file. Split when larger.
- One class per file, one concern per module.
- Every directory has an `index.ts` barrel export.

## Naming

| Thing | Convention | Example |
|-------|-----------|---------|
| Entity file | `kebab-case.entity.ts` | `test-run.entity.ts` |
| Entity class | `PascalCase` | `TestRun` |
| DB table | `snake_case` | `test_runs` |
| DB column | `snake_case` | `system_under_test_id` |
| Service file | `kebab-case.service.ts` | `test-runs.service.ts` |
| Controller file | `kebab-case.controller.ts` | `test-runs.controller.ts` |
| Module file | `kebab-case.module.ts` | `test-runs.module.ts` |
| Test file | `kebab-case.test.ts` | `test-runs.service.test.ts` |
| Pipeline file | `kebab-case.pipeline.ts` | `adapt.pipeline.ts` |
| Type/DTO file | `kebab-case.ts` | `test-run.dto.ts` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_RETRY_ATTEMPTS` |

## API Patterns

Every endpoint follows: **Controller → Service → Repository**

```typescript
// Controller: handles HTTP, validation, auth decorators
@Get(':id')
@Roles('user')
async getTestRun(@Param('id', ParseUUIDPipe) id: string) {
  return this.testRunsService.findById(id);
}

// Service: business logic, no HTTP concerns
async findById(id: string): Promise<TestRun> {
  const testRun = await this.testRunRepo.findOne({ where: { id } });
  if (!testRun) throw new NotFoundException(`TestRun ${id} not found`);
  return testRun;
}
```

### A test run has two ids — never hand-roll the lookup

`test_runs.id` is the internal uuid the UI puts in its links; `test_runs.test_run_id` is the
readable id a person or CI/CD pipeline gave the load test tool. Endpoints get handed either one.

The helpers live in `apps/api/src/modules/reports/services/resolve-test-run.ts` (not in
`@perfana/shared`): `findTestRunByEitherId`, `resolveTestRunUuid`, and `TEST_RUN_UUID_RE` for the
shape test itself.

```typescript
import { findTestRunByEitherId, resolveTestRunUuid } from '../../reports/services/resolve-test-run';

const run = await findTestRunByEitherId(this.testRunRepo, testRunId);
const uuid = await resolveTestRunUuid(this.testRunRepo, testRunId); // for uuid FKs, e.g. awr_reports
```

Two rules the helper exists to enforce:

- **Never `WHERE id = :x OR test_run_id = :x`.** A repeated named parameter is sent once and
  Postgres types it from the first comparison, so the uuid column types the parameter and a
  readable id raises 22P02 instead of reaching the second half. Two statements, not one.
- **A uuid-shaped value is still tried as a name** if no row has it as an id — nothing stops a
  pipeline naming a run after a build guid.

`ParseUUIDPipe` / `@IsUUID()` on a `test_run_id` is the same bug in DTO form: it rejects the only
id a pipeline has before the service, which resolves either form, ever sees it.

## Worker Patterns

Every job follows: **Job Handler → Pipeline Registry → Pipeline**

```typescript
// Job handler: validates input, runs pipeline sequence
async handleAnalyze(job: Job<AnalyzeJobData>) {
  const input = analyzeInputSchema.parse(job.data);
  await this.registry.runSequence(
    ['metrics', 'statistics', 'adapt', 'checks'],
    input
  );
}

// Pipeline: typed input/output, documented algorithm
@Pipeline('adapt')
class AdaptPipeline extends BasePipeline<AdaptInput, AdaptOutput> {
  async execute(input: AdaptInput): Promise<Result<AdaptOutput, PipelineError>> {
    // ...
  }
}
```

## Database Access

- **CRUD operations**: TypeORM Repository or QueryBuilder
- **Complex analytics**: Named query files (`.query.ts`) with typed inputs/outputs
- **Never**: Inline raw SQL strings. Never `as any` for query results.
- **Use the camelCase entity property in `repo.create({...})`, not the snake_case column name.** Most entities declare `@Column({ name: 'organization_id' }) organizationId!: string`. Passing `organization_id: ...` to `repo.create()` silently drops the value (TypeORM ignores unknown properties), the INSERT goes out without an org id, and the Phase 4 NOT NULL constraint blows up at runtime. Always pass `organizationId: parent.organizationId` (and `teamId: parent.teamId`) when creating a child resource. Inherit from the parent (SUT / Profile / GrafanaInstance / TestRun) when one exists; otherwise default to `AuthorizationService.getAccessibleOrganizations(userId)[0]`.

```typescript
// Good: QueryBuilder for CRUD
const runs = await this.repo
  .createQueryBuilder('tr')
  .where('tr.organization_id = :orgId', { orgId })
  .orderBy('tr.startTime', 'DESC')
  .getMany();

// Good: Named query for complex analytics
import { buildAdaptThresholdQuery } from './queries/adapt-threshold.query';
const result = await this.dataSource.query(
  ...buildAdaptThresholdQuery({ testRunId, baselineId })
);
```

## Error Handling

- Never empty `catch {}` blocks. Always log or return an error result.
- Services throw NestJS exceptions (`NotFoundException`, `BadRequestException`).
- Pipelines return `Result<T, PipelineError>` — callers decide how to handle.
- Validation errors include what was expected vs received.

## Testing

- Test runner: **Vitest** (worker), **Jest** (api, web, grafana-sync)
- Test files: co-located as `*.spec.ts` or `*.test.ts` next to source
- Naming: `should [expected behavior] when [condition]`
- Integration tests: use Testcontainers for Postgres/Redis
- Never `expect(x).toBeDefined()` alone — test what the code DOES

## Logging

- **API/Grafana-sync**: NestJS `Logger` (e.g., `private readonly logger = new Logger(MyService.name)`)
- **Worker**: Pino via `@perfana/config`
- No `console.log` in production code. Structured JSON logs with context.

## TypeScript

- `strict: true` in all tsconfig files
- No `as any` — use proper types or `unknown` with type guards
- Zod schemas for runtime validation at system boundaries
- Discriminated unions for state machines
