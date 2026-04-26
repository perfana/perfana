import { Injectable, BadRequestException, ConflictException, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { DynatraceRepository } from './dynatrace.repository';
import { CreateDynatraceConfigDto } from './dto/create-dynatrace-config.dto';
import { UpdateDynatraceConfigDto } from './dto/update-dynatrace-config.dto';
import { CreateDynatraceQueryDto } from './dto/create-dynatrace-query.dto';
import { UpdateDynatraceQueryDto } from './dto/update-dynatrace-query.dto';
import { CreateEntityMappingDto } from './dto/create-entity-mapping.dto';
import { HostPropertiesResponse, HostMetricsResponse, HostProblemResponse, TimeSeriesData } from './dto/host.dto';
import { AuthorizationService } from '../../common/services/authorization.service';
import { withOrgFilter } from '../../common/utils/with-org-filter';
import { validateExternalUrl } from '../../common/security/url-validator';
import axios from 'axios';
import { randomUUID } from 'crypto';

/**
 * Service responsible for managing Dynatrace configurations, queries, and entity mappings.
 *
 * Authorization:
 * - All methods accept userId and roles parameters for authorization
 * - Currently Dynatrace entities do not have organization_id, so all data is treated as legacy
 * - When organization_id is added to Dynatrace entities (Phase 4), authorization checks will be enabled
 * - Global admins bypass all authorization checks
 */
@Injectable()
export class DynatraceService {
  private readonly logger = new Logger(DynatraceService.name);

  // HTTP timeout constants (in milliseconds)
  private static readonly DEFAULT_TIMEOUT_MS = 10000;  // 10 seconds
  private static readonly ENTITIES_API_TIMEOUT_MS = 15000;  // 15 seconds

  constructor(
    private readonly repository: DynatraceRepository,
    private readonly authzService: AuthorizationService,
  ) {}

  /**
   * Mask sensitive credentials in a Dynatrace config for API responses.
   * Returns a shallow copy with tokens replaced by '[MASKED]'.
   */
  private maskConfig<T extends { apiToken?: string; platformApiToken?: string }>(config: T): T {
    return {
      ...config,
      apiToken: config.apiToken ? '[MASKED]' : undefined,
      platformApiToken: config.platformApiToken ? '[MASKED]' : undefined,
    } as T;
  }

  private normalizeUrl(url: string): string {
    // Validate URL to prevent SSRF before any outbound request
    const validation = validateExternalUrl(url);
    if (!validation.isValid) {
      throw new BadRequestException(`Invalid Dynatrace URL: ${validation.error}`);
    }
    return url.replace(/\/+$/, '');
  }

  /**
   * Find all Dynatrace configurations
   *
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Filters results to only show configurations that belong to organizations the user is a member of.
   * Global admins see all configurations. Legacy configs with null organization_id are accessible to all users.
   */
  async findAll(userId: string, roles: string[], organizationId?: string) {
    // Resolve accessible org IDs: null means global admin (no filter needed)
    const orgIds = await withOrgFilter(userId, roles, this.authzService);
    this.logger.debug(`findAll: userId=${userId}, isGlobalAdmin=${orgIds === null}, organizationId=${organizationId}`);

    // Get all configs first
    const allConfigs = await this.repository.findAll();

    // Apply organization filtering
    if (organizationId) {
      // Explicit org selected — scope to that org only
      const filteredConfigs = allConfigs.filter(config =>
        config.organizationId === organizationId
      );
      this.logger.debug(`Returning ${filteredConfigs.length} Dynatrace configs for org ${organizationId} (from ${allConfigs.length} total)`);
      return filteredConfigs.map(c => this.maskConfig(c));
    } else if (orgIds !== null) {
      // Non-admin: filter to accessible organizations OR legacy configs (null organization_id)
      this.logger.debug(`User ${userId} has access to ${orgIds.length} organizations`);
      const filteredConfigs = allConfigs.filter(config =>
        !config.organizationId || orgIds.includes(config.organizationId)
      );

      this.logger.debug(`Returning ${filteredConfigs.length} Dynatrace configs for user ${userId} (from ${allConfigs.length} total)`);
      return filteredConfigs.map(c => this.maskConfig(c));
    }

    return allConfigs.map(c => this.maskConfig(c));
  }

  /**
   * Find a Dynatrace configuration by host
   *
   * @param host - The Dynatrace host URL
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Validates that the user has access to the configuration based on organization membership.
   * @throws NotFoundException if config doesn't exist or user doesn't have access
   */
  async findByHost(host: string, userId: string, roles: string[]) {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`findByHost: host=${host}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

    const config = await this.repository.findByHost(host);
    if (!config) {
      throw new NotFoundException(`Dynatrace configuration for host ${host} not found`);
    }

    // Check access permissions (unless global admin)
    if (!isAdmin) {
      // Legacy data (null organization_id) is accessible to all users
      if (config.organizationId) {
        const hasAccess = await this.authzService.isOrganizationMember(userId, config.organizationId);
        if (!hasAccess) {
          throw new NotFoundException(`Dynatrace configuration for host ${host} not found`);
        }
      }
    }

    return this.maskConfig(config);
  }

  /**
   * Create a new Dynatrace configuration
   *
   * @param dto - The create DTO
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   *
   * Note: DynatraceConfig entity does not have organization_id or created_by/updated_by yet,
   * so ownership tracking is not applied. Full ownership assignment will be enabled when
   * Phase 4 adds the ownership columns.
   */
  async create(dto: CreateDynatraceConfigDto, userId: string, roles: string[]) {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`create: userId=${userId}, isGlobalAdmin=${isAdmin}`);

    // Normalize URL by removing trailing slash for consistency
    const normalizedHost = this.normalizeUrl(dto.host);

    // Check if configuration already exists
    const existing = await this.repository.findByHost(normalizedHost);
    if (existing) {
      throw new ConflictException(`Configuration for host ${normalizedHost} already exists`);
    }

    // Test the connection using provided API token (optional - don't fail if connection test fails)
    try {
      await this.testConnection(normalizedHost, dto.apiToken);
      this.logger.log(`Successfully tested connection to ${normalizedHost}`);
    } catch (error) {
      this.logger.warn(`Connection test failed for ${normalizedHost}, but saving configuration anyway: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
      // Continue to save the configuration even if connection test fails
    }

    // Save configuration with API token and deployment type (with normalized URL)
    const config = await this.repository.create({
      host: normalizedHost,
      api_token: dto.apiToken,
      dynatrace_type: dto.dynatraceType || 'saas',
      label: dto.label,
      platform_api_token: dto.platformApiToken,
      created_by: userId,
      updated_by: userId,
      organization_id: dto.organizationId || undefined,
    });

    this.logger.log(`Dynatrace configuration created: ${normalizedHost} by user ${userId}`);
    return this.maskConfig(config);
  }

  /**
   * Update an existing Dynatrace configuration
   *
   * @param id - The Dynatrace configuration ID
   * @param dto - The update DTO
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   *
   * Note: DynatraceConfig entity does not have organization_id yet, so permission checks are not applied.
   * Full permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async update(id: string, dto: UpdateDynatraceConfigDto, userId: string, roles: string[]) {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`update: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

    // Check if the configuration exists
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundException(`Dynatrace configuration with ID ${id} not found`);
    }

    // Check modification permissions (unless global admin)
    if (!isAdmin && existing.organizationId) {
      const canModify = await this.authzService.isOrganizationAdmin(userId, existing.organizationId);
      if (!canModify) {
        throw new ForbiddenException('You do not have permission to modify this Dynatrace configuration');
      }
    }

    // Update the configuration with the provided attributes
    const updated = await this.repository.update(id, {
      perfana_test_run_id_attribute: dto.perfanaTestRunIdAttribute,
      perfana_request_name_attribute: dto.perfanaRequestNameAttribute,
      label: dto.label,
      platform_api_token: dto.platformApiToken,
      updated_by: userId,
    });

    this.logger.log(`Dynatrace configuration updated: ${id} by user ${userId}`);
    return this.maskConfig(updated);
  }

  /**
   * Delete a Dynatrace configuration
   *
   * @param id - The Dynatrace configuration ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: DynatraceConfig entity does not have organization_id yet, so permission checks are not applied.
   * Full permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async delete(id: string, userId: string, roles: string[]) {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`delete: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

    // Check if the configuration exists and validate permissions
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundException(`Dynatrace configuration with ID ${id} not found`);
    }

    // Check modification permissions (unless global admin)
    if (!isAdmin && existing.organizationId) {
      const canModify = await this.authzService.isOrganizationAdmin(userId, existing.organizationId);
      if (!canModify) {
        throw new ForbiddenException('You do not have permission to delete this Dynatrace configuration');
      }
    }

    await this.repository.delete(id);
    this.logger.log(`Dynatrace configuration ${id} deleted successfully by user ${userId}`);
  }

  async testConnection(host: string, apiToken: string) {
    try {
      // Ensure host ends without trailing slash
      const baseUrl = this.normalizeUrl(host);

      // Test connection by fetching cluster version from Environment API v2
      // This is a more reliable endpoint that works with both SaaS and Managed
      const response = await axios.get(`${baseUrl}/api/v2/entities`, {
        headers: {
          Authorization: `Api-Token ${apiToken}`,
          'Content-Type': 'application/json',
        },
        params: {
          pageSize: 1, // Just fetch 1 entity to verify connection
          entitySelector: 'type("SERVICE")', // Required parameter for entities API
        },
        timeout: DynatraceService.DEFAULT_TIMEOUT_MS,
      });

      if (!response.data) {
        throw new BadRequestException('Invalid response from Dynatrace API');
      }

      // Return success with entity count info
      return {
        success: true,
        version: `Entities API v2 (${response.data.totalCount || 0} entities available)`
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          throw new BadRequestException('Invalid API token');
        } else if (error.response?.status === 403) {
          throw new BadRequestException('API token lacks required permissions');
        } else if (error.response?.status === 404) {
          throw new BadRequestException('Dynatrace API endpoint not found. Please verify the Dynatrace URL (e.g., https://YOUR_TENANT.live.dynatrace.com)');
        } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
          throw new BadRequestException('Cannot connect to Dynatrace server. Please check the URL and network connectivity.');
        }
      }
      throw new BadRequestException('Failed to connect to Dynatrace: ' + (error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'));
    }
  }

  /**
   * Fetch entities from Dynatrace
   *
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   * @param entityType - Optional entity type filter
   * @param entityName - Optional entity name filter
   * @param dynatraceConfigId - Optional specific Dynatrace configuration ID
   *
   * Note: DynatraceConfig entity does not have organization_id yet, so access checks are not applied.
   * Full access permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async fetchEntities(userId: string, roles: string[], entityType?: string, entityName?: string, dynatraceConfigId?: string) {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`fetchEntities: userId=${userId}, isGlobalAdmin=${isAdmin}, dynatraceConfigId=${dynatraceConfigId}`);

    let config;

    if (dynatraceConfigId) {
      // Fetch specific Dynatrace instance by ID
      config = await this.repository.findById(dynatraceConfigId);
      if (!config) {
        throw new NotFoundException(`Dynatrace configuration with ID ${dynatraceConfigId} not found`);
      }
      // NOTE: Access permission check will be added here when DynatraceConfig entity has organization_id
    } else {
      // Fallback to first configured Dynatrace instance for backward compatibility
      const configs = await this.repository.findAll();
      if (configs.length === 0 || !configs[0]) {
        throw new BadRequestException('No Dynatrace instance configured. Please configure a Dynatrace instance first.');
      }
      config = configs[0];
    }

    return this.fetchEntitiesFromHost(config.host, config.apiToken, entityType, entityName);
  }

  private async fetchEntitiesFromHost(host: string, apiToken: string, entityType?: string, entityName?: string) {
    try {
      const baseUrl = this.normalizeUrl(host);

      // Build dynamic entitySelector based on entityType and entityName
      let entitySelector = 'type("SERVICE")'; // Default to SERVICE entities only

      const conditions = [];

      if (entityType) {
        conditions.push(`type("${entityType}")`);
      }

      if (entityName) {
        // Sanitize entityName to prevent injection by escaping quotes and backslashes
        const sanitizedEntityName = entityName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        conditions.push(`entityName.contains("${sanitizedEntityName}")`);
      }

      if (conditions.length > 0) {
        entitySelector = conditions.join(','); // Using comma as AND operator in Dynatrace
      }

      const requestUrl = `${baseUrl}/api/v2/entities`;
      this.logger.debug('Dynatrace API call', {
        baseUrl,
        requestUrl,
        entityType,
        entityName,
        entitySelector,
        hasToken: !!apiToken,
        hasTokenLength: apiToken ? apiToken.length : 0
      });

      const response = await axios.get(requestUrl, {
        headers: {
          Authorization: `Api-Token ${apiToken}`,
          'Content-Type': 'application/json',
        },
        timeout: DynatraceService.ENTITIES_API_TIMEOUT_MS,
        params: {
          // Add some basic filters to limit the response size
          pageSize: 500,
          entitySelector: entitySelector
        }
      });

      if (!response.data) {
        throw new BadRequestException('Invalid response from Dynatrace entities API');
      }

      this.logger.debug('Dynatrace entities API response', {
        totalCount: response.data.totalCount,
        pageSize: response.data.pageSize,
        entitiesCount: response.data.entities?.length || 0,
        firstEntity: response.data.entities?.[0] ? {
          entityId: response.data.entities[0].entityId,
          displayName: response.data.entities[0].displayName,
          type: response.data.entities[0].type
        } : null
      });

      // Return the response in the expected format
      return {
        entities: response.data.entities || [],
        totalCount: response.data.totalCount || 0,
        pageSize: response.data.pageSize || 0,
        nextPageKey: response.data.nextPageKey || null
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.logger.error('Dynatrace API error', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          url: error.config?.url,
          method: error.config?.method,
        });

        if (error.response?.status === 401) {
          throw new BadRequestException('Invalid API token for Dynatrace entities API');
        } else if (error.response?.status === 403) {
          throw new BadRequestException('API token lacks required permissions for entities API');
        } else if (error.response?.status === 404) {
          // Check if Dynatrace provided a suggested URL in the error response
          const errorMessage = error.response?.data?.error?.message || '';
          const suggestedUrlMatch = errorMessage.match(/go to '([^']+)'/);
          const suggestedUrl = suggestedUrlMatch ? suggestedUrlMatch[1] : null;

          let errorMsg = `Dynatrace API endpoint not found (404). URL: ${error.config?.url}. `;

          if (suggestedUrl) {
            errorMsg += `Dynatrace suggests using: ${suggestedUrl} instead. `;
            errorMsg += `Please update your Dynatrace configuration to use the correct URL.`;
          } else {
            errorMsg += `This may indicate an incorrect Dynatrace URL or deployment type. `;
            errorMsg += `Please verify the Dynatrace URL is correct (e.g., https://YOUR_TENANT.live.dynatrace.com for SaaS).`;
          }

          throw new BadRequestException(errorMsg);
        } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
          throw new BadRequestException('Cannot connect to Dynatrace server for entities API');
        }
      }
      throw new BadRequestException('Failed to fetch entities from Dynatrace: ' + (error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'));
    }
  }

  /**
   * Fetch request attributes from Dynatrace
   *
   * @param host - The Dynatrace host URL
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: DynatraceConfig entity does not have organization_id yet, so access checks are not applied.
   * Full access permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async fetchRequestAttributes(host: string, userId: string, roles: string[]) {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`fetchRequestAttributes: host=${host}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

    // Normalize URL by removing trailing slash for consistency
    const normalizedHost = this.normalizeUrl(host);

    // Get the config for this host to retrieve the API token
    const config = await this.repository.findByHost(normalizedHost);
    if (!config) {
      throw new NotFoundException(`Dynatrace configuration for host ${normalizedHost} not found`);
    }

    // NOTE: Access permission check will be added here when DynatraceConfig entity has organization_id
    // For now, all configs are accessible (treated as legacy data)

    try {
      const response = await axios.get(`${normalizedHost}/api/config/v1/service/requestAttributes`, {
        headers: {
          Authorization: `Api-Token ${config.apiToken}`,
          'Content-Type': 'application/json',
        },
        timeout: DynatraceService.DEFAULT_TIMEOUT_MS,
      });

      if (!response.data?.values) {
        return [];
      }

      // Look for perfana-specific attributes
      const perfanaAttributes = response.data.values.filter((attr: { name?: string }) =>
        attr.name?.toLowerCase().includes('perfana')
      );

      return {
        all: response.data.values,
        perfanaAttributes,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new BadRequestException('Failed to fetch request attributes: ' + (error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'));
      }
      throw new BadRequestException('Failed to fetch request attributes: ' + (error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'));
    }
  }

  /**
   * Get request attributes for a specific Dynatrace configuration
   *
   * @param id - The Dynatrace configuration ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: DynatraceConfig entity does not have organization_id yet, so access checks are not applied.
   * Full access permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async getRequestAttributesForConfig(id: string, userId: string, roles: string[]) {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`getRequestAttributesForConfig: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

    // Get the configuration
    const config = await this.repository.findById(id);
    if (!config) {
      throw new NotFoundException(`Dynatrace configuration with ID ${id} not found`);
    }

    // NOTE: Access permission check will be added here when DynatraceConfig entity has organization_id
    // For now, all configs are accessible (treated as legacy data)

    // Use the environment variable API token to fetch request attributes
    return this.fetchRequestAttributes(config.host, userId, roles);
  }

  // DQL Methods

  /**
   * Find all Dynatrace DQL queries
   *
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: DynatraceQuery entity does not have organization_id yet, so org filtering is not applied.
   * Full org filtering will be enabled when Phase 4 adds organization_id column.
   */
  async findAllQuery(userId: string, roles: string[]) {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`findAllQuery: userId=${userId}, isGlobalAdmin=${isAdmin}`);

    // NOTE: Org filtering will be added here when DynatraceQuery entity has organization_id
    // For now, all queries are returned (treated as legacy data)
    return this.repository.findAllQuery();
  }

  /**
   * Find Dynatrace DQL queries by system, environment, and workload
   *
   * @param systemId - The system under test ID
   * @param environment - The test environment
   * @param workload - The workload
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: DynatraceQuery entity does not have organization_id yet, so access checks are not applied.
   * Full access permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async findQueryBySystemAndEnvironment(systemId: string, environment: string, workload: string, userId: string, roles: string[]) {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`findQueryBySystemAndEnvironment: systemId=${systemId}, environment=${environment}, workload=${workload}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

    // NOTE: Access permission check will be added here when DynatraceQuery entity has organization_id
    // For now, all queries are accessible (treated as legacy data)
    return this.repository.findQueryBySystemAndEnvironment(systemId, environment, workload);
  }

  /**
   * Find a Dynatrace DQL query by ID
   *
   * @param id - The query ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: DynatraceQuery entity does not have organization_id yet, so access checks are not applied.
   * Full access permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async findQueryById(id: string, userId: string, roles: string[]) {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`findQueryById: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

    const query = await this.repository.findQueryById(id);
    if (!query) {
      throw new NotFoundException(`Dynatrace DQL query with ID ${id} not found`);
    }

    // NOTE: Access permission check will be added here when DynatraceQuery entity has organization_id
    // For now, all queries are accessible (treated as legacy data)

    return query;
  }

  /**
   * Create a new Dynatrace DQL query
   *
   * @param dto - The create DTO
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   *
   * Note: DynatraceQuery entity does not have organization_id or created_by/updated_by yet,
   * so ownership tracking is not applied. Full ownership assignment will be enabled when
   * Phase 4 adds the ownership columns.
   */
  async createQuery(dto: CreateDynatraceQueryDto, userId: string, roles: string[]) {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`createQuery: userId=${userId}, isGlobalAdmin=${isAdmin}`);

    // Ensure artificial dashboard exists before creating query
    if (dto.systemUnderTestId && dto.testEnvironment && dto.dashboardLabel && dto.applicationDashboardId) {
      await this.repository.ensureArtificialDashboardExists(
        dto.systemUnderTestId,
        dto.testEnvironment,
        dto.workload || '',
        dto.dashboardLabel,
        dto.applicationDashboardId
      );
    }

    // NOTE: created_by, updated_by, organization_id will be set when Phase 4 adds those columns

    return this.repository.createQuery(dto);
  }

  /**
   * Create a Dynatrace DQL query with smart UUID handling
   *
   * @param dto - The create DTO
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   *
   * Note: DynatraceQuery entity does not have organization_id or created_by/updated_by yet,
   * so ownership tracking is not applied. Full ownership assignment will be enabled when
   * Phase 4 adds the ownership columns.
   */
  async createQuerySmart(dto: CreateDynatraceQueryDto, userId: string, roles: string[]) {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`createQuerySmart: userId=${userId}, isGlobalAdmin=${isAdmin}`);

    // Check if there's already a record with the same dashboard_label
    const existingUuid = await this.repository.findDashboardByLabel(dto.dashboardLabel);

    let applicationDashboardId: string;
    if (existingUuid) {
      // Use existing UUID for this dashboard label
      applicationDashboardId = existingUuid;
    } else {
      // Generate new UUID for this dashboard label
      applicationDashboardId = randomUUID();
    }

    // Ensure artificial dashboard exists before creating query
    if (dto.systemUnderTestId && dto.testEnvironment && dto.dashboardLabel) {
      await this.repository.ensureArtificialDashboardExists(
        dto.systemUnderTestId,
        dto.testEnvironment,
        dto.workload || '',
        dto.dashboardLabel,
        applicationDashboardId
      );
    }

    // NOTE: created_by, updated_by, organization_id will be set when Phase 4 adds those columns

    return this.repository.createQueryWithSharedUuid(dto, applicationDashboardId);
  }

  /**
   * Bulk import Dynatrace DQL queries
   *
   * @param dtoList - List of create DTOs
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   * @param generateSharedUuid - Whether to generate a shared UUID for all queries
   *
   * Note: DynatraceQuery entity does not have organization_id or created_by/updated_by yet,
   * so ownership tracking is not applied. Full ownership assignment will be enabled when
   * Phase 4 adds the ownership columns.
   */
  async bulkImportQuery(dtoList: CreateDynatraceQueryDto[], userId: string, roles: string[], generateSharedUuid = true) {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`bulkImportQuery: count=${dtoList.length}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

    if (dtoList.length === 0) {
      return [];
    }

    if (generateSharedUuid) {
      // Generate one UUID for all metrics in this import
      const sharedUuid = randomUUID();

      // Get the first DTO to extract common fields
      const firstDto = dtoList[0];
      if (firstDto && firstDto.systemUnderTestId && firstDto.testEnvironment && firstDto.dashboardLabel) {
        // Ensure artificial dashboard exists before creating queries
        await this.repository.ensureArtificialDashboardExists(
          firstDto.systemUnderTestId,
          firstDto.testEnvironment,
          firstDto.workload || '',
          firstDto.dashboardLabel,
          sharedUuid
        );
      }

      // NOTE: created_by, updated_by, organization_id will be set when Phase 4 adds those columns

      return this.repository.bulkCreateQueryWithSharedUuid(dtoList, sharedUuid);
    } else {
      // Create individual entries using the smart logic for each
      const results = [];
      for (const dto of dtoList) {
        const result = await this.createQuerySmart(dto, userId, roles);
        results.push(result);
      }
      return results;
    }
  }

  /**
   * Update an existing Dynatrace DQL query
   *
   * @param id - The query ID
   * @param dto - The update DTO
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   *
   * Note: DynatraceQuery entity does not have organization_id yet, so permission checks are not applied.
   * Full permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async updateQuery(id: string, dto: UpdateDynatraceQueryDto, userId: string, roles: string[]) {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`updateQuery: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

    // Check if the DQL query exists
    const existing = await this.repository.findQueryById(id);
    if (!existing) {
      throw new NotFoundException(`Dynatrace DQL query with ID ${id} not found`);
    }

    // NOTE: Permission check will be added here when DynatraceQuery entity has organization_id
    // For now, all queries are modifiable (treated as legacy data)
    // NOTE: updated_by will be set when Phase 4 adds that column

    const updated = await this.repository.updateQuery(id, dto);
    this.logger.log(`Dynatrace DQL query updated: ${id}`);
    return updated;
  }

  /**
   * Delete a Dynatrace DQL query
   *
   * @param id - The query ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: DynatraceQuery entity does not have organization_id yet, so permission checks are not applied.
   * Full permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async deleteQuery(id: string, userId: string, roles: string[]) {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`deleteQuery: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

    // Check if the DQL query exists
    const existing = await this.repository.findQueryById(id);
    if (!existing) {
      throw new NotFoundException(`Dynatrace DQL query with ID ${id} not found`);
    }

    // NOTE: Delete permission check will be added here when DynatraceQuery entity has organization_id
    // For now, all queries are deletable (treated as legacy data)

    await this.repository.deleteQuery(id);
    this.logger.log(`Dynatrace DQL query ${id} deleted successfully`);
  }

  // SLO Support Methods

  /**
   * Get distinct dashboard labels for a system, environment, and workload
   *
   * @param systemId - The system under test ID
   * @param environment - The test environment
   * @param workload - The workload
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: DynatraceQuery entity does not have organization_id yet, so access checks are not applied.
   * Full access permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async getDistinctDashboardLabels(systemId: string, environment: string, workload: string, userId: string, roles: string[]) {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`getDistinctDashboardLabels: systemId=${systemId}, environment=${environment}, workload=${workload}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

    // NOTE: Access permission check will be added here when DynatraceQuery entity has organization_id
    // For now, all dashboards are accessible (treated as legacy data)

    const dashboards = await this.repository.getDistinctDashboardLabels(systemId, environment, workload);
    this.logger.debug('Retrieved distinct dashboard labels', {
      systemId,
      environment,
      workload,
      count: dashboards.length,
      dashboards: dashboards.map(d => d.dashboardLabel)
    });
    return dashboards.map(dashboard => ({
      dashboardLabel: dashboard.dashboardLabel
    }));
  }

  /**
   * Get panel titles for a dashboard
   *
   * @param systemId - The system under test ID
   * @param environment - The test environment
   * @param workload - The workload
   * @param dashboardLabel - The dashboard label
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: DynatraceQuery entity does not have organization_id yet, so access checks are not applied.
   * Full access permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async getPanelTitlesForDashboard(systemId: string, environment: string, workload: string, dashboardLabel: string, userId: string, roles: string[]) {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`getPanelTitlesForDashboard: systemId=${systemId}, environment=${environment}, workload=${workload}, dashboardLabel=${dashboardLabel}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

    // NOTE: Access permission check will be added here when DynatraceQuery entity has organization_id
    // For now, all panels are accessible (treated as legacy data)

    const metrics = await this.repository.getPanelTitlesForDashboard(systemId, environment, workload, dashboardLabel);
    this.logger.debug('Retrieved panel titles for dashboard', {
      systemId,
      environment,
      workload,
      dashboardLabel,
      count: metrics.length,
      metrics: metrics.map(m => ({
        panelTitle: m.panelTitle,
        panelId: m.panelId,
        metricsSourceId: m.metricsSourceId,
        metricUnit: m.metricUnit
      }))
    });
    return metrics.map(metric => ({
      panelTitle: metric.panelTitle,
      panelId: metric.panelId,
      applicationDashboardId: metric.applicationDashboardId,
      metricsSourceId: metric.metricsSourceId,
      metricUnit: metric.metricUnit
    }));
  }

  // Entity Mapping Methods

  /**
   * Get entity mappings with optional filters
   *
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   * @param systemId - Optional system under test ID filter
   * @param environment - Optional test environment filter
   * @param workload - Optional workload filter
   *
   * Note: DynatraceEntityMapping entity does not have organization_id yet, so org filtering is not applied.
   * Full org filtering will be enabled when Phase 4 adds organization_id column.
   */
  async getEntityMappings(userId: string, roles: string[], systemId?: string, environment?: string, workload?: string) {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`getEntityMappings: userId=${userId}, isGlobalAdmin=${isAdmin}, systemId=${systemId}, environment=${environment}, workload=${workload}`);

    // NOTE: Org filtering will be added here when DynatraceEntityMapping entity has organization_id
    // For now, all mappings are returned (treated as legacy data)
    return this.repository.getEntityMappings(systemId, environment, workload);
  }

  /**
   * Create a new entity mapping
   *
   * @param dto - The create DTO
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   *
   * Note: DynatraceEntityMapping entity does not have organization_id or created_by/updated_by yet,
   * so ownership tracking is not applied. Full ownership assignment will be enabled when
   * Phase 4 adds the ownership columns.
   */
  async createEntityMapping(dto: CreateEntityMappingDto, userId: string, roles: string[]) {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`createEntityMapping: userId=${userId}, isGlobalAdmin=${isAdmin}`);

    try {
      // NOTE: created_by, updated_by, organization_id will be set when Phase 4 adds those columns
      const result = await this.repository.createEntityMapping(dto);
      this.logger.log(`Dynatrace entity mapping created: ${result.id}`);
      return result;
    } catch (error) {
      // Check if this is a duplicate entity mapping error
      if (error && typeof error === 'object' && 'message' in error) {
        const message = (error as Error).message;
        if (message.includes('already mapped')) {
          throw new ConflictException(message);
        }
      }
      throw error;
    }
  }

  /**
   * Delete an entity mapping
   *
   * @param id - The entity mapping ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: DynatraceEntityMapping entity does not have organization_id yet, so permission checks are not applied.
   * Full permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async deleteEntityMapping(id: string, userId: string, roles: string[]) {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`deleteEntityMapping: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

    const existing = await this.repository.getEntityMappingById(id);
    if (!existing) {
      throw new NotFoundException(`Dynatrace entity mapping with ID ${id} not found`);
    }

    // NOTE: Delete permission check will be added here when DynatraceEntityMapping entity has organization_id
    // For now, all mappings are deletable (treated as legacy data)

    await this.repository.deleteEntityMapping(id);
    this.logger.log(`Dynatrace entity mapping ${id} deleted successfully`);
  }

  // Metric Names for Dynatrace Card

  /**
   * Get metric names with optional test run filter
   *
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   * @param testRunId - Optional test run ID filter
   *
   * Note: This queries Dynatrace metrics which do not have organization_id yet, so org filtering is not applied.
   * Full org filtering will be enabled when Phase 4 adds organization_id column.
   */
  async getMetricNames(userId: string, roles: string[], testRunId?: string) {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`getMetricNames: userId=${userId}, isGlobalAdmin=${isAdmin}, testRunId=${testRunId}`);

    // NOTE: Org filtering will be added here when metrics have organization_id
    // For now, all metrics are returned (treated as legacy data)

    const metricNames = await this.repository.getMetricNames(testRunId);
    this.logger.debug('Retrieved metric names', {
      testRunId,
      count: metricNames.length,
      sampleMetrics: metricNames.slice(0, 10)
    });
    return metricNames;
  }

  // Host-related Methods

  /**
   * Fetch host properties from Dynatrace Entities API
   *
   * @param hostId - The Dynatrace host entity ID
   * @param dynatraceConfigId - The Dynatrace configuration ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: DynatraceConfig entity does not have organization_id yet, so access checks are not applied.
   * Full access permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async fetchHostProperties(hostId: string, dynatraceConfigId: string, userId: string, roles: string[]): Promise<HostPropertiesResponse> {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`fetchHostProperties: hostId=${hostId}, dynatraceConfigId=${dynatraceConfigId}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

    const config = await this.repository.findById(dynatraceConfigId);
    if (!config) {
      throw new NotFoundException(`Dynatrace configuration with ID ${dynatraceConfigId} not found`);
    }

    // NOTE: Access permission check will be added here when DynatraceConfig entity has organization_id
    // For now, all configs are accessible (treated as legacy data)

    try {
      const baseUrl = this.normalizeUrl(config.host);
      const response = await axios.get(`${baseUrl}/api/v2/entities/${hostId}`, {
        headers: {
          Authorization: `Api-Token ${config.apiToken}`,
          'Content-Type': 'application/json',
        },
        timeout: DynatraceService.ENTITIES_API_TIMEOUT_MS,
      });

      const entity = response.data;

      // Transform Dynatrace entity response to our format
      return {
        entityId: entity.entityId,
        displayName: entity.displayName,
        properties: {
          cpuCores: entity.properties?.cpuCores,
          osType: entity.properties?.osType,
          osArchitecture: entity.properties?.osArchitecture,
          bitness: entity.properties?.bitness,
          monitoringMode: entity.properties?.monitoringMode,
          hostName: entity.properties?.hostName,
          ipAddresses: entity.properties?.ipAddresses,
          cloudType: entity.properties?.cloudType,
          memoryTotal: entity.properties?.memoryTotal,
        },
        lastSeenTimestamp: entity.lastSeenTms,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          throw new NotFoundException(`Host entity ${hostId} not found in Dynatrace`);
        }
        if (error.response?.status === 401) {
          throw new BadRequestException('Invalid API token for Dynatrace entities API');
        }
        if (error.response?.status === 403) {
          throw new BadRequestException('API token lacks required permissions for entities API');
        }
        throw new BadRequestException(`Failed to fetch host properties: ${error.message}`);
      }
      throw new BadRequestException('Failed to fetch host properties: ' + (error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'));
    }
  }

  /**
   * Fetch host performance metrics from Dynatrace Metrics API
   * Returns CPU, memory, disk, and network metrics for the specified time range
   *
   * @param hostId - The Dynatrace host entity ID
   * @param startTime - Start time for the metrics query
   * @param endTime - End time for the metrics query
   * @param dynatraceConfigId - The Dynatrace configuration ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: DynatraceConfig entity does not have organization_id yet, so access checks are not applied.
   * Full access permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async fetchHostMetrics(
    hostId: string,
    startTime: Date,
    endTime: Date,
    dynatraceConfigId: string,
    userId: string,
    roles: string[]
  ): Promise<HostMetricsResponse> {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`fetchHostMetrics: hostId=${hostId}, dynatraceConfigId=${dynatraceConfigId}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

    const config = await this.repository.findById(dynatraceConfigId);
    if (!config) {
      throw new NotFoundException(`Dynatrace configuration with ID ${dynatraceConfigId} not found`);
    }

    // NOTE: Access permission check will be added here when DynatraceConfig entity has organization_id
    // For now, all configs are accessible (treated as legacy data)

    const baseUrl = this.normalizeUrl(config.host);

    // Convert dates to ISO strings for Dynatrace API
    const from = startTime.toISOString();
    const to = endTime.toISOString();

    // Define metric selectors for host metrics
    const metrics = [
      {
        name: 'CPU Usage',
        selector: `builtin:host.cpu.usage:filter(eq("dt.entity.host","${hostId}")):avg`,
        unit: 'percent',
        key: 'cpu' as const
      },
      {
        name: 'Memory Usage',
        selector: `builtin:host.mem.usage:filter(eq("dt.entity.host","${hostId}")):avg`,
        unit: 'percent',
        key: 'memory' as const
      },
      {
        name: 'Disk Utilization',
        selector: `builtin:host.disk.utilTime:filter(eq("dt.entity.host","${hostId}")):avg`,
        unit: 'percent',
        key: 'disk' as const
      },
      {
        name: 'Network Traffic',
        // Network traffic doesn't support :avg aggregation, use :splitBy() to get raw values
        selector: `builtin:host.net.nic.traffic:filter(eq("dt.entity.host","${hostId}")):splitBy()`,
        unit: 'bytes',
        key: 'network' as const
      },
    ];

    const result: HostMetricsResponse = {
      entityId: hostId,
      metrics: { cpu: [], memory: [], disk: [], network: [] },
    };

    try {
      // Fetch all metrics concurrently
      const metricPromises = metrics.map(async (metric) => {
        try {
          const response = await axios.get(`${baseUrl}/api/v2/metrics/query`, {
            headers: {
              Authorization: `Api-Token ${config.apiToken}`,
              'Content-Type': 'application/json',
            },
            params: {
              metricSelector: metric.selector,
              from,
              to,
              // Use auto-resolution based on time range for proper time-series data
            },
            timeout: DynatraceService.DEFAULT_TIMEOUT_MS,
          });

          const timeSeriesData: TimeSeriesData = {
            metricName: metric.name,
            unit: metric.unit,
            dataPoints: [],
          };

          // Extract data points from Dynatrace response
          // Dynatrace returns parallel arrays: timestamps[] and values[]
          if (response.data?.result?.[0]?.data?.[0]) {
            const dataPoint = response.data.result[0].data[0];
            if (dataPoint.timestamps && dataPoint.values) {
              timeSeriesData.dataPoints = dataPoint.timestamps.map((ts: number, i: number) => ({
                timestamp: new Date(ts).toISOString(),
                value: dataPoint.values[i] ?? 0,
              }));
            }
          }

          return { key: metric.key, data: timeSeriesData };
        } catch (metricError) {
          this.logger.warn(`Failed to fetch ${metric.name} for host ${hostId}`, {
            error: metricError && typeof metricError === 'object' && 'message' in metricError ? (metricError as Error).message : 'Unknown error'
          });
          // Return empty data for this metric
          return {
            key: metric.key,
            data: { metricName: metric.name, unit: metric.unit, dataPoints: [] }
          };
        }
      });

      const metricResults = await Promise.all(metricPromises);

      // Populate result object
      metricResults.forEach(({ key, data }) => {
        result.metrics[key] = [data];
      });

      return result;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          throw new BadRequestException('Invalid API token for Dynatrace metrics API');
        }
        if (error.response?.status === 403) {
          throw new BadRequestException('API token lacks required permissions for metrics API');
        }
        throw new BadRequestException(`Failed to fetch host metrics: ${error.message}`);
      }
      throw new BadRequestException('Failed to fetch host metrics: ' + (error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'));
    }
  }

  /**
   * Fetch host problems from Dynatrace Problems API
   * Returns problems associated with the host for the specified time range
   *
   * @param hostId - The Dynatrace host entity ID
   * @param startTime - Start time for the problems query
   * @param endTime - End time for the problems query
   * @param dynatraceConfigId - The Dynatrace configuration ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: DynatraceConfig entity does not have organization_id yet, so access checks are not applied.
   * Full access permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async fetchHostProblems(
    hostId: string,
    startTime: Date,
    endTime: Date,
    dynatraceConfigId: string,
    userId: string,
    roles: string[]
  ): Promise<HostProblemResponse[]> {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`fetchHostProblems: hostId=${hostId}, dynatraceConfigId=${dynatraceConfigId}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

    const config = await this.repository.findById(dynatraceConfigId);
    if (!config) {
      throw new NotFoundException(`Dynatrace configuration with ID ${dynatraceConfigId} not found`);
    }

    // NOTE: Access permission check will be added here when DynatraceConfig entity has organization_id
    // For now, all configs are accessible (treated as legacy data)

    try {
      const baseUrl = this.normalizeUrl(config.host);
      const from = startTime.toISOString();
      const to = endTime.toISOString();

      const response = await axios.get(`${baseUrl}/api/v2/problems`, {
        headers: {
          Authorization: `Api-Token ${config.apiToken}`,
          'Content-Type': 'application/json',
        },
        params: {
          entitySelector: `type("HOST"),entityId("${hostId}")`,
          from,
          to,
        },
        timeout: DynatraceService.DEFAULT_TIMEOUT_MS,
      });

      // Transform Dynatrace problems to our format
      const problems: HostProblemResponse[] = (response.data?.problems || []).map((problem: { problemId: string; title: string; status: 'OPEN' | 'RESOLVED'; severityLevel: string; startTime: number; endTime?: number; impactLevel?: string }) => ({
        problemId: problem.problemId,
        title: problem.title,
        status: problem.status,
        severityLevel: problem.severityLevel,
        startTime: new Date(problem.startTime).toISOString(),
        endTime: problem.endTime ? new Date(problem.endTime).toISOString() : undefined,
        impactLevel: problem.impactLevel,
      }));

      return problems;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          throw new BadRequestException('Invalid API token for Dynatrace problems API');
        }
        if (error.response?.status === 403) {
          throw new BadRequestException('API token lacks required permissions for problems API');
        }
        throw new BadRequestException(`Failed to fetch host problems: ${error.message}`);
      }
      throw new BadRequestException('Failed to fetch host problems: ' + (error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'));
    }
  }

  /**
   * Create Dynatrace metric queries for host monitoring
   * Creates 4 queries: CPU Usage, Memory Usage, Disk Utilization, Network Traffic
   * These queries are used to display host performance metrics in the Dynatrace card
   *
   * Structure:
   * - dashboardLabel: "Dynatrace host metrics" (shared across all hosts)
   * - panelTitle: host display name (e.g., "demo-master1")
   * - metricName: metric type (e.g., "CPU Usage", "Memory Usage")
   *
   * Also creates:
   * - grafana_dashboards entries (synthetic)
   * - application_dashboards entries
   * - ds_compare_config entries with USE_utilization classification
   *
   * @param dynatraceConfigId - The Dynatrace configuration ID
   * @param systemUnderTestId - The system under test ID
   * @param testEnvironment - The test environment
   * @param workload - The workload
   * @param hostId - The Dynatrace host entity ID
   * @param hostDisplayName - The display name for the host
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   *
   * Note: Dynatrace entities do not have organization_id or created_by/updated_by yet,
   * so ownership tracking is not applied. Full ownership assignment will be enabled when
   * Phase 4 adds the ownership columns.
   */
  async createHostMetricQueries(
    dynatraceConfigId: string,
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    hostId: string,
    hostDisplayName: string,
    userId: string,
    roles: string[]
  ): Promise<void> {
    // Log authorization context for debugging
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.debug(`createHostMetricQueries: dynatraceConfigId=${dynatraceConfigId}, hostId=${hostId}, userId=${userId}, isGlobalAdmin=${isAdmin}`);
    // Each host gets its own dashboard label (Dashboard: Dynatrace host metrics {hostName})
    const dashboardLabel = `Dynatrace host metrics ${hostDisplayName}`;

    // Generate deterministic UUID for the application dashboard
    // Each host gets its own dashboard
    const applicationDashboardId = this.repository.generateDynatraceDashboardUuid(
      systemUnderTestId,
      testEnvironment,
      dashboardLabel,
      workload
    );

    const metrics = [
      { name: 'CPU Usage', selector: 'builtin:host.cpu.usage', unit: 'percent', aggregation: 'avg' },
      { name: 'Memory Usage', selector: 'builtin:host.mem.usage', unit: 'percent', aggregation: 'avg' },
      { name: 'Disk Utilization', selector: 'builtin:host.disk.utilTime', unit: 'percent', aggregation: 'avg' },
      // Network traffic doesn't support :avg aggregation, use :splitBy() to get raw values
      { name: 'Network Traffic', selector: 'builtin:host.net.nic.traffic', unit: 'bytes', aggregation: 'splitBy()' },
    ];

    this.logger.log(`Creating ${metrics.length} metric queries for host ${hostDisplayName} (${hostId})`, {
      dynatraceConfigId,
      systemUnderTestId,
      testEnvironment,
      workload,
      dashboardLabel,
      applicationDashboardId,
    });

    // Ensure artificial dashboard exists before creating queries
    try {
      await this.repository.ensureArtificialDashboardExists(
        systemUnderTestId,
        testEnvironment,
        workload,
        dashboardLabel,
        applicationDashboardId
      );
      this.logger.log(`Ensured artificial dashboard exists for ${dashboardLabel}`);
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      this.logger.error(`Failed to ensure artificial dashboard exists: ${errorMessage}`);
      throw error;
    }

    // Create all metric queries with the same dashboard ID
    // Panel title is the metric name (CPU Usage, Memory Usage, etc.)
    const results = [];
    for (const metric of metrics) {
      try {
        this.logger.log(`Creating query for metric: ${metric.name} on host ${hostDisplayName}`);
        const result = await this.createQuery({
          dynatraceConfigId,
          systemUnderTestId,
          testEnvironment,
          workload,
          dashboardLabel,
          applicationDashboardId,
          panelTitle: metric.name,  // Metric name as panel title (CPU Usage, etc.)
          query: `${metric.selector}:filter(eq("dt.entity.host","${hostId}")):${metric.aggregation}`,
          metricUnit: metric.unit,
          metricName: metric.name,  // Explicit metric name (CPU Usage, etc.)
        }, userId, roles);
        this.logger.log(`Created query for ${metric.name} on ${hostDisplayName}: ${result.id}`);
        results.push(result);

        // Create ds_compare_config for this metric
        await this.repository.createDsCompareConfigForMetric(
          systemUnderTestId,
          testEnvironment,
          workload,
          applicationDashboardId,
          result.panelId,
          metric.name,
          metric.selector
        );
        this.logger.log(`Created ds_compare_config for ${metric.name}`);
      } catch (error) {
        const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
        this.logger.error(`Failed to create query for ${metric.name}: ${errorMessage}`);
        throw error; // Re-throw to let caller know
      }
    }

    this.logger.log(`Successfully created ${results.length} metric queries for host ${hostDisplayName}`);
  }
}