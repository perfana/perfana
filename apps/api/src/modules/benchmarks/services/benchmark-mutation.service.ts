import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Benchmark as BenchmarkEntity, SystemUnderTest } from '../../../entities';
import { BenchmarkQueryService } from './benchmark-query.service';
import { BenchmarkTagHelper } from './benchmark-tag.helper';
import { BenchmarkMapper } from './benchmark.mapper';
import { AuthorizationService } from '../../../common/services/authorization.service';
import type { OwnedResource } from '@perfana/shared';
import type { Benchmark } from './benchmark-query.types';
import type {
  CreateBenchmarkDto,
  UpdateBenchmarkDto,
  CreateApdexSloDto,
  UpdateApdexSloDto,
} from './benchmark-mutation.types';
import type { CopyBenchmarksDto } from '../dto/copy-benchmarks.dto';

// Re-export types
export type {
  CreateBenchmarkDto,
  UpdateBenchmarkDto,
  CreateApdexSloDto,
  UpdateApdexSloDto,
} from './benchmark-mutation.types';

/**
 * Service responsible for benchmark mutation operations.
 * Handles: create, update, delete, createApdexSlo, updateApdexSlo.
 *
 * Authorization:
 * - All mutation methods accept userId and roles parameters for authorization
 * - Currently Benchmark entity does not have organization_id, so all data is treated as legacy
 * - When organization_id is added to Benchmark (Phase 4), authorization checks will be enabled
 * - Global admins bypass all authorization checks
 */
@Injectable()
export class BenchmarkMutationService {
  private readonly logger = new Logger(BenchmarkMutationService.name);

  constructor(
    @InjectRepository(BenchmarkEntity)
    private readonly benchmarkRepo: Repository<BenchmarkEntity>,
    @InjectRepository(SystemUnderTest)
    private readonly systemRepo: Repository<SystemUnderTest>,
    private readonly queryService: BenchmarkQueryService,
    private readonly tagHelper: BenchmarkTagHelper,
    private readonly authzService: AuthorizationService,
  ) {}

  /**
   * Validate user has access to a system under test
   * @throws ForbiddenException if user doesn't have access
   */
  private async validateSystemAccess(systemId: string, userId: string, roles: string[]): Promise<void> {
    const system = await this.systemRepo.findOne({ where: { id: systemId } });
    if (!system) {
      throw new ForbiddenException(`System under test ${systemId} not found`);
    }

    const result = await this.authzService.canAccessResource(userId, roles, {
      organization_id: system.organization_id,
      created_by: system.created_by ?? '',
    } as OwnedResource);

    if (!result.allowed) {
      throw new ForbiddenException('You do not have access to this system');
    }
  }

  /**
   * Create a new benchmark
   *
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   * @param dto - The create benchmark DTO
   *
   * Validates user has access to the system_under_test before creating.
   */
  async create(userId: string, roles: string[], dto: CreateBenchmarkDto): Promise<Benchmark> {
    try {
      // Validate user has access to the system
      await this.validateSystemAccess(dto.systemUnderTestId, userId, roles);

      const tags = await this.tagHelper.inheritTagsFromDashboard(
        dto.applicationDashboardId,
        dto.tags,
      );

      const benchmark = this.benchmarkRepo.create({
        system_under_test_id: dto.systemUnderTestId,
        test_environment: dto.testEnvironment,
        workload: dto.workload,
        source: dto.source,
        grafana_instance: dto.grafanaInstance,
        dashboard_label: dto.dashboardLabel,
        dashboard_id: dto.dashboardId,
        dashboard_uid: dto.dashboardUid,
        application_dashboard_id: dto.applicationDashboardId || undefined,
        metrics_source_id: dto.metricsSourceId || undefined,
        panel_title: dto.panelTitle,
        config_title: dto.configTitle,
        metric_unit: dto.configuration?.yAxesFormat,
        evaluate_type: dto.evaluateType,
        requirement_operator: dto.requirementOperator,
        requirement_value: dto.requirementValue != null ? Number(dto.requirementValue) : undefined,
        enabled: true,
        valid: true,
        description: dto.description || '',
        tags,
        configuration: {
          title: dto.configTitle,
          id: `${dto.systemUnderTestId}-${dto.testEnvironment}-${dto.workload}-${Date.now()}`,
          type: dto.source || 'grafana',
          evaluateType: dto.evaluateType,
          requirement: { operator: dto.requirementOperator, value: dto.requirementValue },
          ...(dto.configuration || {}),
        },
        exclude_ramp_up_time: true,
        average_all: false,
        validate_with_default_if_no_data: false,
        metadata: {},
        // Set ownership tracking (created_by/updated_by exist on Benchmark entity)
        created_by: userId,
        updated_by: userId,
        // NOTE: organization_id and team_id will be set when Phase 4 adds those columns
      });

      const result = await this.benchmarkRepo.save(benchmark);
      this.logger.log(`Created new benchmark: ${result.config_title}`);

      return BenchmarkMapper.mapEntityToBenchmark(result);
    } catch (error) {
      this.logger.error('Failed to create benchmark:', error);
      throw error;
    }
  }

