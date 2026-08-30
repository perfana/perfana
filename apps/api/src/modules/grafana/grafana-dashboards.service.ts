import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  HttpException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GrafanaClientService } from './grafana-client.service';
import {
  CreateGrafanaDashboardDto,
  UpdateGrafanaDashboardDto,
  GrafanaDashboardQuery,
  TemplatingVariableDto
} from './dto/grafana-dashboard.dto';
import { GrafanaDashboard as GrafanaDashboardEntity, GrafanaInstance as GrafanaInstanceEntity, ApplicationDashboard as ApplicationDashboardEntity } from '../../entities';
import { withRequestEm } from '../../common/db/request-em';
import { AuthorizationService } from '../../common/services/authorization.service';
import { withOrgFilter } from '../../common/utils/with-org-filter';
import { OwnedResource } from '@perfana/shared';
import { AuditService } from '../audit/audit.service';

interface GrafanaJsonData {
  dashboard?: {
    panels?: Record<string, unknown>[];
  };
}

export interface GrafanaDashboard {
  id: string;
  grafana_instance_id: string;
  grafana_id: number;
  datasource_type?: string;
  uid: string;
  slug?: string;
  name: string;
  uri?: string;
  templating_variables?: TemplatingVariableDto[];
  panels?: Record<string, unknown>[];
  variables?: Record<string, unknown>[];
  tags?: string[];
  used_by_sut?: string[];
  updated?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Service responsible for managing Grafana dashboards.
 *
 * Authorization:
 * - All methods accept userId and roles parameters for authorization
 * - findAll filters by organization: users see dashboards in their accessible orgs.
 *   There is no null-org allowance — `organization_id` has been NOT NULL on every
 *   owned resource since RBAC Phase 4.
 * - Global admins bypass all authorization checks
 */
@Injectable()
export class GrafanaDashboardsService {
  private readonly logger = new Logger(GrafanaDashboardsService.name);

