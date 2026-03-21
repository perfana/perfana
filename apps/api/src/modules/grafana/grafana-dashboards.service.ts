import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GrafanaClientService } from './grafana-client.service';
import {
  CreateGrafanaDashboardDto,
  UpdateGrafanaDashboardDto,
  GrafanaDashboardQuery,
  TemplatingVariableDto
} from './dto/grafana-dashboard.dto';
import { GrafanaDashboard as GrafanaDashboardEntity } from '../../entities';
import { AuthorizationService } from '../../common/services/authorization.service';

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
  panels?: any[];
  variables?: any[];
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
 * - Currently GrafanaDashboard entity does not have organization_id, so all data is treated as legacy
 * - When organization_id is added to GrafanaDashboard (Phase 4), authorization checks will be enabled
 * - Global admins bypass all authorization checks
 */
@Injectable()
export class GrafanaDashboardsService {
  private readonly logger = new Logger(GrafanaDashboardsService.name);

  constructor(
    @InjectRepository(GrafanaDashboardEntity)
    private grafanaDashboardRepo: Repository<GrafanaDashboardEntity>,
    private readonly grafanaClientService: GrafanaClientService,
    private readonly authzService: AuthorizationService,
  ) {}

  /**
   * Find all Grafana dashboards
   *
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   * @param query - Optional query filters
   *
   * Note: GrafanaDashboard entity does not have organization_id yet, so org filtering is not applied.
   * Full org filtering will be enabled when Phase 4 adds organization_id column.
   */
  async findAll(userId: string, roles: string[], query: GrafanaDashboardQuery = {}): Promise<GrafanaDashboard[]> {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`findAll: userId=${userId}, isGlobalAdmin=${isAdmin}`);

    // NOTE: Org filtering will be added here when GrafanaDashboard entity has organization_id
    // For now, all dashboards are returned (treated as legacy data)

    try {
      const queryBuilder = this.grafanaDashboardRepo.createQueryBuilder('gd');

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
        const hasDashboard = !!first.grafanaJson?.dashboard;
        const hasPanels = !!first.grafanaJson?.dashboard?.panels;
        const panelsLength = first.grafanaJson?.dashboard?.panels?.length || 0;
        const simplePanelsLength = first.panels?.length || 0;

        this.logger.log(`findAll first result ${first.uid}: grafanaJson=${hasGrafanaJson}, dashboard=${hasDashboard}, panels=${hasPanels}, panelsCount=${panelsLength}, simplePanelsCount=${simplePanelsLength}`);

        if (hasPanels && panelsLength > 0 && first.grafanaJson?.dashboard?.panels?.[0]) {
          this.logger.log(`First panel keys: ${Object.keys(first.grafanaJson.dashboard.panels[0]).join(', ')}`);
        }
      }