  /**
   * Update an existing benchmark
   *
   * @param id - The benchmark ID to update
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   * @param dto - The update benchmark DTO
   *
   * Note: Benchmark entity does not have organization_id yet, so permission checks are limited.
   * Full permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async update(id: string, userId: string, roles: string[], dto: UpdateBenchmarkDto): Promise<Benchmark | null> {
    try {
      const existing = await this.queryService.findOne(id, userId, roles);
      if (!existing) return null;

      // NOTE: Permission check will be added here when Benchmark entity has organization_id
      // For now, all benchmarks are modifiable (treated as legacy data)

      const tags = await this.tagHelper.getInheritedTagsForUpdate(
        dto.dashboardUid,
        dto.systemUnderTestId,
        dto.testEnvironment,
        dto.tags,
        existing.tags,
      );

      const updateData = this.buildUpdateData(dto, existing, tags);
      // Track who updated the resource
      updateData.updated_by = userId;

      await this.benchmarkRepo.update(id, updateData as any);

      const result = await this.benchmarkRepo.findOne({
        where: { id },
        relations: ['system_under_test'],
      });

      if (!result) throw new Error(`Failed to fetch updated benchmark ${id}`);

      this.logger.log(`Updated benchmark: ${result.config_title || id}`);
      return BenchmarkMapper.mapEntityToBenchmark(result);
    } catch (error) {
      this.logger.error(`Failed to update benchmark ${id}:`, error);
      throw error;
    }
  }

  /**
   * Delete a benchmark
   *
   * @param id - The benchmark ID to delete
   * @param userId - The user ID for authorization checks
   * @param roles - The user's roles for authorization checks
   *
   * Checks organization access before deleting via findOne.
   */
  async delete(id: string, userId: string, roles: string[]): Promise<boolean> {
    try {
      // Check if user has access to this benchmark (via findOne which checks organization)
      const existing = await this.queryService.findOne(id, userId, roles);
      if (!existing) {
        this.logger.warn(`[delete] Benchmark not found or access denied: ${id}`);
        return false;
      }

      // Clear references in tables that have FK to benchmarks (prevents FK violation)
      await this.benchmarkRepo.manager.query(
        `UPDATE ds_metric_statistics SET benchmark_id = NULL WHERE benchmark_id = $1`,
        [id],
      );
      await this.benchmarkRepo.manager.query(
        `UPDATE ds_tracked_differences SET benchmark_id = NULL WHERE benchmark_id = $1`,
        [id],
      );

      const result = await this.benchmarkRepo.delete(id);
      if (result.affected === 0) {
        this.logger.warn(`No benchmark found with id ${id} to delete`);
        return false;
      }
      this.logger.log(`Deleted benchmark: ${id}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to delete benchmark ${id}:`, error);
      throw error;
    }
  }

