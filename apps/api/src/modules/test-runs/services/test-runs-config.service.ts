import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { withRequestEm } from '../../../common/db/request-em';
import {
  TestRun as TestRunEntity,
  SystemUnderTest as SystemEntity,
  ExpectedConfigChange,
  TestRunConfiguration as TestRunConfigEntity,
  SparseMetricExclusion,
} from '../../../entities';
import { OwnedResource } from '@perfana/shared';
import { AddTestRunConfigDto, AddTestRunConfigsDto, AddTestRunConfigJsonDto } from '../dto/test-run-config.dto';
import { CreateExpectedConfigChangeDto, ExpectedConfigChangeDto } from '../dto/expected-config-change.dto';
import { CreateSparseMetricExclusionDto, SparseMetricExclusionDto } from '../dto/sparse-metric-exclusion.dto';
import { ResourceNotFoundException, ValidationException } from '../../../common/exceptions/business.exception';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { withOrgFilter } from '../../../common/utils/with-org-filter';
import { AuditService } from '../../audit/audit.service';
import safeRegex from 'safe-regex';

@Injectable()
export class TestRunsConfigService {
  private readonly logger = new Logger(TestRunsConfigService.name);

  constructor(
    @InjectRepository(TestRunEntity)
    private testRunRepo: Repository<TestRunEntity>,
    @InjectRepository(SystemEntity)
    private systemRepo: Repository<SystemEntity>,
    @InjectRepository(ExpectedConfigChange)
    private expectedConfigChangeRepo: Repository<ExpectedConfigChange>,
    @InjectRepository(TestRunConfigEntity)
    private testRunConfigRepo: Repository<TestRunConfigEntity>,
    @InjectRepository(SparseMetricExclusion)
    private sparseMetricExclusionRepo: Repository<SparseMetricExclusion>,
    private dataSource: DataSource,
    private authzService: AuthorizationService,
    private readonly auditService: AuditService,
  ) {}


  async getTestRunConfigs(
    testRunId: string,
    system?: string,
    environment?: string,
    workload?: string,
    userId?: string,
    roles: string[] = [],
  ): Promise<Array<{key: string; value: string; tags: string[]}>> {
    try {
      const orgIds = await withOrgFilter(userId ?? '', roles, this.authzService);
      // Non-admin with no org memberships → empty list (preserves existing behavior)
      if (orgIds !== null && orgIds.length === 0) {
        this.logger.debug('User has no organization memberships, returning empty config list');
        return [];
      }

      let testRun: TestRunEntity | null = null;

      if (system && environment && workload) {
        // Find system first with team relation for organization filtering
        const systemQuery = withRequestEm(this.systemRepo).createQueryBuilder('sut')
          .leftJoin('sut.team', 'team')
          .where('sut.name = :name', { name: system })
          .select(['sut.id']);

        if (orgIds !== null) {
          systemQuery.andWhere('sut.organization_id IN (:...orgIds)', { orgIds });
        }

        const systemUnderTest = await systemQuery.getOne();

        if (!systemUnderTest) {
          throw new ResourceNotFoundException('System under test', system);
        }

        // Find test run with params
        testRun = await withRequestEm(this.testRunRepo).findOne({
          where: {
            testRunId,
            systemUnderTestId: systemUnderTest.id,
            testEnvironment: environment,
            workload
          },
          select: ['id', 'testRunId']
        });
      } else {
        // Find by test_run_id only, with organization filtering
        const testRunQuery = withRequestEm(this.testRunRepo).createQueryBuilder('tr')
          .leftJoin('tr.systemUnderTest', 'sut')
          .leftJoin('sut.team', 'team')
          .where('tr.testRunId = :testRunId', { testRunId })
          .select(['tr.id', 'tr.testRunId']);

        if (orgIds !== null) {
          testRunQuery.andWhere('sut.organization_id IN (:...orgIds)', { orgIds });
        }

        testRun = await testRunQuery.getOne();
      }

      if (!testRun) {
        throw new ResourceNotFoundException('Test run', testRunId);
      }

      // Get configurations
      const configs = await this.testRunConfigRepo.find({
        where: { testRunId: testRun.id },
        select: ['key', 'value', 'tags'],
        order: { key: 'ASC' }
      });

      this.logger.log(`Retrieved ${configs.length} config items for test run: ${testRunId}${orgIds === null ? ' (admin)' : ` (orgs: ${orgIds.length})`}`);
      return configs.map(c => ({
        key: c.key,
        value: c.value || '',
        tags: c.tags || []
      }));
    } catch (error) {
      this.logger.error(`Failed to get test run configs for ${testRunId}:`, error);
      throw error;
    }
  }