  constructor(
    @InjectRepository(GrafanaDashboardEntity)
    private grafanaDashboardRepo: Repository<GrafanaDashboardEntity>,
    @InjectRepository(GrafanaInstanceEntity)
    private grafanaInstanceRepo: Repository<GrafanaInstanceEntity>,
    private readonly grafanaClientService: GrafanaClientService,
    private readonly authzService: AuthorizationService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Verify the user has access to a dashboard by organization membership.
   * Dashboards with no organization_id (legacy/shared) are accessible to all.
   * Delegates the admin / legacy-null-org / membership decision to AuthorizationService.
   * team_id is omitted to preserve the prior behavior of not checking team membership.
   * created_by is unused by canAccessResource.
   */
  private async verifyOrgAccess(dashboard: GrafanaDashboardEntity, userId: string, roles: string[]): Promise<void> {
    const result = await this.authzService.canAccessResource(userId, roles, {
      organization_id: dashboard.organizationId,
      created_by: '',
    } as OwnedResource);
    if (!result.allowed) {
      throw new ForbiddenException(`Access denied to dashboard ${dashboard.id}`);
    }
  }

  /**
   * Find all Grafana dashboards accessible to the user.
   *
   * Non-admin users see dashboards belonging to their organizations plus
   * dashboards with no organization_id (legacy/shared). Admins see all.
   */
  async findAll(userId: string, roles: string[], query: GrafanaDashboardQuery = {}): Promise<GrafanaDashboard[]> {
    // Resolve accessible org IDs: null means global admin (no filter needed)
    const orgIds = await withOrgFilter(userId, roles, this.authzService);
    this.logger.debug(`findAll: userId=${userId}, isGlobalAdmin=${orgIds === null}`);

    try {
      const queryBuilder = withRequestEm(this.grafanaDashboardRepo).createQueryBuilder('gd');

      // Organization filtering: non-admin users see only their organizations'
      // dashboards. No null-org escape — organization_id has been NOT NULL since
      // Phase 4, so it could only ever match a dangling join.
      if (orgIds !== null) {
        if (orgIds.length > 0) {
          queryBuilder.andWhere('gd.organizationId IN (:...orgIds)', { orgIds });
        } else {
          queryBuilder.andWhere('1 = 0'); // no memberships, nothing is visible
        }
      }

      // Exclude synthetic dashboards created for non-Grafana sources.
      // Join through application_dashboards → metrics_sources to check source_type.
      // Only include dashboards linked to a MetricsSource with source_type = 'grafana'
      // (or not linked to any MetricsSource — legacy data).
      if (!query.uid) {
        queryBuilder.andWhere(`NOT EXISTS (
          SELECT 1 FROM application_dashboards ad
          JOIN metrics_sources ms ON ms.id = ad.metrics_source_id
          WHERE ad.grafana_dashboard_id = gd.id
            AND ms.source_type != 'grafana'
        )`);
      }

      // Apply filters
      if (query.grafanaInstanceId) {
        queryBuilder.andWhere('gd.grafanaInstanceId = :grafanaInstanceId', {
          grafanaInstanceId: query.grafanaInstanceId
        });
      }

      if (query.name) {
        queryBuilder.andWhere('gd.name ILIKE :name', {
          name: `%${query.name}%`
        });
      }

      if (query.uid) {
        queryBuilder.andWhere('gd.uid = :uid', {
          uid: query.uid
        });
      }

      if (query.tags && query.tags.length > 0) {
        queryBuilder.andWhere('gd.tags && :tags', { tags: query.tags });
      }

      if (query.usedBySut) {
        queryBuilder.andWhere(':usedBySut = ANY(gd.usedBySut)', { usedBySut: query.usedBySut });
      }

      queryBuilder.orderBy('gd.name', 'ASC');

      const results = await queryBuilder.getMany();

      // Debug logging for first result
      if (results.length > 0 && results[0]) {
        const first = results[0];
        const hasGrafanaJson = !!first.grafanaJson;
        const firstJson = first.grafanaJson as GrafanaJsonData | undefined;
        const hasDashboard = !!firstJson?.dashboard;
        const hasPanels = !!firstJson?.dashboard?.panels;
        const panelsLength = firstJson?.dashboard?.panels?.length || 0;
        const simplePanelsLength = first.panels?.length || 0;

        this.logger.debug(`findAll first result ${first.uid}: grafanaJson=${hasGrafanaJson}, dashboard=${hasDashboard}, panels=${hasPanels}, panelsCount=${panelsLength}, simplePanelsCount=${simplePanelsLength}`);

        if (hasPanels && panelsLength > 0 && firstJson?.dashboard?.panels?.[0]) {
          this.logger.debug(`First panel keys: ${Object.keys(firstJson.dashboard.panels[0]).join(', ')}`);
        }
      }

      return results.map(row => {
        // Try to get full panels from grafanaJson first, fallback to simplified panels
        const rowJson = row.grafanaJson as GrafanaJsonData | undefined;
        let panels = rowJson?.dashboard?.panels || row.panels;

        // Every panel leaves here with `yAxesFormat`, whichever shape it arrived in.
        //
        // Grafana itself never uses that name: a synced dashboard carries the unit at
        // `fieldConfig.defaults.unit`, and only our own simplified rows use `y_axes_format`.
        // Transforming just the simplified branch meant a dashboard with grafanaJson — the
        // majority, since that is what a sync writes — served panels with no unit at all, and
        // every consumer reading `panel.yAxesFormat` silently got undefined. Nothing errored:
        // the compare card just stopped labelling its values.
        //
        // `yaxes[0].format` is the Grafana 6 spelling, kept because a dashboard imported from
        // an old export still carries it and costs one `??` to support.
        if (panels) {
          panels = (panels as unknown[]).map((panel) => {
            const p = panel as Record<string, unknown>;
            const defaults = (p['fieldConfig'] as Record<string, unknown> | undefined)?.['defaults'] as
              | Record<string, unknown>
              | undefined;
            const legacyYaxis = (p['yaxes'] as Array<Record<string, unknown>> | undefined)?.[0];
            return {
              ...p,
              yAxesFormat: p['yAxesFormat'] ?? p['y_axes_format'] ?? defaults?.['unit'] ?? legacyYaxis?.['format'],
            };
          });
        }

        return {
          id: row.id,
          grafana_instance_id: row.grafanaInstanceId,
          grafana_id: row.grafanaId,
          datasource_type: row.datasourceType,
          uid: row.uid,
          slug: row.slug,
          name: row.name,
          uri: row.uri,
          templating_variables: row.templatingVariables as TemplatingVariableDto[] | undefined,
          panels: panels as Record<string, unknown>[] | undefined,
          variables: row.variables as Record<string, unknown>[] | undefined,
          tags: row.tags,
          used_by_sut: row.usedBySut,
          updated: row.updated?.toISOString(),
          created_at: row.createdAt.toISOString(),
          updated_at: row.createdAt.toISOString() // Note: no updated_at column in entity
        };
      });
    } catch (error) {
      this.logger.error('Error fetching Grafana dashboards:', error);
      throw error;
    }
  }

  /**
   * Find a single Grafana dashboard by ID.
   * Non-admin users can only access dashboards in their orgs or unowned dashboards.
   */
  async findOne(id: string, userId: string, roles: string[]): Promise<GrafanaDashboard> {
    this.logger.debug(`findOne: id=${id}, userId=${userId}`);

    try {
      const result = await withRequestEm(this.grafanaDashboardRepo).findOne({ where: { id } });

      if (!result) {
        throw new NotFoundException(`Grafana dashboard with ID ${id} not found`);
      }

      await this.verifyOrgAccess(result, userId, roles);

      // Debug logging for panel structure
      const resultJson = result.grafanaJson as GrafanaJsonData | undefined;
      const hasGrafanaJson = !!result.grafanaJson;
      const hasDashboard = !!resultJson?.dashboard;
      const hasPanels = !!resultJson?.dashboard?.panels;
      const panelsLength = resultJson?.dashboard?.panels?.length || 0;
      const simplePanelsLength = result.panels?.length || 0;

      this.logger.log(`Dashboard ${result.uid}: grafanaJson=${hasGrafanaJson}, dashboard=${hasDashboard}, panels=${hasPanels}, panelsCount=${panelsLength}, simplePanelsCount=${simplePanelsLength}`);

      if (hasPanels && panelsLength > 0) {
        this.logger.log(`First panel structure: ${JSON.stringify(resultJson?.dashboard?.panels?.[0]).substring(0, 200)}`);
      }

      return {
        id: result.id,
        grafana_instance_id: result.grafanaInstanceId,
        grafana_id: result.grafanaId,
        datasource_type: result.datasourceType,
        uid: result.uid,
        slug: result.slug,
        name: result.name,
        uri: result.uri,
        templating_variables: result.templatingVariables as TemplatingVariableDto[] | undefined,
        panels: (resultJson?.dashboard?.panels || result.panels) as Record<string, unknown>[] | undefined,
        variables: result.variables as Record<string, unknown>[] | undefined,
        tags: result.tags,
        used_by_sut: result.usedBySut,
        updated: result.updated?.toISOString(),
        created_at: result.createdAt.toISOString(),
        updated_at: result.createdAt.toISOString() // Note: no updated_at column in entity
      };
    } catch (error) {
      this.logger.error(`Error fetching Grafana dashboard ${id}:`, error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new Error(`Failed to fetch Grafana dashboard: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
    }
  }

  /**
   * Create a new Grafana dashboard.
   */
  async create(createDto: CreateGrafanaDashboardDto, userId: string, _roles: string[]): Promise<GrafanaDashboard> {
    this.logger.debug(`create: userId=${userId}`);

    try {
      // Inherit org/team from the parent GrafanaInstance — GrafanaDashboard.
      // organization_id is NOT NULL and the camelCase property key is required.
      const grafanaInstance = await withRequestEm(this.grafanaInstanceRepo).findOne({
        where: { id: createDto.grafanaInstanceId },
      });
      if (!grafanaInstance) {
        throw new NotFoundException(`Grafana instance not found: ${createDto.grafanaInstanceId}`);
      }

      const dashboard = this.grafanaDashboardRepo.create({
        grafanaInstanceId: createDto.grafanaInstanceId,
        grafanaId: createDto.grafanaId,
        datasourceType: createDto.datasourceType,
        uid: createDto.uid,
        slug: createDto.slug,
        name: createDto.name,
        uri: createDto.uri,
        templatingVariables: createDto.templatingVariables || [],
        panels: createDto.panels || [],
        variables: createDto.variables || [],
        tags: createDto.tags || [],
        usedBySut: createDto.usedBySut || [],
        updated: new Date(),
        organizationId: grafanaInstance.organizationId,
        teamId: grafanaInstance.teamId,
      });

      const result = await withRequestEm(this.grafanaDashboardRepo).save(dashboard);

      // Phase 5a: GrafanaDashboard.organization_id maps to camelCase property
      // organizationId, so AuditService.dispatch cannot read it directly —
      // pass organizationIdOverride for the org-scope tag.
      this.auditService.logCreate(result as unknown as OwnedResource, {
        organizationIdOverride: result.organizationId,
      });

      this.logger.log(`Created Grafana dashboard: ${result.name} (${result.id}) by user: ${userId}`);

      const savedJson = result.grafanaJson as GrafanaJsonData | undefined;
      return {
        id: result.id,
        grafana_instance_id: result.grafanaInstanceId,
        grafana_id: result.grafanaId,
        datasource_type: result.datasourceType,
        uid: result.uid,
        slug: result.slug,
        name: result.name,
        uri: result.uri,
        templating_variables: result.templatingVariables as TemplatingVariableDto[] | undefined,
        panels: (savedJson?.dashboard?.panels || result.panels) as Record<string, unknown>[] | undefined,
        variables: result.variables as Record<string, unknown>[] | undefined,
        tags: result.tags,
        used_by_sut: result.usedBySut,
        updated: result.updated?.toISOString(),
        created_at: result.createdAt.toISOString(),
        updated_at: result.createdAt.toISOString()
      };
    } catch (error) {
      this.logger.error('Error creating Grafana dashboard:', error);
      throw error;
    }
  }

  /**
   * Update a Grafana dashboard.
   * Access check is handled by findOne (verifies org membership).
   */
  async update(id: string, updateDto: UpdateGrafanaDashboardDto, userId: string, roles: string[]): Promise<GrafanaDashboard> {
    this.logger.debug(`update: id=${id}, userId=${userId}`);

    try {
      // Load the entity directly so we have both the prototype (for the audit
      // diff) and the pre-update snapshot. Replaces the previous
      // `findOne(id, userId, roles)` call — same DB round-trip, but the
      // service-layer findOne mapped to a DTO and lost the prototype.
      const before = await withRequestEm(this.grafanaDashboardRepo).findOne({ where: { id } });
      if (!before) {
        throw new NotFoundException(`Grafana dashboard with ID ${id} not found`);
      }
      await this.verifyOrgAccess(before, userId, roles);

      const updateData: Partial<GrafanaDashboardEntity> = {
        updated: new Date()
      };

      // Only update provided fields using entity property names (camelCase)
      if (updateDto.grafanaInstanceId !== undefined) updateData.grafanaInstanceId = updateDto.grafanaInstanceId;
      if (updateDto.grafanaId !== undefined) updateData.grafanaId = updateDto.grafanaId;
      if (updateDto.datasourceType !== undefined) updateData.datasourceType = updateDto.datasourceType;
      if (updateDto.uid !== undefined) updateData.uid = updateDto.uid;
      if (updateDto.slug !== undefined) updateData.slug = updateDto.slug;
      if (updateDto.name !== undefined) updateData.name = updateDto.name;
      if (updateDto.uri !== undefined) updateData.uri = updateDto.uri;
      if (updateDto.templatingVariables !== undefined) updateData.templatingVariables = updateDto.templatingVariables;
      if (updateDto.panels !== undefined) updateData.panels = updateDto.panels;
      if (updateDto.variables !== undefined) updateData.variables = updateDto.variables;
      if (updateDto.tags !== undefined) updateData.tags = updateDto.tags;
      if (updateDto.usedBySut !== undefined) updateData.usedBySut = updateDto.usedBySut;

      // Update with TypeORM
      await withRequestEm(this.grafanaDashboardRepo).update(id, updateData as unknown as Parameters<typeof this.grafanaDashboardRepo.update>[1]);

      // Fetch the updated record
      const result = await withRequestEm(this.grafanaDashboardRepo).findOne({ where: { id } });

      if (!result) {
        throw new Error('Failed to fetch updated Grafana dashboard');
      }

      this.auditService.logUpdate(
        before as unknown as OwnedResource,
        result as unknown as OwnedResource,
        { organizationIdOverride: before.organizationId ?? result.organizationId },
      );

      this.logger.log(`Updated Grafana dashboard: ${result.name} (${result.id}) by user: ${userId}`);

      const updatedJson = result.grafanaJson as GrafanaJsonData | undefined;
      return {
        id: result.id,
        grafana_instance_id: result.grafanaInstanceId,
        grafana_id: result.grafanaId,
        datasource_type: result.datasourceType,
        uid: result.uid,
        slug: result.slug,
        name: result.name,
        uri: result.uri,
        templating_variables: result.templatingVariables as TemplatingVariableDto[] | undefined,
        panels: (updatedJson?.dashboard?.panels || result.panels) as Record<string, unknown>[] | undefined,
        variables: result.variables as Record<string, unknown>[] | undefined,
        tags: result.tags,
        used_by_sut: result.usedBySut,
        updated: result.updated?.toISOString(),
        created_at: result.createdAt.toISOString(),
        updated_at: result.createdAt.toISOString()
      };
    } catch (error) {
      this.logger.error(`Error updating Grafana dashboard ${id}:`, error);
      throw error;
    }
  }

  /**
   * Delete a Grafana dashboard.
   * Access check is handled by findOne (verifies org membership).
   */
  async remove(id: string, userId: string, roles: string[]): Promise<void> {
    this.logger.debug(`remove: id=${id}, userId=${userId}`);

    // Declared outside the try so the 23503 handler below can name the dashboard.
    let entity: GrafanaDashboardEntity | null = null;

    try {
      // Load the entity directly so we have the prototype (for auditableFields
      // resolution). Replaces `findOne(id, userId, roles)` — same DB round-trip
      // but keeps the entity instance instead of the mapped DTO.
      entity = await withRequestEm(this.grafanaDashboardRepo).findOne({ where: { id } });
      if (!entity) {
        throw new NotFoundException(`Grafana dashboard with ID ${id} not found`);
      }
      await this.verifyOrgAccess(entity, userId, roles);

      // application_dashboards.grafana_dashboard_id is ON DELETE NO ACTION, so
      // deleting a dashboard that is still referenced raises 23503 and surfaces as
      // an opaque 500. Grafana dashboards are shared (a SUT delete deliberately
      // leaves them behind), so cascading here would strip other systems' config —
      // refuse with a reason the caller can act on instead.
      // Match on the uid as well as the foreign key: an application dashboard can be
      // linked by dashboard_uid with a NULL grafana_dashboard_id, and those rows are
      // just as much "in use" even though no FK would stop the delete orphaning them.
      const referencingApplicationDashboards = await withRequestEm(
        this.grafanaDashboardRepo,
      ).manager.count(ApplicationDashboardEntity, {
        where: [{ grafanaDashboardId: id }, { dashboardUid: entity.uid }],
      });

      if (referencingApplicationDashboards > 0) {
        throw new ConflictException(
          `Grafana dashboard "${entity.name}" is still used by ${referencingApplicationDashboards} application dashboard(s). Remove those first.`,
        );
      }

      // logDelete fires BEFORE the row is removed so the diff captures the
      // pre-delete state.
      this.auditService.logDelete(entity as unknown as OwnedResource, {
        organizationIdOverride: entity.organizationId,
      });

      await withRequestEm(this.grafanaDashboardRepo).delete(id);

      this.logger.log(`Deleted Grafana dashboard: ${id} by user: ${userId}`);
    } catch (error) {
      // The count above runs inside the RLS transaction, so a referencing
      // application_dashboards row this caller cannot see counts as zero and the
      // DELETE still reaches the FK. A row created between the count and the
      // delete does the same. Both surface as 23503; translate it to the answer
      // the pre-check would have given rather than letting it become a 500.
      if (
        error &&
        typeof error === 'object' &&
        (error as { code?: string }).code === '23503'
      ) {
        this.logger.warn(
          `Grafana dashboard ${id} is still referenced; delete refused by foreign key`,
        );
        throw new ConflictException(
          `Grafana dashboard "${entity?.name ?? id}" is still used by application dashboards. Remove those first.`,
        );
      }

      // A deliberate refusal is not a server fault — log it without the stack so
      // the routine 409 does not read as an incident.
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(`Error deleting Grafana dashboard ${id}:`, error);
      throw error;
    }
  }

  /**
   * Get variable values for a Grafana dashboard template variable
   *
   * @param grafanaDashboardId - The dashboard ID
   * @param variableName - The variable name to get values for
   * @param system - The system under test context
   * @param environment - The test environment context
   * @param existingVariables - Already-selected variable values
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: GrafanaDashboard entity does not have organization_id yet, so access checks are not applied.
   * Full access permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async getVariableValues(
    grafanaDashboardId: string,
    variableName: string,
    system: string,
    environment: string,
    existingVariables: Record<string, string[]>,
    userId: string,
    roles: string[],
  ): Promise<Array<{ label: string; value: string }>> {
    this.logger.debug(`getVariableValues: dashboardId=${grafanaDashboardId}, variable=${variableName}, userId=${userId}`);

    try {
      // Get the dashboard and its templating variables (access check happens in findOne)
      const dashboard = await this.findOne(grafanaDashboardId, userId, roles);
      
      if (!dashboard.templating_variables) {
        return [];
      }

      const variable = dashboard.templating_variables.find(v => v.name === variableName);
      if (!variable) {
        return [];
      }

      // Get the Grafana instance
      const grafanaInstance = await this.grafanaClientService.getGrafanaInstance(dashboard.grafana_instance_id);

      switch (variable.type) {
        case 'custom':
          // For custom variables, return the defined options
          if (variable.query && typeof variable.query === 'string') {
            const options = variable.query.split(',').map(opt => opt.trim());
            return options.map(opt => ({ label: opt, value: opt }));
          }
          return [];

        case 'interval':
        case 'constant':
          // These types typically have predefined options
          if (variable.options) {
            return variable.options.map(opt => ({ label: opt.text || opt.value, value: opt.value }));
          }
          return [];

        case 'query': {
          // Get the datasource and execute the query
          if (!variable.datasource) {
            this.logger.warn(`No datasource defined for variable ${variableName}`);
            return [];
          }

          const datasourceUid = typeof variable.datasource === 'string'
            ? variable.datasource
            : (variable.datasource.uid as string | undefined);

          if (!datasourceUid) {
            this.logger.warn(`No datasource UID found for variable ${variableName}`);
            return [];
          }

          try {
            const datasource = await this.grafanaClientService.getDatasource(grafanaInstance, datasourceUid);
            
            // Replace placeholders in the query
            const processedQuery = this.processVariableQuery(variable, system, environment, existingVariables);
            
            let values: string[] = [];

            switch (datasource.type) {
              case 'influxdb':
                values = await this.grafanaClientService.getInfluxVariableValues(
                  grafanaInstance, 
                  datasource, 
                  processedQuery,
                  variable.regex
                );
                break;

              case 'prometheus':
                values = await this.grafanaClientService.getPrometheusVariableValues(
                  grafanaInstance, 
                  datasource, 
                  processedQuery,
                  variable.regex
                );
                break;

              default:
                this.logger.warn(`Datasource type ${datasource.type} not yet supported for variable ${variableName}`);
                return [];
            }

            // Convert to the expected format
            const result = [...new Set(values)].map(value => ({ label: value, value: value }));
            this.logger.log(`Retrieved ${result.length} values for variable ${variableName} from ${datasource.type} datasource`);
            return result;

          } catch (datasourceError) {
            this.logger.error(`Error querying datasource for variable ${variableName}:`, datasourceError);
            return [];
          }
        }

        default:
          this.logger.warn(`Variable type ${variable.type} not supported for variable ${variableName}`);
          return [];
      }

    } catch (error) {
      this.logger.error(`Error getting variable values for ${variableName}:`, error);
      return [];
    }
  }

  private processVariableQuery(
    variable: TemplatingVariableDto, 
    system: string, 
    environment: string, 
    existingVariables: Record<string, string[]>
  ): string {
    let query = typeof variable.query === 'string' ? variable.query : variable.query?.query || '';

    // Replace system and environment placeholders
    query = query
      .replace(/\$system_under_test/g, system)
      .replace(/\$test_environment/g, environment);

    // Replace other variable placeholders
    Object.entries(existingVariables).forEach(([varName, values]) => {
      if (varName !== 'system_under_test' && varName !== 'test_environment') {
        const replaceValue = values.length > 0 ? values.join('|') : '';
        query = query.replace(new RegExp(`\\$${varName}`, 'g'), replaceValue);
      }
    });

    return query;
  }

}