  /**
   * Copy benchmarks from a source scope to a target scope
   *
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   * @param dto - Copy parameters including source/target scopes and conflict strategy
   */
  async copyToScope(
    userId: string,
    roles: string[],
    dto: CopyBenchmarksDto,
  ): Promise<{ copied: number; skipped: number; total: number }> {
    await this.validateSystemAccess(dto.sourceSystemUnderTestId, userId, roles);
    await this.validateSystemAccess(dto.targetSystemUnderTestId, userId, roles);

    // Fetch source benchmarks
    let sourceBenchmarks = await this.benchmarkRepo.find({
      where: {
        system_under_test_id: dto.sourceSystemUnderTestId,
        test_environment: dto.sourceTestEnvironment,
        workload: dto.sourceWorkload,
      },
    });

    // Filter to specific IDs if provided
    if (dto.ids && dto.ids.length > 0) {
      const idSet = new Set(dto.ids);
      sourceBenchmarks = sourceBenchmarks.filter(b => idSet.has(b.id));
    }

    const total = sourceBenchmarks.length;
    let copied = 0;
    let skipped = 0;

    for (const benchmark of sourceBenchmarks) {
      // Check for existing benchmark in target scope using the same unique constraint fields
      const existing = await this.benchmarkRepo.findOne({
        where: {
          system_under_test_id: dto.targetSystemUnderTestId,
          test_environment: dto.targetTestEnvironment,
          workload: dto.targetWorkload,
          ...(benchmark.application_dashboard_id
            ? { application_dashboard_id: benchmark.application_dashboard_id }
            : {}),
          ...(benchmark.generic_check_id
            ? { generic_check_id: benchmark.generic_check_id }
            : {}),
          ...(benchmark.config_title
            ? { config_title: benchmark.config_title }
            : {}),
        },
      });

      if (existing && dto.conflictStrategy === 'skip') {
        skipped++;
        continue;
      }

      if (existing && dto.conflictStrategy === 'overwrite') {
        await this.benchmarkRepo.update(existing.id, {
          source: benchmark.source,
          grafana_instance: benchmark.grafana_instance,
          dashboard_label: benchmark.dashboard_label,
          dashboard_id: benchmark.dashboard_id,
          dashboard_uid: benchmark.dashboard_uid,
          panel_title: benchmark.panel_title,
          config_title: benchmark.config_title,
          metric_unit: benchmark.metric_unit,
          evaluate_type: benchmark.evaluate_type,
          requirement_operator: benchmark.requirement_operator,
          requirement_value: benchmark.requirement_value,
          description: benchmark.description,
          tags: benchmark.tags,
          configuration: benchmark.configuration,
          benchmark_type: benchmark.benchmark_type,
          transaction_name: benchmark.transaction_name,
          apdex_threshold_ms: benchmark.apdex_threshold_ms,
          min_apdex_score: benchmark.min_apdex_score,
          include_failed_requests: benchmark.include_failed_requests,
          exclude_ramp_up_time: benchmark.exclude_ramp_up_time,
          enabled: benchmark.enabled,
          valid: benchmark.valid,
          updated_by: userId,
        } as any);
        copied++;
        continue;
      }

      // Create new
      const newBenchmark = this.benchmarkRepo.create({
        system_under_test_id: dto.targetSystemUnderTestId,
        test_environment: dto.targetTestEnvironment,
        workload: dto.targetWorkload,
        source: benchmark.source,
        grafana_instance: benchmark.grafana_instance,
        dashboard_label: benchmark.dashboard_label,
        dashboard_id: benchmark.dashboard_id,
        dashboard_uid: benchmark.dashboard_uid,
        application_dashboard_id: benchmark.application_dashboard_id,
        metrics_source_id: benchmark.metrics_source_id,
        generic_check_id: benchmark.generic_check_id,
        panel_title: benchmark.panel_title,
        config_title: benchmark.config_title,
        metric_unit: benchmark.metric_unit,
        evaluate_type: benchmark.evaluate_type,
        requirement_operator: benchmark.requirement_operator,
        requirement_value: benchmark.requirement_value,
        description: benchmark.description,
        tags: benchmark.tags ?? [],
        configuration: benchmark.configuration,
        benchmark_type: benchmark.benchmark_type,
        transaction_name: benchmark.transaction_name,
        apdex_threshold_ms: benchmark.apdex_threshold_ms,
        min_apdex_score: benchmark.min_apdex_score,
        include_failed_requests: benchmark.include_failed_requests,
        exclude_ramp_up_time: benchmark.exclude_ramp_up_time,
        average_all: benchmark.average_all,
        validate_with_default_if_no_data: benchmark.validate_with_default_if_no_data,
        metadata: benchmark.metadata ?? {},
        enabled: benchmark.enabled,
        valid: benchmark.valid,
        created_by: userId,
        updated_by: userId,
      });

      await this.benchmarkRepo.save(newBenchmark);
      copied++;
    }

    this.logger.log(`Copied ${copied} benchmarks, skipped ${skipped} of ${total} total`);
    return { copied, skipped, total };
  }