  async addTestRunConfig(configDto: AddTestRunConfigDto): Promise<void> {
    try {
      this.logger.log(`Looking up test run with test_run_id: ${configDto.testRunId}`);

      // Validate system under test exists
      const systemUnderTest = await withRequestEm(this.systemRepo).findOne({
        where: { name: configDto.systemUnderTest },
        select: ['id']
      });

      if (!systemUnderTest) {
        throw new ResourceNotFoundException('System under test', configDto.systemUnderTest);
      }

      // Try to find test run by test_run_id
      const testRun = await withRequestEm(this.testRunRepo).findOne({
        where: { testRunId: configDto.testRunId },
        select: ['id', 'systemUnderTestId']
      });

      if (testRun) {
        // Validate test run belongs to the specified system
        if (testRun.systemUnderTestId !== systemUnderTest.id) {
          throw new ValidationException(
            `Test run ${configDto.testRunId} does not belong to system ${configDto.systemUnderTest}`
          );
        }
        // Test run exists, use UUID foreign key with proper upsert
        // Use ON CONFLICT with tags_hash(tags) to allow same key with different tags
        const tagsLiteral = this.toPostgresArray(configDto.tags);
        await this.dataSource.query(
          `INSERT INTO test_run_configs (test_run_id, key, value, tags)
           VALUES ($1, $2, $3, $4::text[])
           ON CONFLICT (test_run_id, key, tags_hash(tags))
           DO UPDATE SET value = EXCLUDED.value`,
          [testRun.id, configDto.key, configDto.value, tagsLiteral]
        );
        this.logger.log(`Test run config upserted for existing test run ${configDto.testRunId}: ${configDto.key} = ${configDto.value}`);
      } else {
        // Test run doesn't exist yet, store with string ID
        // Convert tags array to PostgreSQL array literal format
        const tagsLiteral = this.toPostgresArray(configDto.tags);
        await this.dataSource.query(
          `INSERT INTO test_run_configs (test_run_id_string, key, value, tags)
           VALUES ($1, $2, $3, $4::text[])`,
          [configDto.testRunId, configDto.key, configDto.value, tagsLiteral]
        );
        this.logger.log(`Test run config stored for future test run ${configDto.testRunId}: ${configDto.key} = ${configDto.value}`);
      }
    } catch (error) {
      this.logger.error('Failed to add test run config:', error);
      throw error;
    }
  }

