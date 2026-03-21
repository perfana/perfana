# TypeORM Patterns and Best Practices

## Overview

This document provides comprehensive guidance on using TypeORM repositories and QueryBuilder in the Perfana API. The codebase uses TypeORM with PostgreSQL for all database operations.

## Current Implementation

### Core Service: NativeDatabaseService

Located at `src/common/native-database.service.ts`, this service provides TypeORM repository operations for core entities:

- **User** - Authentication and user management
- **TestRun** - Test execution records
- **ApiKey** - API key management
- **TestRunConfiguration** - Test run configuration key-value pairs
- **ApplicationDashboard** - Grafana dashboard configurations
- **TrendsFilterPreset** - Trends view filter presets
- **CompareFilterPreset** - Comparison view filter presets
- **ExpectedConfigChange** - Configuration change tracking

### Architecture Pattern

```typescript
@Injectable()
export class NativeDatabaseService {
  constructor(
    @InjectDataSource() private dataSource: DataSource,
    @InjectRepository(TestRun) private testRunRepo: Repository<TestRun>,
    @InjectRepository(User) private userRepo: Repository<User>,
    // ... other repositories
  ) {}
}
```

## Entity Definitions

### Updated Entities (Validated against Postgres schema)

#### TestRun Entity
Location: `src/entities/test-run.entity.ts`

```typescript
@Entity('test_runs')
export class TestRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'system_under_test_id', type: 'uuid' })
  systemUnderTestId!: string;

  @Column({ name: 'test_environment', type: 'varchar', length: 255 })
  testEnvironment!: string;

  @Column({ type: 'varchar', length: 255 })
  workload!: string;

  @Column({ name: 'test_run_id', type: 'varchar', length: 255, unique: true })
  testRunId!: string;

  // ... additional fields with proper mapping
}
```

#### ApiKey Entity
Location: `src/entities/api-key.entity.ts`

```typescript
@Entity('api_keys')
export class ApiKey {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'api_key', type: 'varchar', unique: true })
  apiKey!: string;

  @Column({ type: 'varchar' })
  description!: string;

  @Column({ name: 'valid_until', type: 'timestamp with time zone', nullable: true })
  validUntil?: Date;
}
```

## Repository Patterns

### 1. Basic CRUD Operations

```typescript
// CREATE
async createTestRun(testRunData: Partial<TestRun>): Promise<TestRun> {
  const testRun = this.testRunRepo.create(testRunData);
  return await this.testRunRepo.save(testRun);
}

// READ
async getTestRunById(id: string): Promise<TestRun | null> {
  return await this.testRunRepo.findOne({
    where: { id },
    relations: ['systemUnderTest', 'configurations']
  });
}

// UPDATE
async updateTestRun(id: string, testRunData: Partial<TestRun>): Promise<TestRun> {
  await this.testRunRepo.update(id, testRunData);
  return await this.getTestRunById(id);
}

// DELETE
async deleteTestRun(id: string): Promise<void> {
  await this.testRunRepo.delete(id);
}
```

### 2. QueryBuilder for Complex Queries

#### Example 1: Filtered Test Runs with Joins

```typescript
async getTestRuns(filters?: {
  systemUnderTestId?: string;
  testEnvironment?: string;
  completed?: boolean;
  limit?: number;
  offset?: number;
}): Promise<TestRun[]> {
  const queryBuilder = this.testRunRepo.createQueryBuilder('tr')
    .leftJoinAndSelect('tr.systemUnderTest', 'system')
    .orderBy('tr.createdAt', 'DESC');

  if (filters?.systemUnderTestId) {
    queryBuilder.andWhere('tr.systemUnderTestId = :systemId', {
      systemId: filters.systemUnderTestId
    });
  }

  if (filters?.testEnvironment) {
    queryBuilder.andWhere('tr.testEnvironment = :env', {
      env: filters.testEnvironment
    });
  }

  if (filters?.completed !== undefined) {
    queryBuilder.andWhere('tr.completed = :completed', {
      completed: filters.completed
    });
  }

  if (filters?.limit) {
    queryBuilder.limit(filters.limit);
  }

  if (filters?.offset) {
    queryBuilder.offset(filters.offset);
  }

  return await queryBuilder.getMany();
}
```

#### Example 2: Aggregations and Grouping

```typescript
async getTestRunStatsBySystem(): Promise<any[]> {
  return await this.testRunRepo.createQueryBuilder('tr')
    .select('tr.systemUnderTestId', 'systemId')
    .addSelect('COUNT(tr.id)', 'totalRuns')
    .addSelect('COUNT(CASE WHEN tr.completed = true THEN 1 END)', 'completedRuns')
    .addSelect('AVG(tr.duration)', 'avgDuration')
    .groupBy('tr.systemUnderTestId')
    .getRawMany();
}
```

#### Example 3: Subqueries