  /**
   * Create an Apdex SLO benchmark
   *
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   * @param dto - The create Apdex SLO DTO
   *
   * Validates user has access to the system_under_test before creating.
   */
  async createApdexSlo(userId: string, roles: string[], dto: CreateApdexSloDto): Promise<Benchmark> {
    try {
      if (dto.minApdexScore < 0 || dto.minApdexScore > 1) {
        throw new Error('minApdexScore must be between 0 and 1');
      }

      // Validate user has access to the system
      await this.validateSystemAccess(dto.systemUnderTestId, userId, roles);

      const benchmark = this.benchmarkRepo.create({
        system_under_test_id: dto.systemUnderTestId,
        test_environment: dto.testEnvironment,
        workload: dto.workload,
        source: 'custom',
        benchmark_type: 'apdex',
        transaction_name: dto.transactionName || undefined,
        min_apdex_score: dto.minApdexScore,
        apdex_threshold_ms: dto.apdexThresholdMs || undefined,
        include_failed_requests: dto.includeFailedRequests ?? false,
        exclude_ramp_up_time: dto.excludeRampUpTime ?? true,
        description: dto.description || '',
        tags: dto.tags || [],
        enabled: true,
        valid: true,
        configuration: {
          type: 'apdex',
          title: dto.transactionName
            ? `Apdex SLO: ${dto.transactionName}`
            : 'Workload Apdex SLO',
        },
        metadata: {},
        // Set ownership tracking (created_by/updated_by exist on Benchmark entity)
        created_by: userId,
        updated_by: userId,
        // NOTE: organization_id and team_id will be set when Phase 4 adds those columns
      });

      const result = await this.benchmarkRepo.save(benchmark);
      this.logger.log(
        `Created Apdex SLO: ${dto.transactionName || 'Workload'} (min score: ${dto.minApdexScore})`,
      );

      return BenchmarkMapper.mapEntityToBenchmark(result);
    } catch (error) {
      this.logger.error('Failed to create Apdex SLO:', error);
      throw error;
    }
  }

