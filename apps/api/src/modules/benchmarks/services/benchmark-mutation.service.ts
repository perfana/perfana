import { Injectable, Logger, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { Benchmark as BenchmarkEntity, SystemUnderTest } from '../../../entities';
import { withRequestEm } from '../../../common/db/request-em';
import { BenchmarkQueryService } from './benchmark-query.service';
import { BenchmarkTagHelper } from './benchmark-tag.helper';
import { BenchmarkMapper } from './benchmark.mapper';
import { AuthorizationService } from '../../../common/services/authorization.service';
import type { OwnedResource } from '@perfana/shared';
import type { Benchmark } from './benchmark-query.types';
import { AuditService } from '../../audit/audit.service';
import type {
  CreateBenchmarkDto,
  UpdateBenchmarkDto,
  CreateApdexSloDto,
  UpdateApdexSloDto,
  CreateAggregatedSloDto,
  UpdateAggregatedSloDto,
} from './benchmark-mutation.types';
import type { CopyBenchmarksDto } from '../dto/copy-benchmarks.dto';

/** `metric_unit` of a trend SLO: the slope is % of the series mean per hour, whatever the panel's unit. */
const TREND_UNIT = '%/h';

// Re-export types
export type {
  CreateBenchmarkDto,
  UpdateBenchmarkDto,
  CreateApdexSloDto,
  UpdateApdexSloDto,
  CreateAggregatedSloDto,
  UpdateAggregatedSloDto,
} from './benchmark-mutation.types';

/** The body is an untyped inline DTO, so the range check lives here beside minApdexScore's. `null` means reset to the default. The controller rethrows HttpExceptions as-is. */
function assertApdexMinSamples(value: number | null | undefined): void {
  if (value === undefined || value === null) return;
  if (!Number.isInteger(value) || value < 1 || value > 2147483647) {
    throw new BadRequestException('apdexMinSamples must be an integer of at least 1');
  }
}

/** Every column a copy carries. Scope, ownership, ids, timestamps and the baseline run stay behind. */
function cloneColumns(b: BenchmarkEntity) {
  return {
    source: b.source,
    grafana_instance: b.grafana_instance,
    dashboard_label: b.dashboard_label,
    dashboard_id: b.dashboard_id,
    dashboard_uid: b.dashboard_uid,
    application_dashboard_id: b.application_dashboard_id,
    metrics_source_id: b.metrics_source_id,
    generic_check_id: b.generic_check_id,
    panel_title: b.panel_title,
    config_title: b.config_title,
    config_id: b.config_id,
    config_type: b.config_type,
    metric_unit: b.metric_unit,
    evaluate_type: b.evaluate_type,
    requirement_operator: b.requirement_operator,
    requirement_value: b.requirement_value,
    description: b.description,
    tags: b.tags ?? [],
    configuration: b.configuration,
    benchmark_type: b.benchmark_type,
    transaction_name: b.transaction_name,
    apdex_threshold_ms: b.apdex_threshold_ms,
    min_apdex_score: b.min_apdex_score,
    include_failed_requests: b.include_failed_requests,
    exclude_ramp_up_time: b.exclude_ramp_up_time,
    apdex_min_samples: b.apdex_min_samples,
    aggregate_metric: b.aggregate_metric,
    aggregate_stat: b.aggregate_stat,
    average_all: b.average_all,
    match_pattern: b.match_pattern,
    validate_with_default_if_no_data: b.validate_with_default_if_no_data,
    validate_with_default_if_no_data_value: b.validate_with_default_if_no_data_value,
    alert_on_breach: b.alert_on_breach,
    alert_channels: b.alert_channels,
    metadata: b.metadata ?? {},
    enabled: b.enabled,
    valid: b.valid,
  };
}

/**
 * The columns that identify "the same SLO" inside one scope, per type. An apdex or aggregated
 * SLO has no dashboard, generic check or config title, so spreading those conditionally used to
 * leave the probe with the scope alone — it then matched whatever SLO the target happened to
 * hold first, skipping the copy or overwriting an unrelated row.
 */
function conflictKey(b: BenchmarkEntity): FindOptionsWhere<BenchmarkEntity> {
  switch (b.benchmark_type) {
    case 'apdex':
      return { benchmark_type: 'apdex', transaction_name: b.transaction_name };
    case 'aggregated':
      return { benchmark_type: 'aggregated', aggregate_metric: b.aggregate_metric, aggregate_stat: b.aggregate_stat };
    default:
      return {
        benchmark_type: b.benchmark_type,
        ...(b.application_dashboard_id ? { application_dashboard_id: b.application_dashboard_id } : {}),
        ...(b.generic_check_id ? { generic_check_id: b.generic_check_id } : {}),
        ...(b.config_title ? { config_title: b.config_title } : {}),
        ...(b.panel_title ? { panel_title: b.panel_title } : {}),
      };
  }
}

/**
 * Service responsible for benchmark mutation operations.
 * Handles: create, update, delete, createApdexSlo, updateApdexSlo.
 *
 * Authorization:
 * - All mutation methods accept userId and roles parameters for authorization
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
    private readonly auditService: AuditService,
  ) {}

  /**
   * Validate user has access to a system under test and return the loaded entity.
   * Callers use the returned system to inherit organizationId/teamId onto the
   * benchmark — Benchmark.organization_id is NOT NULL (Phase 4) and the benchmark
   * lives under the same org/team as its parent SUT.
   * @throws ForbiddenException if user doesn't have access
   */
  private async validateSystemAccess(
    systemId: string,
    userId: string,
    roles: string[],
  ): Promise<SystemUnderTest> {
    const system = await withRequestEm(this.systemRepo).findOne({ where: { id: systemId } });
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

    return system;
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
      // Validate user has access to the system and capture it to inherit org/team
      const system = await this.validateSystemAccess(dto.systemUnderTestId, userId, roles);

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
        // A trend is always % of the series mean per hour, whatever the panel's unit.
        metric_unit: dto.evaluateType === 'trend' ? TREND_UNIT : dto.configuration?.yAxesFormat,
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
        // Inherit ownership from the parent system_under_test. organizationId is
        // NOT NULL on Benchmark (Phase 4); TypeORM maps the camelCase property
        // organizationId → DB column organization_id, so the key MUST be camelCase.
        organizationId: system.organization_id,
        teamId: system.team_id,
        created_by: userId,
        updated_by: userId,
      });

      const result = await withRequestEm(this.benchmarkRepo).save(benchmark);

      // Phase 5a: Benchmark.organization_id maps to camelCase property
      // organizationId, so AuditService.dispatch cannot read it off ref
      // directly — pass organizationIdOverride so the audit row is org-scoped.
      this.auditService.logCreate(result as unknown as OwnedResource, {
        organizationIdOverride: result.organizationId,
      });

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

      // Phase 5a: rehydrate the entity prototype from the queryService DTO for
      // the audit before-snapshot. BenchmarkMapper preserves snake_case field
      // names (system_under_test_id, evaluate_type, configuration, etc.), so
      // Object.assign onto a fresh BenchmarkEntity gives a faithful before-row
      // for AuditService.dispatch to resolve auditableFields against.
      const beforeEntity = Object.assign(new BenchmarkEntity(), existing);

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

      // The edit dialog (and a duplicate being turned into a variant) may re-point the SLO
      // at another dashboard. The checks pipeline matches on application_dashboard_id and
      // the edit form re-matches on metrics_source_id, so both move together.
      if (dto.applicationDashboardId && dto.applicationDashboardId !== existing.application_dashboard_id) {
        updateData.application_dashboard_id = dto.applicationDashboardId;
        updateData.metrics_source_id = await this.tagHelper.metricsSourceIdOf(dto.applicationDashboardId);
      }

      await withRequestEm(this.benchmarkRepo).update(id, updateData as unknown as Parameters<typeof this.benchmarkRepo.update>[1]);

      const result = await withRequestEm(this.benchmarkRepo).findOne({
        where: { id },
        relations: ['system_under_test'],
      });

      if (!result) throw new Error(`Failed to fetch updated benchmark ${id}`);

      // Phase 5a: emit UPDATE audit row with the diff. organizationIdOverride
      // bridges the camelCase property / snake_case column mismatch.
      if (beforeEntity) {
        this.auditService.logUpdate(
          beforeEntity as unknown as OwnedResource,
          result as unknown as OwnedResource,
          { organizationIdOverride: beforeEntity.organizationId ?? result.organizationId },
        );
      }

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

      // Phase 5a: rehydrate the entity prototype from the queryService DTO
      // (BenchmarkMapper preserves snake_case field names, so Object.assign
      // gives a faithful pre-delete row for AuditService.dispatch to resolve
      // auditableFields against). Log DELETE before the FK null-out and the
      // actual remove so the audit row captures the pre-delete state.
      const entity = Object.assign(new BenchmarkEntity(), existing);
      this.auditService.logDelete(entity as unknown as OwnedResource, {
        organizationIdOverride: entity.organizationId,
      });

      // Clear references in tables that have FK to benchmarks (prevents FK violation).
      // Use the request-scoped EM via withRequestEm() so these raw queries inherit the
      // RLS interceptor's transaction-scoped GUCs.
      await withRequestEm(this.benchmarkRepo).manager.query(
        `UPDATE ds_metric_statistics SET benchmark_id = NULL WHERE benchmark_id = $1`,
        [id],
      );
      await withRequestEm(this.benchmarkRepo).manager.query(
        `UPDATE ds_tracked_differences SET benchmark_id = NULL WHERE benchmark_id = $1`,
        [id],
      );

      const result = await withRequestEm(this.benchmarkRepo).delete(id);
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
    const targetSystem = await this.validateSystemAccess(dto.targetSystemUnderTestId, userId, roles);

    // Fetch source benchmarks
    let sourceBenchmarks = await withRequestEm(this.benchmarkRepo).find({
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
      // Check for existing benchmark in target scope on the identity the type carries.
      const existing = await withRequestEm(this.benchmarkRepo).findOne({
        where: {
          system_under_test_id: dto.targetSystemUnderTestId,
          test_environment: dto.targetTestEnvironment,
          workload: dto.targetWorkload,
          ...conflictKey(benchmark),
        },
      });

      if (existing && dto.conflictStrategy === 'skip') {
        skipped++;
        continue;
      }

      if (existing && dto.conflictStrategy === 'overwrite') {
        // Phase 5a: clone `existing` for the before-snapshot so the diff
        // captures pre-overwrite values; the overwrite below is a SQL UPDATE
        // (not in-place mutation), but we re-fetch after to keep the audit
        // payload symmetric with the rest of the service.
        const beforeOverwrite = Object.assign(new BenchmarkEntity(), existing);

        await withRequestEm(this.benchmarkRepo).update(existing.id, {
          ...cloneColumns(benchmark),
          updated_by: userId,
        } as unknown as Parameters<typeof this.benchmarkRepo.update>[1]);

        // Re-fetch the persisted row so the audit diff sees the actual
        // post-update values (including any DB-side defaults / triggers).
        const afterOverwrite = await withRequestEm(this.benchmarkRepo).findOne({ where: { id: existing.id } });
        if (afterOverwrite) {
          this.auditService.logUpdate(
            beforeOverwrite as unknown as OwnedResource,
            afterOverwrite as unknown as OwnedResource,
            { organizationIdOverride: beforeOverwrite.organizationId ?? afterOverwrite.organizationId },
          );
        }

        copied++;
        continue;
      }

      // Create new
      const newBenchmark = this.benchmarkRepo.create({
        ...cloneColumns(benchmark),
        system_under_test_id: dto.targetSystemUnderTestId,
        test_environment: dto.targetTestEnvironment,
        workload: dto.targetWorkload,
        // Inherit ownership from the target SUT — copies live under the target's
        // org, not the source's. organizationId is NOT NULL on Benchmark.
        organizationId: targetSystem.organization_id,
        teamId: targetSystem.team_id,
        created_by: userId,
        updated_by: userId,
      });

      const savedNew = await withRequestEm(this.benchmarkRepo).save(newBenchmark);

      // Phase 5a: per-row CREATE audit (one row per persisted benchmark, per
      // the audit architecture's "one row per entity" rule).
      this.auditService.logCreate(savedNew as unknown as OwnedResource, {
        organizationIdOverride: savedNew.organizationId,
      });

      copied++;
    }

    this.logger.log(`Copied ${copied} benchmarks, skipped ${skipped} of ${total} total`);
    return { copied, skipped, total };
  }

  /**
   * Clone a benchmark into its own scope so the user can edit the copy into a variant.
   *
   * `generic_check_id` is dropped: it is the golden-path auto-config key and part of
   * `uq_benchmarks_unique`, so keeping it would both collide with the source and hand the
   * clone to grafana-sync to manage. A UI-created SLO never has one anyway.
   */
  async duplicate(id: string, userId: string, roles: string[]): Promise<Benchmark | null> {
    const source = await this.queryService.findOne(id, userId, roles);
    if (!source) return null;
    const system = await this.validateSystemAccess(source.system_under_test_id, userId, roles);

    const clone = this.benchmarkRepo.create({
      ...cloneColumns(source as unknown as BenchmarkEntity),
      generic_check_id: undefined,
      system_under_test_id: source.system_under_test_id,
      test_environment: source.test_environment,
      workload: source.workload,
      organizationId: system.organization_id,
      teamId: system.team_id,
      created_by: userId,
      updated_by: userId,
    });
    const saved = await withRequestEm(this.benchmarkRepo).save(clone);
    this.auditService.logCreate(saved as unknown as OwnedResource, {
      organizationIdOverride: saved.organizationId,
    });
    this.logger.log(`Duplicated benchmark ${id} as ${saved.id}`);
    return BenchmarkMapper.mapEntityToBenchmark(saved);
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
      assertApdexMinSamples(dto.apdexMinSamples);

      // Validate user has access to the system and capture it to inherit org/team
      const system = await this.validateSystemAccess(dto.systemUnderTestId, userId, roles);

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
        apdex_min_samples: dto.apdexMinSamples ?? 50,
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
        // Inherit ownership from the parent system_under_test. organizationId is
        // NOT NULL on Benchmark (Phase 4); the camelCase key matters because
        // TypeORM silently drops snake_case organization_id on entity create.
        organizationId: system.organization_id,
        teamId: system.team_id,
        created_by: userId,
        updated_by: userId,
      });

      const result = await withRequestEm(this.benchmarkRepo).save(benchmark);

      // Phase 5a: CREATE audit on the Apdex path (same shape as `create`).
      this.auditService.logCreate(result as unknown as OwnedResource, {
        organizationIdOverride: result.organizationId,
      });

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
      const existingEntity = await withRequestEm(this.benchmarkRepo).findOne({ where: { id } });
      if (!existingEntity) return null;

      if (dto.minApdexScore !== undefined && (dto.minApdexScore < 0 || dto.minApdexScore > 1)) {
        throw new Error('minApdexScore must be between 0 and 1');
      }
      assertApdexMinSamples(dto.apdexMinSamples);

      // Phase 5a: clone before-snapshot so the SQL-update-then-refetch flow
      // produces a faithful audit diff (the underlying `update` is a SQL
      // UPDATE, but `existingEntity` may share JSON references with the
      // refetched `result`).
      const beforeApdex = Object.assign(new BenchmarkEntity(), existingEntity);

      const updateData = this.buildApdexUpdateData(dto, existingEntity);
      // Track who updated the resource
      updateData.updated_by = userId;

      await withRequestEm(this.benchmarkRepo).update(id, updateData as unknown as Parameters<typeof this.benchmarkRepo.update>[1]);

      const result = await withRequestEm(this.benchmarkRepo).findOne({
        where: { id },
        relations: ['system_under_test'],
      });

      if (!result) throw new Error(`Failed to fetch updated Apdex SLO ${id}`);

      this.auditService.logUpdate(
        beforeApdex as unknown as OwnedResource,
        result as unknown as OwnedResource,
        { organizationIdOverride: beforeApdex.organizationId ?? result.organizationId },
      );

      this.logger.log(`Updated Apdex SLO: ${id}`);
      return BenchmarkMapper.mapEntityToBenchmark(result);
    } catch (error) {
      this.logger.error(`Failed to update Apdex SLO ${id}:`, error);
      throw error;
    }
  }

  /**
   * Create an Aggregated SLO benchmark
   *
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   * @param dto - The create Aggregated SLO DTO
   *
   * Validates user has access to the system_under_test before creating.
   */
  async createAggregatedSlo(userId: string, roles: string[], dto: CreateAggregatedSloDto): Promise<Benchmark> {
    const system = await this.validateSystemAccess(dto.systemUnderTestId, userId, roles);

    const statLabel = dto.aggregateStat
      ? dto.aggregateStat.charAt(0).toUpperCase() + dto.aggregateStat.slice(1)
      : '';
    const label = dto.aggregateMetric === 'error_percentage'
      ? 'Error Percentage'
      : `${statLabel ? statLabel + ' ' : ''}${dto.aggregateMetric === 'transaction_response_time' ? 'Transaction' : 'Request'} Response Times`;

    const benchmark = this.benchmarkRepo.create({
      system_under_test_id: dto.systemUnderTestId,
      test_environment: dto.testEnvironment,
      workload: dto.workload,
      source: 'custom',
      benchmark_type: 'aggregated',
      aggregate_metric: dto.aggregateMetric,
      aggregate_stat: dto.aggregateStat,
      requirement_operator: dto.requirementOperator,
      requirement_value: dto.requirementValue,
      exclude_ramp_up_time: dto.excludeRampUpTime ?? true,
      description: dto.description || '',
      tags: dto.tags || [],
      enabled: true,
      valid: true,
      panel_title: label,
      config_title: label,
      configuration: { type: 'aggregated', title: label },
      metadata: {},
      // Inherit ownership from the parent system_under_test. organizationId is
      // NOT NULL on Benchmark (Phase 4); the camelCase key matters because
      // TypeORM silently drops snake_case organization_id on entity create.
      organizationId: system.organization_id,
      teamId: system.team_id,
      created_by: userId,
      updated_by: userId,
    });

    const result = await withRequestEm(this.benchmarkRepo).save(benchmark);

    this.auditService.logCreate(result as unknown as OwnedResource, {
      organizationIdOverride: result.organizationId,
    });

    this.logger.log(`Created Aggregated SLO: ${label}`);
    return BenchmarkMapper.mapEntityToBenchmark(result);
  }

  /**
   * Update an Aggregated SLO benchmark
   *
   * @param id - The benchmark ID to update
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   * @param dto - The update Aggregated SLO DTO
   *
   * Checks organization access before updating.
   */
  async updateAggregatedSlo(id: string, userId: string, roles: string[], dto: UpdateAggregatedSloDto): Promise<Benchmark | null> {
    const existing = await this.queryService.findOne(id, userId, roles);
    if (!existing) {
      this.logger.warn(`[updateAggregatedSlo] Benchmark not found or access denied: ${id}`);
      return null;
    }

    if (existing.benchmark_type !== 'aggregated') {
      throw new Error('Benchmark is not an aggregated SLO');
    }

    const existingEntity = await withRequestEm(this.benchmarkRepo).findOne({ where: { id } });
    if (!existingEntity) return null;

    const beforeEntity = Object.assign(new BenchmarkEntity(), existingEntity);

    const updates: Partial<BenchmarkEntity> = { updated_by: userId };
    if (dto.aggregateStat !== undefined) updates.aggregate_stat = dto.aggregateStat;
    if (dto.requirementOperator !== undefined) updates.requirement_operator = dto.requirementOperator;
    if (dto.requirementValue !== undefined) updates.requirement_value = dto.requirementValue;
    if (dto.excludeRampUpTime !== undefined) updates.exclude_ramp_up_time = dto.excludeRampUpTime;
    if (dto.enabled !== undefined) updates.enabled = dto.enabled;
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.tags !== undefined) updates.tags = dto.tags;

    await withRequestEm(this.benchmarkRepo).update(id, updates as unknown as Parameters<typeof this.benchmarkRepo.update>[1]);

    const updated = await withRequestEm(this.benchmarkRepo).findOne({
      where: { id },
      relations: ['system_under_test'],
    });

    if (!updated) throw new Error(`Failed to fetch updated Aggregated SLO ${id}`);

    this.auditService.logUpdate(
      beforeEntity as unknown as OwnedResource,
      updated as unknown as OwnedResource,
      { organizationIdOverride: beforeEntity.organizationId ?? updated.organizationId },
    );

    this.logger.log(`Updated Aggregated SLO ${id}`);
    return BenchmarkMapper.mapEntityToBenchmark(updated);
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
    const evaluateType = dto.evaluateType ?? existing.evaluate_type;
    if (evaluateType === 'trend') data.metric_unit = TREND_UNIT;
    else if (existing.metric_unit === TREND_UNIT && dto.evaluateType !== undefined) {
      // Switching away from trend: the panel unit lives in the (merged) configuration.
      // null, not undefined: TypeORM's update() skips undefined keys, which would leave '%/h' on an
      // avg SLO. The entity types the column as `string | undefined`, hence the cast.
      data.metric_unit = ((data.configuration ?? existing.configuration)?.yAxesFormat ?? null) as string | undefined;
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
    if (dto.apdexMinSamples !== undefined) data.apdex_min_samples = dto.apdexMinSamples ?? 50;
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.tags !== undefined) data.tags = dto.tags;

    return data;
  }
}
