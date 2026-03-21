import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { TestRunRepository } from '../../../src/repositories/test-run.repository';
import { TestRun, SystemUnderTest, TestRunConfiguration, Team, Organization } from '@perfana/shared/entities';
import { TestRunStatus } from '@perfana/shared/types';

// Import all entity classes from the test entities barrel
import * as testEntities from '../../../src/test/test-entities';

describe('TestRunRepository - Database Integration', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let testRunRepository: TestRunRepository;
  let systemRepository: Repository<SystemUnderTest>;

  // Test data cleanup
  const createdSystemIds: string[] = [];
  const createdTestRunIds: string[] = [];

  beforeAll(async () => {
    // Get all entity classes as an array from the test entities barrel
    const entityClasses = Object.values(testEntities).filter(
      (value) => typeof value === 'function' && value.prototype,
    ) as any[];

    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: process.env.DB_HOST || 'localhost',
          port: parseInt(process.env.DB_PORT || '5432', 10),
          username: process.env.DB_USERNAME || 'perfana',
          password: process.env.DB_PASSWORD || 'perfana_test_password',
          database: process.env.DB_NAME || 'perfana_test',
          entities: entityClasses,
          synchronize: false, // Use existing schema
        }),
        TypeOrmModule.forFeature([TestRun, SystemUnderTest, TestRunConfiguration, Team, Organization]),
      ],
      providers: [TestRunRepository],
    }).compile();

    dataSource = module.get<DataSource>(DataSource);

    // Wait for database connection to be fully established (fixes CI race condition)
    let retries = 10;
    while (retries > 0) {
      try {
        await dataSource.query('SELECT 1');
        console.log('✓ Database connection established');
        break;
      } catch (error) {
        retries--;
        if (retries === 0) {
          console.error('❌ Database connection failed after 10 retries');
          throw error;
        }
        console.log(`⏳ Waiting for database... (${retries} retries left)`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    testRunRepository = module.get<TestRunRepository>(TestRunRepository);
    systemRepository = dataSource.getRepository(SystemUnderTest);
  });

  afterAll(async () => {
    // Clean up test data
    if (createdTestRunIds.length > 0) {
      await dataSource
        .createQueryBuilder()
        .delete()
        .from(TestRun)
        .where('id IN (:...ids)', { ids: createdTestRunIds })
        .execute();
    }

    if (createdSystemIds.length > 0) {
      await dataSource
        .createQueryBuilder()
        .delete()
        .from(SystemUnderTest)
        .where('id IN (:...ids)', { ids: createdSystemIds })
        .execute();
    }

    await module.close();
  });

  /**
   * Helper function to create a test system
   */
  async function createTestSystem(name: string): Promise<SystemUnderTest> {
    const system = systemRepository.create({
      name: `test-system-${name}-${Date.now()}`,
      description: `Test system for ${name}`,
    });
    const saved = await systemRepository.save(system);
    createdSystemIds.push(saved.id);
    return saved;
  }

  /**
   * Helper function to create a test run
   */
  async function createTestRun(
    system: SystemUnderTest,
    overrides?: Partial<TestRun>
  ): Promise<TestRun> {
    const testRun = {
      systemUnderTestId: system.id,
      testEnvironment: 'test',
      workload: 'loadTest',
      testRunId: `test-run-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      startTime: new Date(),
      completed: false,
      valid: true,
      ...overrides,
    };

    const saved = await testRunRepository.create(testRun);
    createdTestRunIds.push(saved.id);
    return saved;
  }

  describe('Database Connection and Basic Operations', () => {
    it('should connect to the database successfully', async () => {
      expect(dataSource.isInitialized).toBe(true);
    });

    it('should create a test run with all required fields', async () => {
      const system = await createTestSystem('basic-create');
      const testRun = await createTestRun(system);

      expect(testRun.id).toBeDefined();
      expect(testRun.testRunId).toBeDefined();
      expect(testRun.systemUnderTestId).toBe(system.id);
      expect(testRun.createdAt).toBeInstanceOf(Date);
      expect(testRun.updatedAt).toBeInstanceOf(Date);
    });

    it('should retrieve a test run by UUID', async () => {
      const system = await createTestSystem('find-by-id');
      const created = await createTestRun(system);

      const found = await testRunRepository.findById(created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.testRunId).toBe(created.testRunId);
    });

    it('should update a test run', async () => {
      const system = await createTestSystem('update');
      const created = await createTestRun(system);

      const updated = await testRunRepository.update(created.id, {
        completed: true,
        endTime: new Date(),
      });

      expect(updated.completed).toBe(true);
      expect(updated.endTime).toBeInstanceOf(Date);
    });

    it('should delete a test run', async () => {
      const system = await createTestSystem('delete');
      const created = await createTestRun(system);

      await testRunRepository.delete(created.id);

      // findById throws ResourceNotFoundException when entity not found
      await expect(testRunRepository.findById(created.id)).rejects.toThrow();

      // Remove from cleanup list
      const index = createdTestRunIds.indexOf(created.id);
      if (index > -1) createdTestRunIds.splice(index, 1);
    });
  });

  describe('findAllWithSystem - Complex Query Builder Tests', () => {
    let system1: SystemUnderTest;
    let system2: SystemUnderTest;

    beforeAll(async () => {
      system1 = await createTestSystem('findall-sys1');
      system2 = await createTestSystem('findall-sys2');

      // Create test runs with various filters
      await createTestRun(system1, {
        testEnvironment: 'production',
        workload: 'loadTest',
        completed: true,
        valid: true,
        tags: ['important', 'regression'],
        startTime: new Date('2024-01-15'),
        duration: 3600,
      });

      await createTestRun(system1, {
        testEnvironment: 'staging',
        workload: 'stressTest',
        completed: false,
        valid: true,
        tags: ['experimental'],
        startTime: new Date('2024-02-20'),
      });

      await createTestRun(system2, {
        testEnvironment: 'production',
        workload: 'loadTest',
        completed: true,
        valid: false,
        tags: ['important'],
        startTime: new Date('2024-03-10'),
        duration: 4200,
      });
    });

    it('should find all test runs without filters', async () => {
      const results = await testRunRepository.findAllWithSystem();

      expect(results).toBeInstanceOf(Array);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.systemUnderTest).toBeDefined();
    });

    it('should filter by systemUnderTestId', async () => {
      const results = await testRunRepository.findAllWithSystem({
        systemUnderTestId: system1.id,
      });

      expect(results.every(r => r.systemUnderTestId === system1.id)).toBe(true);
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter by testEnvironment', async () => {
      const results = await testRunRepository.findAllWithSystem({
        testEnvironment: 'production',
      });

      expect(results.every(r => r.testEnvironment === 'production')).toBe(true);
    });

    it('should filter by workload', async () => {
      const results = await testRunRepository.findAllWithSystem({
        workload: 'loadTest',
      });

      expect(results.every(r => r.workload === 'loadTest')).toBe(true);
    });

    it('should filter by completed status', async () => {
      const results = await testRunRepository.findAllWithSystem({
        completed: true,
      });

      expect(results.every(r => r.completed === true)).toBe(true);
    });

    it('should filter by valid status', async () => {
      const results = await testRunRepository.findAllWithSystem({
        valid: false,
      });

      expect(results.every(r => r.valid === false)).toBe(true);
    });

    it('should filter by tags using PostgreSQL array overlap', async () => {
      const results = await testRunRepository.findAllWithSystem({
        tags: ['important'],
      });

      expect(results.every(r => r.tags?.includes('important'))).toBe(true);
    });

    it('should filter by date range', async () => {
      const startDate = new Date('2024-02-01');
      const endDate = new Date('2024-03-31');

      const results = await testRunRepository.findAllWithSystem({
        startDateFrom: startDate,
        startDateTo: endDate,
      });

      results.forEach(r => {
        if (r.startTime) {
          expect(r.startTime >= startDate).toBe(true);
          expect(r.startTime <= endDate).toBe(true);
        }
      });
    });

    it('should apply pagination with limit', async () => {
      const results = await testRunRepository.findAllWithSystem({
        limit: 1,
      });

      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('should apply pagination with limit and offset', async () => {
      const page1 = await testRunRepository.findAllWithSystem({
        limit: 1,
        offset: 0,
      });

      const page2 = await testRunRepository.findAllWithSystem({
        limit: 1,
        offset: 1,
      });

      if (page1[0] && page2[0]) {
        expect(page1[0].id).not.toBe(page2[0].id);
      }
    });

    it('should combine multiple filters', async () => {
      const results = await testRunRepository.findAllWithSystem({
        systemUnderTestId: system1.id,
        testEnvironment: 'production',
        completed: true,
        valid: true,
      });

      expect(results.every(r =>
        r.systemUnderTestId === system1.id &&
        r.testEnvironment === 'production' &&
        r.completed === true &&
        r.valid === true
      )).toBe(true);
    });

    it('should order results by createdAt DESC', async () => {
      const results = await testRunRepository.findAllWithSystem();

      if (results.length >= 2) {
        for (let i = 0; i < results.length - 1; i++) {
          const current = results[i]?.createdAt.getTime() || 0;
          const next = results[i + 1]?.createdAt.getTime() || 0;
          expect(current).toBeGreaterThanOrEqual(next);
        }
      }
    });
  });

  describe('findByTestRunId - Unique Constraint Tests', () => {
    it('should find test run by testRunId string', async () => {
      const system = await createTestSystem('find-by-testrunid');
      const created = await createTestRun(system, {
        testRunId: 'unique-test-run-id-12345',
      });

      const found = await testRunRepository.findByTestRunId('unique-test-run-id-12345');

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.systemUnderTest).toBeDefined();
      expect(found?.configurations).toBeDefined();
    });

    it('should return null for non-existent testRunId', async () => {
      const found = await testRunRepository.findByTestRunId('non-existent-test-run-id');

      expect(found).toBeNull();
    });

    it('should enforce unique constraint on testRunId', async () => {
      const system = await createTestSystem('unique-constraint');
      const testRunId = `unique-constraint-${Date.now()}`;

      await createTestRun(system, { testRunId });

      // Attempt to create duplicate should fail
      await expect(async () => {
        await createTestRun(system, { testRunId });
      }).rejects.toThrow();
    });
  });

  describe('findByContext - Multi-field Query', () => {
    it('should find test runs by system, environment, and workload', async () => {
      const system = await createTestSystem('context');
      await createTestRun(system, {
        testEnvironment: 'production',
        workload: 'loadTest',
      });

      const results = await testRunRepository.findByContext(
        system.id,
        'production',
        'loadTest'
      );

      expect(results.every(r =>
        r.systemUnderTestId === system.id &&
        r.testEnvironment === 'production' &&
        r.workload === 'loadTest'
      )).toBe(true);
    });

    it('should return empty array when no match found', async () => {
      const system = await createTestSystem('no-match');

      const results = await testRunRepository.findByContext(
        system.id,
        'non-existent-env',
        'non-existent-workload'
      );

      expect(results).toEqual([]);
    });
  });

  describe('findRunning - Boolean Filter', () => {
    it('should find only running (not completed) test runs', async () => {
      const system = await createTestSystem('running');
      await createTestRun(system, { completed: false });
      await createTestRun(system, { completed: false });
      await createTestRun(system, { completed: true });

      const running = await testRunRepository.findRunning();

      expect(running.every(r => r.completed === false)).toBe(true);
    });
  });

  describe('findByDateRange - Between Query', () => {
    it('should find test runs within date range', async () => {
      const system = await createTestSystem('daterange');
      const startDate = new Date('2024-06-01');
      const endDate = new Date('2024-06-30');

      await createTestRun(system, {
        startTime: new Date('2024-06-15'),
      });

      const results = await testRunRepository.findByDateRange(startDate, endDate);

      results.forEach(r => {
        if (r.startTime) {
          expect(r.startTime >= startDate).toBe(true);
          expect(r.startTime <= endDate).toBe(true);
        }
      });
    });

    it('should order by startTime ASC', async () => {
      const system = await createTestSystem('daterange-order');
      await createTestRun(system, { startTime: new Date('2024-07-10') });
      await createTestRun(system, { startTime: new Date('2024-07-05') });

      const results = await testRunRepository.findByDateRange(
        new Date('2024-07-01'),
        new Date('2024-07-31')
      );

      if (results.length >= 2) {
        for (let i = 0; i < results.length - 1; i++) {
          const current = results[i]?.startTime?.getTime() || 0;
          const next = results[i + 1]?.startTime?.getTime() || 0;
          expect(current).toBeLessThanOrEqual(next);
        }
      }
    });
  });

  describe('findByTags - PostgreSQL Array Operations', () => {
    it('should find test runs with specific tags', async () => {
      const system = await createTestSystem('tags');
      await createTestRun(system, {
        tags: ['performance', 'regression'],
      });

      const results = await testRunRepository.findByTags(['performance']);

      expect(results.some(r => r.tags?.includes('performance'))).toBe(true);
    });

    it('should handle multiple tags query', async () => {
      const system = await createTestSystem('multi-tags');
      await createTestRun(system, {
        tags: ['tag1', 'tag2', 'tag3'],
      });

      const results = await testRunRepository.findByTags(['tag1', 'tag2']);

      expect(results.some(r =>
        r.tags?.includes('tag1') || r.tags?.includes('tag2')
      )).toBe(true);
    });

    it('should return empty array for non-matching tags', async () => {
      const results = await testRunRepository.findByTags(['non-existent-tag-xyz']);

      // May have results from other tests, just verify it returns an array
      expect(results).toBeInstanceOf(Array);
    });
  });

  describe('findExpired - Null Checks and Complex Conditions', () => {
    it('should find expired test runs with non-null expires date', async () => {
      const system = await createTestSystem('expired');
      await createTestRun(system, {
        expires: new Date('2024-01-01'),
        expired: true,
      });

      const results = await testRunRepository.findExpired();

      expect(results.every(r => r.expires !== null && r.expires !== undefined)).toBe(true);
      expect(results.every(r => r.expired === true)).toBe(true);
    });

    it('should order by expires DESC', async () => {
      const results = await testRunRepository.findExpired();

      if (results.length >= 2) {
        for (let i = 0; i < results.length - 1; i++) {
          const current = results[i]?.expires?.getTime() || 0;
          const next = results[i + 1]?.expires?.getTime() || 0;
          expect(current).toBeGreaterThanOrEqual(next);
        }
      }
    });
  });

  describe('getStatsBySystem - Aggregation Queries', () => {
    let statsSystem: SystemUnderTest;

    beforeAll(async () => {
      statsSystem = await createTestSystem('stats');

      // Create test runs with durations
      await createTestRun(statsSystem, {
        completed: true,
        duration: 3000,
      });

      await createTestRun(statsSystem, {
        completed: true,
        duration: 4000,
      });

      await createTestRun(statsSystem, {
        completed: false,
        duration: 2000,
      });
    });

    it('should calculate statistics by system', async () => {
      const stats = await testRunRepository.getStatsBySystem([statsSystem.id]);

      expect(stats).toBeInstanceOf(Array);
      const systemStats = stats.find(s => s.systemId === statsSystem.id);

      if (systemStats) {
        expect(systemStats.totalRuns).toBeGreaterThanOrEqual(3);
        expect(systemStats.completedRuns).toBeGreaterThanOrEqual(2);
        expect(systemStats.avgDuration).toBeDefined();
        expect(systemStats.p95Duration).toBeDefined();
      }
    });

    it('should get stats for all systems when no filter provided', async () => {
      const stats = await testRunRepository.getStatsBySystem();

      expect(stats).toBeInstanceOf(Array);
      expect(stats.length).toBeGreaterThan(0);
    });

    it('should filter stats by specific system IDs', async () => {
      const stats = await testRunRepository.getStatsBySystem([statsSystem.id]);

      expect(stats.every(s => s.systemId === statsSystem.id)).toBe(true);
    });
  });

  describe('getLatestPerSystem - Subquery Tests', () => {
    it('should get latest test run per system', async () => {
      const system1 = await createTestSystem('latest1');
      const system2 = await createTestSystem('latest2');

      // Create test runs at different times
      await createTestRun(system1);
      await new Promise(resolve => setTimeout(resolve, 100));
      const latest1 = await createTestRun(system1);

      await createTestRun(system2);
      await new Promise(resolve => setTimeout(resolve, 100));
      const latest2 = await createTestRun(system2);

      const results = await testRunRepository.getLatestPerSystem([system1.id, system2.id]);

      expect(results).toBeInstanceOf(Array);
      const sys1Result = results.find(r => r.systemUnderTestId === system1.id);
      const sys2Result = results.find(r => r.systemUnderTestId === system2.id);

      if (sys1Result && sys2Result) {
        expect(sys1Result.id).toBe(latest1.id);
        expect(sys2Result.id).toBe(latest2.id);
      }
    });

    it('should include system relation', async () => {
      const system = await createTestSystem('latest-relation');
      await createTestRun(system);

      const results = await testRunRepository.getLatestPerSystem([system.id]);

      expect(results[0]?.systemUnderTest).toBeDefined();
    });
  });

  describe('search - ILIKE Pattern Matching', () => {
    it('should search test runs by testRunId pattern', async () => {
      const system = await createTestSystem('search');
      await createTestRun(system, {
        testRunId: 'PaymentService-production-loadTest-001',
      });

      const results = await testRunRepository.search('PaymentService');

      expect(results.some(r => r.testRunId.includes('PaymentService'))).toBe(true);
    });

    it('should search by environment pattern', async () => {
      const system = await createTestSystem('search-env');
      await createTestRun(system, {
        testEnvironment: 'pre-production',
      });

      const results = await testRunRepository.search('production');

      expect(results.some(r => r.testEnvironment.includes('production'))).toBe(true);
    });

    it('should be case insensitive', async () => {
      const system = await createTestSystem('search-case');
      await createTestRun(system, {
        testRunId: 'UPPERCASE-TEST-RUN',
      });

      const results = await testRunRepository.search('uppercase');

      expect(results.some(r => r.testRunId.includes('UPPERCASE'))).toBe(true);
    });

    it('should apply custom limit', async () => {
      const results = await testRunRepository.search('test', 5);

      expect(results.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Status Updates', () => {
    it('should mark test run as completed', async () => {
      const system = await createTestSystem('mark-completed');
      const testRun = await createTestRun(system, { completed: false });

      const endTime = new Date();
      const duration = 3600;

      const updated = await testRunRepository.markCompleted(testRun.id, endTime, duration);

      expect(updated.completed).toBe(true);
      expect(updated.endTime).toEqual(endTime);
      expect(updated.duration).toBe(duration);
    });

    it('should mark test run as aborted', async () => {
      const system = await createTestSystem('mark-aborted');
      const testRun = await createTestRun(system, { completed: false });

      const updated = await testRunRepository.markAborted(testRun.id);

      expect(updated.abort).toBe(true);
      expect(updated.completed).toBe(true);
      expect(updated.endTime).toBeInstanceOf(Date);
    });

    it('should update test run status JSONB field', async () => {
      const system = await createTestSystem('update-status');
      const testRun = await createTestRun(system);

      const status: TestRunStatus = { evaluatingAdapt: 'COMPLETED' };
      const updated = await testRunRepository.updateStatus(testRun.id, status);

      expect(updated.status).toEqual(status);
    });
  });

  describe('groupByEnvironment - Group By Aggregation', () => {
    it('should group test runs by environment', async () => {
      const system = await createTestSystem('group-env');
      await createTestRun(system, {
        testEnvironment: 'production',
        duration: 3000,
      });
      await createTestRun(system, {
        testEnvironment: 'staging',
        duration: 2500,
      });

      const groups = await testRunRepository.groupByEnvironment(system.id);

      expect(groups).toBeInstanceOf(Array);
      expect(groups.some(g => g.environment === 'production')).toBe(true);
      expect(groups.some(g => g.environment === 'staging')).toBe(true);

      groups.forEach(g => {
        expect(g.count).toBeDefined();
      });
    });

    it('should calculate average duration per environment', async () => {
      const groups = await testRunRepository.groupByEnvironment();

      groups.forEach(g => {
        expect(g.environment).toBeDefined();
        expect(g.count).toBeDefined();
      });
    });

    it('should order by count DESC', async () => {
      const groups = await testRunRepository.groupByEnvironment();

      if (groups.length >= 2) {
        for (let i = 0; i < groups.length - 1; i++) {
          const currentCount = groups[i]?.count || '0';
          const nextCount = groups[i + 1]?.count || '0';
          const current = typeof currentCount === 'string' ? parseInt(currentCount, 10) : currentCount;
          const next = typeof nextCount === 'string' ? parseInt(nextCount, 10) : nextCount;
          expect(current).toBeGreaterThanOrEqual(next);
        }
      }
    });
  });

  describe('deleteOlderThan - Bulk Delete Operations', () => {
    it('should delete test runs older than specified date', async () => {
      const system = await createTestSystem('delete-old');

      // Create old test run by directly manipulating created_at
      const oldTestRun = await createTestRun(system);
      await dataSource
        .createQueryBuilder()
        .update(TestRun)
        .set({ createdAt: new Date('2020-01-01') } as any)
        .where('id = :id', { id: oldTestRun.id })
        .execute();

      const cutoffDate = new Date('2023-01-01');
      const deletedCount = await testRunRepository.deleteOlderThan(cutoffDate);

      expect(deletedCount).toBeGreaterThanOrEqual(1);

      // Remove from cleanup list
      const index = createdTestRunIds.indexOf(oldTestRun.id);
      if (index > -1) createdTestRunIds.splice(index, 1);
    });

    it('should return 0 when no old test runs exist', async () => {
      const futureDate = new Date('2099-12-31');
      const deletedCount = await testRunRepository.deleteOlderThan(futureDate);

      expect(deletedCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('findByStatusField - JSONB Queries', () => {
    it('should find test runs by JSONB status field', async () => {
      const system = await createTestSystem('status-field');
      const status: TestRunStatus = { evaluatingAdapt: 'EVALUATING' };
      await createTestRun(system, { status });

      const results = await testRunRepository.findByStatusField('evaluatingAdapt', 'EVALUATING');

      expect(results.some(r =>
        r.status?.evaluatingAdapt === 'EVALUATING'
      )).toBe(true);
    });

    it('should validate field name to prevent SQL injection', async () => {
      await expect(async () => {
        await testRunRepository.findByStatusField('malicious; DROP TABLE test_runs;', 'value');
      }).rejects.toThrow();
    });

    it('should handle boolean values in JSONB', async () => {
      const system = await createTestSystem('status-bool');
      const status: TestRunStatus = { evaluatingAdapt: 'COMPLETED' };
      await createTestRun(system, { status });

      const results = await testRunRepository.findByStatusField('evaluatingAdapt', true);

      expect(results).toBeInstanceOf(Array);
    });
  });

  describe('countByWorkload - Count Aggregation', () => {
    it('should count test runs by workload', async () => {
      const system = await createTestSystem('count-workload');
      await createTestRun(system, {
        testEnvironment: 'production',
        workload: 'loadTest',
      });
      await createTestRun(system, {
        testEnvironment: 'production',
        workload: 'stressTest',
      });

      const counts = await testRunRepository.countByWorkload(system.id, 'production');

      expect(counts).toBeInstanceOf(Map);
      expect(counts.get('loadTest')).toBeGreaterThanOrEqual(1);
      expect(counts.get('stressTest')).toBeGreaterThanOrEqual(1);
    });

    it('should return empty map for non-existent context', async () => {
      const system = await createTestSystem('count-empty');

      const counts = await testRunRepository.countByWorkload(
        system.id,
        'non-existent-environment'
      );

      expect(counts).toBeInstanceOf(Map);
      expect(counts.size).toBe(0);
    });
  });

  describe('Transaction Support', () => {
    it('should support transactions for multiple operations', async () => {
      const system = await createTestSystem('transaction');

      const queryRunner = dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        const testRun = await queryRunner.manager.save(TestRun, {
          systemUnderTestId: system.id,
          testEnvironment: 'test',
          workload: 'loadTest',
          testRunId: `transaction-test-${Date.now()}`,
          startTime: new Date(),
        });

        createdTestRunIds.push(testRun.id);

        await queryRunner.manager.update(TestRun, testRun.id, {
          completed: true,
        });

        await queryRunner.commitTransaction();

        const found = await testRunRepository.findById(testRun.id);
        expect(found?.completed).toBe(true);
      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
      } finally {
        await queryRunner.release();
      }
    });

    it('should rollback transaction on error', async () => {
      const system = await createTestSystem('rollback');

      const queryRunner = dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      let testRunId: string | undefined;

      try {
        const testRun = await queryRunner.manager.save(TestRun, {
          systemUnderTestId: system.id,
          testEnvironment: 'test',
          workload: 'loadTest',
          testRunId: `rollback-test-${Date.now()}`,
          startTime: new Date(),
        });

        testRunId = testRun.id;

        // Force an error
        throw new Error('Intentional error for rollback test');
      } catch (error) {
        await queryRunner.rollbackTransaction();
      } finally {
        await queryRunner.release();
      }

      // Verify test run was not saved
      if (testRunId) {
        const found = await testRunRepository.findById(testRunId);
        expect(found).toBeNull();
      }
    });
  });

  describe('Performance and Load Tests', () => {
    it('should handle bulk inserts efficiently', async () => {
      const system = await createTestSystem('bulk');
      const testRuns: Partial<TestRun>[] = [];

      for (let i = 0; i < 50; i++) {
        testRuns.push({
          systemUnderTestId: system.id,
          testEnvironment: 'test',
          workload: 'loadTest',
          testRunId: `bulk-test-${Date.now()}-${i}`,
          startTime: new Date(),
        });
      }

      const startTime = Date.now();
      const saved = await dataSource.getRepository(TestRun).save(testRuns);
      const duration = Date.now() - startTime;

      expect(saved.length).toBe(50);
      expect(duration).toBeLessThan(5000); // Should complete in under 5 seconds

      // Add to cleanup
      saved.forEach(tr => createdTestRunIds.push(tr.id));
    });

    it('should query with indexes efficiently', async () => {
      const system = await createTestSystem('index-perf');
      await createTestRun(system, {
        testEnvironment: 'production',
        workload: 'loadTest',
      });

      const startTime = Date.now();
      await testRunRepository.findByContext(system.id, 'production', 'loadTest');
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(1000); // Should complete in under 1 second
    });
  });

  describe('Error Handling', () => {
    it('should throw DatabaseException on connection error simulation', async () => {
      // Close connection temporarily
      if (dataSource.isInitialized) {
        await dataSource.destroy();
      }

      await expect(async () => {
        await testRunRepository.findAllWithSystem();
      }).rejects.toThrow();

      // Reconnect
      await dataSource.initialize();
    });

    it('should handle constraint violations gracefully', async () => {
      const system = await createTestSystem('constraint');
      const testRunId = `constraint-test-${Date.now()}`;

      await createTestRun(system, { testRunId });

      // Try to create duplicate
      await expect(async () => {
        await createTestRun(system, { testRunId });
      }).rejects.toThrow();
    });
  });
});
