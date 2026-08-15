import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import {
  CreateApplicationDashboardDto,
  UpdateApplicationDashboardDto,
  ApplicationDashboardVariableDto,
  ReplacedTemplatingVariableDto,
} from './dto/application-dashboard.dto';
import { CopyApplicationDashboardsDto } from './dto/copy-application-dashboards.dto';
import {
  ApplicationDashboard as ApplicationDashboardEntity,
  GrafanaDashboard as GrafanaDashboardEntity,
  SystemUnderTest,
} from '../../entities';
import { withRequestEm } from '../../common/db/request-em';
import { OwnedResource } from '@perfana/shared';
import { GrafanaClientService } from './grafana-client.service';
import { AuthorizationService } from '../../common/services/authorization.service';
import { withOrgFilter } from '../../common/utils/with-org-filter';
import { AuditService } from '../audit/audit.service';

export interface DeleteInfo {
  canDeleteFromGrafana: boolean;
  grafanaDashboardName: string;
  grafanaDashboardUid: string;
  otherSuts: string[];
}

export interface BatchDeleteInfo {
  orphanedDashboards: Array<{
    applicationDashboardId: string;
    grafanaDashboardName: string;
    grafanaDashboardUid: string;
  }>;
  nonOrphanedCount: number;
}

export interface DeleteResult {
  deletedFromGrafana: boolean;
  grafanaDashboardUid?: string;
}

export interface ApplicationDashboard {
  id: string;
  system_under_test_id: string;
  test_environment: string;
  grafana_instance_id?: string;
  grafana_dashboard_id?: string;
  dashboard_name: string;
  dashboard_id?: number;
  dashboard_uid?: string;
  dashboard_label: string;
  tags?: string[];
  template_dashboard_uid?: string;
  variables?: Record<string, unknown>[];
  replaced_templating_variables?: Record<string, unknown>[];
  snapshot_timeout: number;
  created_at: string;
  updated_at: string;
  // Joined data
  grafana_instance?: {
    id: string;
    label: string;
    client_url: string;
    server_url?: string;
  } | undefined;
  systems_under_test?: {
    id: string;
    name: string;
  } | undefined;
}

export interface ApplicationDashboardQuery {
  systemId?: string;
  systemUnderTestId?: string;
  environment?: string;
  testEnvironment?: string;
  grafanaInstanceId?: string;
  dashboardLabel?: string;
  dashboardUid?: string;
  tags?: string[];
}

/**
 * Service responsible for managing application dashboards.
 *
 * Authorization:
 * - All methods accept userId and roles parameters for authorization
 * - ApplicationDashboard entity has organization_id (added in RBAC Phase 2)
 * - Organization-based filtering is applied to all queries
 * - Global admins bypass all authorization checks
 */
@Injectable()
export class ApplicationDashboardsService {
  private readonly logger = new Logger(ApplicationDashboardsService.name);