```typescript
async getLatestTestRunPerSystem(): Promise<TestRun[]> {
  const subQuery = this.testRunRepo.createQueryBuilder('sub')
    .select('MAX(sub.createdAt)', 'maxDate')
    .addSelect('sub.systemUnderTestId', 'sysId')
    .groupBy('sub.systemUnderTestId');

  return await this.testRunRepo.createQueryBuilder('tr')
    .innerJoin(
      `(${subQuery.getQuery()})`,
      'latest',
      'tr.systemUnderTestId = latest.sysId AND tr.createdAt = latest.maxDate'
    )
    .leftJoinAndSelect('tr.systemUnderTest', 'system')
    .getMany();
}
```

#### Example 4: Complex Filtering with OR conditions

```typescript
async searchTestRuns(searchTerm: string): Promise<TestRun[]> {
  return await this.testRunRepo.createQueryBuilder('tr')
    .leftJoinAndSelect('tr.systemUnderTest', 'system')
    .where(
      '(tr.testRunId ILIKE :search OR system.name ILIKE :search OR tr.testEnvironment ILIKE :search)',
      { search: `%${searchTerm}%` }
    )
    .orderBy('tr.createdAt', 'DESC')
    .limit(50)
    .getMany();
}
```

#### Example 5: JSON Column Queries

```typescript
async getTestRunsByTag(tag: string): Promise<TestRun[]> {
  return await this.testRunRepo.createQueryBuilder('tr')
    .where(':tag = ANY(tr.tags)', { tag })
    .orderBy('tr.createdAt', 'DESC')
    .getMany();
}

async getTestRunsByStatusField(fieldName: string, fieldValue: any): Promise<TestRun[]> {
  return await this.testRunRepo.createQueryBuilder('tr')
    .where("tr.status->>'":fieldName"' = :value", { fieldName, value: fieldValue })
    .getMany();
}
```

#### Example 6: Date Range Queries

```typescript
async getTestRunsByDateRange(startDate: Date, endDate: Date): Promise<TestRun[]> {
  return await this.testRunRepo.createQueryBuilder('tr')
    .where('tr.startTime >= :startDate', { startDate })
    .andWhere('tr.startTime <= :endDate', { endDate })
    .leftJoinAndSelect('tr.systemUnderTest', 'system')
    .orderBy('tr.startTime', 'ASC')
    .getMany();
}
```

### 3. Transactions

```typescript
async createTestRunWithConfigs(
  testRunData: Partial<TestRun>,
  configs: Partial<TestRunConfiguration>[]
): Promise<TestRun> {
  return await this.dataSource.transaction(async (manager) => {
    // Create test run
    const testRun = manager.create(TestRun, testRunData);
    const savedTestRun = await manager.save(testRun);

    // Create configurations
    const configEntities = configs.map(config =>
      manager.create(TestRunConfiguration, {
        ...config,
        testRunId: savedTestRun.id
      })
    );
    await manager.save(configEntities);

    return savedTestRun;
  });
}
```

### 4. Bulk Operations

```typescript
// Bulk Insert
async createMultipleConfigs(configs: Partial<TestRunConfiguration>[]): Promise<void> {
  const entities = this.configRepo.create(configs);
  await this.configRepo.save(entities, { chunk: 100 }); // Insert in chunks of 100
}

// Bulk Update
async updateMultipleTestRuns(ids: string[], updates: Partial<TestRun>): Promise<void> {
  await this.testRunRepo.createQueryBuilder()
    .update(TestRun)
    .set(updates)
    .whereInIds(ids)
    .execute();
}

// Bulk Delete
async deleteTestRunsBySystem(systemId: string): Promise<void> {
  await this.testRunRepo.createQueryBuilder()
    .delete()
    .from(TestRun)
    .where('systemUnderTestId = :systemId', { systemId })
    .execute();
}
```

### 5. Raw Queries (Use Sparingly)

```typescript
async executeRawQuery<T = any>(sql: string, parameters?: any[]): Promise<T[]> {
  return await this.dataSource.query(sql, parameters);
}

// Example: Complex aggregation that's difficult with QueryBuilder
async getAdvancedMetrics(): Promise<any[]> {
  return await this.dataSource.query(`
    SELECT
      s.name as system_name,
      tr.test_environment,
      COUNT(tr.id) as total_runs,
      AVG(tr.duration) as avg_duration,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY tr.duration) as p95_duration
    FROM test_runs tr
    INNER JOIN systems_under_test s ON s.id = tr.system_under_test_id
    WHERE tr.completed = true
    GROUP BY s.name, tr.test_environment
    ORDER BY total_runs DESC
  `);
}
```

## Best Practices

### 1. Always Use Parameterized Queries

```typescript
// ✅ GOOD - Uses parameters
queryBuilder.where('tr.testRunId = :id', { id: testRunId });

// ❌ BAD - SQL injection risk
queryBuilder.where(`tr.testRunId = '${testRunId}'`);
```

### 2. Select Only Required Fields for Performance

```typescript
// ✅ GOOD - Select specific fields
queryBuilder.select(['tr.id', 'tr.testRunId', 'tr.status']);

// ❌ BAD - Selects all fields including large JSONB columns
queryBuilder.select('tr');
```

