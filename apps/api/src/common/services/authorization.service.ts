import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  OrganizationMember,
  TeamMember,
  Team,
  ApiKey,
  OwnedResource,
  createdByUser,
} from '@perfana/shared/entities';
import {
  hasGlobalAdminRole,
  OrganizationRole,
  TeamRole,
} from '../../constants/roles.constants';
import { CapabilitiesService } from './capabilities.service';
import { CapabilityValue } from '../../constants/capabilities.constants';

/**
 * Cached user context with organization and team memberships
 */
export interface CachedUserContext {
  userId: string;
  globalRoles: string[];
  organizationMemberships: Array<{
    organizationId: string;
    roles: string[];
  }>;
  teamMemberships: Array<{
    teamId: string;
    organizationId: string;
    roles: string[];
  }>;
  cachedAt: number;
}

/**
 * Result of an authorization check
 */
export interface AuthorizationResult {
  allowed: boolean;
  reason: string;
}

/**
 * Authorization Service
 *
 * Provides centralized permission checking with Redis caching for high performance.
 * This service is the primary entry point for all authorization decisions in the application.
 *
 * Key Features:
 * - Global admin role detection (bypasses all other checks)
 * - Organization membership-based access control
 * - Team membership-based access control
 * - Resource ownership tracking
 * - Configurable TTL for cached permissions
 * - Cache invalidation on membership changes
 *
 * Authorization Hierarchy:
 * 1. Global Admin (perfana-admin, admin) - Full access to all resources
 * 2. Organization Admin - Full access within organization
 * 3. Organization Member/Viewer - Access based on role
 * 4. Team Admin - Full access to team resources
 * 5. Team Member/Viewer - Access based on role
 * 6. Resource Owner (createdBy) - Full access to own resources
 */
@Injectable()
export class AuthorizationService {
  private readonly logger = new Logger(AuthorizationService.name);
  private readonly cacheKeyPrefix = 'auth:user-context:';
  private readonly orgMembershipPrefix = 'auth:org-membership:';
  private readonly defaultTtl: number;
  private readonly enableCache: boolean;

