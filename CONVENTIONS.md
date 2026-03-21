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

- Test runner: **Vitest** everywhere
- Test files: co-located as `*.test.ts` next to source
- Naming: `should [expected behavior] when [condition]`
- Integration tests: use Testcontainers for Postgres/Redis
- Never `expect(x).toBeDefined()` alone — test what the code DOES

## Logging

- **Pino** everywhere. No `console.log`, no NestJS `Logger`.
- Structured JSON logs with correlation IDs.
- Import: `import { logger } from '@perfana/config';`

## TypeScript

- `strict: true` in all tsconfig files
- No `as any` — use proper types or `unknown` with type guards
- Zod schemas for runtime validation at system boundaries
- Discriminated unions for state machines
