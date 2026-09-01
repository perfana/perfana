import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { DynatraceConfig } from '../../entities';
import { DynatraceQuery } from '../../entities';
import { DynatraceEntityMapping } from '../../entities';
import { DsPanels } from '../../entities';
import { DsMetrics } from '../../entities';
import { MetricsSource } from '../../entities';
import { withRequestEm } from '../../common/db/request-em';
import { CreateDynatraceQueryDto } from './dto/create-dynatrace-query.dto';
import { UpdateDynatraceQueryDto } from './dto/update-dynatrace-query.dto';
import { CreateEntityMappingDto } from './dto/create-entity-mapping.dto';
import { generateDeterministicUuid } from '../../utils/uuid-generator';

/**
 * Optional ownership tuple passed by the service layer when creating /
 * updating DQL queries and entity mappings. Lets the repository persist
 * `organization_id`, `created_by`, `updated_by` so the rows aren't created
 * with the "legacy null org" hatch that historically left them globally
 * mutable. The service derives `organizationId` from the parent
 * `DynatraceConfig` (the only resource that has the org assignment) and
 * passes the authenticated user as creator/updater.
 */
export interface QueryOwnership {
  organizationId?: string;
  createdBy?: string;
  updatedBy?: string;
}

@Injectable()
export class DynatraceRepository {
  private readonly logger = new Logger(DynatraceRepository.name);

  constructor(
    @InjectRepository(DynatraceConfig)
    private configRepo: Repository<DynatraceConfig>,
    @InjectRepository(DynatraceQuery)
    private queryRepo: Repository<DynatraceQuery>,
    @InjectRepository(DynatraceEntityMapping)
    private entityMappingRepo: Repository<DynatraceEntityMapping>,
    @InjectRepository(DsPanels)
    private panelsRepo: Repository<DsPanels>,
    @InjectRepository(DsMetrics)
    private metricsRepo: Repository<DsMetrics>,
    @InjectRepository(MetricsSource)
    private metricsSourceRepo: Repository<MetricsSource>,
    private dataSource: DataSource,
  ) {}

  /**
   * Upsert a MetricsSource row for a Dynatrace config + SUT/env/workload combination.
   * Returns the MetricsSource id so it can be stored on the DynatraceQuery row.
   *
   * Uses INSERT ... ON CONFLICT DO NOTHING via TypeORM upsert so concurrent calls
   * are safe — only one row is ever written for a given (sut, env, workload, configId).
   */
  private async ensureMetricsSourceExists(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    dynatraceConfigId: string,
    configLabel: string,
    organizationId: string,
  ): Promise<string> {
    await withRequestEm(this.metricsSourceRepo).upsert(
      {
        systemUnderTestId,
        testEnvironment,
        workload,
        sourceType: 'dynatrace',
        sourceConfigId: dynatraceConfigId,
        externalRef: dynatraceConfigId,
        displayName: configLabel,
        displayLabel: workload,
        organizationId,
      },
      {
        conflictPaths: ['systemUnderTestId', 'testEnvironment', 'sourceType', 'externalRef', 'displayName', 'displayLabel'],
        skipUpdateIfNoValuesChanged: true,
      },
    );

    const row = await withRequestEm(this.metricsSourceRepo).findOneOrFail({
      where: {
        systemUnderTestId,
        testEnvironment,
        sourceType: 'dynatrace',
        externalRef: dynatraceConfigId,
        displayLabel: workload,
      },
    });

    return row.id;
  }