### 3. Use Relations vs Manual Joins

```typescript
// ✅ GOOD - TypeORM handles the join
const testRun = await this.testRunRepo.findOne({
  where: { id },
  relations: ['systemUnderTest', 'configurations']
});

// ⚠️ OK for complex scenarios
const testRuns = await this.testRunRepo.createQueryBuilder('tr')
  .leftJoinAndSelect('tr.systemUnderTest', 'system')
  .getMany();
```

### 4. Handle Errors Properly

```typescript
async getTestRunById(id: string): Promise<TestRun> {
  try {
    const testRun = await this.testRunRepo.findOne({ where: { id } });
    if (!testRun) {
      throw new ResourceNotFoundException('TestRun', id);
    }
    return testRun;
  } catch (error) {
    this.logger.error(`Failed to get test run: ${error.message}`);
    throw new DatabaseException('Failed to retrieve test run', error);
  }
}
```

### 5. Use Pagination for Large Datasets

```typescript
async getPaginatedTestRuns(page: number = 1, pageSize: number = 20): Promise<{
  data: TestRun[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const [data, total] = await this.testRunRepo.findAndCount({
    order: { createdAt: 'DESC' },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  return { data, total, page, pageSize };
}
```

### 6. Index Consideration

Ensure database indexes exist for frequently queried fields:

```sql
-- Example indexes (should be in migrations)
CREATE INDEX idx_test_runs_system_id ON test_runs(system_under_test_id);
CREATE INDEX idx_test_runs_environment ON test_runs(test_environment);
CREATE INDEX idx_test_runs_created_at ON test_runs(created_at DESC);
CREATE INDEX idx_test_runs_test_run_id ON test_runs(test_run_id);
```

## Common Query Patterns

### Pattern 1: Find or Create

```typescript
async findOrCreateSystemUnderTest(name: string, teamId: string): Promise<SystemUnderTest> {
  let system = await this.systemUnderTestRepository.findOne({
    where: { name, team_id: teamId }
  });

  if (!system) {
    system = this.systemUnderTestRepository.create({
      name,
      team_id: teamId,
      description: `Auto-created for ${name}`
    });
    system = await this.systemUnderTestRepository.save(system);
  }

  return system;
}
```

### Pattern 2: Soft Delete

```typescript
@Entity('test_runs')
export class TestRun {
  // ... other fields

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date;
}

// TypeORM automatically filters soft-deleted records
// To include soft-deleted:
const allRuns = await this.testRunRepo.find({ withDeleted: true });

// To restore:
await this.testRunRepo.restore(id);
```

### Pattern 3: Optimistic Locking

```typescript
@Entity('test_runs')
export class TestRun {
  // ... other fields

  @VersionColumn()
  version!: number;
}

// TypeORM will throw OptimisticLockVersionMismatchError if concurrent update
```

## Query Performance Tips

1. **Use `leftJoinAndSelect` vs `leftJoin`**
   - `leftJoinAndSelect`: Loads related entities
   - `leftJoin`: Just for filtering, doesn't load data

2. **Avoid N+1 Queries**
   ```typescript
   // ❌ BAD - Triggers N+1
   const testRuns = await this.testRunRepo.find();
   for (const run of testRuns) {
     run.system = await this.systemRepo.findOne({ where: { id: run.systemId } });
   }

   // ✅ GOOD - Single query with join
   const testRuns = await this.testRunRepo.find({
     relations: ['systemUnderTest']
   });
   ```

3. **Use QueryBuilder for Complex Filtering**
   - More readable than FindOptions
   - Better for dynamic conditions
   - Allows subqueries and complex joins

4. **Monitor Query Performance**
   ```typescript
   // Enable logging in development
   logging: ['query', 'error', 'slow']
   ```

## Testing Repositories

```typescript
describe('TestRunRepository', () => {
  let repository: Repository<TestRun>;
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await new DataSource({
      type: 'postgres',
      // ... test database config
    }).initialize();

    repository = dataSource.getRepository(TestRun);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('should create a test run', async () => {
    const testRun = repository.create({
      testRunId: 'test-123',
      systemUnderTestId: 'uuid',
      testEnvironment: 'test',
      workload: 'load-test'
    });

    const saved = await repository.save(testRun);
    expect(saved.id).toBeDefined();
  });
});
```

## Additional Resources

- [TypeORM Documentation](https://typeorm.io/)
- [QueryBuilder Reference](https://typeorm.io/select-query-builder)
- [Entity Decorators](https://typeorm.io/entities)
- [Migrations Guide](https://typeorm.io/migrations)

## Entity Status

### ✅ Validated and Updated
- TestRun - `src/entities/test-run.entity.ts`
- ApiKey - `src/entities/api-key.entity.ts`

### ⚠️ Needs Validation
- User
- SystemUnderTest
- Organization
- Team
- Benchmark
- And other entities in `src/entities/`

Use the Postgres MCP tool to validate other entities:
```typescript
mcp__postgres__query({
  sql: "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'table_name' ORDER BY ordinal_position"
})
```