      return results.map(row => {
        // Try to get full panels from grafanaJson first, fallback to simplified panels
        let panels = row.grafanaJson?.dashboard?.panels || row.panels;

        // If using simplified panels, ensure y_axes_format is transformed to yAxesFormat
        if (panels === row.panels && panels) {
          panels = panels.map((panel: any) => ({
            ...panel,
            yAxesFormat: panel.y_axes_format
          }));
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
          templating_variables: row.templatingVariables,
          panels,
          variables: row.variables,
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
   * Find a single Grafana dashboard by ID
   *
   * @param id - The dashboard ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: GrafanaDashboard entity does not have organization_id yet, so access checks are not applied.
   * Full access permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async findOne(id: string, userId: string, roles: string[]): Promise<GrafanaDashboard> {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`findOne: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

    try {
      const result = await this.grafanaDashboardRepo.findOne({ where: { id } });

      if (!result) {
        throw new NotFoundException(`Grafana dashboard with ID ${id} not found`);
      }

      // NOTE: Access permission check will be added here when GrafanaDashboard entity has organization_id
      // For now, all dashboards are accessible (treated as legacy data)

      // Debug logging for panel structure
      const hasGrafanaJson = !!result.grafanaJson;
      const hasDashboard = !!result.grafanaJson?.dashboard;
      const hasPanels = !!result.grafanaJson?.dashboard?.panels;
      const panelsLength = result.grafanaJson?.dashboard?.panels?.length || 0;
      const simplePanelsLength = result.panels?.length || 0;

      this.logger.log(`Dashboard ${result.uid}: grafanaJson=${hasGrafanaJson}, dashboard=${hasDashboard}, panels=${hasPanels}, panelsCount=${panelsLength}, simplePanelsCount=${simplePanelsLength}`);

      if (hasPanels && panelsLength > 0) {
        this.logger.log(`First panel structure: ${JSON.stringify(result.grafanaJson.dashboard.panels[0]).substring(0, 200)}`);
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
        templating_variables: result.templatingVariables,
        panels: result.grafanaJson?.dashboard?.panels || result.panels,
        variables: result.variables,
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
   * Create a new Grafana dashboard
   *
   * @param createDto - The dashboard creation DTO
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   *
   * Note: GrafanaDashboard entity does not have organization_id or created_by/updated_by yet,
   * so ownership tracking is not applied. Full ownership assignment will be enabled when
   * Phase 4 adds the ownership columns.
   */
  async create(createDto: CreateGrafanaDashboardDto, userId: string, roles: string[]): Promise<GrafanaDashboard> {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`create: userId=${userId}, isGlobalAdmin=${isAdmin}`);

    // NOTE: Permission check will be added here when GrafanaDashboard entity has organization_id
    // For now, all users can create dashboards (treated as legacy data)

    try {
      // NOTE: Ownership fields (created_by, organization_id) will be set here when Phase 4 adds them
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
        updated: new Date()
      });

      const result = await this.grafanaDashboardRepo.save(dashboard);

      this.logger.log(`Created Grafana dashboard: ${result.name} (${result.id}) by user: ${userId}`);

      return {
        id: result.id,
        grafana_instance_id: result.grafanaInstanceId,
        grafana_id: result.grafanaId,
        datasource_type: result.datasourceType,
        uid: result.uid,
        slug: result.slug,
        name: result.name,
        uri: result.uri,
        templating_variables: result.templatingVariables,
        panels: result.grafanaJson?.dashboard?.panels || result.panels,
        variables: result.variables,
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
   * Update a Grafana dashboard
   *
   * @param id - The dashboard ID
   * @param updateDto - The dashboard update DTO
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: GrafanaDashboard entity does not have organization_id yet, so permission checks are not applied.
   * Full permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async update(id: string, updateDto: UpdateGrafanaDashboardDto, userId: string, roles: string[]): Promise<GrafanaDashboard> {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`update: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

    try {
      // First check if the dashboard exists
      await this.findOne(id, userId, roles);

      // NOTE: Modify permission check will be added here when GrafanaDashboard entity has organization_id
      // For now, all dashboards are updatable (treated as legacy data)

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
      await this.grafanaDashboardRepo.update(id, updateData);

      // Fetch the updated record
      const result = await this.grafanaDashboardRepo.findOne({ where: { id } });

      if (!result) {
        throw new Error('Failed to fetch updated Grafana dashboard');
      }

      this.logger.log(`Updated Grafana dashboard: ${result.name} (${result.id}) by user: ${userId}`);

      return {
        id: result.id,
        grafana_instance_id: result.grafanaInstanceId,
        grafana_id: result.grafanaId,
        datasource_type: result.datasourceType,
        uid: result.uid,
        slug: result.slug,
        name: result.name,
        uri: result.uri,
        templating_variables: result.templatingVariables,
        panels: result.grafanaJson?.dashboard?.panels || result.panels,
        variables: result.variables,
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
   * Delete a Grafana dashboard
   *
   * @param id - The dashboard ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: GrafanaDashboard entity does not have organization_id yet, so permission checks are not applied.
   * Full permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async remove(id: string, userId: string, roles: string[]): Promise<void> {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`remove: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

    try {
      // First check if the dashboard exists
      await this.findOne(id, userId, roles);

      // NOTE: Delete permission check will be added here when GrafanaDashboard entity has organization_id
      // For now, all dashboards are deletable (treated as legacy data)

      await this.grafanaDashboardRepo.delete(id);

      this.logger.log(`Deleted Grafana dashboard: ${id} by user: ${userId}`);
    } catch (error) {
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
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`getVariableValues: dashboardId=${grafanaDashboardId}, variable=${variableName}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

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
            : variable.datasource.uid;

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
            // Fall back to basic mock values if datasource query fails
            return this.getFallbackValues(variableName, system, environment);
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

  private getFallbackValues(variableName: string, system: string, environment: string): Array<{ label: string; value: string }> {
    // Provide basic fallback values if datasource queries fail
    switch (variableName.toLowerCase()) {
      case 'application':
      case 'system':
      case 'system_under_test':
        return [
          { label: 'MyAfterburner', value: 'MyAfterburner' },
          { label: system, value: system }
        ].filter((item, index, self) => 
          index === self.findIndex(t => t.value === item.value)
        );

      case 'environment':
      case 'test_environment':
        return [
          { label: 'acc', value: 'acc' },
          { label: 'prod', value: 'prod' },
          { label: environment, value: environment }
        ].filter((item, index, self) => 
          index === self.findIndex(t => t.value === item.value)
        );

      case 'service':
        return [
          { label: 'afterburner-fe', value: 'afterburner-fe' },
          { label: 'afterburner-be', value: 'afterburner-be' }
        ];

      default:
        return [
          { label: `${variableName}-1`, value: `${variableName}-1` },
          { label: `${variableName}-2`, value: `${variableName}-2` }
        ];
    }
  }
}