  /**
   * Update an Apdex SLO benchmark
   *
   * @param id - The benchmark ID to update
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   * @param dto - The update Apdex SLO DTO
   *
   * Checks organization access before updating.
   */
  async updateApdexSlo(id: string, userId: string, roles: string[], dto: UpdateApdexSloDto): Promise<Benchmark | null> {
    try {
      // Check access via queryService.findOne (which validates organization access)
      const existing = await this.queryService.findOne(id, userId, roles);
      if (!existing) {
        this.logger.warn(`[updateApdexSlo] Benchmark not found or access denied: ${id}`);
        return null;
      }

      if (existing.benchmark_type !== 'apdex') {
        throw new Error('Cannot update a non-Apdex benchmark with Apdex-specific fields');
      }

      // Get the entity for update (we know it exists and user has access)
      const existingEntity = await this.benchmarkRepo.findOne({ where: { id } });
      if (!existingEntity) return null;

      if (dto.minApdexScore !== undefined && (dto.minApdexScore < 0 || dto.minApdexScore > 1)) {
        throw new Error('minApdexScore must be between 0 and 1');
      }

      const updateData = this.buildApdexUpdateData(dto, existingEntity);
      // Track who updated the resource
      updateData.updated_by = userId;

      await this.benchmarkRepo.update(id, updateData as any);

      const result = await this.benchmarkRepo.findOne({
        where: { id },
        relations: ['system_under_test'],
      });

      if (!result) throw new Error(`Failed to fetch updated Apdex SLO ${id}`);

      this.logger.log(`Updated Apdex SLO: ${id}`);
      return BenchmarkMapper.mapEntityToBenchmark(result);
    } catch (error) {
      this.logger.error(`Failed to update Apdex SLO ${id}:`, error);
      throw error;
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private buildUpdateData(
    dto: UpdateBenchmarkDto,
    existing: Benchmark,
    tags: string[],
  ): Partial<BenchmarkEntity> {
    const data: Partial<BenchmarkEntity> = { tags };

    // Simple field mappings
    if (dto.systemUnderTestId !== undefined) data.system_under_test_id = dto.systemUnderTestId;
    if (dto.testEnvironment !== undefined) data.test_environment = dto.testEnvironment;
    if (dto.workload !== undefined) data.workload = dto.workload;
    if (dto.source !== undefined) data.source = dto.source;
    if (dto.grafanaInstance !== undefined) data.grafana_instance = dto.grafanaInstance;
    if (dto.dashboardLabel !== undefined) data.dashboard_label = dto.dashboardLabel;
    if (dto.dashboardId !== undefined) data.dashboard_id = dto.dashboardId;
    if (dto.dashboardUid !== undefined) data.dashboard_uid = dto.dashboardUid;
    if (dto.panelTitle !== undefined) data.panel_title = dto.panelTitle;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.valid !== undefined) data.valid = dto.valid;

    // Dedicated column updates
    if (dto.evaluateType !== undefined) data.evaluate_type = dto.evaluateType;
    if (dto.requirementOperator !== undefined) data.requirement_operator = dto.requirementOperator;
    if (dto.requirementValue !== undefined) data.requirement_value = Number(dto.requirementValue);
    if (dto.configTitle !== undefined) data.config_title = dto.configTitle;

    // Configuration updates
    if (dto.configuration !== undefined) {
      const config = { ...existing.configuration, ...dto.configuration };

      if (dto.requirementOperator !== undefined || dto.requirementValue !== undefined) {
        const operator = dto.requirementOperator || existing.requirement_operator;
        const value = dto.requirementValue ?? existing.requirement_value;
        if (operator && value !== undefined) {
          config.requirement = { operator, value };
        }
      }

      if (dto.evaluateType !== undefined) config.evaluateType = dto.evaluateType;
      if (config.yAxesFormat) data.metric_unit = config.yAxesFormat as string;

      data.configuration = config;
    }

    if (dto.configTitle !== undefined && data.configuration) {
      data.configuration.title = dto.configTitle;
    }

    return data;
  }

  private buildApdexUpdateData(
    dto: UpdateApdexSloDto,
    existing: BenchmarkEntity,
  ): Partial<BenchmarkEntity> {
    const data: Partial<BenchmarkEntity> = {};

    if (dto.transactionName !== undefined) {
      data.transaction_name = dto.transactionName || undefined;
      data.configuration = {
        ...existing.configuration,
        title: dto.transactionName ? `Apdex SLO: ${dto.transactionName}` : 'Workload Apdex SLO',
      };
    }
    if (dto.minApdexScore !== undefined) data.min_apdex_score = dto.minApdexScore;
    if (dto.apdexThresholdMs !== undefined) {
      data.apdex_threshold_ms = dto.apdexThresholdMs === null ? undefined : dto.apdexThresholdMs;
    }
    if (dto.includeFailedRequests !== undefined) {
      data.include_failed_requests = dto.includeFailedRequests;
    }
    if (dto.excludeRampUpTime !== undefined) data.exclude_ramp_up_time = dto.excludeRampUpTime;
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.tags !== undefined) data.tags = dto.tags;

    return data;
  }
}