  // Cache metrics for monitoring
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: IORedis,
    private readonly configService: ConfigService,
    @InjectRepository(OrganizationMember)
    private readonly organizationMemberRepository: Repository<OrganizationMember>,
    @InjectRepository(TeamMember)
    private readonly teamMemberRepository: Repository<TeamMember>,
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
    @InjectRepository(ApiKey)
    private readonly apiKeyRepository: Repository<ApiKey>,
    private readonly capabilitiesService: CapabilitiesService,
  ) {
    // Default TTL: 5 minutes (300 seconds)
    // Shorter than API key cache since membership changes should reflect faster
    this.defaultTtl = this.configService.get<number>('AUTH_CACHE_TTL_SECONDS', 300);
    this.enableCache = this.configService.get<string>('AUTH_CACHE_ENABLED', 'true') === 'true';

    this.logger.log(`Authorization Cache initialized (enabled: ${this.enableCache}, TTL: ${this.defaultTtl}s)`);
  }

  // ============================================
  // Global Admin Checks
  // ============================================

  /**
   * Check if a user has global admin privileges.
   * Global admins bypass all other permission checks.
   *
   * @param roles - Array of role strings from the user's JWT or context
   * @returns true if user has global admin role
   */
  isGlobalAdmin(roles: string[] | null | undefined): boolean {
    return hasGlobalAdminRole(roles);
  }

  // ============================================
  // Resource Access Checks
  // ============================================

  /**
   * Check if a user can access (read) a resource.
   *
   * Access is granted if any of these conditions are met:
   * 1. User has global admin role
   * 2. User is a member of the resource's organization
   * 3. User is a member of the resource's team
   *
   * @param userId - The user ID to check
   * @param globalRoles - The user's global roles from JWT
   * @param resource - The resource to check access for
   * @returns AuthorizationResult with allowed status and reason
   */
  async canAccessResource(
    userId: string,
    globalRoles: string[] | null | undefined,
    resource: OwnedResource,
  ): Promise<AuthorizationResult> {
    // Global admin bypasses all checks
    if (this.isGlobalAdmin(globalRoles)) {
      return {
        allowed: true,
        reason: 'User has global admin privileges',
      };
    }

    // Check organization membership
    const isOrgMember = await this.isOrganizationMember(
      userId,
      resource.organization_id,
    );

    if (isOrgMember) {
      return {
        allowed: true,
        reason: `User is a member of organization ${resource.organization_id}`,
      };
    }

    // Check team membership if resource has a team
    if (resource.team_id) {
      const isTeamMember = await this.isTeamMember(userId, resource.team_id);
      if (isTeamMember) {
        return {
          allowed: true,
          reason: `User is a member of team ${resource.team_id}`,
        };
      }
    }

    return {
      allowed: false,
      reason: `User ${userId} does not have access to this resource`,
    };
  }

  /**
   * Check if a user can modify (create/update/delete) a resource.
   *
   * Modification is granted if any of these conditions are met:
   * 1. User has global admin role
   * 2. User is the resource creator (createdBy matches userId)
   * 3. User is an organization admin (org-admin)
   * 4. User is a team admin (team-admin) for the resource's team
   *
   * @param userId - The user ID to check
   * @param globalRoles - The user's global roles from JWT
   * @param resource - The resource to check modification access for
   * @returns AuthorizationResult with allowed status and reason
   */
  async canModifyResource(
    userId: string,
    globalRoles: string[] | null | undefined,
    resource: OwnedResource,
  ): Promise<AuthorizationResult> {
    // Global admin bypasses all checks
    if (this.isGlobalAdmin(globalRoles)) {
      return {
        allowed: true,
        reason: 'User has global admin privileges',
      };
    }

    // Resource owner can always modify
    if (resource.created_by && createdByUser(resource, userId)) {
      return {
        allowed: true,
        reason: 'User is the resource creator',
      };
    }

    // Check if user is organization admin
    const isOrgAdmin = await this.isOrganizationAdmin(
      userId,
      resource.organization_id,
    );

    if (isOrgAdmin) {
      return {
        allowed: true,
        reason: `User is an admin of organization ${resource.organization_id}`,
      };
    }

    // Check if user is team admin for the resource's team
    if (resource.team_id) {
      const isTeamAdmin = await this.isTeamAdmin(userId, resource.team_id);
      if (isTeamAdmin) {
        return {
          allowed: true,
          reason: `User is an admin of team ${resource.team_id}`,
        };
      }
    }

    return {
      allowed: false,
      reason: `User ${userId} does not have modification rights for this resource`,
    };
  }

  // ============================================
  // Organization Membership Checks
  // ============================================

  /**
   * Check if a user is a member of an organization.
   * Results are cached for performance.
   *
   * @param userId - The user ID to check
   * @param organizationId - The organization ID
   * @returns true if user is a member
   */
  async isOrganizationMember(
    userId: string,
    organizationId: string,
  ): Promise<boolean> {
    const cacheKey = this.buildOrgMembershipKey(userId, organizationId);

    // Try cache first
    const cached = await this.getCachedMembership(cacheKey);
    if (cached !== null) {
      return cached;
    }

    // Query database
    try {
      const count = await this.organizationMemberRepository.count({
        where: {
          user_id: userId,
          organization_id: organizationId,
        },
      });

      let isMember = count > 0;

      // For API key users, also check if the API key belongs to this organization.
      //
      // Deliberately NOT RLS-scoped. This lookup is an *input* to the RLS
      // context — getAccessibleOrganizations feeds the same row into
      // app.current_user_organizations, which rls_api_keys_select then reads.
      // Scoping it would be circular: the key would have to already be in the
      // organization to prove it is in the organization, and the answer would
      // change with the GUCs currently in force. Keeping it context-free also
      // makes the cache below sound — buildOrgMembershipKey carries no RLS
      // context, so a context-dependent answer would be cached and reused.
      //
      // (The organization_members lookup above is unscoped for a different
      // reason: that table has RLS disabled entirely — no policies — so
      // withRequestEm would not change its visibility either way.)
      //
      // Three consequences to know. (1) This read leaves the request
      // transaction and runs on a pooled connection, so it cannot see rows
      // written earlier in the same request; that is fine because api_keys
      // rows are never created and re-read within one request. (2) It is safe
      // only while `userId` is the authenticated principal itself — every
      // caller today passes ctx.userId or a self-derived id. Passing a
      // third-party userId here would make this a cross-org membership oracle
      // that RLS would have blocked. (3) api_keys is FORCE ROW LEVEL SECURITY,
      // so this read returns rows only because the API's login role bypasses
      // RLS (rolsuper/rolbypassrls). Deploy the API under a least-privilege
      // role without that and BOTH api-key branches return zero rows: every
      // key silently loses org access, surfacing as the misleading
      // "user is not a member of organization X" denial below.
      //
      // Correctness here also assumes api_keys rows are immutable and
      // delete-only — the membership cache below is keyed on api-key:<id> and
      // is invalidated on delete (see api-keys.service.ts deleteApiKey). Add a
      // revoke flag or an org-move endpoint and that invalidation must grow
      // to match.
      if (!isMember && userId.startsWith('api-key:')) {
        const apiKeyId = userId.replace('api-key:', '');
        // eslint-disable-next-line owned-resource-must-use-request-em
        const apiKeyCount = await this.apiKeyRepository.count({
          where: { id: apiKeyId, organization_id: organizationId },
        });
        isMember = apiKeyCount > 0;
      }
      await this.cacheMembership(cacheKey, isMember);
      return isMember;
    } catch (error) {
      this.logger.error(
        `Failed to check organization membership for user ${userId} in org ${organizationId}`,
        error instanceof Error ? error.stack : error,
      );
      // On error, fail closed (deny access)
      return false;
    }
  }

  /**
   * Check if a user is an admin of an organization.
   * Results are cached for performance.
   *
   * @param userId - The user ID to check
   * @param organizationId - The organization ID
   * @returns true if user is an org admin
   */
  async isOrganizationAdmin(
    userId: string,
    organizationId: string,
  ): Promise<boolean> {
    const cacheKey = `${this.buildOrgMembershipKey(userId, organizationId)}:admin`;

    // Try cache first
    const cached = await this.getCachedMembership(cacheKey);
    if (cached !== null) {
      return cached;
    }

    // Query database
    try {
      const member = await this.organizationMemberRepository.findOne({
        where: {
          user_id: userId,
          organization_id: organizationId,
        },
      });

      if (!member) {
        await this.cacheMembership(cacheKey, false);
        return false;
      }

      const isAdmin = member.roles.includes(OrganizationRole.ADMIN);

      await this.cacheMembership(cacheKey, isAdmin);
      return isAdmin;
    } catch (error) {
      this.logger.error(
        `Failed to check organization admin status for user ${userId} in org ${organizationId}`,
        error instanceof Error ? error.stack : error,
      );
      return false;
    }
  }

  /**
   * Check if user is an organization admin in ANY of their organizations.
   * Useful for operations that require org-admin privileges but aren't scoped to a specific organization yet.
   *
   * @param userId - The user ID to check
   * @returns true if user is org-admin in at least one organization
   */
  async isOrgAdminInAnyOrganization(userId: string): Promise<boolean> {
    const cacheKey = `${this.cacheKeyPrefix}${userId}:any-org-admin`;

    // Try cache first
    const cached = await this.getCachedMembership(cacheKey);
    if (cached !== null) {
      return cached;
    }

    // Query database
    try {
      const memberships = await this.organizationMemberRepository.find({
        where: { user_id: userId },
      });

      const isOrgAdmin = memberships.some(
        (member) => member.roles.includes(OrganizationRole.ADMIN)
      );

      await this.cacheMembership(cacheKey, isOrgAdmin);
      return isOrgAdmin;
    } catch (error) {
      this.logger.error(
        `Failed to check if user ${userId} is org-admin in any organization`,
        error instanceof Error ? error.stack : error,
      );
      return false;
    }
  }

  /**
   * Check if a user can administer any organization — either via global admin
   * privileges or via org-admin membership in at least one organization.
   *
   * Returns the same {allowed, reason} shape as canAccessResource/canModifyResource
   * so callers can use a uniform pattern.
   *
   * Useful for write operations that aren't scoped to a specific organization yet
   * (e.g. CRUD gates on services like grafana-instances, pyroscope-instances,
   * tracing-instances).
   *
   * @param userId - The user ID to check
   * @param globalRoles - The user's global roles from JWT
   * @returns AuthorizationResult with allowed status and reason
   */
  async canAdministerAnyOrganization(
    userId: string,
    globalRoles: string[] | null | undefined,
  ): Promise<AuthorizationResult> {
    if (this.isGlobalAdmin(globalRoles)) {
      return {
        allowed: true,
        reason: 'User has global admin privileges',
      };
    }

    const isOrgAdmin = await this.isOrgAdminInAnyOrganization(userId);
    if (isOrgAdmin) {
      return {
        allowed: true,
        reason: `User ${userId} is org-admin in at least one organization`,
      };
    }

    return {
      allowed: false,
      reason: `User ${userId} is not a global admin and not an org-admin in any organization`,
    };
  }

  /**
   * Get all organization IDs a user has access to.
   * Results are cached for performance.
   *
   * @param userId - The user ID to check
   * @returns Array of organization IDs the user is a member of
   */
  async getAccessibleOrganizations(userId: string): Promise<string[]> {
    const cacheKey = `${this.cacheKeyPrefix}orgs:${userId}`;

    // Try cache first
    if (this.enableCache) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          this.cacheHits++;
          const orgIds = JSON.parse(cached) as string[];
          this.logger.debug(`[getAccessibleOrganizations] Cache HIT for user ${userId} - organizations: ${orgIds.join(', ')}`);
          return orgIds;
        }
        this.cacheMisses++;
        this.logger.debug(`[getAccessibleOrganizations] Cache MISS for user ${userId}`);
      } catch (error) {
        this.logger.error(
          `Failed to get cached accessible organizations: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
        );
      }
    }

    // Query database
    try {
      const memberships = await this.organizationMemberRepository.find({
        where: { user_id: userId },
        select: ['organization_id'],
      });

      const orgIds = memberships.map((m) => m.organization_id);

      // For API key users, also include the API key's own organization_id.
      //
      // Deliberately NOT RLS-scoped — see isOrganizationMember for the full
      // rationale, including the requirement that `userId` be the authenticated
      // principal. This result *becomes* app.current_user_organizations
      // (RlsTransactionInterceptor calls this before opening the transaction),
      // so it cannot be read through a policy that consumes it.
      if (userId.startsWith('api-key:')) {
        const apiKeyId = userId.replace('api-key:', '');
        // eslint-disable-next-line owned-resource-must-use-request-em
        const apiKey = await this.apiKeyRepository.findOne({
          where: { id: apiKeyId },
          select: ['organization_id'],
        });
        if (apiKey?.organization_id && !orgIds.includes(apiKey.organization_id)) {
          orgIds.push(apiKey.organization_id);
        }
      }

      this.logger.debug(`[getAccessibleOrganizations] Database query for user ${userId} - found ${orgIds.length} organizations: ${orgIds.join(', ')}`);

      // Cache the result
      if (this.enableCache) {
        try {
          await this.redis.setex(cacheKey, this.defaultTtl, JSON.stringify(orgIds));
          this.logger.debug(`[getAccessibleOrganizations] Cached ${orgIds.length} organizations for user ${userId}`);
        } catch (error) {
          this.logger.error(
            `Failed to cache accessible organizations: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
          );
        }
      }

      return orgIds;
    } catch (error) {
      this.logger.error(
        `Failed to get accessible organizations for user ${userId}`,
        error instanceof Error ? error.stack : error,
      );
      return [];
    }
  }

  // ============================================
  // Team Membership Checks
  // ============================================

  /**
   * Check if a user is a member of a team.
   * Results are cached for performance.
   *
   * @param userId - The user ID to check
   * @param teamId - The team ID
   * @returns true if user is a member
   */
  async isTeamMember(userId: string, teamId: string): Promise<boolean> {
    const cacheKey = `auth:team-membership:${userId}:${teamId}`;

    // Try cache first
    const cached = await this.getCachedMembership(cacheKey);
    if (cached !== null) {
      return cached;
    }

    // Query database
    try {
      const count = await this.teamMemberRepository.count({
        where: {
          user_id: userId,
          team_id: teamId,
        },
      });

      const isMember = count > 0;
      await this.cacheMembership(cacheKey, isMember);
      return isMember;
    } catch (error) {
      this.logger.error(
        `Failed to check team membership for user ${userId} in team ${teamId}`,
        error instanceof Error ? error.stack : error,
      );
      return false;
    }
  }

  /**
   * Check if a user is an admin of a team.
   * Results are cached for performance.
   *
   * @param userId - The user ID to check
   * @param teamId - The team ID
   * @returns true if user is a team admin
   */
  async isTeamAdmin(userId: string, teamId: string): Promise<boolean> {
    const cacheKey = `auth:team-membership:${userId}:${teamId}:admin`;

    // Try cache first
    const cached = await this.getCachedMembership(cacheKey);
    if (cached !== null) {
      return cached;
    }

    // Query database
    try {
      const member = await this.teamMemberRepository.findOne({
        where: {
          user_id: userId,
          team_id: teamId,
        },
      });

      if (!member) {
        await this.cacheMembership(cacheKey, false);
        return false;
      }

      const isAdmin = member.roles.includes(TeamRole.ADMIN);

      await this.cacheMembership(cacheKey, isAdmin);
      return isAdmin;
    } catch (error) {
      this.logger.error(
        `Failed to check team admin status for user ${userId} in team ${teamId}`,
        error instanceof Error ? error.stack : error,
      );
      return false;
    }
  }

  /**
   * Get all team IDs a user has access to.
   * Results are cached for performance.
   *
   * @param userId - The user ID to check
   * @returns Array of team IDs the user is a member of
   */
  async getAccessibleTeams(userId: string): Promise<string[]> {
    const cacheKey = `${this.cacheKeyPrefix}teams:${userId}`;

    // Try cache first
    if (this.enableCache) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          this.cacheHits++;
          this.logger.debug(`Cache HIT for accessible teams: ${userId}`);
          return JSON.parse(cached) as string[];
        }
        this.cacheMisses++;
        this.logger.debug(`Cache MISS for accessible teams: ${userId}`);
      } catch (error) {
        this.logger.error(
          `Failed to get cached accessible teams: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
        );
      }
    }

    // Query database
    try {
      const memberships = await this.teamMemberRepository.find({
        where: { user_id: userId },
        select: ['team_id'],
      });

      const teamIds = memberships.map((m) => m.team_id);

      // Cache the result
      if (this.enableCache) {
        try {
          await this.redis.setex(cacheKey, this.defaultTtl, JSON.stringify(teamIds));
          this.logger.debug(`Cached accessible teams for user ${userId}`);
        } catch (error) {
          this.logger.error(
            `Failed to cache accessible teams: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
          );
        }
      }

      return teamIds;
    } catch (error) {
      this.logger.error(
        `Failed to get accessible teams for user ${userId}`,
        error instanceof Error ? error.stack : error,
      );
      return [];
    }
  }

  // ============================================
  // Team Resource Visibility
  // ============================================

  /**
   * Check if a user can view resources belonging to a team.
   *
   * Access is granted if:
   * 1. User is a direct team member → always allowed
   * 2. Team has restrict_to_team_members = false AND user is an org member → allowed
   * 3. Team has restrict_to_team_members = true AND user is NOT a team member → denied
   *
   * @param userId - The user ID to check
   * @param teamId - The team ID whose resources are being accessed
   * @returns AuthorizationResult with allowed status and reason
   */
  async canViewTeamResources(
    userId: string,
    teamId: string,
  ): Promise<AuthorizationResult> {
    // Step 1: Direct team member always has access
    const isMember = await this.isTeamMember(userId, teamId);
    if (isMember) {
      return {
        allowed: true,
        reason: `User is a direct member of team ${teamId}`,
      };
    }

    // Step 2: Load team to check restriction flag
    const team = await this.teamRepository.findOne({
      where: { id: teamId },
      select: ['id', 'restrict_to_team_members', 'organization_id'],
    });

    if (!team) {
      return {
        allowed: false,
        reason: `Team ${teamId} not found`,
      };
    }

    // Step 3: If team is unrestricted, org membership grants access
    if (!team.restrict_to_team_members) {
      const isOrgMember = await this.isOrganizationMember(userId, team.organization_id);
      if (isOrgMember) {
        return {
          allowed: true,
          reason: `Team is unrestricted and user is a member of organization ${team.organization_id}`,
        };
      }
    }

    // Step 4: Restricted team and user is not a team member → denied
    return {
      allowed: false,
      reason: `User ${userId} does not have access to team ${teamId} resources`,
    };
  }

  // ============================================
  // Cache Invalidation
  // ============================================

  /**
   * Invalidate all cached authorization data for a user.
   * Call this when user memberships change.
   *
   * @param userId - The user ID to invalidate caches for
   */
  async invalidateUserCache(userId: string): Promise<void> {
    if (!this.enableCache) {
      return;
    }

    try {
      // Invalidate organization memberships
      const orgPattern = `${this.orgMembershipPrefix}${userId}:*`;
      const orgKeys = await this.scanKeys(orgPattern);

      // Invalidate team memberships
      const teamPattern = `auth:team-membership:${userId}:*`;
      const teamKeys = await this.scanKeys(teamPattern);

      // Invalidate accessible lists
      const accessibleOrgsKey = `${this.cacheKeyPrefix}orgs:${userId}`;
      const accessibleTeamsKey = `${this.cacheKeyPrefix}teams:${userId}`;

      const allKeys = [
        ...orgKeys,
        ...teamKeys,
        accessibleOrgsKey,
        accessibleTeamsKey,
      ];

      if (allKeys.length > 0) {
        await this.redis.del(...allKeys);
        this.logger.log(`Invalidated ${allKeys.length} cache entries for user ${userId}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to invalidate user cache: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
      );
    }

    // Bump the per-user capabilities version. Every capability cache key for
    // this user embeds the version, so incrementing it makes all existing
    // entries unreachable in O(1) — no KEYS scan, no mass DEL. Stale entries
    // expire via their existing TTL. Non-fatal: if Redis is down the TTL
    // will eventually expire the stale capabilities entries.
    try {
      await this.redis.incr(`auth:capabilities-version:${userId}`);
    } catch {
      /* non-fatal — fall back to TTL */
    }
  }

  /**
   * Invalidate all cached authorization data for an organization.
   * Call this when organization membership changes.
   *
   * @param organizationId - The organization ID to invalidate caches for
   */
  async invalidateOrganizationCache(organizationId: string): Promise<void> {
    if (!this.enableCache) {
      return;
    }

    try {
      // Invalidate all membership checks for this org
      const pattern = `${this.orgMembershipPrefix}*:${organizationId}*`;
      const keys = await this.scanKeys(pattern);

      if (keys.length > 0) {
        await this.redis.del(...keys);
        this.logger.log(`Invalidated ${keys.length} cache entries for organization ${organizationId}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to invalidate organization cache: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Invalidate all cached authorization data for a team.
   * Call this when team membership changes.
   *
   * @param teamId - The team ID to invalidate caches for
   */
  async invalidateTeamCache(teamId: string): Promise<void> {
    if (!this.enableCache) {
      return;
    }

    try {
      // Invalidate all membership checks for this team
      const pattern = `auth:team-membership:*:${teamId}*`;
      const keys = await this.scanKeys(pattern);

      if (keys.length > 0) {
        await this.redis.del(...keys);
        this.logger.log(`Invalidated ${keys.length} cache entries for team ${teamId}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to invalidate team cache: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Clear all authorization caches.
   * Use sparingly - primarily for testing or major data changes.
   */
  async clearAllCaches(): Promise<void> {
    if (!this.enableCache) {
      return;
    }

    try {
      // Clear all auth-related caches
      const patterns = [
        `${this.cacheKeyPrefix}*`,
        `${this.orgMembershipPrefix}*`,
        'auth:team-membership:*',
      ];

      let totalKeys = 0;
      for (const pattern of patterns) {
        const keys = await this.scanKeys(pattern);
        if (keys.length > 0) {
          await this.redis.del(...keys);
          totalKeys += keys.length;
        }
      }

      if (totalKeys > 0) {
        this.logger.log(`Cleared ${totalKeys} authorization cache entries`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to clear all caches: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
      );
    }
  }

  // ============================================
  // Cache Statistics
  // ============================================

  /**
   * Get cache statistics for monitoring.
   */
  getCacheStats(): {
    hits: number;
    misses: number;
    hitRate: string;
    totalRequests: number;
  } {
    const totalRequests = this.cacheHits + this.cacheMisses;
    const hitRate =
      totalRequests > 0
        ? ((this.cacheHits / totalRequests) * 100).toFixed(2)
        : '0.00';

    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: `${hitRate}%`,
      totalRequests,
    };
  }

  /**
   * Reset cache statistics.
   */
  resetCacheStats(): void {
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.logger.log('Cache statistics reset');
  }

  // ============================================
  // Health Check
  // ============================================

  /**
   * Health check for the authorization cache service.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const testKey = 'auth:health-check';
      const testValue = 'ok';

      await this.redis.setex(testKey, 10, testValue);
      const result = await this.redis.get(testKey);
      await this.redis.del(testKey);

      return result === testValue;
    } catch (error) {
      this.logger.error(
        `Cache health check failed: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
      );
      return false;
    }
  }

  // ============================================
  // Capabilities
  // ============================================

  /**
   * Compute the user's flat capability set for the given organization context.
   * Returns global-admin capabilities (every defined capability) when the caller
   * passes a system-admin role.
   *
   * Cached by `(userId, organizationId, teamId)`; cache is invalidated on
   * membership change via the existing `invalidateMembershipCache` flow.
   *
   * @param userId   User identity (Keycloak sub or `api-key:{id}`).
   * @param roles    System roles from the JWT/API key (pass `ctx.roles` from `@UserCtx()`).
   * @param organizationId  Organization scope, or `null` for global-only resolution.
   * @param teamId   Optional team scope.
   */
  async getCapabilities(
    userId: string,
    roles: string[],
    organizationId: string | null,
    teamId?: string | null,
  ): Promise<CapabilityValue[]> {
    // Versioned cache key strategy (NOT a `redis.keys('pattern')` invalidation).
    // KEYS blocks the entire Redis instance — never safe in production. Instead,
    // each user has a per-user "capabilities-version" counter; the cache key
    // includes that version. Invalidation just INCR's the counter, which makes
    // every old key for that user unreachable. Stale entries time out via TTL.
    const version = await this.getCapabilitiesVersion(userId);
    const cacheKey = `auth:capabilities:${userId}:${organizationId ?? '_'}:${teamId ?? '_'}:v${version}`;

    const cached = await this.getCachedCapabilities(cacheKey);
    if (cached !== null) return cached;

    // Cold path: load org+team roles in parallel (one Postgres round-trip
    // instead of two when both are scoped).
    const [orgRoles, teamRoles] = await Promise.all([
      organizationId
        ? this.loadOrgRoles(userId, organizationId)
        : Promise.resolve([] as OrganizationRole[]),
      teamId ? this.loadTeamRoles(userId, teamId) : Promise.resolve([] as TeamRole[]),
    ]);

    const caps = this.capabilitiesService.compute({
      systemRoles: roles,
      orgRoles,
      teamRoles,
    });

    await this.cacheCapabilities(cacheKey, caps);
    return caps;
  }

  /**
   * Per-user capability cache version. Bumped on every membership change to
   * make every existing cache entry for this user unreachable. Default 1 if
   * the counter doesn't exist yet (first-ever lookup).
   */
  private async getCapabilitiesVersion(userId: string): Promise<number> {
    if (!this.enableCache) return 1;
    try {
      const v = await this.redis.get(`auth:capabilities-version:${userId}`);
      return v ? parseInt(v, 10) : 1;
    } catch {
      return 1; // Redis down → cache disabled implicitly via the cache helpers
    }
  }

  private async getCachedCapabilities(
    cacheKey: string,
  ): Promise<CapabilityValue[] | null> {
    if (!this.enableCache) return null;
    try {
      const raw = await this.redis.get(cacheKey);
      return raw ? (JSON.parse(raw) as CapabilityValue[]) : null;
    } catch {
      return null;
    }
  }

  private async cacheCapabilities(
    cacheKey: string,
    caps: CapabilityValue[],
  ): Promise<void> {
    if (!this.enableCache) return;
    try {
      // Reuse the existing TTL the AuthorizationService already configures
      // for `auth:org-membership:*` keys. Using a separate value here would
      // create inconsistent staleness windows (a user removed from an org
      // could see stale capabilities for capabilities-TTL seconds AFTER
      // their membership cache was invalidated).
      await this.redis.setex(cacheKey, this.defaultTtl, JSON.stringify(caps));
    } catch {
      /* cache failures are non-fatal */
    }
  }

  private async loadOrgRoles(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationRole[]> {
    const member = await this.organizationMemberRepository.findOne({
      where: { user_id: userId, organization_id: organizationId },
    });
    return (member?.roles ?? []) as OrganizationRole[];
  }

  private async loadTeamRoles(userId: string, teamId: string): Promise<TeamRole[]> {
    const member = await this.teamMemberRepository.findOne({
      where: { user_id: userId, team_id: teamId },
    });
    return (member?.roles ?? []) as TeamRole[];
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  /**
   * Build cache key for organization membership check
   */
  private buildOrgMembershipKey(userId: string, organizationId: string): string {
    return `${this.orgMembershipPrefix}${userId}:${organizationId}`;
  }

  /**
   * Get cached membership result
   */
  private async getCachedMembership(cacheKey: string): Promise<boolean | null> {
    if (!this.enableCache) {
      return null;
    }

    try {
      const cached = await this.redis.get(cacheKey);

      if (cached !== null) {
        this.cacheHits++;
        this.logger.debug(`Cache HIT: ${cacheKey}`);
        return cached === '1';
      }

      this.cacheMisses++;
      this.logger.debug(`Cache MISS: ${cacheKey}`);
      return null;
    } catch (error) {
      this.logger.error(
        `Failed to get cached membership: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
      );
      return null;
    }
  }

  /**
   * Cache a membership result
   */
  private async cacheMembership(cacheKey: string, isMember: boolean): Promise<void> {
    if (!this.enableCache) {
      return;
    }

    try {
      await this.redis.setex(cacheKey, this.defaultTtl, isMember ? '1' : '0');
      this.logger.debug(`Cached membership: ${cacheKey} = ${isMember}`);
    } catch (error) {
      this.logger.error(
        `Failed to cache membership: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Scan Redis keys matching a pattern.
   * Uses SCAN for non-blocking iteration over large keyspaces.
   */
  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, foundKeys] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );

      cursor = nextCursor;
      keys.push(...foundKeys);
    } while (cursor !== '0');

    return keys;
  }
}
