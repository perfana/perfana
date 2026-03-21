import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ExpectedConfigChange,
  SystemUnderTest,
  Team,
  Organization,
  TestRun,
  TestRunConfiguration
} from '@perfana/shared/entities';

// Import all entity classes from the test entities barrel
import * as testEntities from './test-entities';
import * as fs from 'fs';
import * as path from 'path';

// Load testcontainers database config if available
let testDbConfig: any = {};
try {
  const configPath = path.join(__dirname, '../../.test-db-config.json');
  if (fs.existsSync(configPath)) {
    testDbConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    console.log('✓ Loaded testcontainers database config');
  }
} catch (error) {
  console.log('⚠️  Using default database config');
}

describe('Phase 5 Migration Validation Suite', () => {
  let app: INestApplication;
  let expectedConfigChangeRepo: Repository<ExpectedConfigChange>;
  let systemUnderTestRepo: Repository<SystemUnderTest>;
  let teamRepo: Repository<Team>;
  let organizationRepo: Repository<Organization>;

  // Test data for Phase 5 entities
  const testOrganization = {
    name: 'Test Organization Phase 5',
    description: 'Test organization for phase 5 validation'
  };

  const testTeam = {
    organization_id: '',
    name: 'Test Team Phase 5',
    description: 'Test team for phase 5 validation'
  };

  const testSystemUnderTest = {
    team_id: '',
    name: 'Test System Phase 5',
    description: 'Test system for phase 5 validation',
    tracing_service: 'jaeger',
    pyroscope_application: 'test-app',
    pyroscope_profiler: 'pyroscope'
  };

  const testExpectedConfigChange = {
    system_under_test_id: '',
    test_environment: 'test',
    workload: 'load-test',
    config_key: 'database.connection.pool.max',
    expected_value: '100',
    description: 'Increased connection pool for load testing'
  };

  beforeAll(async () => {
    // Get all entity classes as an array from the test entities barrel
    const entityClasses = Object.values(testEntities).filter(
      (value) => typeof value === 'function' && value.prototype,
    ) as any[];

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: ['.env.test', '.env.local', '.env'],
        }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: testDbConfig.host || process.env.TEST_DB_HOST || process.env.DB_HOST || 'localhost',
          port: testDbConfig.port || parseInt(process.env.TEST_DB_PORT || process.env.DB_PORT || '5432'),
          username: testDbConfig.username || process.env.TEST_DB_USERNAME || process.env.DB_USERNAME || 'perfana',
          password: testDbConfig.password || process.env.TEST_DB_PASSWORD || process.env.DB_PASSWORD || 'password',
          database: testDbConfig.database || process.env.TEST_DB_NAME || process.env.DB_NAME || 'perfana_test',
          entities: entityClasses,
          synchronize: true,
          logging: false,
          dropSchema: true,
        }),
        TypeOrmModule.forFeature([ExpectedConfigChange, SystemUnderTest, Team, Organization, TestRun, TestRunConfiguration]),
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // Wait for database connection to be fully established (fixes CI race condition)
    const dataSource = moduleFixture.get<DataSource>(DataSource);
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

    expectedConfigChangeRepo = moduleFixture.get<Repository<ExpectedConfigChange>>(
      getRepositoryToken(ExpectedConfigChange),
    );
    systemUnderTestRepo = moduleFixture.get<Repository<SystemUnderTest>>(
      getRepositoryToken(SystemUnderTest),
    );
    teamRepo = moduleFixture.get<Repository<Team>>(getRepositoryToken(Team));
    organizationRepo = moduleFixture.get<Repository<Organization>>(
      getRepositoryToken(Organization),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Phase 5: Expected Config Changes Entity', () => {
    let organizationId: string;
    let teamId: string;
    let systemUnderTestId: string;

    beforeAll(async () => {
      // Create prerequisite data
      try {
        const savedOrganization = await organizationRepo.save(testOrganization);
        organizationId = savedOrganization.id;
        console.log(`✓ Created organization: ${organizationId}`);

        const savedTeam = await teamRepo.save({
          ...testTeam,
          organization_id: organizationId
        });
        teamId = savedTeam.id;
        console.log(`✓ Created team: ${teamId}`);

        const savedSystem = await systemUnderTestRepo.save({
          ...testSystemUnderTest,
          team_id: teamId
        });
        systemUnderTestId = savedSystem.id;
        console.log(`✓ Created system: ${systemUnderTestId}`);

        // Verify the system exists
        const verifySystem = await systemUnderTestRepo.findOne({
          where: { id: systemUnderTestId }
        });
        if (!verifySystem) {
          throw new Error('System was not persisted correctly!');
        }
        console.log(`✓ Verified system exists in database`);
      } catch (error) {
        console.error('❌ Error in beforeAll setup:', error);
        throw error;
      }
    });

    afterEach(async () => {
      // Clear all expected config changes using proper method
      await expectedConfigChangeRepo.createQueryBuilder()
        .delete()
        .execute();
    });

    describe('CRUD Operations', () => {
      it('should create expected config change successfully', async () => {
        const changeData = {
          ...testExpectedConfigChange,
          system_under_test_id: systemUnderTestId
        };

        const savedChange = await expectedConfigChangeRepo.save(changeData);

        expect(savedChange).toBeDefined();
        expect(savedChange.id).toBeDefined();
        expect(savedChange.system_under_test_id).toBe(systemUnderTestId);
        expect(savedChange.test_environment).toBe('test');
        expect(savedChange.workload).toBe('load-test');
        expect(savedChange.config_key).toBe('database.connection.pool.max');
        expect(savedChange.expected_value).toBe('100');
        expect(savedChange.description).toBe('Increased connection pool for load testing');
        expect(savedChange.created_at).toBeDefined();
        expect(savedChange.updated_at).toBeDefined();
      });

      it('should retrieve expected config change by system, environment, and workload', async () => {
        const changeData = {
          ...testExpectedConfigChange,
          system_under_test_id: systemUnderTestId
        };

        await expectedConfigChangeRepo.save(changeData);

        const retrievedChanges = await expectedConfigChangeRepo.find({
          where: {
            system_under_test_id: systemUnderTestId,
            test_environment: 'test',
            workload: 'load-test'
          }
        });

        expect(retrievedChanges).toHaveLength(1);
        expect(retrievedChanges[0]?.config_key).toBe('database.connection.pool.max');
      });

      it('should update expected config change', async () => {
        const changeData = {
          ...testExpectedConfigChange,
          system_under_test_id: systemUnderTestId
        };

        const savedChange = await expectedConfigChangeRepo.save(changeData);
        const updatedChange = await expectedConfigChangeRepo.save({
          ...savedChange,
          description: 'Updated reason for connection pool increase'
        });

        expect(updatedChange.description).toBe('Updated reason for connection pool increase');
        expect(updatedChange.updated_at.getTime()).toBeGreaterThan(savedChange.updated_at.getTime());
      });

      it('should delete expected config change', async () => {
        const changeData = {
          ...testExpectedConfigChange,
          system_under_test_id: systemUnderTestId
        };

        const savedChange = await expectedConfigChangeRepo.save(changeData);
        await expectedConfigChangeRepo.delete(savedChange.id);

        const deletedChange = await expectedConfigChangeRepo.findOne({
          where: { id: savedChange.id }
        });

        expect(deletedChange).toBeNull();
      });
    });

    describe('Relationships', () => {
      it('should load system under test relationship', async () => {
        const changeData = {
          ...testExpectedConfigChange,
          system_under_test_id: systemUnderTestId
        };

        const savedChange = await expectedConfigChangeRepo.save(changeData);
        const changeWithRelation = await expectedConfigChangeRepo.findOne({
          where: { id: savedChange.id },
          relations: ['system_under_test']
        });

        expect(changeWithRelation).toBeDefined();
        expect(changeWithRelation!.system_under_test).toBeDefined();
        expect(changeWithRelation!.system_under_test!.id).toBe(systemUnderTestId);
        expect(changeWithRelation!.system_under_test!.name).toBe('Test System Phase 5');
      });

      it('should handle cascade delete when system under test is deleted', async () => {
        // Create a dedicated system for this test to avoid affecting other tests
        const dedicatedSystem = await systemUnderTestRepo.save({
          ...testSystemUnderTest,
          team_id: teamId,
          name: 'Dedicated System for Cascade Delete Test'
        });

        const changeData = {
          ...testExpectedConfigChange,
          system_under_test_id: dedicatedSystem.id
        };

        const savedChange = await expectedConfigChangeRepo.save(changeData);

        // Delete the dedicated system under test
        await systemUnderTestRepo.delete(dedicatedSystem.id);

        // Expected config change should be deleted due to CASCADE
        const deletedChange = await expectedConfigChangeRepo.findOne({
          where: { id: savedChange.id }
        });

        expect(deletedChange).toBeNull();
      });
    });

    describe('Constraints and Validation', () => {
      it.skip('should enforce unique constraint on system, environment, workload, and config key', async () => {
        const changeData = {
          ...testExpectedConfigChange,
          system_under_test_id: systemUnderTestId
        };

        // Create first expected config change
        await expectedConfigChangeRepo.save(changeData);

        // Attempt to create duplicate with same system, environment, workload, and config key
        // Create a fresh object so it's treated as a new insert, not an update
        await expect(
          expectedConfigChangeRepo.save({ ...changeData })
        ).rejects.toThrow();
      });

      it('should allow same config key for different systems', async () => {
        // Create second system under test
        const secondSystem = await systemUnderTestRepo.save({
          ...testSystemUnderTest,
          team_id: teamId,
          name: 'Second Test System Phase 5'
        });

        const firstChangeData = {
          ...testExpectedConfigChange,
          system_under_test_id: systemUnderTestId
        };

        const secondChangeData = {
          ...testExpectedConfigChange,
          system_under_test_id: secondSystem.id
        };

        // Both should save successfully
        const firstChange = await expectedConfigChangeRepo.save(firstChangeData);
        const secondChange = await expectedConfigChangeRepo.save(secondChangeData);

        expect(firstChange.id).toBeDefined();
        expect(secondChange.id).toBeDefined();
        expect(firstChange.id).not.toBe(secondChange.id);
      });

      it('should allow same config key for different environments or workloads', async () => {
        const prodChangeData = {
          ...testExpectedConfigChange,
          system_under_test_id: systemUnderTestId,
          test_environment: 'production'
        };

        const stressChangeData = {
          ...testExpectedConfigChange,
          system_under_test_id: systemUnderTestId,
          workload: 'stress-test'
        };

        // Both should save successfully
        const testChange = await expectedConfigChangeRepo.save({
          ...testExpectedConfigChange,
          system_under_test_id: systemUnderTestId
        });
        const prodChange = await expectedConfigChangeRepo.save(prodChangeData);
        const stressChange = await expectedConfigChangeRepo.save(stressChangeData);

        expect(testChange.id).toBeDefined();
        expect(prodChange.id).toBeDefined();
        expect(stressChange.id).toBeDefined();
      });
    });

    describe('Field Validation', () => {
      it('should handle optional fields correctly', async () => {
        const minimalChangeData = {
          system_under_test_id: systemUnderTestId,
          test_environment: 'test',
          workload: 'load-test',
          config_key: 'minimal.config.key'
          // expected_value and description are optional
        };

        const savedChange = await expectedConfigChangeRepo.save(minimalChangeData);

        expect(savedChange.id).toBeDefined();
        expect(savedChange.expected_value).toBeFalsy();
        expect(savedChange.description).toBeFalsy();
      });

      it('should enforce required fields', async () => {
        const incompleteData = {
          system_under_test_id: systemUnderTestId,
          test_environment: 'test'
          // Missing workload and config_key
        };

        await expect(
          expectedConfigChangeRepo.save(incompleteData)
        ).rejects.toThrow();
      });

      it('should handle long config keys (up to 500 characters)', async () => {
        const longConfigKey = 'a'.repeat(500);
        const changeData = {
          ...testExpectedConfigChange,
          system_under_test_id: systemUnderTestId,
          config_key: longConfigKey
        };

        const savedChange = await expectedConfigChangeRepo.save(changeData);
        expect(savedChange.config_key).toBe(longConfigKey);
      });

      it('should handle long description text', async () => {
        const longDescription = 'This is a very long description '.repeat(50);
        const changeData = {
          ...testExpectedConfigChange,
          system_under_test_id: systemUnderTestId,
          description: longDescription
        };

        const savedChange = await expectedConfigChangeRepo.save(changeData);
        expect(savedChange.description).toBe(longDescription);
      });
    });

    describe('Querying and Filtering', () => {
      beforeEach(async () => {
        // Create multiple expected config changes for testing
        const changes = [
          {
            ...testExpectedConfigChange,
            system_under_test_id: systemUnderTestId,
            config_key: 'database.pool.min',
            test_environment: 'test'
          },
          {
            ...testExpectedConfigChange,
            system_under_test_id: systemUnderTestId,
            config_key: 'database.pool.max',
            test_environment: 'production'
          },
          {
            ...testExpectedConfigChange,
            system_under_test_id: systemUnderTestId,
            config_key: 'cache.timeout',
            test_environment: 'staging',
            workload: 'stress-test'
          }
        ];

        await expectedConfigChangeRepo.save(changes);
      });

      it('should filter by test environment', async () => {
        const testChanges = await expectedConfigChangeRepo.find({
          where: { test_environment: 'test' }
        });

        expect(testChanges).toHaveLength(1);
        expect(testChanges[0]?.config_key).toBe('database.pool.min');
      });

      it('should filter by workload', async () => {
        const stressChanges = await expectedConfigChangeRepo.find({
          where: { workload: 'stress-test' }
        });

        expect(stressChanges).toHaveLength(1);
        expect(stressChanges[0]?.config_key).toBe('cache.timeout');
      });

      it('should filter by config key pattern', async () => {
        const databaseChanges = await expectedConfigChangeRepo
          .createQueryBuilder('change')
          .where('change.config_key LIKE :pattern', { pattern: 'database.%' })
          .getMany();

        expect(databaseChanges).toHaveLength(2);
        expect(databaseChanges.every(c => c.config_key.startsWith('database.'))).toBe(true);
      });

      it('should order by creation date', async () => {
        const orderedChanges = await expectedConfigChangeRepo.find({
          order: { created_at: 'DESC' }
        });

        expect(orderedChanges).toHaveLength(3);
        for (let i = 1; i < orderedChanges.length; i++) {
          expect(orderedChanges[i - 1]?.created_at?.getTime() || 0)
            .toBeGreaterThanOrEqual(orderedChanges[i]?.created_at?.getTime() || 0);
        }
      });
    });
  });

  describe('Integration with NativeDatabaseService', () => {
    it('should be compatible with native database service patterns', async () => {
      // Create a system under test for this test
      const savedOrganization = await organizationRepo.save(testOrganization);
      const savedTeam = await teamRepo.save({
        ...testTeam,
        organization_id: savedOrganization.id
      });
      const savedSystem = await systemUnderTestRepo.save({
        ...testSystemUnderTest,
        team_id: savedTeam.id
      });

      // Test that the entity works with the patterns used in NativeDatabaseService
      const changeData = {
        system_under_test_id: savedSystem.id,
        test_environment: 'integration',
        workload: 'integration-test',
        config_key: 'integration.test.config',
        expected_value: '50',
        description: 'Integration test configuration'
      };

      // Simulate NativeDatabaseService repository operations
      const savedChange = await expectedConfigChangeRepo.save(changeData);

      const retrievedChanges = await expectedConfigChangeRepo.find({
        where: {
          system_under_test_id: savedSystem.id,
          test_environment: 'integration',
          workload: 'integration-test'
        },
        relations: ['system_under_test'],
        order: { created_at: 'DESC' }
      });

      expect(retrievedChanges).toHaveLength(1);
      expect(retrievedChanges[0]?.id).toBe(savedChange.id);
      expect(retrievedChanges[0]?.system_under_test).toBeDefined();

      // Test deletion
      const deleteResult = await expectedConfigChangeRepo.delete(savedChange.id);
      expect(deleteResult.affected).toBe(1);
    });
  });
});