  async addTestRunConfigs(configsDto: AddTestRunConfigsDto): Promise<void> {
    try {
      // Validate system under test exists
      const systemUnderTest = await withRequestEm(this.systemRepo).findOne({
        where: { name: configsDto.systemUnderTest },
        select: ['id']
      });

      if (!systemUnderTest) {
        throw new ResourceNotFoundException('System under test', configsDto.systemUnderTest);
      }

      // Try to find test run
      const testRun = await withRequestEm(this.testRunRepo).findOne({
        where: { testRunId: configsDto.testRunId },
        select: ['id', 'systemUnderTestId']
      });

      // Convert tags array to PostgreSQL array literal format once (same tags for all items)
      const tagsLiteral = this.toPostgresArray(configsDto.tags);

      if (testRun) {
        // Validate test run belongs to the specified system
        if (testRun.systemUnderTestId !== systemUnderTest.id) {
          throw new ValidationException(
            `Test run ${configsDto.testRunId} does not belong to system ${configsDto.systemUnderTest}`
          );
        }
        // Test run exists, use UUID foreign key with proper upsert
        // Use ON CONFLICT with tags_hash(tags) to allow same key with different tags
        const values = configsDto.configItems.map((_item, idx) => {
          const offset = idx * 4;
          return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}::text[])`;
        }).join(', ');

        const params: (string | number | null)[] = [];
        configsDto.configItems.forEach(item => {
          params.push(testRun.id, item.key, item.value, tagsLiteral);
        });

        await this.dataSource.query(
          `INSERT INTO test_run_configs (test_run_id, key, value, tags)
           VALUES ${values}
           ON CONFLICT (test_run_id, key, tags_hash(tags))
           DO UPDATE SET value = EXCLUDED.value`,
          params
        );
        this.logger.log(`${configsDto.configItems.length} test run configs upserted for existing test run ${configsDto.testRunId}`);
      } else {
        // Test run doesn't exist yet, use raw SQL with string ID
        const values = configsDto.configItems.map((_item, idx) => {
          const offset = idx * 4;
          return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}::text[])`;
        }).join(', ');

        const params: (string | number | null)[] = [];
        configsDto.configItems.forEach(item => {
          params.push(configsDto.testRunId, item.key, item.value, tagsLiteral);
        });

        await this.dataSource.query(
          `INSERT INTO test_run_configs (test_run_id_string, key, value, tags)
           VALUES ${values}`,
          params
        );
        this.logger.log(`${configsDto.configItems.length} test run configs stored for future test run ${configsDto.testRunId}`);
      }
    } catch (error) {
      this.logger.error('Failed to add test run configs:', error);
      throw error;
    }
  }

  async associateStringBasedConfigs(testRunIdString: string, testRunUuid: string): Promise<void> {
    try {
      // Find configs with string-based test_run_id, keeping only the most recent for each (key, tags) combination
      // Using tags_hash(tags) to match the unique constraint on test_run_configs
      const stringConfigs = await this.dataSource.query(
        `SELECT DISTINCT ON (key, tags_hash(tags)) id, key, value, tags, created_at
         FROM test_run_configs
         WHERE test_run_id_string = $1 AND test_run_id IS NULL
         ORDER BY key, tags_hash(tags), created_at DESC`,
        [testRunIdString]
      );

      if (stringConfigs.length > 0) {
        // Get IDs of configs to keep
        const idsToKeep = stringConfigs.map((c: { id: string }) => c.id);

        // Delete duplicate configs (older ones with same key and tags)
        await this.dataSource.query(
          `DELETE FROM test_run_configs
           WHERE test_run_id_string = $1
           AND test_run_id IS NULL
           AND id NOT IN (${idsToKeep.map((_: string, idx: number) => `$${idx + 2}`).join(', ')})`,
          [testRunIdString, ...idsToKeep]
        );

        // Update remaining configs to associate with test run UUID
        await this.dataSource.query(
          `UPDATE test_run_configs
           SET test_run_id = $1, test_run_id_string = NULL
           WHERE test_run_id_string = $2 AND test_run_id IS NULL`,
          [testRunUuid, testRunIdString]
        );

        this.logger.log(`Associated ${stringConfigs.length} string-based configs with test run ${testRunIdString}`);
      }
    } catch (error) {
      this.logger.error(`Failed to associate string-based configs for ${testRunIdString}:`, error);
      // Don't throw - this is not critical
    }
  }

  /**
   * Add test run configurations by UUID (for internal use)
   * This method looks up the test run by UUID and adds configurations with the specified tags
   */
  async addTestRunConfigsByUuid(
    testRunUuid: string,
    tags: string[],
    configItems: Array<{ key: string; value: string }>
  ): Promise<void> {
    try {
      // Find test run by UUID
      const testRun = await withRequestEm(this.testRunRepo).findOne({
        where: { id: testRunUuid },
        select: ['id']
      });

      if (!testRun) {
        this.logger.warn(`Test run with UUID ${testRunUuid} not found, skipping config storage`);
        return;
      }

      // Convert tags array to PostgreSQL array literal format
      const tagsLiteral = this.toPostgresArray(tags);

      // Insert all config items
      for (const item of configItems) {
        await this.dataSource.query(
          `INSERT INTO test_run_configs (test_run_id, key, value, tags)
           VALUES ($1, $2, $3, $4::text[])
           ON CONFLICT (test_run_id, key, tags_hash(tags))
           DO UPDATE SET value = EXCLUDED.value`,
          [testRun.id, item.key, item.value, tagsLiteral]
        );
      }

      this.logger.log(`Stored ${configItems.length} config items for test run ${testRunUuid} with tags ${tags.join(', ')}`);
    } catch (error) {
      this.logger.error(`Failed to add test run configs by UUID for ${testRunUuid}:`, error);
      throw error;
    }
  }

  async addTestRunConfigJson(configJsonDto: AddTestRunConfigJsonDto): Promise<void> {
    try {
      // Validate regex patterns
      for (const include of configJsonDto.includes) {
        if (!safeRegex(include)) {
          throw new ValidationException('Malicious regex detected in includes pattern');
        }
      }

      for (const exclude of configJsonDto.excludes) {
        if (!safeRegex(exclude)) {
          throw new ValidationException('Malicious regex detected in excludes pattern');
        }
      }

      // Flatten JSON
      const flatJSON = this.flattenJSON(configJsonDto.json);
      const keyValuePairs: Array<{ key: string; value: string }> = [];

      Object.keys(flatJSON).forEach((key) => {
        if (keyValuePairs.length > 0) {
          const keyValuePairIndex = keyValuePairs.findIndex((keyValuePair) => {
            if (keyValuePair.key.includes('.')) {
              return (
                keyValuePair.key.replace(/\//g, '.').split('.')[
                  keyValuePair.key.replace(/\//g, '.').split('.').length - 1
                ] === 'name' &&
                key.replace(/\//g, '.').split('.')[
                  key.replace(/\//g, '.').split('.').length - 1
                ] === 'value' &&
                keyValuePair.key
                  .replace(/\//g, '.')
                  .split('.')
                  .slice(0, keyValuePair.key.split('.').length - 1)
                  .join('.') ===
                  key
                    .replace(/\//g, '.')
                    .split('.')
                    .slice(0, key.split('.').length - 1)
                    .join('.')
              );
            } else {
              return false;
            }
          });

          if (keyValuePairIndex !== -1) {
            const mergedKeyValuePair = {
              key:
                keyValuePairs[keyValuePairIndex]?.key
                  .replace(/\//g, '.')
                  .split('.')
                  .slice(0, keyValuePairs[keyValuePairIndex]?.key.split('.').length - 1)
                  .join('.') +
                '.' +
                keyValuePairs[keyValuePairIndex]?.value,
              value: String(flatJSON[key] ?? ''),
            };
            keyValuePairs[keyValuePairIndex] = mergedKeyValuePair;
          } else {
            keyValuePairs.push({ key: key, value: String(flatJSON[key] ?? '') });
          }
        } else {
          keyValuePairs.push({ key: key, value: String(flatJSON[key] ?? '') });
        }
      });

      // Find system under test
      const systemUnderTest = await withRequestEm(this.systemRepo).findOne({
        where: { name: configJsonDto.systemUnderTest },
        select: ['id']
      });

      if (!systemUnderTest) {
        throw new ResourceNotFoundException('System under test', configJsonDto.systemUnderTest);
      }

      // Find test run
      const testRun = await withRequestEm(this.testRunRepo).findOne({
        where: { testRunId: configJsonDto.testRunId },
        select: ['id']
      });

      // Filter configs based on include/exclude patterns
      const filteredPairs: Array<{ key: string; value: string }> = [];

      keyValuePairs.forEach((keyValuePair) => {
        const matchesInclude = configJsonDto.includes.some((whitelistMatch) =>
          keyValuePair.key.match(this.escapeRegExp(whitelistMatch))
        );

        if (matchesInclude) {
          const matchesExclude = configJsonDto.excludes.some((blacklistMatch) =>
            keyValuePair.key.match(this.escapeRegExp(blacklistMatch))
          );

          if (!matchesExclude) {
            filteredPairs.push({ key: keyValuePair.key, value: keyValuePair.value });
          }
        }
      });

      const tagsLiteral = this.toPostgresArray(configJsonDto.tags);

      if (filteredPairs.length > 0) {
        if (testRun) {
          // Test run exists — upsert with UUID FK
          const values = filteredPairs.map((_item, idx) => {
            const offset = idx * 4;
            return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}::text[])`;
          }).join(', ');

          const params: (string | number | null)[] = [];
          filteredPairs.forEach(item => {
            params.push(testRun.id, item.key, item.value, tagsLiteral);
          });

          await this.dataSource.query(
            `INSERT INTO test_run_configs (test_run_id, key, value, tags)
             VALUES ${values}
             ON CONFLICT (test_run_id, key, tags_hash(tags))
             DO UPDATE SET value = EXCLUDED.value`,
            params
          );
          this.logger.log(`${filteredPairs.length} test run configs upserted from JSON for ${configJsonDto.testRunId}`);
        } else {
          // Test run doesn't exist yet — store with string ID for later association
          const values = filteredPairs.map((_item, idx) => {
            const offset = idx * 4;
            return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}::text[])`;
          }).join(', ');

          const params: (string | number | null)[] = [];
          filteredPairs.forEach(item => {
            params.push(configJsonDto.testRunId, item.key, item.value, tagsLiteral);
          });

          await this.dataSource.query(
            `INSERT INTO test_run_configs (test_run_id_string, key, value, tags)
             VALUES ${values}`,
            params
          );
          this.logger.log(`${filteredPairs.length} test run configs stored from JSON for future test run ${configJsonDto.testRunId}`);
        }
      } else {
        this.logger.log(`No matching configs to insert from JSON for ${configJsonDto.testRunId}`);
      }
    } catch (error) {
      this.logger.error('Failed to add test run config from JSON:', error);
      throw error;
    }
  }

  private flattenJSON(obj: Record<string, unknown> = {}, res: Record<string, string> = {}, extraKey = ''): Record<string, string> {
    for (const key in obj) {
      if (typeof obj[key] !== 'object' || obj[key] === null) {
        res[extraKey + key] = String(obj[key]);
      } else {
        this.flattenJSON(obj[key] as Record<string, unknown>, res, `${extraKey}${key}.`);
      }
    }
    return res;
  }

  private escapeRegExp(pattern: string): string {
    return pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Convert a JavaScript array to PostgreSQL array literal format
   * e.g., ['a', 'b', 'c'] -> '{a,b,c}'
   * Handles escaping of special characters in array elements
   */
  private toPostgresArray(arr: string[] | undefined): string {
    if (!arr || arr.length === 0) {
      return '{}';
    }
    // Escape special characters in each element and wrap in curly braces
    const escaped = arr.map(item => {
      // Escape backslashes first, then double quotes, then wrap in quotes if needed
      const escapedItem = String(item)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');
      // If the item contains special characters, wrap it in double quotes
      if (escapedItem.includes(',') || escapedItem.includes('"') || escapedItem.includes('{') ||
          escapedItem.includes('}') || escapedItem.includes(' ') || escapedItem.includes('\\')) {
        return `"${escapedItem}"`;
      }
      return escapedItem;
    });
    return `{${escaped.join(',')}}`;
  }

  async getLatestConfigKeys(
    system: string,
    environment: string,
    workload: string,
    userId?: string,
    roles: string[] = [],
  ): Promise<string[]> {
    try {
      const orgIds = await withOrgFilter(userId ?? '', roles, this.authzService);
      // Non-admin with no org memberships → empty list
      if (orgIds !== null && orgIds.length === 0) {
        this.logger.debug('User has no organization memberships, returning empty config keys list');
        return [];
      }

      // Find system under test with organization filtering
      const systemQuery = withRequestEm(this.systemRepo).createQueryBuilder('sut')
        .leftJoin('sut.team', 'team')
        .where('sut.name = :name', { name: system })
        .select(['sut.id']);

      if (orgIds !== null) {
        systemQuery.andWhere('sut.organization_id IN (:...orgIds)', { orgIds });
      }

      const systemUnderTest = await systemQuery.getOne();

      if (!systemUnderTest) {
        this.logger.warn(`System under test not found: ${system}${orgIds !== null ? ' (or not accessible to user)' : ''}`);
        return [];
      }

      // Find latest test run
      const latestTestRun = await withRequestEm(this.testRunRepo).findOne({
        where: {
          systemUnderTestId: systemUnderTest.id,
          testEnvironment: environment,
          workload
        },
        select: ['id', 'testRunId'],
        order: { createdAt: 'DESC' }
      });

      if (!latestTestRun) {
        this.logger.warn(`No test runs found for ${system}/${environment}/${workload}`);
        return [];
      }

      // Get distinct config keys
      const configKeys = await this.testRunConfigRepo
        .createQueryBuilder('trc')
        .select('DISTINCT trc.key', 'key')
        .where('trc.testRunId = :testRunId', { testRunId: latestTestRun.id })
        .orderBy('trc.key', 'ASC')
        .getRawMany();

      const uniqueKeys = configKeys.map(item => item.key);

      this.logger.log(`Found ${uniqueKeys.length} distinct config keys for latest test run of ${system}/${environment}/${workload}${orgIds === null ? ' (admin)' : ` (orgs: ${orgIds.length})`}`);
      return uniqueKeys;
    } catch (error) {
      this.logger.error(`Failed to get latest config keys for ${system}/${environment}/${workload}:`, error);
      throw error;
    }
  }

  async getExpectedConfigChanges(
    system: string,
    environment: string,
    workload: string,
    userId?: string,
    roles: string[] = [],
  ): Promise<ExpectedConfigChangeDto[]> {
    try {
      const orgIds = await withOrgFilter(userId ?? '', roles, this.authzService);
      // Non-admin with no org memberships → empty list (preserves existing behavior)
      if (orgIds !== null && orgIds.length === 0) {
        this.logger.debug('User has no organization memberships, returning empty expected config changes list');
        return [];
      }

      // Find system under test with organization filtering
      const systemQuery = withRequestEm(this.systemRepo).createQueryBuilder('sut')
        .leftJoin('sut.team', 'team')
        .where('sut.name = :name', { name: system })
        .select(['sut.id']);

      if (orgIds !== null) {
        systemQuery.andWhere('sut.organization_id IN (:...orgIds)', { orgIds });
      }

      const systemUnderTest = await systemQuery.getOne();

      if (!systemUnderTest) {
        this.logger.warn(`System under test not found: ${system}${orgIds !== null ? ' (or not accessible to user)' : ''}`);
        return [];
      }

      const expectedChanges = await withRequestEm(this.expectedConfigChangeRepo).find({
        where: {
          system_under_test_id: systemUnderTest.id,
          test_environment: environment,
          workload
        },
        order: {
          config_key: 'ASC'
        }
      });

      const dtos: ExpectedConfigChangeDto[] = expectedChanges.map(entity => ({
        id: entity.id,
        system_under_test_id: entity.system_under_test_id,
        test_environment: entity.test_environment,
        workload: entity.workload,
        config_key: entity.config_key,
        reason: entity.description,
        created_at: entity.created_at.toISOString(),
        updated_at: entity.updated_at.toISOString()
      }));

      this.logger.log(`Retrieved ${dtos.length} expected config changes for ${system}-${environment}-${workload}${orgIds === null ? ' (admin)' : ` (orgs: ${orgIds.length})`}`);
      return dtos;
    } catch (error) {
      this.logger.error(`Failed to get expected config changes:`, error);
      throw error;
    }
  }

  async createExpectedConfigChange(createDto: CreateExpectedConfigChangeDto): Promise<ExpectedConfigChangeDto> {
    try {
      // Find system under test
      const systemUnderTest = await withRequestEm(this.systemRepo).findOne({
        where: { name: createDto.system },
        select: ['id']
      });

      if (!systemUnderTest) {
        throw new ResourceNotFoundException('System under test', createDto.system);
      }

      // Check if already exists
      let expectedChange = await withRequestEm(this.expectedConfigChangeRepo).findOne({
        where: {
          system_under_test_id: systemUnderTest.id,
          test_environment: createDto.environment,
          workload: createDto.workload,
          config_key: createDto.configKey
        }
      });

      if (expectedChange) {
        // Update existing — clone before-snapshot so the diff captures the
        // pre-update value (the in-place mutation below would otherwise alias
        // the post-update field).
        const before = Object.assign(new ExpectedConfigChange(), expectedChange);
        expectedChange.description = createDto.reason || undefined;
        const saved = await withRequestEm(this.expectedConfigChangeRepo).save(expectedChange);
        this.auditService.logUpdate(
          before as unknown as OwnedResource,
          saved as unknown as OwnedResource,
          { organizationIdOverride: before.organizationId ?? saved.organizationId },
        );
        expectedChange = saved;
      } else {
        // Create new
        expectedChange = this.expectedConfigChangeRepo.create({
          system_under_test_id: systemUnderTest.id,
          test_environment: createDto.environment,
          workload: createDto.workload,
          config_key: createDto.configKey,
          description: createDto.reason || undefined
        });
        const saved = await withRequestEm(this.expectedConfigChangeRepo).save(expectedChange);
        this.auditService.logCreate(saved as unknown as OwnedResource, {
          organizationIdOverride: saved.organizationId,
        });
        expectedChange = saved;
      }

      this.logger.log(`Created expected config change: ${createDto.configKey} for ${createDto.system}-${createDto.environment}-${createDto.workload}`);

      return {
        id: expectedChange.id,
        system_under_test_id: expectedChange.system_under_test_id,
        test_environment: expectedChange.test_environment,
        workload: expectedChange.workload,
        config_key: expectedChange.config_key,
        reason: expectedChange.description,
        created_at: expectedChange.created_at.toISOString(),
        updated_at: expectedChange.updated_at.toISOString()
      };
    } catch (error) {
      this.logger.error(`Failed to create expected config change:`, error);
      throw error;
    }
  }

  async deleteExpectedConfigChange(system: string, environment: string, workload: string, configKey: string): Promise<void> {
    try {
      // Find system under test
      const systemUnderTest = await withRequestEm(this.systemRepo).findOne({
        where: { name: system },
        select: ['id']
      });

      if (!systemUnderTest) {
        throw new ResourceNotFoundException('System under test', system);
      }

      // Phase 5a: load the existing row first so the audit row captures the
      // pre-delete state. The unique constraint on
      // (sut, env, workload, config_key) makes this at-most-one row.
      const existing = await withRequestEm(this.expectedConfigChangeRepo).findOne({
        where: {
          system_under_test_id: systemUnderTest.id,
          test_environment: environment,
          workload,
          config_key: configKey,
        },
      });

      if (existing) {
        this.auditService.logDelete(existing as unknown as OwnedResource, {
          organizationIdOverride: existing.organizationId,
        });
      }

      await withRequestEm(this.expectedConfigChangeRepo).delete({
        system_under_test_id: systemUnderTest.id,
        test_environment: environment,
        workload,
        config_key: configKey
      });

      this.logger.log(`Deleted expected config change: ${configKey} for ${system}-${environment}-${workload}`);
    } catch (error) {
      this.logger.error(`Failed to delete expected config change:`, error);
      throw error;
    }
  }

  // ==================== Sparse Metric Exclusions ====================

  async getSparseMetricExclusions(
    system: string,
    environment: string,
    workload: string,
  ): Promise<SparseMetricExclusionDto[]> {
    try {
      const systemUnderTest = await withRequestEm(this.systemRepo).findOne({
        where: { name: system },
        select: ['id'],
      });

      if (!systemUnderTest) {
        this.logger.warn(`System under test not found: ${system}`);
        return [];
      }

      const exclusions = await withRequestEm(this.sparseMetricExclusionRepo).find({
        where: {
          system_under_test_id: systemUnderTest.id,
          test_environment: environment,
          workload,
        },
        order: { dashboard_label: 'ASC', metric_name: 'ASC' },
      });

      return exclusions.map(e => ({
        id: e.id,
        system_under_test_id: e.system_under_test_id,
        test_environment: e.test_environment,
        workload: e.workload,
        dashboard_label: e.dashboard_label,
        metric_name: e.metric_name,
        reason: e.reason,
        created_at: e.created_at.toISOString(),
        updated_at: e.updated_at.toISOString(),
      }));
    } catch (error) {
      this.logger.error('Failed to get sparse metric exclusions:', error);
      throw error;
    }
  }

  async createSparseMetricExclusion(createDto: CreateSparseMetricExclusionDto): Promise<SparseMetricExclusionDto> {
    try {
      // Use provided UUID directly, fall back to name lookup
      let sutId = createDto.systemUnderTestId;
      if (!sutId) {
        const systemUnderTest = await withRequestEm(this.systemRepo).findOne({
          where: { name: createDto.system },
          select: ['id'],
        });
        if (!systemUnderTest) {
          throw new ResourceNotFoundException('System under test', createDto.system);
        }
        sutId = systemUnderTest.id;
      }

      // Upsert: update reason if already exists
      let exclusion = await withRequestEm(this.sparseMetricExclusionRepo).findOne({
        where: {
          system_under_test_id: sutId,
          test_environment: createDto.environment,
          workload: createDto.workload,
          dashboard_label: createDto.dashboardLabel,
          metric_name: createDto.metricName,
        },
      });

      if (exclusion) {
        // Update branch — clone before-snapshot for an accurate diff.
        const before = Object.assign(new SparseMetricExclusion(), exclusion);
        exclusion.reason = createDto.reason || undefined;
        const saved = await withRequestEm(this.sparseMetricExclusionRepo).save(exclusion);
        this.auditService.logUpdate(
          before as unknown as OwnedResource,
          saved as unknown as OwnedResource,
          { organizationIdOverride: before.organizationId ?? saved.organizationId },
        );
        exclusion = saved;
      } else {
        exclusion = this.sparseMetricExclusionRepo.create({
          system_under_test_id: sutId,
          test_environment: createDto.environment,
          workload: createDto.workload,
          dashboard_label: createDto.dashboardLabel,
          metric_name: createDto.metricName,
          reason: createDto.reason || undefined,
        });
        const saved = await withRequestEm(this.sparseMetricExclusionRepo).save(exclusion);
        this.auditService.logCreate(saved as unknown as OwnedResource, {
          organizationIdOverride: saved.organizationId,
        });
        exclusion = saved;
      }

      this.logger.log(
        `Created sparse metric exclusion: ${createDto.dashboardLabel} / ${createDto.metricName} for ${createDto.system}-${createDto.environment}-${createDto.workload}`,
      );

      return {
        id: exclusion.id,
        system_under_test_id: exclusion.system_under_test_id,
        test_environment: exclusion.test_environment,
        workload: exclusion.workload,
        dashboard_label: exclusion.dashboard_label,
        metric_name: exclusion.metric_name,
        reason: exclusion.reason,
        created_at: exclusion.created_at.toISOString(),
        updated_at: exclusion.updated_at.toISOString(),
      };
    } catch (error) {
      this.logger.error('Failed to create sparse metric exclusion:', error);
      throw error;
    }
  }

  async deleteSparseMetricExclusion(
    system: string,
    environment: string,
    workload: string,
    dashboardLabel: string,
    metricName: string,
  ): Promise<void> {
    try {
      const systemUnderTest = await withRequestEm(this.systemRepo).findOne({
        where: { name: system },
        select: ['id'],
      });

      if (!systemUnderTest) {
        throw new ResourceNotFoundException('System under test', system);
      }

      // Phase 5a: load the existing row first so the audit row captures the
      // pre-delete state. Unique constraint on
      // (sut, env, workload, dashboard_label, metric_name) ⇒ at-most-one row.
      const existing = await withRequestEm(this.sparseMetricExclusionRepo).findOne({
        where: {
          system_under_test_id: systemUnderTest.id,
          test_environment: environment,
          workload,
          dashboard_label: dashboardLabel,
          metric_name: metricName,
        },
      });

      if (existing) {
        this.auditService.logDelete(existing as unknown as OwnedResource, {
          organizationIdOverride: existing.organizationId,
        });
      }

      await withRequestEm(this.sparseMetricExclusionRepo).delete({
        system_under_test_id: systemUnderTest.id,
        test_environment: environment,
        workload,
        dashboard_label: dashboardLabel,
        metric_name: metricName,
      });

      this.logger.log(
        `Deleted sparse metric exclusion: ${dashboardLabel} / ${metricName} for ${system}-${environment}-${workload}`,
      );
    } catch (error) {
      this.logger.error('Failed to delete sparse metric exclusion:', error);
      throw error;
    }
  }
}
