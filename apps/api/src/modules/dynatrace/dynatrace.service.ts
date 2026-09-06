import { Injectable, BadRequestException, ConflictException, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { DynatraceRepository } from './dynatrace.repository';
import { CreateDynatraceConfigDto } from './dto/create-dynatrace-config.dto';
import { UpdateDynatraceConfigDto } from './dto/update-dynatrace-config.dto';
import { CreateDynatraceQueryDto } from './dto/create-dynatrace-query.dto';
import { UpdateDynatraceQueryDto } from './dto/update-dynatrace-query.dto';
import { CreateEntityMappingDto } from './dto/create-entity-mapping.dto';
import { HostPropertiesResponse, HostMetricsResponse, HostProblemResponse, HostOverviewRow, TimeSeriesData } from './dto/host.dto';
import { AuthorizationService } from '../../common/services/authorization.service';
import { withOrgFilter } from '../../common/utils/with-org-filter';
import { OwnedResource, DynatraceQuery, DynatraceEntityMapping } from '@perfana/shared';
import { validateExternalUrl } from '../../common/security/url-validator';
import { attachPermissions } from '../../common/serializers/with-permissions.serializer';
import { Capability } from '../../constants/capabilities.constants';
import { AuditService } from '../audit/audit.service';
import { ProxyResolverService } from '../proxy/proxy-resolver.service';
import axios from 'axios';
import { randomUUID } from 'crypto';

// Return type of DynatraceService#proxyOpts — spread into every axios config.
type DynatraceProxyOpts = { proxy: { host: string; port: number; protocol: string; auth?: { username: string; password: string } } } | Record<string, never>;

// Rough severity ranking so the overview can surface the "worst" problem per host.
const DT_SEVERITY_RANK: Record<string, number> = {
  AVAILABILITY: 6,
  ERROR: 5,
  PERFORMANCE: 4,
  RESOURCE_CONTENTION: 3,
  CUSTOM_ALERT: 2,
  MONITORING_UNAVAILABLE: 1,
  INFO: 0,
};

function worseSeverity(current: string | null, candidate: string | null): string | null {
  if (!candidate) return current;
  if (!current) return candidate;
  return (DT_SEVERITY_RANK[candidate] ?? -1) > (DT_SEVERITY_RANK[current] ?? -1) ? candidate : current;
}

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
  // Max entities-API pages to follow (500 entities/page = 10k entity cap). Bounds
  // the fleet-wide tag scan so a huge environment can't spin forever.
  private static readonly ENTITIES_MAX_PAGES = 20;

  constructor(
    private readonly repository: DynatraceRepository,
    private readonly authzService: AuthorizationService,
    private readonly auditService: AuditService,
    private readonly proxyResolver: ProxyResolverService,
  ) {}

  /**
   * Returns `{ proxy: axiosProxy }` when the org has a proxy configured and
   * useProxy is true, otherwise returns `{}`.  Spread into every axios config.
   */
  private async proxyOpts(cfg: { organizationId: string; useProxy: boolean }): Promise<{ proxy: { host: string; port: number; protocol: string; auth?: { username: string; password: string } } } | Record<string, never>> {
    const agents = await this.proxyResolver.resolve(cfg.organizationId, cfg.useProxy);
    return agents ? { proxy: agents.axiosProxy } : {};
  }

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
   * Wrap a mapped DTO returned from {@link DynatraceRepository}'s query helpers
   * in an actual {@link DynatraceQuery} instance so that
   * {@link AuditService.dispatch}'s `ref.constructor.auditableFields` lookup
   * succeeds. The repository returns plain objects (via `mapEntityToDtoFields`)
   * for the API response shape; the audit pipeline needs the prototype to
   * resolve the static auditableFields declaration.
   */
  private toQueryAuditRef(dto: object): OwnedResource {
    return Object.assign(new DynatraceQuery(), dto) as unknown as OwnedResource;
  }

  /**
   * Same as {@link toQueryAuditRef} for {@link DynatraceEntityMapping} rows.
   */
  private toMappingAuditRef(dto: object): OwnedResource {
    return Object.assign(new DynatraceEntityMapping(), dto) as unknown as OwnedResource;
  }

  /**
   * Resolve the parent DynatraceConfig's organizationId and verify the caller
   * has IntegrationDynatraceUpdate capability there. Used by every create/bulk
   * path that mints DQL queries or entity mappings under a config — keeps the
   * child rows from being created with `organization_id IS NULL` (which would
   * trip the legacy hatch in the mutation/delete paths).
   *
   * Admin bypass is handled implicitly by `getCapabilities`: global admins
   * receive the full GLOBAL_ADMIN_CAPABILITIES set regardless of the org scope
   * (CapabilitiesService.compute short-circuits on the systemRoles check), so
   * the capability lookup passes for them whether the parent has an org or
   * not. Non-admins under a legacy null-org config get an empty cap set and
   * are properly denied — preserving the original "non-admins cannot mint
   * rows under admin-only configs" rule without a separate `isAdmin` branch.
   *
   * @returns The resolved organizationId (may be undefined for legacy
   *   admin-only configs); the caller forwards it as the persisted ownership.
   */
  private async requireDynatraceMutationCapability(
    dynatraceConfigId: string,
    userId: string,
    roles: string[],
    op: 'create' | 'update' | 'delete',
  ): Promise<string | undefined> {
    const parentConfig = await this.repository.findById(dynatraceConfigId);
    if (!parentConfig) {
      throw new NotFoundException(`Dynatrace configuration with ID ${dynatraceConfigId} not found`);
    }

    const requiredCapability =
      op === 'delete'
        ? Capability.IntegrationDynatraceDelete
        : Capability.IntegrationDynatraceUpdate;
    const caps = await this.authzService.getCapabilities(
      userId,
      roles,
      parentConfig.organizationId,
    );
    if (!caps.includes(requiredCapability)) {
      throw new ForbiddenException(
        `You do not have permission to ${op} resources under this Dynatrace configuration`,
      );
    }
    return parentConfig.organizationId;
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
    const isGlobalAdmin = orgIds === null;
    this.logger.debug(`findAll: userId=${userId}, isGlobalAdmin=${isGlobalAdmin}, organizationId=${organizationId}`);

    // Get all configs first
    const allConfigs = await this.repository.findAll();

    // Apply organization filtering
    let filteredConfigs: typeof allConfigs;
    if (organizationId) {
      // Explicit org selected — scope to that org only
      filteredConfigs = allConfigs.filter(config =>
        config.organizationId === organizationId
      );
      this.logger.debug(`Returning ${filteredConfigs.length} Dynatrace configs for org ${organizationId} (from ${allConfigs.length} total)`);
    } else if (orgIds !== null) {
      // Non-admin: filter to accessible organizations
      this.logger.debug(`User ${userId} has access to ${orgIds.length} organizations`);
      filteredConfigs = allConfigs.filter(config => orgIds.includes(config.organizationId));
      this.logger.debug(`Returning ${filteredConfigs.length} Dynatrace configs for user ${userId} (from ${allConfigs.length} total)`);
    } else {
      filteredConfigs = allConfigs;
    }

    // Batch capability lookup: M Redis hits for M unique org IDs (not N per config)
    if (isGlobalAdmin) {
      // Global admin can always update/delete everything
      return filteredConfigs.map(c =>
        attachPermissions(this.maskConfig(c), { update: true, delete: true })
      );
    }

    const uniqueOrgIds = Array.from(new Set(filteredConfigs.map(c => c.organizationId)));
    const capsResults = await Promise.all(
      uniqueOrgIds.map(orgId => this.authzService.getCapabilities(userId, roles, orgId))
    );
    const capsByOrg = new Map<string, string[]>();
    uniqueOrgIds.forEach((orgId, i) => capsByOrg.set(orgId, capsResults[i] as string[]));

    return filteredConfigs.map(c => {
      const caps = capsByOrg.get(c.organizationId) ?? [];
      return attachPermissions(this.maskConfig(c), {
        update: caps.includes(Capability.IntegrationDynatraceUpdate),
        delete: caps.includes(Capability.IntegrationDynatraceDelete),
      });
    });
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
    this.logger.debug(`findByHost: host=${host}, userId=${userId}`);

    const config = await this.repository.findByHost(host);
    if (!config) {
      throw new NotFoundException(`Dynatrace configuration for host ${host} not found`);
    }

    // Delegate the admin / membership decision to AuthorizationService.
    // team_id is omitted to preserve the prior behavior of not checking team membership.
    // created_by is unused by canAccessResource.
    const accessResult = await this.authzService.canAccessResource(userId, roles, {
      organization_id: config.organizationId,
      created_by: '',
    } as OwnedResource);
    if (!accessResult.allowed) {
      throw new NotFoundException(`Dynatrace configuration for host ${host} not found`);
    }
    const isAdmin = accessResult.reason === 'User has global admin privileges';

    if (isAdmin) {
      return attachPermissions(this.maskConfig(config), { update: true, delete: true });
    }

    const caps = await this.authzService.getCapabilities(userId, roles, config.organizationId) as string[];
    return attachPermissions(this.maskConfig(config), {
      update: caps.includes(Capability.IntegrationDynatraceUpdate),
      delete: caps.includes(Capability.IntegrationDynatraceDelete),
    });
  }

  /**
   * Create a new Dynatrace configuration
   *
   * @param dto - The create DTO
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   *
   * Note: DynatraceConfig entity does not have organization_id or created_by/updated_by yet,
   * The caller may name a target organization in the body. That is checked here:
   * RLS cannot backstop it, because `rls_dynatrace_configs_insert`'s
   * `can_access_resource` creator branch passes for any row the caller created,
   * whatever organization_id it carries. Without this check any authenticated user
   * could plant a config — and its browser-facing clientUrl, which members then
   * follow out of Perfana — into an organization they do not belong to.
   */
  async create(dto: CreateDynatraceConfigDto, userId: string, roles: string[]) {
    // Log authorization context for debugging
    this.logger.debug(`create: userId=${userId}`);

    // The body may name a target organization; default to the caller's own.
    const organizationId =
      dto.organizationId ?? (await this.authzService.getAccessibleOrganizations(userId))[0];
    if (!organizationId) {
      throw new ForbiddenException('User has no accessible organization');
    }

    // getCapabilities is scoped to that organization and already grants global
    // admins the full set, so this is the whole check.
    const caps = await this.authzService.getCapabilities(userId, roles, organizationId);
    if (!caps.includes(Capability.IntegrationDynatraceCreate)) {
      throw new ForbiddenException(
        'You do not have permission to create a Dynatrace configuration in this organization',
      );
    }

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
      // Not run through normalizeUrl: that is an SSRF guard for URLs the server
      // calls, and the client URL is only ever opened in the user's browser.
      client_url: dto.clientUrl?.replace(/\/+$/, '') || undefined,
      api_token: dto.apiToken,
      dynatrace_type: dto.dynatraceType || 'saas',
      label: dto.label,
      platform_api_token: dto.platformApiToken,
      use_proxy: dto.useProxy || false,
      created_by: userId,
      updated_by: userId,
      organization_id: organizationId,
    });

    // Phase 5a: DynatraceConfig.organization_id column maps to camelCase property
    // organizationId, which AuditService.dispatch cannot read off ref directly —
    // pass organizationIdOverride so the audit row is org-scoped.
    this.auditService.logCreate(config as unknown as OwnedResource, {
      organizationIdOverride: config.organizationId,
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
    this.logger.debug(`update: id=${id}, userId=${userId}`);

    // Check if the configuration exists
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundException(`Dynatrace configuration with ID ${id} not found`);
    }

    // Delegate the admin / legacy-null-org / org-admin decision to AuthorizationService.
    // canModifyResource handles: global admin bypass, legacy null-org bypass, creator-of-resource,
    // org-admin role check, team-admin role check.
    const modifyResult = await this.authzService.canModifyResource(userId, roles, {
      organization_id: existing.organizationId,
      created_by: existing.createdBy ?? '',
    } as OwnedResource);
    if (!modifyResult.allowed) {
      throw new ForbiddenException('You do not have permission to modify this Dynatrace configuration');
    }

    // Ignore the '[MASKED]' sentinel so a masked read can never overwrite the real token.
    const apiToken = dto.apiToken === '[MASKED]' ? undefined : dto.apiToken;
    const platformApiToken = dto.platformApiToken === '[MASKED]' ? undefined : dto.platformApiToken;

    // Update the configuration with the provided attributes
    const updated = await this.repository.update(id, {
      // null and '' both mean "clear it": a client that GETs a config (where an
      // unset value reads back as null) and PATCHes it back must not silently
      // no-op. Only an absent key leaves the stored value alone.
      client_url: dto.clientUrl === null ? '' : dto.clientUrl?.replace(/\/+$/, ''),
      perfana_test_run_id_attribute: dto.perfanaTestRunIdAttribute,
      perfana_request_name_attribute: dto.perfanaRequestNameAttribute,
      label: dto.label,
      api_token: apiToken,
      platform_api_token: platformApiToken,
      use_proxy: dto.useProxy,
      updated_by: userId,
    });

    this.auditService.logUpdate(
      existing as unknown as OwnedResource,
      updated as unknown as OwnedResource,
      { organizationIdOverride: existing.organizationId ?? updated.organizationId },
    );

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
    this.logger.debug(`delete: id=${id}, userId=${userId}`);

    // Check if the configuration exists and validate permissions
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundException(`Dynatrace configuration with ID ${id} not found`);
    }

    // Same access shape as update — see comment there for the canModifyResource rationale.
    const modifyResult = await this.authzService.canModifyResource(userId, roles, {
      organization_id: existing.organizationId,
      created_by: existing.createdBy ?? '',
    } as OwnedResource);
    if (!modifyResult.allowed) {
      throw new ForbiddenException('You do not have permission to delete this Dynatrace configuration');
    }

    // Phase 5a: log DELETE before the row goes away so the diff captures the
    // pre-delete state. organizationIdOverride bridges the camelCase property
    // / snake_case column mismatch on DynatraceConfig.
    this.auditService.logDelete(existing as unknown as OwnedResource, {
      organizationIdOverride: existing.organizationId,
    });

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
  async fetchEntities(userId: string, _roles: string[], entityType?: string, entityName?: string, dynatraceConfigId?: string, tagKey?: string, tagValue?: string) {
    // Log authorization context for debugging
    this.logger.debug(`fetchEntities: userId=${userId}, dynatraceConfigId=${dynatraceConfigId}`);

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

    return this.fetchEntitiesFromHost(config, entityType, entityName, tagKey, tagValue);
  }

  private async fetchEntitiesFromHost(config: { host: string; apiToken: string; organizationId: string; useProxy: boolean }, entityType?: string, entityName?: string, tagKey?: string, tagValue?: string) {
    const { host, apiToken } = config;
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

      if (tagKey) {
        // Filter server-side across the whole fleet instead of the fetched page.
        // Dynatrace tag syntax: tag("key:value") for key+value, tag("key") for key only.
        const sanitize = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const tag = tagValue ? `${sanitize(tagKey)}:${sanitize(tagValue)}` : sanitize(tagKey);
        conditions.push(`tag("${tag}")`);
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

      const proxyOpts = await this.proxyOpts(config);
      const headers = {
        Authorization: `Api-Token ${apiToken}`,
        'Content-Type': 'application/json',
      };

      // Dynatrace v2 paging: the FIRST request carries the query params; every
      // follow-up request must send ONLY nextPageKey (passing entitySelector/
      // pageSize/fields alongside it returns 400). Follow the cursor so the tag
      // key/value dropdowns and host list reflect the whole fleet, not just the
      // first 500-entity page — previously the tag suggestions were parsed from
      // page 1 only, so a value living on a later page was never offered.
      const entities: Record<string, unknown>[] = [];
      let totalCount = 0;
      let nextPageKey: string | null = null;
      let page = 0;

      do {
        const params: Record<string, string | number> = nextPageKey
          ? { nextPageKey }
          : {
              pageSize: 500,
              entitySelector,
              // v2 entities API omits tags unless requested; '+tags' adds to the default fields
              fields: '+tags',
            };

        const response = await axios.get(requestUrl, {
          headers,
          timeout: DynatraceService.ENTITIES_API_TIMEOUT_MS,
          params,
          ...proxyOpts,
        });

        if (!response.data) {
          throw new BadRequestException('Invalid response from Dynatrace entities API');
        }

        entities.push(...(response.data.entities || []));
        totalCount = response.data.totalCount || totalCount;
        nextPageKey = response.data.nextPageKey || null;
        page++;
      } while (nextPageKey && page < DynatraceService.ENTITIES_MAX_PAGES);

      if (nextPageKey) {
        this.logger.warn(
          `Dynatrace entities fetch hit the ${DynatraceService.ENTITIES_MAX_PAGES}-page cap ` +
            `(${entities.length} of ${totalCount}); tag suggestions may be incomplete — narrow with a tag filter.`,
          { entitySelector },
        );
      }

      this.logger.debug('Dynatrace entities API response', {
        totalCount,
        entitiesCount: entities.length,
        pages: page,
      });

      // Return the response in the expected format. nextPageKey is null because
      // the loop already exhausted (or capped) the cursor server-side.
      return {
        entities,
        totalCount,
        pageSize: entities.length,
        nextPageKey: null,
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
  async fetchRequestAttributes(host: string, userId: string, _roles: string[]) {
    // Log authorization context for debugging
    this.logger.debug(`fetchRequestAttributes: host=${host}, userId=${userId}`);

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
        ...(await this.proxyOpts(config)),
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
    this.logger.debug(`getRequestAttributesForConfig: id=${id}, userId=${userId}`);

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
   * Attach `_permissions` to DQL query / entity-mapping rows.
   *
   * PR #187 closed the backend authz bypass on these two sub-resources — a
   * non-admin now correctly gets 403 on PATCH/DELETE. The frontend had no way to
   * know that, so the user only discovered the denial after clicking. This is the
   * same enrichment the parent `DynatraceConfig` already gets in `findAll`, and it
   * reads the *same* capabilities the mutation paths enforce, so the button state
   * and the eventual 403 cannot disagree.
   *
   * Batched the same way as `findAll`: one capability lookup per unique org, not
   * per row.
   */
  private async attachSubResourcePermissions<T extends { organizationId?: string }>(
    rows: T[],
    userId: string,
    roles: string[],
  ): Promise<T[]> {
    if (rows.length === 0) return rows;

    // No isGlobalAdmin branch: getCapabilities already returns the full
    // GLOBAL_ADMIN_CAPABILITIES set for a global admin regardless of org scope
    // (CapabilitiesService.compute short-circuits on systemRoles), so admins fall
    // out of the normal path with both flags true.
    const uniqueOrgIds = Array.from(new Set(rows.map(r => r.organizationId ?? null)));
    const capsResults = await Promise.all(
      uniqueOrgIds.map(orgId => this.authzService.getCapabilities(userId, roles, orgId)),
    );
    const capsByOrg = new Map<string | null, string[]>();
    uniqueOrgIds.forEach((orgId, i) => capsByOrg.set(orgId, capsResults[i] as string[]));

    return rows.map(row => {
      const caps = capsByOrg.get(row.organizationId ?? null) ?? [];
      return attachPermissions(row, {
        update: caps.includes(Capability.IntegrationDynatraceUpdate),
        delete: caps.includes(Capability.IntegrationDynatraceDelete),
      }) as T;
    });
  }

  /**
   * Find all Dynatrace DQL queries
   *
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Rows are RLS-scoped by `rls_dynatrace_queries_select`; this adds the
   * `_permissions` the UI needs to disable edit/delete before the user clicks.
   */
  async findAllQuery(userId: string, roles: string[]) {
    this.logger.debug(`findAllQuery: userId=${userId}`);

    return this.attachSubResourcePermissions(await this.repository.findAllQuery(), userId, roles);
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
   */
  async findQueryBySystemAndEnvironment(systemId: string, environment: string, workload: string | undefined, userId: string, roles: string[]) {
    this.logger.debug(`findQueryBySystemAndEnvironment: systemId=${systemId}, environment=${environment}, workload=${workload}, userId=${userId}`);

    return this.attachSubResourcePermissions(
      await this.repository.findQueryBySystemAndEnvironment(systemId, environment, workload),
      userId,
      roles,
    );
  }

  /**
   * Find a Dynatrace DQL query by ID
   *
   * @param id - The query ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   */
  async findQueryById(id: string, userId: string, roles: string[]) {
    this.logger.debug(`findQueryById: id=${id}, userId=${userId}`);

    const query = await this.repository.findQueryById(id);
    if (!query) {
      throw new NotFoundException(`Dynatrace DQL query with ID ${id} not found`);
    }

    const [enriched] = await this.attachSubResourcePermissions([query], userId, roles);
    return enriched;
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
    this.logger.debug(`createQuery: userId=${userId}`);

    const parentOrgId = await this.requireDynatraceMutationCapability(
      dto.dynatraceConfigId,
      userId,
      roles,
      'create',
    );

    if (dto.systemUnderTestId && dto.testEnvironment && dto.dashboardLabel && dto.applicationDashboardId && parentOrgId) {
      await this.repository.ensureArtificialDashboardExists(
        dto.systemUnderTestId,
        dto.testEnvironment,
        dto.workload || '',
        dto.dashboardLabel,
        dto.applicationDashboardId,
        parentOrgId
      );
    }

    const result = await this.repository.createQuery(dto, {
      organizationId: parentOrgId,
      createdBy: userId,
      updatedBy: userId,
    });
    this.auditService.logCreate(this.toQueryAuditRef(result), {
      organizationIdOverride: result.organizationId,
    });
    return result;
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
    this.logger.debug(`createQuerySmart: userId=${userId}`);

    const parentOrgId = await this.requireDynatraceMutationCapability(
      dto.dynatraceConfigId,
      userId,
      roles,
      'create',
    );

    const existingUuid = await this.repository.findDashboardByLabel(dto.dashboardLabel);

    let applicationDashboardId: string;
    if (existingUuid) {
      applicationDashboardId = existingUuid;
    } else {
      applicationDashboardId = randomUUID();
    }

    if (dto.systemUnderTestId && dto.testEnvironment && dto.dashboardLabel && parentOrgId) {
      await this.repository.ensureArtificialDashboardExists(
        dto.systemUnderTestId,
        dto.testEnvironment,
        dto.workload || '',
        dto.dashboardLabel,
        applicationDashboardId,
        parentOrgId
      );
    }

    const result = await this.repository.createQueryWithSharedUuid(
      dto,
      applicationDashboardId,
      {
        organizationId: parentOrgId,
        createdBy: userId,
        updatedBy: userId,
      },
    );
    this.auditService.logCreate(this.toQueryAuditRef(result), {
      organizationIdOverride: result.organizationId,
    });
    return result;
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
    this.logger.debug(`bulkImportQuery: count=${dtoList.length}, userId=${userId}`);

    if (dtoList.length === 0) {
      return [];
    }

    // bulkCreate path requires the same parent config across all DTOs (the
    // repository enforces this). Validate the caller's mutation capability
    // against that single parent up front so we fail fast on a single 403
    // instead of writing some rows before discovering the gap.
    const firstDto = dtoList[0]!;
    const parentOrgId = await this.requireDynatraceMutationCapability(
      firstDto.dynatraceConfigId,
      userId,
      roles,
      'create',
    );

    if (generateSharedUuid) {
      const sharedUuid = randomUUID();

      if (firstDto.systemUnderTestId && firstDto.testEnvironment && firstDto.dashboardLabel && parentOrgId) {
        await this.repository.ensureArtificialDashboardExists(
          firstDto.systemUnderTestId,
          firstDto.testEnvironment,
          firstDto.workload || '',
          firstDto.dashboardLabel,
          sharedUuid,
          parentOrgId
        );
      }

      const created = await this.repository.bulkCreateQueryWithSharedUuid(
        dtoList,
        sharedUuid,
        {
          organizationId: parentOrgId,
          createdBy: userId,
          updatedBy: userId,
        },
      );
      // One audit row per persisted query — bulk imports are still per-row
      // history for compliance reconstruction.
      for (const row of created) {
        this.auditService.logCreate(this.toQueryAuditRef(row), {
          organizationIdOverride: row.organizationId,
        });
      }
      return created;
    } else {
      const results = [];
      for (const dto of dtoList) {
        // createQuerySmart emits its own logCreate per row.
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
    this.logger.debug(`updateQuery: id=${id}, userId=${userId}`);

    const existing = await this.repository.findQueryById(id);
    if (!existing) {
      throw new NotFoundException(`Dynatrace DQL query with ID ${id} not found`);
    }

    // Capability check scoped to the row's org. Pre-backfill rows have
    // organizationId === null; getCapabilities(userId, roles, null) returns
    // [] for non-admins (so the cap check fails and they're denied) but
    // returns GLOBAL_ADMIN_CAPABILITIES for admins (so the cap check passes).
    // The backfill migration (1777600000000) is the only path that re-opens
    // null-org rows for non-admins.
    const caps = await this.authzService.getCapabilities(
      userId,
      roles,
      existing.organizationId,
    );
    if (!caps.includes(Capability.IntegrationDynatraceUpdate)) {
      throw new ForbiddenException(
        'You do not have permission to modify this Dynatrace query',
      );
    }

    const updated = await this.repository.updateQuery(id, dto, { updatedBy: userId });
    this.auditService.logUpdate(
      this.toQueryAuditRef(existing),
      this.toQueryAuditRef(updated),
      { organizationIdOverride: existing.organizationId ?? updated.organizationId },
    );
    this.logger.log(`Dynatrace DQL query updated: ${id} by user ${userId}`);
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
    this.logger.debug(`deleteQuery: id=${id}, userId=${userId}`);

    const existing = await this.repository.findQueryById(id);
    if (!existing) {
      throw new NotFoundException(`Dynatrace DQL query with ID ${id} not found`);
    }

    // See updateQuery for the null-org / admin-bypass semantics.
    const caps = await this.authzService.getCapabilities(
      userId,
      roles,
      existing.organizationId,
    );
    if (!caps.includes(Capability.IntegrationDynatraceDelete)) {
      throw new ForbiddenException(
        'You do not have permission to delete this Dynatrace query',
      );
    }

    this.auditService.logDelete(this.toQueryAuditRef(existing), {
      organizationIdOverride: existing.organizationId,
    });
    await this.repository.deleteQuery(id);
    this.logger.log(`Dynatrace DQL query ${id} deleted successfully by user ${userId}`);
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
  async getDistinctDashboardLabels(systemId: string, environment: string, workload: string | undefined, userId: string, _roles: string[]) {
    // Log authorization context for debugging
    this.logger.debug(`getDistinctDashboardLabels: systemId=${systemId}, environment=${environment}, workload=${workload}, userId=${userId}`);

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
  async getPanelTitlesForDashboard(systemId: string, environment: string, workload: string | undefined, dashboardLabel: string, userId: string, _roles: string[]) {
    // Log authorization context for debugging
    this.logger.debug(`getPanelTitlesForDashboard: systemId=${systemId}, environment=${environment}, workload=${workload}, dashboardLabel=${dashboardLabel}, userId=${userId}`);

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
   * Mappings have no update endpoint — only delete — but the enrichment emits both
   * flags for a uniform shape; the UI reads `_permissions.delete`.
   */
  async getEntityMappings(userId: string, roles: string[], systemId?: string, environment?: string, workload?: string) {
    this.logger.debug(`getEntityMappings: userId=${userId}, systemId=${systemId}, environment=${environment}, workload=${workload}`);

    return this.attachSubResourcePermissions(
      await this.repository.getEntityMappings(systemId, environment, workload),
      userId,
      roles,
    );
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
    this.logger.debug(`createEntityMapping: userId=${userId}`);

    const parentOrgId = await this.requireDynatraceMutationCapability(
      dto.dynatraceConfigId,
      userId,
      roles,
      'create',
    );

    try {
      const result = await this.repository.createEntityMapping(dto, {
        organizationId: parentOrgId,
        createdBy: userId,
        updatedBy: userId,
      });
      this.auditService.logCreate(this.toMappingAuditRef(result), {
        organizationIdOverride: parentOrgId,
      });
      this.logger.log(`Dynatrace entity mapping created: ${result.id} by user ${userId}`);
      return result;
    } catch (error) {
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
    this.logger.debug(`deleteEntityMapping: id=${id}, userId=${userId}`);

    const existing = await this.repository.getEntityMappingById(id);
    if (!existing) {
      throw new NotFoundException(`Dynatrace entity mapping with ID ${id} not found`);
    }

    // See updateQuery for the null-org / admin-bypass semantics.
    const caps = await this.authzService.getCapabilities(
      userId,
      roles,
      existing.organizationId,
    );
    if (!caps.includes(Capability.IntegrationDynatraceDelete)) {
      throw new ForbiddenException(
        'You do not have permission to delete this Dynatrace entity mapping',
      );
    }

    this.auditService.logDelete(this.toMappingAuditRef(existing), {
      organizationIdOverride: existing.organizationId,
    });
    await this.repository.deleteEntityMapping(id);
    this.logger.log(`Dynatrace entity mapping ${id} deleted successfully by user ${userId}`);
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
  async getMetricNames(userId: string, _roles: string[], testRunId?: string) {
    // Log authorization context for debugging
    this.logger.debug(`getMetricNames: userId=${userId}, testRunId=${testRunId}`);

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
  async fetchHostProperties(hostId: string, dynatraceConfigId: string, userId: string, _roles: string[]): Promise<HostPropertiesResponse> {
    // Log authorization context for debugging
    this.logger.debug(`fetchHostProperties: hostId=${hostId}, dynatraceConfigId=${dynatraceConfigId}, userId=${userId}`);

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
        ...(await this.proxyOpts(config)),
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
    _roles: string[]
  ): Promise<HostMetricsResponse> {
    // Log authorization context for debugging
    this.logger.debug(`fetchHostMetrics: hostId=${hostId}, dynatraceConfigId=${dynatraceConfigId}, userId=${userId}`);

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

    const proxyOpts = await this.proxyOpts(config);

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
            ...proxyOpts,
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
    _roles: string[]
  ): Promise<HostProblemResponse[]> {
    // Log authorization context for debugging
    this.logger.debug(`fetchHostProblems: hostId=${hostId}, dynatraceConfigId=${dynatraceConfigId}, userId=${userId}`);

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
        ...(await this.proxyOpts(config)),
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
   * Batch host overview for the Hosts tab: one row per HOST entity mapped to the
   * given system/environment/workload, with average CPU/mem over [startTime,endTime]
   * and a count of problems overlapping the window. Hosts are grouped by their own
   * Dynatrace instance config; each config costs 2 Dynatrace calls. Fails soft per
   * config so one bad instance never blanks the whole table.
   *
   * `hostId` narrows the answer to a single host so the Hosts tab can fan out one
   * request per host and fill the table as replies arrive, instead of waiting for
   * one selector covering every host.
   */
  async fetchHostsOverview(
    systemId: string,
    environment: string,
    workload: string,
    startTime: Date,
    endTime: Date,
    userId: string,
    roles: string[],
    hostId?: string,
  ): Promise<HostOverviewRow[]> {
    const mappings = await this.getEntityMappings(userId, roles, systemId, environment, workload);
    const hosts = (mappings ?? []).filter(
      (m: { entityType: string; entityId: string }) =>
        m.entityType === 'HOST' && (!hostId || m.entityId === hostId),
    ) as Array<{
      entityId: string;
      entityDisplayName: string;
      dynatraceConfigId: string;
    }>;
    if (hosts.length === 0) return [];

    // ponytail: 2 Dynatrace calls per DISTINCT config. Usually one config → 2 total.
    const byConfig = new Map<string, typeof hosts>();
    for (const h of hosts) {
      const list = byConfig.get(h.dynatraceConfigId) ?? [];
      list.push(h);
      byConfig.set(h.dynatraceConfigId, list);
    }

    const from = startTime.toISOString();
    const to = endTime.toISOString();
    const rows: HostOverviewRow[] = [];

    for (const [configId, configHosts] of byConfig) {
      const base = configHosts.map((h) => ({
        hostId: h.entityId,
        displayName: h.entityDisplayName,
        dynatraceConfigId: configId,
      }));
      try {
        const config = await this.repository.findById(configId);
        if (!config) throw new Error(`Dynatrace configuration ${configId} not found`);

        const baseUrl = this.normalizeUrl(config.host);
        const proxyOpts = await this.proxyOpts(config);
        const entityIds = configHosts.map((h) => `"${h.entityId}"`).join(',');
        const entitySelector = `type("HOST"),entityId(${entityIds})`;

        const [cpuMap, memMap, problemsMap] = await Promise.all([
          this.queryHostMetricAverages(baseUrl, config.apiToken, 'builtin:host.cpu.usage', entitySelector, from, to, proxyOpts),
          this.queryHostMetricAverages(baseUrl, config.apiToken, 'builtin:host.mem.usage', entitySelector, from, to, proxyOpts),
          this.queryHostProblemCounts(baseUrl, config.apiToken, entitySelector, from, to, proxyOpts),
        ]);

        for (const b of base) {
          const p = problemsMap.get(b.hostId);
          rows.push({
            ...b,
            cpuAvg: cpuMap.get(b.hostId) ?? null,
            memAvg: memMap.get(b.hostId) ?? null,
            problemCount: p?.count ?? 0,
            worstSeverity: p?.worst ?? null,
          });
        }
      } catch (error) {
        this.logger.warn(`fetchHostsOverview: failed for config ${configId}`, {
          error: error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error',
        });
        for (const b of base) {
          rows.push({ ...b, cpuAvg: null, memAvg: null, problemCount: 0, worstSeverity: null });
        }
      }
    }

    return rows;
  }

  /** One /metrics/query call → Map<hostId, avgValue> over the window (resolution=Inf gives one value per host). */
  private async queryHostMetricAverages(
    baseUrl: string,
    apiToken: string,
    metric: string,
    entitySelector: string,
    from: string,
    to: string,
    proxyOpts: DynatraceProxyOpts,
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    const response = await axios.get(`${baseUrl}/api/v2/metrics/query`, {
      headers: { Authorization: `Api-Token ${apiToken}`, 'Content-Type': 'application/json' },
      params: {
        metricSelector: `${metric}:splitBy("dt.entity.host"):avg`,
        entitySelector,
        from,
        to,
        resolution: 'Inf',
      },
      timeout: DynatraceService.DEFAULT_TIMEOUT_MS,
      ...proxyOpts,
    });

    const series = response.data?.result?.[0]?.data ?? [];
    for (const s of series) {
      const hostId: string | undefined = s?.dimensionMap?.['dt.entity.host'] ?? s?.dimensions?.[0];
      if (!hostId) continue;
      const value = (s?.values ?? []).find((v: number | null) => v !== null && v !== undefined);
      if (typeof value === 'number') map.set(hostId, value);
    }
    return map;
  }

  /** One /problems call → Map<hostId, {count, worst}> for problems overlapping the window. */
  private async queryHostProblemCounts(
    baseUrl: string,
    apiToken: string,
    entitySelector: string,
    from: string,
    to: string,
    proxyOpts: DynatraceProxyOpts,
  ): Promise<Map<string, { count: number; worst: string | null }>> {
    const map = new Map<string, { count: number; worst: string | null }>();
    const response = await axios.get(`${baseUrl}/api/v2/problems`, {
      headers: { Authorization: `Api-Token ${apiToken}`, 'Content-Type': 'application/json' },
      params: { entitySelector, from, to, fields: '+affectedEntities' },
      timeout: DynatraceService.DEFAULT_TIMEOUT_MS,
      ...proxyOpts,
    });

    const problems = response.data?.problems ?? [];
    for (const problem of problems) {
      const severity: string | null = problem?.severityLevel ?? null;
      const affected = problem?.affectedEntities ?? [];
      for (const e of affected) {
        const id: string | undefined = e?.entityId?.id;
        if (!id) continue;
        const cur = map.get(id) ?? { count: 0, worst: null };
        cur.count += 1;
        cur.worst = worseSeverity(cur.worst, severity);
        map.set(id, cur);
      }
    }
    return map;
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
    this.logger.debug(`createHostMetricQueries: dynatraceConfigId=${dynatraceConfigId}, hostId=${hostId}, userId=${userId}`);

    const parentOrgId = await this.requireDynatraceMutationCapability(
      dynatraceConfigId,
      userId,
      roles,
      'create',
    );

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
        applicationDashboardId,
        parentOrgId!
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