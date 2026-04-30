import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Benchmark as BenchmarkEntity } from '../../../entities';
import {
  Benchmark,
  BenchmarkQuery,
  BenchmarkTagSyncStatus,
} from './benchmark-query.types';
import { BenchmarkMapper } from './benchmark.mapper';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { withOrgFilter } from '../../../common/utils/with-org-filter';
import { OwnedResource } from '@perfana/shared';

/**
 * Service responsible for benchmark query and validation operations.
 * Handles: findAll, findOne, filtering, and tag sync status queries.
 *
 * Authorization:
 * - All query methods accept userId and roles parameters for authorization
 * - Currently Benchmark entity does not have organization_id, so all data is treated as legacy
 * - When organization_id is added to Benchmark (Phase 4), authorization filtering will be enabled
 * - Global admins bypass all authorization checks
 */
@Injectable()
export class BenchmarkQueryService {
  private readonly logger = new Logger(BenchmarkQueryService.name);

  constructor(
    @InjectRepository(BenchmarkEntity)
    private readonly benchmarkRepo: Repository<BenchmarkEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly authzService: AuthorizationService,
  ) {}

  /**
   * Find all benchmarks with optional filtering
   *
   * @param userId - The user ID for authorization checks
   * @param roles - The user's roles for authorization checks
   * @param query - Optional query filters
   *
   * Filters benchmarks by user's accessible organizations via system_under_test.organization_id.
   * Global admins see all benchmarks.
   */
  async findAll(userId: string, roles: string[], query: BenchmarkQuery = {}): Promise<Benchmark[]> {
    try {
      // Resolve accessible org IDs: null means global admin (no filter needed)
      const orgIds = await withOrgFilter(userId, roles, this.authzService);
      this.logger.log(`[findAll] START - userId=${userId}, isGlobalAdmin=${orgIds === null}`);

      const queryBuilder = this.benchmarkRepo
        .createQueryBuilder('b')
        .leftJoinAndSelect('b.system_under_test', 'sut');

      // Apply organization filtering for non-admin users
      if (orgIds !== null) {
        this.logger.log(`[findAll] NON-ADMIN PATH - User ${userId} has access to organizations: ${orgIds.join(', ')}`);

        // Filter by system_under_test organization_id, including legacy systems with null org_id
        if (orgIds.length === 0) {
          queryBuilder.andWhere('sut.organization_id IS NULL');
        } else {
          queryBuilder.andWhere('(sut.organization_id IN (:...orgIds) OR sut.organization_id IS NULL)', { orgIds });
        }
      }

      if (query.systemUnderTestId) {
        queryBuilder.andWhere('b.system_under_test_id = :systemId', {
          systemId: query.systemUnderTestId
        });
      }

      if (query.testEnvironment) {
        queryBuilder.andWhere('b.test_environment = :environment', {
          environment: query.testEnvironment
        });
      }

      if (query.workload) {
        queryBuilder.andWhere('b.workload = :workload', {
          workload: query.workload
        });
      }

      if (query.enabled === 'true') {
        queryBuilder.andWhere('b.enabled = :enabled', { enabled: true });
      } else if (query.enabled === 'false') {
        queryBuilder.andWhere('b.enabled = :enabled', { enabled: false });
      }

      if (query.valid === 'true') {
        queryBuilder.andWhere('b.valid = :valid', { valid: true });
      } else if (query.valid === 'false') {
        queryBuilder.andWhere('b.valid = :valid', { valid: false });
      }

      if (query.benchmarkType) {
        queryBuilder.andWhere('b.benchmark_type = :benchmarkType', {
          benchmarkType: query.benchmarkType
        });
      }

      if (query.metricsSourceId) {
        queryBuilder.andWhere('b.metrics_source_id = :metricsSourceId', {
          metricsSourceId: query.metricsSourceId
        });
      }

      queryBuilder
        .orderBy('b.config_title', 'ASC')
        .addOrderBy('b.created_at', 'ASC');

      const results = await queryBuilder.getMany();

      this.logger.log(`[findAll] Found ${results.length} benchmarks${orgIds === null ? ' (admin)' : ` (filtered by organizations)`}`);

      return results.map(row => BenchmarkMapper.mapEntityToBenchmark(row));
    } catch (error) {
      this.logger.error('Failed to fetch benchmarks:', error);
      throw error;
    }
  }

  /**
   * Find a single benchmark by ID
   *
   * @param id - The benchmark ID
   * @param userId - The user ID for authorization checks
   * @param roles - The user's roles for authorization checks
   *
   * Checks organization access via system_under_test.organization_id.
   * Global admins can access all benchmarks.
   */
  async findOne(id: string, userId: string, roles: string[]): Promise<Benchmark | null> {
    try {
      this.logger.log(`[findOne] START - id=${id}, userId=${userId}`);

      const result = await this.benchmarkRepo.findOne({
        where: { id },
        relations: ['system_under_test']
      });

      if (!result) {
        this.logger.log(`[findOne] Benchmark not found: ${id}`);
        return null;
      }

      // Delegate the admin / legacy-null-org / membership decision to AuthorizationService.
      // team_id is omitted to preserve the prior behavior of not checking team membership.
      // created_by is unused by canAccessResource.
      const accessResult = await this.authzService.canAccessResource(userId, roles, {
        organization_id: result.system_under_test?.organization_id,
        created_by: '',
      } as OwnedResource);
      if (!accessResult.allowed) {
        this.logger.warn(`[findOne] Access denied: user ${userId} attempted to access benchmark ${id} (${accessResult.reason})`);
        return null;
      }

      this.logger.log(`[findOne] Access granted for benchmark ${id}`);
      return BenchmarkMapper.mapEntityToBenchmark(result);
    } catch (error) {
      this.logger.error(`Failed to fetch benchmark ${id}:`, error);
      return null;
    }
  }

