import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  TestRun,
  SystemUnderTest,
  TestRunConfiguration,
  Team,
  Organization,
  Profile,
  ExpectedConfigChange,
} from '@perfana/shared/entities';
import { TestRunStatus } from '@perfana/shared/types';

// Import all entity classes from the test entities barrel
import * as testEntities from '../../../src/test/test-entities';

describe.skip('Data Integrity - Database Integration', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let testRunRepository: Repository<TestRun>;
  let systemRepository: Repository<SystemUnderTest>;
  let configRepository: Repository<TestRunConfiguration>;
  let teamRepository: Repository<Team>;
  let profileRepository: Repository<Profile>;
  let expectedConfigChangeRepository: Repository<ExpectedConfigChange>;

  // Cleanup tracking
  const cleanup = {
    testRuns: [] as string[],
    systems: [] as string[],
    teams: [] as string[],
    configs: [] as string[],
    profiles: [] as string[],
    expectedChanges: [] as string[],
  };

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
          synchronize: false,
        }),
        TypeOrmModule.forFeature([
          TestRun,
          SystemUnderTest,
          TestRunConfiguration,
          Team,
          Organization,
          Profile,
          ExpectedConfigChange,
        ]),
      ],
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

    testRunRepository = dataSource.getRepository(TestRun);
    systemRepository = dataSource.getRepository(SystemUnderTest);
    configRepository = dataSource.getRepository(TestRunConfiguration);
    teamRepository = dataSource.getRepository(Team);
    profileRepository = dataSource.getRepository(Profile);
    expectedConfigChangeRepository = dataSource.getRepository(ExpectedConfigChange);
  });

  beforeEach(() => {
    // Clear cleanup arrays for each test to ensure proper isolation
    cleanup.testRuns.length = 0;
    cleanup.systems.length = 0;
    cleanup.teams.length = 0;
    cleanup.configs.length = 0;
    cleanup.profiles.length = 0;
    cleanup.expectedChanges.length = 0;
  });

  afterAll(async () => {
    // Clean up in reverse order
    if (cleanup.configs.length > 0) {
      await configRepository.delete(cleanup.configs);
    }
    if (cleanup.testRuns.length > 0) {
      await testRunRepository.delete(cleanup.testRuns);
    }
    if (cleanup.expectedChanges.length > 0) {
      await expectedConfigChangeRepository.delete(cleanup.expectedChanges);
    }
    if (cleanup.systems.length > 0) {
      await systemRepository.delete(cleanup.systems);
    }
    if (cleanup.teams.length > 0) {
      await teamRepository.delete(cleanup.teams);
    }
    if (cleanup.profiles.length > 0) {
      await profileRepository.delete(cleanup.profiles);
    }

    await module.close();
  });

  describe('Unique Constraints', () => {
    describe('TestRun.testRunId - Unique Constraint', () => {
      it('should enforce unique constraint on testRunId', async () => {
        const team = await teamRepository.save({
          name: `team-unique-${Date.now()}`,
          description: 'Test team',
        });
        cleanup.teams.push(team.id);

        const system = await systemRepository.save({
          team_id: team.id,
          name: `system-unique-${Date.now()}`,
          description: 'Test system',
        });
        cleanup.systems.push(system.id);

        const testRunId = `unique-test-run-${Date.now()}`;

        const testRun1 = await testRunRepository.save({
          systemUnderTestId: system.id,
          testEnvironment: 'test',
          workload: 'loadTest',
          testRunId,
          startTime: new Date(),
        });
        cleanup.testRuns.push(testRun1.id);

        // Attempt to create duplicate
        await expect(async () => {
          await testRunRepository.save({
            systemUnderTestId: system.id,
            testEnvironment: 'test',
            workload: 'loadTest',
            testRunId, // Same testRunId
            startTime: new Date(),
          });
        }).rejects.toThrow();
      });

      it('should allow different testRunIds', async () => {
        const team = await teamRepository.save({
          name: `team-diff-${Date.now()}`,
          description: 'Test team',
        });
        cleanup.teams.push(team.id);

        const system = await systemRepository.save({
          team_id: team.id,
          name: `system-diff-${Date.now()}`,
          description: 'Test system',
        });
        cleanup.systems.push(system.id);

        const testRun1 = await testRunRepository.save({
          systemUnderTestId: system.id,
          testEnvironment: 'test',
          workload: 'loadTest',
          testRunId: `test-run-1-${Date.now()}`,
          startTime: new Date(),
        });
        cleanup.testRuns.push(testRun1.id);

        const testRun2 = await testRunRepository.save({
          systemUnderTestId: system.id,
          testEnvironment: 'test',
          workload: 'loadTest',
          testRunId: `test-run-2-${Date.now()}`,
          startTime: new Date(),
        });
        cleanup.testRuns.push(testRun2.id);

        expect(testRun1.id).not.toBe(testRun2.id);
        expect(testRun1.testRunId).not.toBe(testRun2.testRunId);
      });
    });

    describe('Profile.name - Unique Constraint', () => {
      it('should enforce unique constraint on profile name', async () => {
        const profileName = `unique-profile-${Date.now()}`;

        const profile1 = await profileRepository.save({
          name: profileName,
          description: 'Test profile',
        });
        cleanup.profiles.push(profile1.id);

        await expect(async () => {
          await profileRepository.save({
            name: profileName, // Same name
            description: 'Another profile',
          });
        }).rejects.toThrow();
      });

      it('should allow different profile names', async () => {
        const profile1 = await profileRepository.save({
          name: `profile-1-${Date.now()}`,
          description: 'Test profile 1',
        });
        cleanup.profiles.push(profile1.id);

        const profile2 = await profileRepository.save({
          name: `profile-2-${Date.now()}`,
          description: 'Test profile 2',
        });
        cleanup.profiles.push(profile2.id);

        expect(profile1.id).not.toBe(profile2.id);
        expect(profile1.name).not.toBe(profile2.name);
      });
    });
  });

  describe('Foreign Key Constraints', () => {
    it('should enforce foreign key constraint on TestRun.systemUnderTestId', async () => {
      const invalidSystemId = '00000000-0000-0000-0000-000000000000';

      await expect(async () => {
        await testRunRepository.save({
          systemUnderTestId: invalidSystemId,
          testEnvironment: 'test',
          workload: 'loadTest',
          testRunId: `fk-test-${Date.now()}`,
          startTime: new Date(),
        });
      }).rejects.toThrow();
    });

    it('should enforce foreign key constraint on TestRunConfiguration.testRunId', async () => {
      const invalidTestRunId = '00000000-0000-0000-0000-000000000000';

      await expect(async () => {
        await configRepository.save({
          testRunId: invalidTestRunId,
          key: 'test.key',
          value: 'test.value',
        });
      }).rejects.toThrow();
    });

    it('should enforce foreign key constraint on SystemUnderTest.team_id', async () => {
      const invalidTeamId = '00000000-0000-0000-0000-000000000000';

      await expect(async () => {
        await systemRepository.save({
          team_id: invalidTeamId,
          name: `system-fk-test-${Date.now()}`,
          description: 'Test system',
        });
      }).rejects.toThrow();
    });

    it('should allow null foreign keys when nullable', async () => {
      const system = await systemRepository.save({
        name: `system-null-fk-${Date.now()}`,
        description: 'Test system without team',
        // team_id is nullable
      });
      cleanup.systems.push(system.id);

      expect(system.team_id).toBeUndefined();
    });
  });

  describe('NOT NULL Constraints', () => {
    it('should enforce NOT NULL on TestRun.testRunId', async () => {
      const team = await teamRepository.save({
        name: `team-notnull-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-notnull-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      await expect(async () => {
        await testRunRepository.save({
          systemUnderTestId: system.id,
          testEnvironment: 'test',
          workload: 'loadTest',
          // testRunId is missing (NOT NULL)
          startTime: new Date(),
        } as any);
      }).rejects.toThrow();
    });

    it('should enforce NOT NULL on SystemUnderTest.name', async () => {
      await expect(async () => {
        await systemRepository.save({
          // name is missing (NOT NULL)
          description: 'Test system',
        } as any);
      }).rejects.toThrow();
    });

    it('should enforce NOT NULL on Profile.name', async () => {
      await expect(async () => {
        await profileRepository.save({
          // name is missing (NOT NULL)
          description: 'Test profile',
        } as any);
      }).rejects.toThrow();
    });

    it('should allow null for nullable columns', async () => {
      const team = await teamRepository.save({
        name: `team-nullable-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-nullable-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const testRun = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'test',
        workload: 'loadTest',
        testRunId: `nullable-test-${Date.now()}`,
        startTime: new Date(),
        // duration is nullable
        // endTime is nullable
        // completed defaults to false
      });
      cleanup.testRuns.push(testRun.id);

      expect(testRun.duration).toBeUndefined();
      expect(testRun.endTime).toBeUndefined();
    });
  });

  describe('Check Constraints and Validation', () => {
    it('should handle boolean fields with proper defaults', async () => {
      const team = await teamRepository.save({
        name: `team-bool-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-bool-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const testRun = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'test',
        workload: 'loadTest',
        testRunId: `bool-test-${Date.now()}`,
        startTime: new Date(),
      });
      cleanup.testRuns.push(testRun.id);

      expect(testRun.completed).toBe(false);
      expect(testRun.abort).toBe(false);
      expect(testRun.valid).toBe(true);
    });

    it('should handle array fields correctly', async () => {
      const team = await teamRepository.save({
        name: `team-array-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-array-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const testRun = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'test',
        workload: 'loadTest',
        testRunId: `array-test-${Date.now()}`,
        startTime: new Date(),
        tags: ['tag1', 'tag2', 'tag3'],
        annotations: ['annotation1', 'annotation2'],
      });
      cleanup.testRuns.push(testRun.id);

      expect(testRun.tags).toEqual(['tag1', 'tag2', 'tag3']);
      expect(testRun.annotations).toEqual(['annotation1', 'annotation2']);
    });

    it('should handle empty arrays', async () => {
      const team = await teamRepository.save({
        name: `team-empty-array-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-empty-array-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const testRun = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'test',
        workload: 'loadTest',
        testRunId: `empty-array-test-${Date.now()}`,
        startTime: new Date(),
        tags: [],
        annotations: [],
      });
      cleanup.testRuns.push(testRun.id);

      expect(testRun.tags).toEqual([]);
      expect(testRun.annotations).toEqual([]);
    });
  });

  describe('JSONB Field Validation', () => {
    it('should store and retrieve JSONB status field', async () => {
      const team = await teamRepository.save({
        name: `team-jsonb-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-jsonb-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const status: TestRunStatus = {
        evaluatingAdapt: 'COMPLETED',
      };

      const testRun = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'test',
        workload: 'loadTest',
        testRunId: `jsonb-test-${Date.now()}`,
        startTime: new Date(),
        status,
      });
      cleanup.testRuns.push(testRun.id);

      const found = await testRunRepository.findOne({
        where: { id: testRun.id },
      });

      expect(found?.status).toEqual(status);
      expect(found?.status?.evaluatingAdapt).toBe('COMPLETED');
    });

    it('should handle complex nested JSONB structures', async () => {
      const team = await teamRepository.save({
        name: `team-nested-jsonb-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-nested-jsonb-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const variables = {
        grafana: {
          instance: 'prod-grafana',
          dashboard: 'test-dashboard',
        },
        influxdb: {
          database: 'perfana',
          measurement: 'metrics',
        },
      };

      const testRun = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'test',
        workload: 'loadTest',
        testRunId: `nested-jsonb-test-${Date.now()}`,
        startTime: new Date(),
        variables: variables as any, // Testing JSONB storage of complex nested structures
      });
      cleanup.testRuns.push(testRun.id);

      const found = await testRunRepository.findOne({
        where: { id: testRun.id },
      });

      expect(found?.variables).toEqual(variables);
      expect((found?.variables as any)?.grafana?.instance).toBe('prod-grafana');
    });

    it('should handle null JSONB fields', async () => {
      const team = await teamRepository.save({
        name: `team-null-jsonb-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-null-jsonb-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const testRun = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'test',
        workload: 'loadTest',
        testRunId: `null-jsonb-test-${Date.now()}`,
        startTime: new Date(),
      });
      cleanup.testRuns.push(testRun.id);

      expect(testRun.status).toBeUndefined();
      expect(testRun.variables).toBeUndefined();
    });

    it('should query JSONB fields using PostgreSQL operators', async () => {
      const team = await teamRepository.save({
        name: `team-jsonb-query-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-jsonb-query-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const status: TestRunStatus = {
        evaluatingAdapt: 'EVALUATING',
      };

      const testRun = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'test',
        workload: 'loadTest',
        testRunId: `jsonb-query-test-${Date.now()}`,
        startTime: new Date(),
        status,
      });
      cleanup.testRuns.push(testRun.id);

      const found = await testRunRepository
        .createQueryBuilder('tr')
        .where("tr.status->>'evaluatingAdapt' = :value", { value: 'EVALUATING' })
        .getMany();

      expect(found.some(tr => tr.id === testRun.id)).toBe(true);
    });
  });

  describe('Timestamp Handling', () => {
    it('should automatically set createdAt and updatedAt', async () => {
      const team = await teamRepository.save({
        name: `team-timestamp-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-timestamp-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const beforeCreate = new Date();
      await new Promise(resolve => setTimeout(resolve, 10));

      const testRun = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'test',
        workload: 'loadTest',
        testRunId: `timestamp-test-${Date.now()}`,
        startTime: new Date(),
      });
      cleanup.testRuns.push(testRun.id);

      await new Promise(resolve => setTimeout(resolve, 10));
      const afterCreate = new Date();

      expect(testRun.createdAt).toBeInstanceOf(Date);
      expect(testRun.updatedAt).toBeInstanceOf(Date);
      expect(testRun.createdAt.getTime()).toBeGreaterThan(beforeCreate.getTime());
      expect(testRun.createdAt.getTime()).toBeLessThan(afterCreate.getTime());
    });

    it('should update updatedAt on modification', async () => {
      const team = await teamRepository.save({
        name: `team-update-timestamp-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-update-timestamp-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const testRun = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'test',
        workload: 'loadTest',
        testRunId: `update-timestamp-test-${Date.now()}`,
        startTime: new Date(),
      });
      cleanup.testRuns.push(testRun.id);

      const originalUpdatedAt = testRun.updatedAt;

      // Wait to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 100));

      const updated = await testRunRepository.save({
        ...testRun,
        completed: true,
      });

      expect(updated.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    });

    it('should handle timezone-aware timestamps', async () => {
      const team = await teamRepository.save({
        name: `team-tz-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-tz-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const startTime = new Date('2024-06-15T10:00:00Z');

      const testRun = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'test',
        workload: 'loadTest',
        testRunId: `tz-test-${Date.now()}`,
        startTime,
      });
      cleanup.testRuns.push(testRun.id);

      const found = await testRunRepository.findOne({
        where: { id: testRun.id },
      });

      expect(found?.startTime).toBeInstanceOf(Date);
      // Compare timestamps (may have slight differences due to timezone conversion)
      expect(Math.abs(found!.startTime!.getTime() - startTime.getTime())).toBeLessThan(1000);
    });
  });

  describe('Data Type Validation', () => {
    it('should handle integer fields correctly', async () => {
      const team = await teamRepository.save({
        name: `team-int-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-int-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const testRun = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'test',
        workload: 'loadTest',
        testRunId: `int-test-${Date.now()}`,
        startTime: new Date(),
        duration: 3600,
        plannedDuration: 3000,
        rampUp: 300,
      });
      cleanup.testRuns.push(testRun.id);

      expect(testRun.duration).toBe(3600);
      expect(testRun.plannedDuration).toBe(3000);
      expect(testRun.rampUp).toBe(300);
    });

    it('should handle varchar length limits', async () => {
      const team = await teamRepository.save({
        name: `team-varchar-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-varchar-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      // Test normal length (within limit)
      const normalTestRun = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'test',
        workload: 'loadTest',
        testRunId: `varchar-normal-${Date.now()}`,
        startTime: new Date(),
      });
      cleanup.testRuns.push(normalTestRun.id);

      expect(normalTestRun.testEnvironment.length).toBeLessThanOrEqual(255);
      expect(normalTestRun.workload.length).toBeLessThanOrEqual(255);
    });

    it('should handle text fields without length limits', async () => {
      const system = await systemRepository.save({
        name: `system-text-${Date.now()}`,
        description: 'A'.repeat(10000), // Very long description
      });
      cleanup.systems.push(system.id);

      expect(system.description.length).toBe(10000);
    });
  });

  describe('Cascade and Orphan Removal', () => {
    it('should handle deletion of parent entity', async () => {
      const team = await teamRepository.save({
        name: `team-cascade-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-cascade-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const testRun = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'test',
        workload: 'loadTest',
        testRunId: `cascade-test-${Date.now()}`,
        startTime: new Date(),
      });
      cleanup.testRuns.push(testRun.id);

      // Attempt to delete system (should fail due to FK constraint)
      await expect(async () => {
        await systemRepository.delete(system.id);
      }).rejects.toThrow();
    });

    it('should clean up child entities when allowed', async () => {
      const team = await teamRepository.save({
        name: `team-cleanup-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-cleanup-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const testRun = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'test',
        workload: 'loadTest',
        testRunId: `cleanup-test-${Date.now()}`,
        startTime: new Date(),
      });
      cleanup.testRuns.push(testRun.id);

      const config = await configRepository.save({
        testRunId: testRun.id,
        key: 'test.key',
        value: 'test.value',
      });

      const configId = config.id;

      // Delete test run
      await testRunRepository.delete(testRun.id);

      // Configuration may still exist depending on cascade settings
      // This test verifies we can query without errors
      await configRepository.findOne({
        where: { id: configId },
      });

      // Remove from cleanup lists
      const trIndex = cleanup.testRuns.indexOf(testRun.id);
      if (trIndex > -1) cleanup.testRuns.splice(trIndex, 1);
    });
  });

  describe('Concurrent Access and Locking', () => {
    it('should handle concurrent inserts', async () => {
      const team = await teamRepository.save({
        name: `team-concurrent-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-concurrent-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          testRunRepository.save({
            systemUnderTestId: system.id,
            testEnvironment: 'test',
            workload: 'loadTest',
            testRunId: `concurrent-${Date.now()}-${i}`,
            startTime: new Date(),
          })
        );
      }

      const results = await Promise.all(promises);

      results.forEach(tr => cleanup.testRuns.push(tr.id));

      expect(results.length).toBe(10);
      expect(new Set(results.map(r => r.id)).size).toBe(10); // All unique
    });

    it('should handle concurrent updates to same entity', async () => {
      const team = await teamRepository.save({
        name: `team-concurrent-update-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-concurrent-update-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const testRun = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'test',
        workload: 'loadTest',
        testRunId: `concurrent-update-${Date.now()}`,
        startTime: new Date(),
        duration: 0,
      });
      cleanup.testRuns.push(testRun.id);

      // Concurrent updates
      const updates = [];
      for (let i = 1; i <= 5; i++) {
        updates.push(
          testRunRepository.update(testRun.id, {
            duration: i * 1000,
          })
        );
      }

      await Promise.all(updates);

      const final = await testRunRepository.findOne({
        where: { id: testRun.id },
      });

      // One of the updates should have won
      expect(final?.duration).toBeDefined();
      expect(final!.duration! % 1000).toBe(0);
    });
  });

  describe('Index Performance', () => {
    it('should use index on testRunId for fast lookups', async () => {
      const team = await teamRepository.save({
        name: `team-index-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-index-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const testRunId = `index-test-${Date.now()}`;

      const testRun = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'test',
        workload: 'loadTest',
        testRunId,
        startTime: new Date(),
      });
      cleanup.testRuns.push(testRun.id);

      const startTime = Date.now();

      const found = await testRunRepository.findOne({
        where: { testRunId },
      });

      const duration = Date.now() - startTime;

      expect(found?.id).toBe(testRun.id);
      expect(duration).toBeLessThan(100); // Should be fast with index
    });

    it('should use composite index on system, environment, workload', async () => {
      const team = await teamRepository.save({
        name: `team-composite-${Date.now()}`,
        description: 'Test team',
      });
      cleanup.teams.push(team.id);

      const system = await systemRepository.save({
        team_id: team.id,
        name: `system-composite-${Date.now()}`,
        description: 'Test system',
      });
      cleanup.systems.push(system.id);

      const testRun = await testRunRepository.save({
        systemUnderTestId: system.id,
        testEnvironment: 'production',
        workload: 'loadTest',
        testRunId: `composite-index-${Date.now()}`,
        startTime: new Date(),
      });
      cleanup.testRuns.push(testRun.id);

      const startTime = Date.now();

      const found = await testRunRepository.find({
        where: {
          systemUnderTestId: system.id,
          testEnvironment: 'production',
          workload: 'loadTest',
        },
      });

      const duration = Date.now() - startTime;

      expect(found.some(tr => tr.id === testRun.id)).toBe(true);
      expect(duration).toBeLessThan(100); // Should be fast with composite index
    });
  });
});