  private generatePanelId(dashboardLabel: string, panelTitle: string): number {
    const combined = `${dashboardLabel}-${panelTitle}`;
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash) % 100000;
  }

  // Config Methods
  async findAll() {
    return withRequestEm(this.configRepo).find({
      order: { host: 'ASC' }
    });
  }

  async findByHost(host: string) {
    return withRequestEm(this.configRepo).findOne({ where: { host } });
  }

  async findById(id: string) {
    return withRequestEm(this.configRepo).findOne({ where: { id } });
  }

  async create(dto: {
    host: string;
    client_url?: string;
    api_token: string;
    dynatrace_type?: 'saas' | 'managed';
    label: string;
    platform_api_token?: string;
    perfana_test_run_id_attribute?: string;
    perfana_request_name_attribute?: string;
    use_proxy?: boolean;
    created_by?: string;
    updated_by?: string;
    organization_id?: string;
  }) {
    const config = this.configRepo.create({
      host: dto.host,
      clientUrl: dto.client_url,
      apiToken: dto.api_token,
      dynatraceType: dto.dynatrace_type || 'saas',
      label: dto.label,
      platformApiToken: dto.platform_api_token,
      perfanaTestRunIdAttribute: dto.perfana_test_run_id_attribute,
      perfanaRequestNameAttribute: dto.perfana_request_name_attribute,
      useProxy: dto.use_proxy ?? false,
      createdBy: dto.created_by,
      updatedBy: dto.updated_by,
      organizationId: dto.organization_id,
    });
    return withRequestEm(this.configRepo).save(config);
  }

  async update(
    id: string,
    dto: {
      client_url?: string;
      perfana_test_run_id_attribute?: string;
      perfana_request_name_attribute?: string;
      label?: string;
      api_token?: string;
      platform_api_token?: string;
      use_proxy?: boolean;
      updated_by?: string;
    },
  ) {
    const updateData: Partial<DynatraceConfig> = {};

    if (dto.client_url !== undefined) {
      // '' is the wire signal for "clear it", stored as NULL so the column has a
      // single unset representation. TypeORM's update() skips undefined but does
      // write null, hence the cast past the non-nullable property type.
      updateData.clientUrl = dto.client_url === '' ? (null as unknown as undefined) : dto.client_url;
    }
    if (dto.perfana_test_run_id_attribute !== undefined) {
      updateData.perfanaTestRunIdAttribute = dto.perfana_test_run_id_attribute;
    }
    if (dto.perfana_request_name_attribute !== undefined) {
      updateData.perfanaRequestNameAttribute = dto.perfana_request_name_attribute;
    }
    if (dto.label !== undefined) {
      updateData.label = dto.label;
    }
    if (dto.api_token !== undefined) {
      updateData.apiToken = dto.api_token;
    }
    if (dto.platform_api_token !== undefined) {
      updateData.platformApiToken = dto.platform_api_token;
    }
    if (dto.use_proxy !== undefined) {
      updateData.useProxy = dto.use_proxy;
    }
    if (dto.updated_by !== undefined) {
      updateData.updatedBy = dto.updated_by;
    }

    await withRequestEm(this.configRepo).update(id, updateData);

    const result = await withRequestEm(this.configRepo).findOne({ where: { id } });
    if (!result) {
      throw new NotFoundException(`Config with id ${id} not found after update`);
    }
    return result;
  }

  async delete(id: string) {
    await withRequestEm(this.configRepo).delete(id);
  }

  // DQL Methods
  async findAllQuery() {
    const results = await withRequestEm(this.queryRepo)
      .createQueryBuilder('query')
      .leftJoinAndSelect('query.dynatraceConfig', 'config')
      .orderBy('query.createdAt', 'DESC')
      .getMany();
    return results.map(this.mapEntityToDtoFields);
  }

  async findQueryBySystemAndEnvironment(systemId: string, environment: string, workload?: string) {
    const qb = withRequestEm(this.queryRepo)
      .createQueryBuilder('query')
      .leftJoinAndSelect('query.dynatraceConfig', 'config')
      .where('query.systemUnderTestId = :systemId', { systemId })
      .andWhere('query.testEnvironment = :environment', { environment });
    // workload is optional: SLO pickers are workload-agnostic (a Dynatrace
    // dashboard's panels are identical across workloads), cards still pass it.
    if (workload) qb.andWhere('query.workload = :workload', { workload });
    const results = await qb.orderBy('query.createdAt', 'DESC').getMany();
    return results.map(this.mapEntityToDtoFields);
  }

  private mapEntityToDtoFields(entity: DynatraceQuery) {
    return {
      id: entity.id,
      dynatraceConfigId: entity.dynatraceConfigId,
      systemUnderTestId: entity.systemUnderTestId,
      testEnvironment: entity.testEnvironment,
      workload: entity.workload,
      dashboardLabel: entity.dashboardLabel,
      applicationDashboardId: entity.applicationDashboardId,
      panelTitle: entity.panelTitle,
      panelId: entity.panelId,
      query: entity.query,
      matchMetricPattern: entity.matchMetricPattern,
      omitGroupByVariableFromMetricName: entity.omitGroupByVariableFromMetricName || [],
      templateVariables: entity.templateVariables || {},
      metricUnit: entity.metricUnit,
      metricName: entity.metricName,
      enabled: entity.enabled,
      dynatraceConfig: entity.dynatraceConfig ? {
        id: entity.dynatraceConfig.id,
        host: entity.dynatraceConfig.host,
        label: entity.dynatraceConfig.label,
        dynatraceType: entity.dynatraceConfig.dynatraceType,
      } : undefined,
      organizationId: entity.organizationId,
      createdBy: entity.createdBy,
      updatedBy: entity.updatedBy,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  async findQueryById(id: string) {
    const result = await withRequestEm(this.queryRepo)
      .createQueryBuilder('query')
      .leftJoinAndSelect('query.dynatraceConfig', 'config')
      .where('query.id = :id', { id })
      .getOne();
    return result ? this.mapEntityToDtoFields(result) : null;
  }

  async createQuery(dto: CreateDynatraceQueryDto, ownership?: QueryOwnership) {
    const panelId = dto.panelId || this.generatePanelId(dto.dashboardLabel, dto.panelTitle);

    const config = await withRequestEm(this.configRepo).findOne({ where: { id: dto.dynatraceConfigId } });
    const resolvedOrgId = ownership?.organizationId ?? config?.organizationId;
    const metricsSourceId = config && resolvedOrgId
      ? await this.ensureMetricsSourceExists(
          dto.systemUnderTestId,
          dto.testEnvironment,
          dto.workload || '',
          dto.dynatraceConfigId,
          config.label,
          resolvedOrgId,
        )
      : undefined;

    const query = this.queryRepo.create({
      dynatraceConfigId: dto.dynatraceConfigId,
      systemUnderTestId: dto.systemUnderTestId,
      testEnvironment: dto.testEnvironment,
      workload: dto.workload,
      dashboardLabel: dto.dashboardLabel,
      applicationDashboardId: dto.applicationDashboardId,
      metricsSourceId,
      panelTitle: dto.panelTitle,
      panelId: panelId,
      query: dto.query,
      matchMetricPattern: dto.matchMetricPattern,
      omitGroupByVariableFromMetricName: dto.omitGroupByVariableFromMetricName,
      templateVariables: dto.templateVariables,
      metricUnit: dto.metricUnit,
      metricName: dto.metricName,
      enabled: dto.enabled ?? true,
      organizationId: resolvedOrgId,
      createdBy: ownership?.createdBy,
      updatedBy: ownership?.updatedBy ?? ownership?.createdBy,
    });

    const result = await withRequestEm(this.queryRepo).save(query);
    return this.mapEntityToDtoFields(result);
  }

  async updateQuery(id: string, dto: UpdateDynatraceQueryDto, ownership?: QueryOwnership) {
    const updateData: Partial<DynatraceQuery> = {};

    if (ownership?.updatedBy !== undefined) {
      updateData.updatedBy = ownership.updatedBy;
    }
    if (dto.dynatraceConfigId !== undefined) updateData.dynatraceConfigId = dto.dynatraceConfigId;
    if (dto.systemUnderTestId !== undefined) updateData.systemUnderTestId = dto.systemUnderTestId;
    if (dto.testEnvironment !== undefined) updateData.testEnvironment = dto.testEnvironment;
    if (dto.workload !== undefined) updateData.workload = dto.workload;
    if (dto.dashboardLabel !== undefined) updateData.dashboardLabel = dto.dashboardLabel;
    if (dto.applicationDashboardId !== undefined) updateData.applicationDashboardId = dto.applicationDashboardId;
    if (dto.panelTitle !== undefined) updateData.panelTitle = dto.panelTitle;
    if (dto.panelId !== undefined) updateData.panelId = dto.panelId;
    if (dto.query !== undefined) updateData.query = dto.query;
    if (dto.matchMetricPattern !== undefined) updateData.matchMetricPattern = dto.matchMetricPattern;
    if (dto.omitGroupByVariableFromMetricName !== undefined) updateData.omitGroupByVariableFromMetricName = dto.omitGroupByVariableFromMetricName;
    if (dto.templateVariables !== undefined) updateData.templateVariables = dto.templateVariables;
    if (dto.metricUnit !== undefined) updateData.metricUnit = dto.metricUnit;
    if (dto.metricName !== undefined) updateData.metricName = dto.metricName;
    if (dto.enabled !== undefined) updateData.enabled = dto.enabled;

    // If dashboardLabel or panelTitle are being updated but panelId is not explicitly provided, regenerate it
    if ((dto.dashboardLabel !== undefined || dto.panelTitle !== undefined) && dto.panelId === undefined) {
      const current = await this.findQueryById(id);
      if (current) {
        const finalDashboardLabel = dto.dashboardLabel !== undefined ? dto.dashboardLabel : current.dashboardLabel;
        const finalPanelTitle = dto.panelTitle !== undefined ? dto.panelTitle : current.panelTitle;
        updateData.panelId = this.generatePanelId(finalDashboardLabel, finalPanelTitle);
      }
    }

    await withRequestEm(this.queryRepo).update(id, updateData as unknown as QueryDeepPartialEntity<DynatraceQuery>);

    const result = await withRequestEm(this.queryRepo).findOne({ where: { id } });
    if (!result) {
      throw new NotFoundException(`Query with id ${id} not found after update`);
    }
    return this.mapEntityToDtoFields(result);
  }

  async deleteQuery(id: string) {
    await withRequestEm(this.queryRepo).delete(id);
  }

  async findDashboardByLabel(dashboardLabel: string) {
    const result = await withRequestEm(this.queryRepo).findOne({
      where: { dashboardLabel },
      select: ['applicationDashboardId']
    });
    return result?.applicationDashboardId || null;
  }

  async createQueryWithSharedUuid(
    dto: CreateDynatraceQueryDto,
    applicationDashboardId: string,
    ownership?: QueryOwnership,
  ) {
    const panelId = dto.panelId || this.generatePanelId(dto.dashboardLabel, dto.panelTitle);

    const config = await withRequestEm(this.configRepo).findOne({ where: { id: dto.dynatraceConfigId } });
    const resolvedOrgId = ownership?.organizationId ?? config?.organizationId;
    const metricsSourceId = config && resolvedOrgId
      ? await this.ensureMetricsSourceExists(
          dto.systemUnderTestId,
          dto.testEnvironment,
          dto.workload || '',
          dto.dynatraceConfigId,
          config.label,
          resolvedOrgId,
        )
      : undefined;

    const query = this.queryRepo.create({
      dynatraceConfigId: dto.dynatraceConfigId,
      systemUnderTestId: dto.systemUnderTestId,
      testEnvironment: dto.testEnvironment,
      workload: dto.workload,
      dashboardLabel: dto.dashboardLabel,
      applicationDashboardId: applicationDashboardId,
      metricsSourceId,
      panelTitle: dto.panelTitle,
      panelId: panelId,
      query: dto.query,
      matchMetricPattern: dto.matchMetricPattern,
      omitGroupByVariableFromMetricName: dto.omitGroupByVariableFromMetricName,
      templateVariables: dto.templateVariables,
      metricUnit: dto.metricUnit,
      metricName: dto.metricName,
      enabled: dto.enabled ?? true,
      organizationId: resolvedOrgId,
      createdBy: ownership?.createdBy,
      updatedBy: ownership?.updatedBy ?? ownership?.createdBy,
    });

    const result = await withRequestEm(this.queryRepo).save(query);
    return this.mapEntityToDtoFields(result);
  }

  async bulkCreateQueryWithSharedUuid(
    dtoList: CreateDynatraceQueryDto[],
    applicationDashboardId: string,
    ownership?: QueryOwnership,
  ) {
    // All DTOs in a bulk import must share the same config/sut/env/workload — we resolve
    // MetricsSource once from the first DTO and apply it to all rows.
    const firstDto = dtoList[0];
    let metricsSourceId: string | undefined;
    let parentOrgId: string | undefined;

    if (firstDto && dtoList.length > 1) {
      const mismatch = dtoList.find(
        dto =>
          dto.dynatraceConfigId !== firstDto.dynatraceConfigId ||
          dto.systemUnderTestId !== firstDto.systemUnderTestId ||
          dto.testEnvironment !== firstDto.testEnvironment ||
          dto.workload !== firstDto.workload,
      );
      if (mismatch) {
        throw new Error(
          'bulkCreateQueryWithSharedUuid: all DTOs must share the same dynatraceConfigId, systemUnderTestId, testEnvironment, and workload',
        );
      }
    }

    if (firstDto) {
      const config = await withRequestEm(this.configRepo).findOne({ where: { id: firstDto.dynatraceConfigId } });
      if (config) {
        parentOrgId = ownership?.organizationId ?? config.organizationId;
        metricsSourceId = await this.ensureMetricsSourceExists(
          firstDto.systemUnderTestId,
          firstDto.testEnvironment,
          firstDto.workload || '',
          firstDto.dynatraceConfigId,
          config.label,
          parentOrgId,
        );
      }
    }

    const querys = dtoList.map(dto => this.queryRepo.create({
      dynatraceConfigId: dto.dynatraceConfigId,
      systemUnderTestId: dto.systemUnderTestId,
      testEnvironment: dto.testEnvironment,
      workload: dto.workload,
      dashboardLabel: dto.dashboardLabel,
      applicationDashboardId: applicationDashboardId,
      metricsSourceId,
      panelTitle: dto.panelTitle,
      panelId: dto.panelId || this.generatePanelId(dto.dashboardLabel, dto.panelTitle),
      query: dto.query,
      matchMetricPattern: dto.matchMetricPattern,
      omitGroupByVariableFromMetricName: dto.omitGroupByVariableFromMetricName,
      templateVariables: dto.templateVariables,
      metricUnit: dto.metricUnit,
      metricName: dto.metricName,
      organizationId: ownership?.organizationId ?? parentOrgId,
      createdBy: ownership?.createdBy,
      updatedBy: ownership?.updatedBy ?? ownership?.createdBy,
    }));

    const results = await withRequestEm(this.queryRepo).save(querys);
    return results.map(this.mapEntityToDtoFields);
  }

  // SLO Support Methods
  async getDistinctDashboardLabels(systemId: string, environment: string, workload?: string) {
    const qb = withRequestEm(this.queryRepo)
      .createQueryBuilder('query')
      .select('DISTINCT query.dashboardLabel', 'dashboardLabel')
      .where('query.systemUnderTestId = :systemId', { systemId })
      .andWhere('query.testEnvironment = :environment', { environment });
    if (workload) qb.andWhere('query.workload = :workload', { workload });
    const results = await qb.orderBy('query.dashboardLabel', 'ASC').getRawMany();

    return results.map(row => ({ dashboardLabel: row.dashboardLabel }));
  }

  async getPanelTitlesForDashboard(systemId: string, environment: string, workload: string | undefined, dashboardLabel: string) {
    const qb = withRequestEm(this.queryRepo)
      .createQueryBuilder('query')
      .select(['query.panelTitle', 'query.panelId', 'query.applicationDashboardId', 'query.metricsSourceId', 'query.metricUnit'])
      .where('query.systemUnderTestId = :systemId', { systemId })
      .andWhere('query.testEnvironment = :environment', { environment })
      .andWhere('query.dashboardLabel = :dashboardLabel', { dashboardLabel });
    if (workload) qb.andWhere('query.workload = :workload', { workload });
    const results = await qb.orderBy('query.panelTitle', 'ASC').getMany();

    // Remove duplicates based on panel_title
    const uniqueItems = Array.from(
      new Map(results.map(item => [item.panelTitle, item])).values()
    );

    return uniqueItems.map(item => ({
      panelTitle: item.panelTitle,
      panelId: item.panelId,
      applicationDashboardId: item.applicationDashboardId,
      metricsSourceId: item.metricsSourceId,
      metricUnit: item.metricUnit
    }));
  }

  // Entity Mapping Methods
  async getEntityMappings(systemId?: string, environment?: string, workload?: string) {
    const queryBuilder = withRequestEm(this.entityMappingRepo)
      .createQueryBuilder('mapping')
      .leftJoinAndSelect('mapping.dynatraceConfig', 'config')
      .orderBy('mapping.createdAt', 'DESC');

    if (!systemId) {
      const results = await queryBuilder.getMany();
      return results.map(entity => this.mapEntityMappingToDtoFieldsWithLabel(entity));
    }

    // Hierarchical query - get all levels
    const conditions = [];

    // Level 1: System level
    conditions.push('(mapping.systemUnderTestId = :systemId AND mapping.testEnvironment IS NULL AND mapping.workload IS NULL)');

    // Level 2: Environment level
    if (environment) {
      conditions.push('(mapping.systemUnderTestId = :systemId AND mapping.testEnvironment = :environment AND mapping.workload IS NULL)');

      // Level 3: Workload level
      if (workload) {
        conditions.push('(mapping.systemUnderTestId = :systemId AND mapping.testEnvironment = :environment AND mapping.workload = :workload)');
      }
    }

    queryBuilder.where(`(${conditions.join(' OR ')})`, { systemId, environment, workload });

    const results = await queryBuilder.getMany();

    // Remove duplicates and sort
    const uniqueResults = results.filter((item, index, arr) =>
      arr.findIndex(i => i.id === item.id) === index
    ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return uniqueResults.map(entity => this.mapEntityMappingToDtoFieldsWithLabel(entity));
  }

  async getEntityMappingById(id: string) {
    const result = await withRequestEm(this.entityMappingRepo).findOne({ where: { id } });
    return result ? this.mapEntityMappingToDtoFields(result) : null;
  }

  async createEntityMapping(dto: CreateEntityMappingDto, ownership?: QueryOwnership) {
    let parentOrgId: string | undefined;
    if (!ownership?.organizationId) {
      const parentConfig = await withRequestEm(this.configRepo).findOne({
        where: { id: dto.dynatraceConfigId },
        select: ['organizationId'],
      });
      parentOrgId = parentConfig?.organizationId;
    }

    const mapping = this.entityMappingRepo.create({
      dynatraceConfigId: dto.dynatraceConfigId,
      systemUnderTestId: dto.systemUnderTestId,
      testEnvironment: dto.testEnvironment,
      workload: dto.workload,
      entityId: dto.entityId,
      entityDisplayName: dto.entityDisplayName,
      entityType: dto.entityType,
      level: dto.level,
      organizationId: ownership?.organizationId ?? parentOrgId,
      createdBy: ownership?.createdBy,
      updatedBy: ownership?.updatedBy ?? ownership?.createdBy,
    });

    try {
      const result = await withRequestEm(this.entityMappingRepo).save(mapping);

      // Fetch with joined config to get the label
      const entityWithConfig = await withRequestEm(this.entityMappingRepo)
        .createQueryBuilder('mapping')
        .leftJoinAndSelect('mapping.dynatraceConfig', 'config')
        .where('mapping.id = :id', { id: result.id })
        .getOne();

      return entityWithConfig ? this.mapEntityMappingToDtoFieldsWithLabel(entityWithConfig) : this.mapEntityMappingToDtoFields(result);
    } catch (error) {
      // Check if this is a unique constraint violation
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        // PostgreSQL unique constraint violation error code
        const levelDisplay = dto.level === 'sut' ? 'system' : dto.level === 'sut_testenv' ? 'environment' : 'workload';
        throw new ConflictException(`This entity is already mapped to this ${levelDisplay}. Please remove the existing mapping first.`);
      }
      throw error;
    }
  }

  async deleteEntityMapping(id: string) {
    await withRequestEm(this.entityMappingRepo).delete(id);
  }

  private mapEntityMappingToDtoFields(entity: DynatraceEntityMapping) {
    return {
      id: entity.id,
      dynatraceConfigId: entity.dynatraceConfigId,
      systemUnderTestId: entity.systemUnderTestId,
      testEnvironment: entity.testEnvironment,
      workload: entity.workload,
      entityId: entity.entityId,
      entityDisplayName: entity.entityDisplayName,
      entityType: entity.entityType,
      level: entity.level,
      organizationId: entity.organizationId,
      createdBy: entity.createdBy,
      updatedBy: entity.updatedBy,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  private mapEntityMappingToDtoFieldsWithLabel(entity: DynatraceEntityMapping) {
    return {
      id: entity.id,
      dynatraceConfigId: entity.dynatraceConfigId,
      dynatraceLabel: entity.dynatraceConfig?.label || null,
      systemUnderTestId: entity.systemUnderTestId,
      testEnvironment: entity.testEnvironment,
      workload: entity.workload,
      entityId: entity.entityId,
      entityDisplayName: entity.entityDisplayName,
      entityType: entity.entityType,
      level: entity.level,
      // Needed by the service to resolve per-row capabilities for _permissions.
      organizationId: entity.organizationId,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  /**
   * Generate a deterministic UUID for a Dynatrace dashboard
   * Used by the service to create consistent dashboard IDs
   */
  generateDynatraceDashboardUuid(
    systemUnderTestId: string,
    testEnvironment: string,
    dashboardLabel: string,
    workload: string
  ): string {
    const input = `${systemUnderTestId}-${testEnvironment}-${workload}-dynatrace-${dashboardLabel}`;
    return generateDeterministicUuid(input);
  }

  /**
   * Generate a dashboard UID for Grafana integration
   */
  private generateDynatraceDashboardUid(dashboardLabel: string): string {
    // Sanitize dashboard label for use in UID (lowercase, replace spaces/special chars with hyphens)
    const sanitized = dashboardLabel
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-') // Replace multiple consecutive hyphens with single hyphen
      .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens

    return `dynatrace-${sanitized}`;
  }

  /**
   * Ensure artificial dashboard exists for Dynatrace queries
   * Creates both grafana_dashboards and application_dashboards entries if they don't exist
   * Uses deterministic UUID generation to ensure the same dashboard is reused
   *
   * @param systemUnderTestId - System under test UUID
   * @param testEnvironment - Test environment (e.g., "production")
   * @param workload - Workload identifier
   * @param dashboardLabel - Dashboard label (e.g., "Host: hostname")
   * @param applicationDashboardId - Pre-generated application dashboard ID
   * @returns Promise<void>
   */
  async ensureArtificialDashboardExists(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    dashboardLabel: string,
    applicationDashboardId: string,
    organizationId: string
  ): Promise<void> {
    const dashboardUid = this.generateDynatraceDashboardUid(dashboardLabel);

    this.logger.log(
      `Ensuring artificial dashboard exists for ${dashboardLabel} (workload: ${workload})`
    );

    // Use a transaction to ensure atomicity
    await this.dataSource.transaction(async (manager) => {
      // Get the first available grafana instance
      const grafanaInstances = await manager.query<Array<{ id: string }>>(
        `SELECT id FROM grafana_instances LIMIT 1`
      );

      if (!grafanaInstances || grafanaInstances.length === 0) {
        throw new Error(
          'No Grafana instances found in database - cannot create Dynatrace dashboard'
        );
      }

      const grafanaInstanceId = grafanaInstances[0]!.id;

      // Check if synthetic grafana_dashboard exists for this UID
      const grafanaDashboardExists = await manager.query(
        `SELECT id FROM grafana_dashboards WHERE uid = $1 AND grafana_instance_id = $2`,
        [dashboardUid, grafanaInstanceId]
      );

      let grafanaDashboardId: string;

      if (!grafanaDashboardExists || grafanaDashboardExists.length === 0) {
        // Create synthetic grafana_dashboard with grafana_id in 800000+ range
        // This distinguishes Dynatrace dashboards from performance test metrics (900000+)
        const syntheticGrafanaId = Math.floor(Math.random() * 100000) + 800000;

        const result = await manager.query<Array<{ id: string }>>(
          `INSERT INTO grafana_dashboards (
            grafana_instance_id, grafana_id, uid, name, panels, organization_id
          ) VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id`,
          [
            grafanaInstanceId,
            syntheticGrafanaId,
            dashboardUid,
            dashboardLabel,
            JSON.stringify([]), // Empty panels array
            organizationId,
          ]
        );
        grafanaDashboardId = result[0]!.id;
        this.logger.log(
          `Created synthetic grafana_dashboard: ${grafanaDashboardId} (grafana_id: ${syntheticGrafanaId})`
        );
      } else {
        grafanaDashboardId = grafanaDashboardExists[0].id;
      }

      // Check if application_dashboard exists
      const appDashboardExists = await manager.query(
        `SELECT id FROM application_dashboards WHERE id = $1`,
        [applicationDashboardId]
      );

      if (!appDashboardExists || appDashboardExists.length === 0) {
        // Create application_dashboard
        await manager.query(
          `INSERT INTO application_dashboards (
            id, system_under_test_id, test_environment,
            grafana_instance_id, grafana_dashboard_id,
            dashboard_name, dashboard_uid, dashboard_label, organization_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (system_under_test_id, test_environment, grafana_instance_id, dashboard_uid, dashboard_label)
          DO NOTHING`,
          [
            applicationDashboardId,
            systemUnderTestId,
            testEnvironment,
            grafanaInstanceId,
            grafanaDashboardId,
            dashboardLabel,
            dashboardUid,
            dashboardLabel,
            organizationId,
          ]
        );

        this.logger.log(`Created Dynatrace application_dashboard: ${applicationDashboardId}`);
      }
    });
  }

  /**
   * Create ds_compare_config entry for a Dynatrace metric
   * This enables the metric to be included in anomaly detection and comparison
   *
   * @param systemUnderTestId - System under test UUID
   * @param testEnvironment - Test environment
   * @param workload - Workload identifier
   * @param applicationDashboardId - Application dashboard UUID
   * @param panelId - Panel ID (hash-based)
   * @param panelTitle - Panel title (metric name)
   * @param metricSelector - Dynatrace metric selector (used to determine classification)
   * @returns Promise<void>
   */
  async createDsCompareConfigForMetric(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    applicationDashboardId: string,
    panelId: number,
    panelTitle: string,
    metricSelector: string
  ): Promise<void> {
    // Determine classification and higherIsBetter based on metric type
    const classification = 'USE_utilization';
    let higherIsBetter: boolean | null = false;

    // Network Traffic is informational (higherIsBetter: null)
    if (metricSelector.includes('builtin:host.net.nic.traffic')) {
      higherIsBetter = null;
    }

    const configData = {
      metricClassification: {
        classification,
        higherIsBetter,
      },
      thresholds: {
        aggregation: 'mean',
        percentageThreshold: 0.10,
        iqrThreshold: 2.0,
        absoluteThreshold: null,
      },
      ignore: false,
      source: 'dynatrace-host',
    };

    // Use a transaction to ensure atomicity
    await this.dataSource.transaction(async (manager) => {
      // Check if config already exists (unique on application_dashboard_id, panel_id, metric_name)
      const existingConfig = await manager.query(
        `SELECT id FROM ds_compare_config
         WHERE application_dashboard_id = $1
         AND panel_id = $2
         AND metric_name IS NULL`,
        [applicationDashboardId, panelId]
      );

      if (!existingConfig || existingConfig.length === 0) {
        // Ownership is inherited from the parent dashboard (which inherits from its SUT at
        // creation). NOTE: this runs on the plain pooled connection, not withRequestEm — under
        // a least-privilege deploy (no rolbypassrls) the subqueries would return zero rows and
        // the insert would fail on the NOT NULL org column. Same deployment constraint as the
        // documented api_keys carve-out in CLAUDE.md.
        await manager.query(
          `INSERT INTO ds_compare_config (
            system_under_test_id, test_environment, workload,
            application_dashboard_id, panel_id, config_data, organization_id, team_id
          ) VALUES ($1, $2, $3, $4, $5, $6,
            (SELECT organization_id FROM application_dashboards WHERE id = $4),
            (SELECT team_id FROM application_dashboards WHERE id = $4))`,
          [
            systemUnderTestId,
            testEnvironment,
            workload,
            applicationDashboardId,
            panelId,
            JSON.stringify(configData),
          ]
        );

        this.logger.log(
          `Created ds_compare_config for ${panelTitle} (panel_id: ${panelId})`
        );
      } else {
        this.logger.log(
          `ds_compare_config already exists for ${panelTitle} (panel_id: ${panelId})`
        );
      }
    });
  }

  // Metric Names from ds_metrics for Dynatrace Card
  async getMetricNames(testRunId?: string) {
    try {
      // Query panels with JSONB field where panel->description = 'perfana-request-names'
      const panels = await this.panelsRepo
        .createQueryBuilder('panel')
        .select(['panel.test_run_id', 'panel.application_dashboard_id', 'panel.panel_id'])
        .where("panel.panel->>'description' = :description", { description: 'perfana-request-names' })
        .andWhere('panel.test_run_id = :testRunId', { testRunId })
        .getMany();

      if (!panels || panels.length === 0) {
        return [];
      }

      // Build conditions for matching metrics - query for all matching test_run/dashboard/panel combinations
      const conditions = panels.map(panel => ({
        test_run_id: panel.test_run_id,
        application_dashboard_id: panel.application_dashboard_id,
        panel_id: panel.panel_id
      }));

      // Get distinct metric names from matching metrics using safe query builder
      const queryBuilder = this.metricsRepo
        .createQueryBuilder('metric')
        .select('DISTINCT metric.metric_name', 'metric_name');

      // Build OR conditions safely using query builder methods
      queryBuilder.where('1 = 0'); // Start with false condition
      conditions.forEach((condition, index) => {
        queryBuilder.orWhere(
          'metric.test_run_id = :testRunId' + index +
          ' AND metric.application_dashboard_id = :dashboardId' + index +
          ' AND metric.panel_id = :panelId' + index,
          {
            [`testRunId${index}`]: condition.test_run_id,
            [`dashboardId${index}`]: condition.application_dashboard_id,
            [`panelId${index}`]: condition.panel_id,
          }
        );
      });

      const metrics = await queryBuilder
        .orderBy('metric.metric_name', 'ASC')
        .getRawMany();

      // Get unique metric names
      const uniqueMetrics = metrics
        .map((row: { metric_name: string }) => row.metric_name)
        .filter((name): name is string => name != null);

      this.logger.log(`Found ${uniqueMetrics.length} metric names for test run ${testRunId}`);
      return uniqueMetrics;
    } catch (error) {
      this.logger.error(`Error getting metric names for test run ${testRunId}:`, error);
      return [];
    }
  }
}