  constructor(
    @InjectRepository(ApplicationDashboardEntity)
    private appDashboardRepo: Repository<ApplicationDashboardEntity>,
    @InjectRepository(SystemUnderTest)
    private systemRepo: Repository<SystemUnderTest>,
    private dataSource: DataSource,
    private grafanaClientService: GrafanaClientService,
    private readonly authzService: AuthorizationService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Find all application dashboards
   *
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   * @param query - Optional query filters
   *
   * Note: Organization-based filtering is applied. Global admins see all dashboards.
   * Non-admin users only see dashboards from their accessible organizations or legacy (NULL org_id) dashboards.
   */
  async findAll(userId: string, roles: string[], query: ApplicationDashboardQuery = {}): Promise<ApplicationDashboard[]> {
    // Resolve accessible org IDs: null means global admin (no filter needed)
    const orgIds = await withOrgFilter(userId, roles, this.authzService);
    this.logger.debug(`findAll: userId=${userId}, isGlobalAdmin=${orgIds === null}`);

    try {
      // Build TypeORM query with relations
      const queryBuilder = withRequestEm(this.appDashboardRepo)
        .createQueryBuilder('ad')
        .leftJoinAndSelect('ad.grafanaInstance', 'gi')
        .leftJoinAndSelect('ad.systemUnderTest', 'sut')
        .leftJoinAndSelect('ad.grafanaDashboard', 'gd');

      // Apply organization filtering (unless user is global admin)
      if (orgIds !== null) {
        this.logger.debug(`Applying org filter for non-admin user. Accessible orgs: ${JSON.stringify(orgIds)}`);

        if (orgIds.length === 0) {
          // User has no organization access - only show legacy (NULL) dashboards
          this.logger.debug('No accessible orgs - filtering to NULL organization_id only');
          queryBuilder.andWhere('ad.organizationId IS NULL');
        } else {
          // User has org access - show their org dashboards + legacy (NULL) dashboards
          this.logger.debug(`Adding WHERE clause: organizationId IN (${orgIds.join(', ')}) OR organizationId IS NULL`);
          queryBuilder.andWhere(
            '(ad.organizationId IN (:...orgIds) OR ad.organizationId IS NULL)',
            { orgIds }
          );
        }
      } else {
        this.logger.debug('User is global admin - no org filtering applied');
      }
      // Global admins see all dashboards (no filtering)

      // Support both systemId and systemUnderTestId for flexibility
      if (query.systemId || query.systemUnderTestId) {
        queryBuilder.andWhere('ad.systemUnderTestId = :systemId', {
          systemId: query.systemId || query.systemUnderTestId
        });
      }

      // Support both environment and testEnvironment for flexibility
      if (query.environment || query.testEnvironment) {
        queryBuilder.andWhere('ad.testEnvironment = :environment', {
          environment: query.environment || query.testEnvironment
        });
      }

      if (query.grafanaInstanceId) {
        queryBuilder.andWhere('ad.grafanaInstanceId = :grafanaInstanceId', {
          grafanaInstanceId: query.grafanaInstanceId
        });
      }

      if (query.dashboardLabel) {
        queryBuilder.andWhere('ad.dashboardLabel ILIKE :dashboardLabel', {
          dashboardLabel: `%${query.dashboardLabel}%`
        });
      }

      if (query.dashboardUid) {
        queryBuilder.andWhere('ad.dashboardUid = :dashboardUid', {
          dashboardUid: query.dashboardUid
        });
      }

      if (query.tags && query.tags.length > 0) {
        queryBuilder.andWhere('ad.tags && :tags', { tags: query.tags });
      }

      queryBuilder
        .orderBy('ad.dashboardName', 'ASC')
        .addOrderBy('ad.dashboardLabel', 'ASC');

      const results = await queryBuilder.getMany();

      this.logger.debug(`Found ${results.length} application dashboards`);

      return results.map(row => {
        // Enrich variables with template metadata from Grafana dashboard
        const enrichedVariables = this.enrichVariablesWithTemplateMetadata(
          Array.isArray(row.variables) ? row.variables : [],
          row.grafanaDashboard
        );

        return {
          id: row.id,
          system_under_test_id: row.systemUnderTestId,
          test_environment: row.testEnvironment,
          grafana_instance_id: row.grafanaInstanceId,
          grafana_dashboard_id: row.grafanaDashboardId,
          dashboard_name: row.dashboardName,
          dashboard_id: row.dashboardId,
          dashboard_uid: row.dashboardUid,
          dashboard_label: row.dashboardLabel,
          tags: row.tags,
          template_dashboard_uid: row.templateDashboardUid,
          variables: enrichedVariables,
          replaced_templating_variables: row.replacedTemplatingVariables as Record<string, unknown>[] | undefined,
          snapshot_timeout: row.snapshotTimeout,
          created_at: row.createdAt.toISOString(),
          updated_at: row.updatedAt.toISOString(),
          grafana_instance: row.grafanaInstance ? {
            id: row.grafanaInstance.id,
            label: row.grafanaInstance.label,
            client_url: row.grafanaInstance.client_url,
            server_url: row.grafanaInstance.server_url,
          } : undefined,
          systems_under_test: row.systemUnderTest ? {
            id: row.systemUnderTest.id,
            name: row.systemUnderTest.name,
          } : undefined,
        };
      });
    } catch (error) {
      this.logger.error('Failed to fetch application dashboards:', error);
      throw error;
    }
  }

  /**
   * Find a single application dashboard by ID
   *
   * @param id - The application dashboard ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: Organization-based access control is applied. Users can only access dashboards
   * from their organizations or legacy (NULL org_id) dashboards. Global admins see all.
   */
  async findOne(id: string, userId: string, roles: string[]): Promise<ApplicationDashboard> {
    // Resolve accessible org IDs: null means global admin (no filter needed)
    const orgIds = await withOrgFilter(userId, roles, this.authzService);
    this.logger.debug(`findOne: id=${id}, userId=${userId}, isGlobalAdmin=${orgIds === null}`);

    try {
      // Build query with organization filtering
      const queryBuilder = withRequestEm(this.appDashboardRepo)
        .createQueryBuilder('ad')
        .leftJoinAndSelect('ad.grafanaInstance', 'gi')
        .leftJoinAndSelect('ad.systemUnderTest', 'sut')
        .leftJoinAndSelect('ad.grafanaDashboard', 'gd')
        .where('ad.id = :id', { id });

      // Apply organization filtering (unless user is global admin)
      if (orgIds !== null) {
        if (orgIds.length === 0) {
          // User has no organization access - only legacy (NULL) dashboards
          queryBuilder.andWhere('ad.organizationId IS NULL');
        } else {
          // User has org access - their org dashboards + legacy (NULL) dashboards
          queryBuilder.andWhere(
            '(ad.organizationId IN (:...orgIds) OR ad.organizationId IS NULL)',
            { orgIds }
          );
        }
      }

      const result = await queryBuilder.getOne();

      if (!result) {
        throw new NotFoundException(`Application dashboard with ID ${id} not found`);
      }

      // Enrich variables with template metadata
      const enrichedVariables = this.enrichVariablesWithTemplateMetadata(
        Array.isArray(result.variables) ? result.variables : [],
        result.grafanaDashboard
      );

      return {
        id: result.id,
        system_under_test_id: result.systemUnderTestId,
        test_environment: result.testEnvironment,
        grafana_instance_id: result.grafanaInstanceId,
        grafana_dashboard_id: result.grafanaDashboardId,
        dashboard_name: result.dashboardName,
        dashboard_id: result.dashboardId,
        dashboard_uid: result.dashboardUid,
        dashboard_label: result.dashboardLabel,
        tags: result.tags,
        template_dashboard_uid: result.templateDashboardUid,
        variables: enrichedVariables,
        replaced_templating_variables: result.replacedTemplatingVariables as Record<string, unknown>[] | undefined,
        snapshot_timeout: result.snapshotTimeout,
        created_at: result.createdAt.toISOString(),
        updated_at: result.updatedAt.toISOString(),
        grafana_instance: result.grafanaInstance ? {
          id: result.grafanaInstance.id,
          label: result.grafanaInstance.label,
          client_url: result.grafanaInstance.client_url,
          server_url: result.grafanaInstance.server_url,
        } : undefined,
        systems_under_test: result.systemUnderTest ? {
          id: result.systemUnderTest.id,
          name: result.systemUnderTest.name,
        } : undefined,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to fetch application dashboard ${id}:`, error);
      throw error;
    }
  }

  /**
   * Create a new application dashboard
   *
   * @param createDto - The application dashboard creation DTO
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   *
   * Note: ApplicationDashboard entity does not have organization_id or created_by/updated_by yet,
   * so ownership tracking is not applied. Full ownership assignment will be enabled when
   * Phase 4 adds the ownership columns.
   */
  async create(createDto: CreateApplicationDashboardDto, userId: string, _roles: string[]): Promise<ApplicationDashboard> {
    this.logger.debug(`create: userId=${userId}`);

    try {
      // Inherit org/team from the parent SUT — ApplicationDashboard.organization_id
      // is NOT NULL and the camelCase property key is required.
      const system = await withRequestEm(this.systemRepo).findOne({
        where: { id: createDto.systemUnderTestId },
      });
      if (!system) {
        throw new NotFoundException(`System under test not found: ${createDto.systemUnderTestId}`);
      }

      const applicationDashboard = this.appDashboardRepo.create({
        systemUnderTestId: createDto.systemUnderTestId,
        testEnvironment: createDto.testEnvironment,
        grafanaInstanceId: createDto.grafanaInstanceId,
        grafanaDashboardId: createDto.grafanaDashboardId,
        dashboardName: createDto.dashboardName,
        dashboardId: createDto.dashboardId,
        dashboardUid: createDto.dashboardUid,
        dashboardLabel: createDto.dashboardLabel,
        tags: createDto.tags || [],
        templateDashboardUid: createDto.templateDashboardUid,
        variables: (createDto.variables || []).filter(v => v && !Array.isArray(v) && typeof v.name === 'string'),
        replacedTemplatingVariables: createDto.replacedTemplatingVariables || [],
        snapshotTimeout: createDto.snapshotTimeout || 4,
        organizationId: system.organization_id,
        teamId: system.team_id,
      } as unknown as Parameters<typeof this.appDashboardRepo.create>[0]);

      const result = await withRequestEm(this.appDashboardRepo).save(applicationDashboard);

      // Fetch with relations
      const resultWithRelations = await withRequestEm(this.appDashboardRepo).findOne({
        where: { id: result.id },
        relations: ['grafanaInstance', 'systemUnderTest']
      });

      if (!resultWithRelations) {
        throw new Error('Failed to fetch created application dashboard');
      }

      // Phase 5a: ApplicationDashboard.organization_id maps to camelCase
      // organizationId, so AuditService.dispatch cannot read it directly —
      // pass organizationIdOverride for the org-scope tag.
      this.auditService.logCreate(resultWithRelations as unknown as OwnedResource, {
        organizationIdOverride: resultWithRelations.organizationId,
      });

      this.logger.log(`Created application dashboard: ${resultWithRelations.dashboardLabel} (${resultWithRelations.id}) by user: ${userId}`);

      return {
        id: resultWithRelations.id,
        system_under_test_id: resultWithRelations.systemUnderTestId,
        test_environment: resultWithRelations.testEnvironment,
        grafana_instance_id: resultWithRelations.grafanaInstanceId,
        grafana_dashboard_id: resultWithRelations.grafanaDashboardId,
        dashboard_name: resultWithRelations.dashboardName,
        dashboard_id: resultWithRelations.dashboardId,
        dashboard_uid: resultWithRelations.dashboardUid,
        dashboard_label: resultWithRelations.dashboardLabel,
        tags: resultWithRelations.tags,
        template_dashboard_uid: resultWithRelations.templateDashboardUid,
        variables: resultWithRelations.variables as Record<string, unknown>[] | undefined,
        replaced_templating_variables: resultWithRelations.replacedTemplatingVariables as Record<string, unknown>[] | undefined,
        snapshot_timeout: resultWithRelations.snapshotTimeout,
        created_at: resultWithRelations.createdAt.toISOString(),
        updated_at: resultWithRelations.updatedAt.toISOString(),
        grafana_instance: resultWithRelations.grafanaInstance ? {
          id: resultWithRelations.grafanaInstance.id,
          label: resultWithRelations.grafanaInstance.label,
          client_url: resultWithRelations.grafanaInstance.client_url,
          server_url: resultWithRelations.grafanaInstance.server_url,
        } : undefined,
        systems_under_test: resultWithRelations.systemUnderTest ? {
          id: resultWithRelations.systemUnderTest.id,
          name: resultWithRelations.systemUnderTest.name,
        } : undefined,
      };
    } catch (error) {
      this.logger.error('Error creating application dashboard:', error);
      throw error;
    }
  }

  /**
   * Update an existing application dashboard
   *
   * @param id - The application dashboard ID
   * @param updateDto - The update DTO
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   *
   * Note: ApplicationDashboard entity does not have organization_id yet, so permission checks are not applied.
   * Full permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async update(id: string, updateDto: UpdateApplicationDashboardDto, userId: string, roles: string[]): Promise<ApplicationDashboard> {
    this.logger.debug(`update: id=${id}, userId=${userId}`);

    try {
      // First check if the dashboard exists
      const existing = await withRequestEm(this.appDashboardRepo).findOne({ where: { id } });
      if (!existing) {
        throw new NotFoundException(`Application dashboard with id ${id} not found`);
      }

      // NOTE: Modify permission check will be added here when ApplicationDashboard entity has organization_id
      // For now, all application dashboards are updatable (treated as legacy data)

      // Build update data using entity property names
      const updateData: Partial<ApplicationDashboardEntity> = {};

      if (updateDto.systemUnderTestId !== undefined) updateData.systemUnderTestId = updateDto.systemUnderTestId;
      if (updateDto.testEnvironment !== undefined) updateData.testEnvironment = updateDto.testEnvironment;
      if (updateDto.grafanaInstanceId !== undefined) updateData.grafanaInstanceId = updateDto.grafanaInstanceId;
      if (updateDto.grafanaDashboardId !== undefined) updateData.grafanaDashboardId = updateDto.grafanaDashboardId;
      if (updateDto.dashboardName !== undefined) updateData.dashboardName = updateDto.dashboardName;
      if (updateDto.dashboardId !== undefined) updateData.dashboardId = updateDto.dashboardId;
      if (updateDto.dashboardUid !== undefined) updateData.dashboardUid = updateDto.dashboardUid;
      if (updateDto.dashboardLabel !== undefined) updateData.dashboardLabel = updateDto.dashboardLabel;
      if (updateDto.tags !== undefined) updateData.tags = updateDto.tags;
      if (updateDto.templateDashboardUid !== undefined) updateData.templateDashboardUid = updateDto.templateDashboardUid;
      if (updateDto.variables !== undefined) updateData.variables = updateDto.variables.filter(v => v && !Array.isArray(v) && typeof v.name === 'string') as unknown as Record<string, unknown>;
      if (updateDto.replacedTemplatingVariables !== undefined) updateData.replacedTemplatingVariables = updateDto.replacedTemplatingVariables as unknown as Record<string, unknown>;
      if (updateDto.snapshotTimeout !== undefined) updateData.snapshotTimeout = updateDto.snapshotTimeout;

      // Update with TypeORM
      await withRequestEm(this.appDashboardRepo).update(id, updateData as unknown as Parameters<typeof this.appDashboardRepo.update>[1]);

      // Reload the post-update entity (with prototype intact) for the audit
      // diff. `existing` already holds the pre-update snapshot — no extra
      // clone needed because update() doesn't mutate it in place.
      const afterEntity = await withRequestEm(this.appDashboardRepo).findOne({ where: { id } });
      if (afterEntity) {
        this.auditService.logUpdate(
          existing as unknown as OwnedResource,
          afterEntity as unknown as OwnedResource,
          { organizationIdOverride: existing.organizationId ?? afterEntity.organizationId },
        );
      }

      // Fetch the updated record with relations
      const result = await this.findOne(id, userId, roles);

      this.logger.log(`Updated application dashboard: ${result.dashboard_label} (${result.id}) by user: ${userId}`);

      return result;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error updating application dashboard ${id}:`, error);
      throw error;
    }
  }

  /**
   * Copy application dashboards from a source scope to a target scope
   *
   * @param dto - Copy parameters including source/target scopes and conflict strategy
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   *
   * Note: Application dashboards don't have a workload dimension - scoped by system + environment only.
   * Unique constraint key: grafanaInstanceId + dashboardUid + dashboardLabel
   */
  async copyToScope(
    dto: CopyApplicationDashboardsDto,
    userId: string,
    roles: string[],
  ): Promise<{ copied: number; skipped: number; total: number }> {
    // Fetch source dashboards using the existing findAll with org filtering
    let sourceDashboards = await this.findAll(userId, roles, {
      systemUnderTestId: dto.sourceSystemUnderTestId,
      testEnvironment: dto.sourceTestEnvironment,
    });

    // Filter to specific IDs if provided
    if (dto.ids && dto.ids.length > 0) {
      const idSet = new Set(dto.ids);
      sourceDashboards = sourceDashboards.filter(d => idSet.has(d.id));
    }

    const total = sourceDashboards.length;
    let copied = 0;
    let skipped = 0;

    // Fetch existing dashboards in target scope for conflict detection
    const existingDashboards = await this.findAll(userId, roles, {
      systemUnderTestId: dto.targetSystemUnderTestId,
      testEnvironment: dto.targetTestEnvironment,
    });

    // Unique key: grafanaInstanceId + dashboardUid + dashboardLabel
    const makeKey = (d: { grafana_instance_id?: string; dashboard_uid?: string; dashboard_label: string }) =>
      `${d.grafana_instance_id ?? ''}|${d.dashboard_uid ?? ''}|${d.dashboard_label}`;

    const existingKeySet = new Set(existingDashboards.map(makeKey));
    const existingByKey = new Map(existingDashboards.map(d => [makeKey(d), d]));

    for (const dashboard of sourceDashboards) {
      const key = makeKey(dashboard);
      const exists = existingKeySet.has(key);

      if (exists && dto.conflictStrategy === 'skip') {
        skipped++;
        continue;
      }

      if (exists && dto.conflictStrategy === 'overwrite') {
        const existingDash = existingByKey.get(key)!;
        await this.update(
          existingDash.id,
          {
            tags: dashboard.tags ?? [],
            variables: (dashboard.variables ?? []) as unknown as ApplicationDashboardVariableDto[],
            replacedTemplatingVariables: (dashboard.replaced_templating_variables ?? []) as unknown as ReplacedTemplatingVariableDto[],
            snapshotTimeout: dashboard.snapshot_timeout,
          },
          userId,
          roles,
        );
        copied++;
        continue;
      }

      // Create new
      await this.create(
        {
          systemUnderTestId: dto.targetSystemUnderTestId,
          testEnvironment: dto.targetTestEnvironment,
          grafanaInstanceId: dashboard.grafana_instance_id ?? '',
          grafanaDashboardId: dashboard.grafana_dashboard_id ?? '',
          dashboardName: dashboard.dashboard_name,
          dashboardId: dashboard.dashboard_id,
          dashboardUid: dashboard.dashboard_uid ?? '',
          dashboardLabel: dashboard.dashboard_label,
          tags: dashboard.tags ?? [],
          templateDashboardUid: dashboard.template_dashboard_uid,
          variables: (dashboard.variables ?? []) as unknown as ApplicationDashboardVariableDto[],
          replacedTemplatingVariables: (dashboard.replaced_templating_variables ?? []) as unknown as ReplacedTemplatingVariableDto[],
          snapshotTimeout: dashboard.snapshot_timeout,
        },
        userId,
        roles,
      );
      copied++;
    }

    this.logger.log(`Copied ${copied} application dashboards, skipped ${skipped} of ${total} total`);
    return { copied, skipped, total };
  }

  /**
   * Get information about whether a dashboard can be deleted from Grafana
   * Returns info about the linked grafana_dashboard and whether it's used by other SUTs
   *
   * @param id - The application dashboard ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: ApplicationDashboard entity does not have organization_id yet, so access checks are not applied.
   * Full access permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async getDeleteInfo(id: string, userId: string, _roles: string[]): Promise<DeleteInfo> {
    this.logger.debug(`getDeleteInfo: id=${id}, userId=${userId}`);

    // NOTE: Access permission check will be added here when ApplicationDashboard entity has organization_id
    // For now, all application dashboards are accessible (treated as legacy data)

    try {
      // Load the application dashboard with its grafana dashboard and SUT
      const appDashboard = await withRequestEm(this.appDashboardRepo).findOne({
        where: { id },
        relations: ['grafanaDashboard', 'systemUnderTest'],
      });

      if (!appDashboard) {
        throw new NotFoundException(`Application dashboard with id ${id} not found`);
      }

      const grafanaDashboard = appDashboard.grafanaDashboard;
      if (!grafanaDashboard) {
        return {
          canDeleteFromGrafana: false,
          grafanaDashboardName: appDashboard.dashboardName,
          grafanaDashboardUid: appDashboard.dashboardUid || '',
          otherSuts: [],
        };
      }

      // Get current SUT name
      const currentSutName = appDashboard.systemUnderTest?.name || '';

      // Get other SUTs that use this dashboard (excluding current)
      const usedBySut = grafanaDashboard.usedBySut || [];
      const otherSuts = usedBySut.filter(sut => sut !== currentSutName);

      return {
        canDeleteFromGrafana: otherSuts.length === 0,
        grafanaDashboardName: grafanaDashboard.name,
        grafanaDashboardUid: grafanaDashboard.uid,
        otherSuts,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error getting delete info for application dashboard ${id}:`, error);
      throw error;
    }
  }

  /**
   * Get batch delete info for multiple application dashboards
   * Returns list of orphaned dashboards that can be deleted from Grafana
   *
   * @param ids - The application dashboard IDs
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: ApplicationDashboard entity does not have organization_id yet, so access checks are not applied.
   * Full access permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async getBatchDeleteInfo(ids: string[], userId: string, roles: string[]): Promise<BatchDeleteInfo> {
    this.logger.debug(`getBatchDeleteInfo: count=${ids.length}, userId=${userId}`);

    // NOTE: Access permission check will be added here when ApplicationDashboard entity has organization_id
    // For now, all application dashboards are accessible (treated as legacy data)

    try {
      const orphanedDashboards: BatchDeleteInfo['orphanedDashboards'] = [];
      let nonOrphanedCount = 0;

      for (const id of ids) {
        const info = await this.getDeleteInfo(id, userId, roles);
        if (info.canDeleteFromGrafana && info.grafanaDashboardUid) {
          orphanedDashboards.push({
            applicationDashboardId: id,
            grafanaDashboardName: info.grafanaDashboardName,
            grafanaDashboardUid: info.grafanaDashboardUid,
          });
        } else {
          nonOrphanedCount++;
        }
      }

      return {
        orphanedDashboards,
        nonOrphanedCount,
      };
    } catch (error) {
      this.logger.error('Error getting batch delete info:', error);
      throw error;
    }
  }

  /**
   * Delete an application dashboard with optional Grafana dashboard deletion
   *
   * @param id - Application dashboard ID
   * @param deleteFromGrafana - If true and dashboard is orphaned, also delete from Grafana
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: ApplicationDashboard entity does not have organization_id yet, so permission checks are not applied.
   * Full permission checks will be enabled when Phase 4 adds organization_id column.
   */
  /**
   * Narrow a batch to the dashboards the caller can actually see.
   *
   * Batch deletion is executed by a background worker, where there is no request
   * transaction and therefore no RLS role/GUCs — the DELETE would go through for
   * any id. So the visibility check has to happen here, in the request, while the
   * RLS policies still apply to this read.
   */
  async filterAccessible(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await withRequestEm(this.appDashboardRepo).find({
      where: { id: In(ids) },
      select: { id: true },
    });
    return rows.map(row => row.id);
  }

  async delete(
    id: string,
    deleteFromGrafana: boolean,
    userId: string,
    _roles: string[],
    opts?: { auditActorOverride?: { userId: string } },
  ): Promise<DeleteResult> {
    this.logger.debug(`delete: id=${id}, deleteFromGrafana=${deleteFromGrafana}, userId=${userId}`);

    try {
      // First check if the dashboard exists and load related data
      const existing = await withRequestEm(this.appDashboardRepo).findOne({
        where: { id },
        relations: ['grafanaDashboard', 'grafanaInstance', 'systemUnderTest'],
      });

      if (!existing) {
        throw new NotFoundException(`Application dashboard with id ${id} not found`);
      }

      // NOTE: Delete permission check will be added here when ApplicationDashboard entity has organization_id
      // For now, all application dashboards are deletable (treated as legacy data)

      const grafanaDashboard = existing.grafanaDashboard;
      const grafanaInstance = existing.grafanaInstance;
      const currentSutName = existing.systemUnderTest?.name || '';

      // Check if we should delete from Grafana
      let shouldDeleteFromGrafana = false;
      if (deleteFromGrafana && grafanaDashboard && grafanaInstance) {
        const usedBySut = grafanaDashboard.usedBySut || [];
        const otherSuts = usedBySut.filter(sut => sut !== currentSutName);
        shouldDeleteFromGrafana = otherSuts.length === 0;
      }

      // Phase 5a: log DELETE rows before the cascade transaction so the
      // pre-delete state is captured. Mirrors the test-run handler precedent
      // (PR8) — accepts the small false-positive risk if the txn rolls back.
      // Audited rows: the ApplicationDashboard itself, and (if the user opted
      // to also remove it from Grafana and the linked GrafanaDashboard is
      // unused by any other SUT) the sibling GrafanaDashboard. Cascaded
      // benchmark deletions are not individually audited (bucket-2 pattern).
      // Batch deletes run in the BullMQ worker with no HTTP request CLS context,
      // so AuditService would skip the row unless the queuing user is forwarded
      // explicitly (same fix as DeleteTestRunHandler). In-request deletes pass
      // no override and fall back to CLS, which also has email + IP.
      const actorOverride = opts?.auditActorOverride
        ? { actorOverride: opts.auditActorOverride }
        : {};

      this.auditService.logDelete(existing as unknown as OwnedResource, {
        organizationIdOverride: existing.organizationId,
        ...actorOverride,
      });
      if (shouldDeleteFromGrafana && grafanaDashboard) {
        this.auditService.logDelete(grafanaDashboard as unknown as OwnedResource, {
          organizationIdOverride: grafanaDashboard.organizationId,
          ...actorOverride,
        });
      }

      // Use transaction to ensure atomicity
      await this.dataSource.transaction(async (transactionalEntityManager) => {
        // Delete related benchmarks
        const benchmarkResult = await transactionalEntityManager
          .createQueryBuilder()
          .delete()
          .from('benchmarks')
          .where('application_dashboard_id = :id', { id })
          .execute();

        if (benchmarkResult.affected && benchmarkResult.affected > 0) {
          this.logger.log(`Cascade deleted ${benchmarkResult.affected} benchmark(s) for application dashboard ${id}`);
        }

        // Cascade-delete dependent rows that have NO ACTION FKs on
        // application_dashboard_id. Mirrors the SUT delete handler — these are
        // time-series stats / template configs keyed on the dashboard and are
        // meaningless once the dashboard is gone. Without this the parent
        // DELETE fails with a 23503 FK violation (e.g. ds_metric_statistics,
        // provisioned_template_ds_compare_configs). ds_compare_config is
        // CASCADE so it is intentionally omitted.
        const dependentTables = [
          'ds_change_points',
          'ds_adapt_results',
          'ds_adapt_tracked_results',
          'ds_tracked_differences',
          'ds_control_group_statistics',
          'ds_metric_statistics',
          'ds_panels',
          'ds_metrics',
          'provisioned_template_ds_compare_configs',
        ];
        for (const table of dependentTables) {
          await transactionalEntityManager.query(
            `DELETE FROM ${table} WHERE application_dashboard_id = $1`,
            [id],
          );
        }

        // Delete the application dashboard
        await transactionalEntityManager.delete(ApplicationDashboardEntity, id);
        this.logger.log(`Deleted application dashboard: ${existing.dashboardLabel} (${existing.id}) by user: ${userId}`);

        // Update usedBySut on grafana_dashboard (remove this SUT)
        if (grafanaDashboard && currentSutName) {
          const updatedUsedBySut = (grafanaDashboard.usedBySut || []).filter(
            sut => sut !== currentSutName
          );
          await transactionalEntityManager.update(
            GrafanaDashboardEntity,
            grafanaDashboard.id,
            { usedBySut: updatedUsedBySut }
          );
          this.logger.log(`Updated usedBySut for grafana dashboard ${grafanaDashboard.uid}, removed: ${currentSutName}`);
        }

        // If we should delete from Grafana, do so within the transaction
        if (shouldDeleteFromGrafana && grafanaDashboard && grafanaInstance) {
          // Delete from database first
          await transactionalEntityManager.delete(GrafanaDashboardEntity, grafanaDashboard.id);
          this.logger.log(`Deleted grafana dashboard from database: ${grafanaDashboard.uid}`);

          // Delete from Grafana API
          // Note: If this fails, the transaction will rollback
          const grafanaInstanceData = await this.grafanaClientService.getGrafanaInstance(grafanaInstance.id);
          await this.grafanaClientService.deleteDashboard(grafanaInstanceData, grafanaDashboard.uid);
          this.logger.log(`Deleted dashboard from Grafana: ${grafanaDashboard.uid}`);
        }
      });

      return {
        deletedFromGrafana: shouldDeleteFromGrafana,
        grafanaDashboardUid: shouldDeleteFromGrafana ? grafanaDashboard?.uid : undefined,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error deleting application dashboard ${id}:`, error);
      throw error;
    }
  }

  /**
   * Enrich application dashboard variables with template metadata from Grafana dashboard
   * @private
   */
  private enrichVariablesWithTemplateMetadata(
    variables: Record<string, unknown>[],
    grafanaDashboard: GrafanaDashboardEntity | undefined | null,
  ): Record<string, unknown>[] {
    if (!grafanaDashboard || !variables || variables.length === 0) {
      return variables;
    }

    try {
      // Get template variables from grafana_json.dashboard.templating.list
      const grafanaJson = grafanaDashboard.grafanaJson as Record<string, unknown> | undefined;
      const dashboard = grafanaJson?.dashboard as Record<string, unknown> | undefined;
      const templating = dashboard?.templating as Record<string, unknown> | undefined;
      const templateVars = (templating?.list as Record<string, unknown>[]) || [];

      // Create a map of template variables by name for quick lookup
      const templateVarMap = new Map<string, Record<string, unknown>>();
      templateVars.forEach((templateVar: Record<string, unknown>) => {
        templateVarMap.set(templateVar.name as string, templateVar);
      });

      // Enrich each variable with template metadata
      return variables.map((variable: Record<string, unknown>) => {
        const templateVar = templateVarMap.get(variable.name as string);

        if (templateVar) {
          return {
            ...variable,
            includeAll: templateVar.includeAll || false,
            multi: templateVar.multi || false,
            type: templateVar.type,
            query: templateVar.query,
            allValue: templateVar.allValue,
          };
        }

        return variable;
      });
    } catch (error) {
      this.logger.warn('Failed to enrich variables with template metadata:', error);
      return variables;
    }
  }
}