  /**
   * Get unique environments and workloads for a system under test
   *
   * @param systemUnderTestId - The system under test ID
   * @param userId - The user ID for authorization checks
   * @param roles - The user's roles for authorization checks
   *
   * Returns environments/workloads only if user has access to the system's organization.
   */
  async getSystemEnvironmentsAndWorkloads(
    systemUnderTestId: string,
    userId: string,
    roles: string[],
  ): Promise<{
    environments: string[];
    workloads: string[];
  }> {
    try {
      // Resolve accessible org IDs: null means global admin (no filter needed)
      const orgIds = await withOrgFilter(userId, roles, this.authzService);
      this.logger.log(`[getSystemEnvironmentsAndWorkloads] START - systemId=${systemUnderTestId}, userId=${userId}, isGlobalAdmin=${orgIds === null}`);

      const queryBuilder = this.benchmarkRepo
        .createQueryBuilder('b')
        .leftJoin('b.system_under_test', 'sut')
        .select(['b.test_environment', 'b.workload'])
        .where('b.system_under_test_id = :systemId', { systemId: systemUnderTestId })
        .andWhere('b.enabled = :enabled', { enabled: true })
        .andWhere('b.valid = :valid', { valid: true });

      // Apply organization filtering for non-admin users
      if (orgIds !== null) {
        // Include legacy systems with null org_id for backward compatibility
        if (orgIds.length === 0) {
          queryBuilder.andWhere('sut.organization_id IS NULL');
        } else {
          queryBuilder.andWhere('(sut.organization_id IN (:...orgIds) OR sut.organization_id IS NULL)', { orgIds });
        }
      }

      const results = await queryBuilder.getMany();

      // Extract unique environments and workloads
      const environments = [...new Set(results.map(row => row.test_environment))].sort();
      const workloads = [...new Set(results.map(row => row.workload))].sort();

      this.logger.log(`[getSystemEnvironmentsAndWorkloads] Found ${environments.length} environments and ${workloads.length} workloads for system ${systemUnderTestId}`);

      return {
        environments,
        workloads
      };
    } catch (error) {
      this.logger.error('Failed to fetch system environments and workloads:', error);
      throw error;
    }
  }

  /**
   * Get the tag synchronization status between benchmarks and application dashboards
   *
   * @param userId - The user ID for authorization checks
   * @param roles - The user's roles for authorization checks
   *
   * Filters results by user's accessible organizations via system_under_test.
   */
  async getBenchmarkTagSyncStatus(userId: string, roles: string[]): Promise<BenchmarkTagSyncStatus[]> {
    try {
      // Resolve accessible org IDs: null means global admin (no filter needed)
      const orgIds = await withOrgFilter(userId, roles, this.authzService);
      this.logger.log(`[getBenchmarkTagSyncStatus] START - userId=${userId}, isGlobalAdmin=${orgIds === null}`);

      // For non-admin users, filter by organization
      if (orgIds !== null) {
        // Include legacy systems with null org_id for backward compatibility
        const result = await this.dataSource.query(`
          SELECT bts.*
          FROM benchmark_tag_sync_status bts
          INNER JOIN benchmarks b ON bts.benchmark_id = b.id
          INNER JOIN systems_under_test sut ON b.system_under_test_id = sut.id
          WHERE (sut.organization_id = ANY($1::uuid[]) OR sut.organization_id IS NULL)
          ORDER BY bts.system_name, bts.dashboard_label, bts.config_title
        `, [orgIds]);

        this.logger.log(`[getBenchmarkTagSyncStatus] Retrieved ${result.length} tag sync statuses (filtered)`);
        return result;
      }

      // Admin users see all
      const result = await this.dataSource.query(`
        SELECT *
        FROM benchmark_tag_sync_status
        ORDER BY system_name, dashboard_label, config_title
      `);

      this.logger.log(`[getBenchmarkTagSyncStatus] Retrieved ${result.length} tag sync statuses (admin)`);
      return result;
    } catch (error) {
      this.logger.error('Failed to fetch benchmark tag sync status:', error);
      throw error;
    }
  }

  /**
   * Synchronize benchmark tags with application dashboard tags
   *
   * @param userId - The user ID for authorization checks
   * @param roles - The user's roles for authorization checks
   *
   * Note: This is an administrative operation that affects all benchmarks.
   * Authorization filtering will be added when Phase 4 adds organization_id column.
   */
  async syncTagsWithApplicationDashboards(userId: string, _roles: string[]): Promise<void> {
    try {
      this.logger.debug(`syncTagsWithApplicationDashboards: userId=${userId}`);

      // Call the PostgreSQL stored procedure to sync benchmark tags with application dashboard tags
      await this.dataSource.query('SELECT sync_benchmark_tags_with_application_dashboards()');

      this.logger.log('Successfully synchronized benchmark tags with application_dashboard tags');
    } catch (error) {
      this.logger.error('Failed to synchronize benchmark tags:', error);
      throw error;
    }
  }
}
