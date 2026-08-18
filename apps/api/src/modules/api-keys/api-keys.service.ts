import { Injectable, Logger, ForbiddenException, ConflictException } from '@nestjs/common';
import { In } from 'typeorm';
import { ResourceNotFoundException, ValidationException, DatabaseException } from '../../common/exceptions/business.exception';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { ApiKeyRepository } from '../../repositories/api-key.repository';
import { ApiKey, OwnedResource } from '../../entities';
import { ApiKeyCacheService } from './api-key-cache.service';
import { ApiKeyLastUsedFlusherService } from './api-key-last-used-flusher.service';
import { AuthorizationService } from '../../common/services/authorization.service';
import { AuditService } from '../audit/audit.service';
import { Capability } from '../../constants/capabilities.constants';

/**
 * Service responsible for managing API keys.
 *
 * Authorization model (Phase 3c capability-based):
 * - Read paths gate on `Capability.ApiKeyRead` for the target organization.
 * - Create/delete gate on `Capability.ApiKeyCreate` / `ApiKeyDelete` for the
 *   target organization. Note this is *target-org scoped*: a user who is
 *   org-admin in org A but only org-member in org B cannot mutate keys in B.
 * - Global admins receive every capability via `getCapabilities(_, _, null)`.
 *
 * Capability resolution lives in `AuthorizationService.getCapabilities`, which
 * caches per-user/per-org capability sets and invalidates on membership change.
 */
@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);
  private readonly saltRounds = 10;

  constructor(
    private readonly apiKeyRepository: ApiKeyRepository,
    private readonly apiKeyCacheService: ApiKeyCacheService,
    private readonly authzService: AuthorizationService,
    private readonly auditService: AuditService,
    private readonly lastUsedFlusher: ApiKeyLastUsedFlusherService,
  ) {}

  /**
   * Resolve whether the caller has *global* admin reach (no org context).
   * `SystemManageGlobalSettings` is only ever granted to system-roles in
   * `GLOBAL_ADMIN_ROLES` (see capabilities.constants.ts), so its presence is
   * the canonical "are you a global admin" check without bypassing the
   * capability layer.
   */
  private async isGlobalAdminUser(userId: string, roles: string[]): Promise<boolean> {
    const caps = await this.authzService.getCapabilities(userId, roles, null);
    return caps.includes(Capability.SystemManageGlobalSettings);
  }

  /**
   * Find all API keys
   *
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   * @param organizationId - Optional explicit org filter
   *
   * Behavior:
   * - With `organizationId`: returns keys for that org if caller has `ApiKeyRead`
   *   there; otherwise empty (we do not 403 here to avoid leaking org existence).
   * - Without `organizationId`:
   *     - Global admin → all keys.
   *     - Otherwise → keys in every org where the caller has `ApiKeyRead`.
   */
  async findAll(userId: string, roles: string[], organizationId?: string): Promise<ApiKey[]> {
    if (organizationId) {
      const caps = await this.authzService.getCapabilities(userId, roles, organizationId);
      if (!caps.includes(Capability.ApiKeyRead)) {
        this.logger.log(`[findAll] No ApiKeyRead in org ${organizationId} for user ${userId} - returning empty`);
        return [];
      }
      const apiKeys = await this.apiKeyRepository.findAll({
        where: { organization_id: organizationId },
        order: { createdAt: 'DESC' },
      });
      this.logger.log(`[findAll] org-scoped (org=${organizationId}) - returning ${apiKeys.length} API keys`);
      return apiKeys;
    }

    if (await this.isGlobalAdminUser(userId, roles)) {
      const apiKeys = await this.apiKeyRepository.findAll({
        order: { createdAt: 'DESC' },
      });
      this.logger.log(`[findAll] global-admin - returning ${apiKeys.length} API keys`);
      return apiKeys;
    }

    const accessibleOrgIds = await this.authzService.getAccessibleOrganizations(userId);
    if (accessibleOrgIds.length === 0) {
      this.logger.log(`[findAll] User ${userId} has no organizations - returning empty`);
      return [];
    }

    // Filter to orgs where the caller actually has ApiKeyRead. In the current
    // role mapping every org role grants ApiKeyRead, but checking is forward-
    // compatible with future role-shaping (e.g. revoking the cap on viewers).
    const capsByOrg = await Promise.all(
      accessibleOrgIds.map(orgId => this.authzService.getCapabilities(userId, roles, orgId)),
    );
    const readableOrgIds = accessibleOrgIds.filter((_, i) =>
      (capsByOrg[i] ?? []).includes(Capability.ApiKeyRead),
    );

    if (readableOrgIds.length === 0) {
      this.logger.log(`[findAll] User ${userId} has no ApiKeyRead capability in any org - returning empty`);
      return [];
    }

    const apiKeys = await this.apiKeyRepository.findAll({
      where: { organization_id: In(readableOrgIds) },
      order: { createdAt: 'DESC' },
    });
    this.logger.log(`[findAll] member-scoped (orgs=${readableOrgIds.join(',')}) - returning ${apiKeys.length} API keys`);
    return apiKeys;
  }

  /**
   * Find a single API key by ID
   *
   * Resource-level capability check: only callers with `ApiKeyRead` in the
   * key's organization may see it. Legacy keys (null organization_id) are
   * visible only to global admins.
   */
  async findOne(id: string, userId: string, roles: string[]): Promise<ApiKey> {
    try {
      const apiKey = await this.apiKeyRepository.findById(id);
      if (!apiKey) {
        throw new ResourceNotFoundException('API key', id);
      }

      const caps = await this.authzService.getCapabilities(userId, roles, apiKey.organization_id);
      if (!caps.includes(Capability.ApiKeyRead)) {
        this.logger.warn(`[findOne] user ${userId} lacks ApiKeyRead in org ${apiKey.organization_id} for key ${id}`);
        throw new ResourceNotFoundException('API key', id);
      }
      return apiKey;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error('Failed to find API key:', error);
      throw new DatabaseException('Failed to retrieve API key', error);
    }
  }


  /**
   * Create a new API key
   *
   * Authorization: caller must have `Capability.ApiKeyCreate` for the target
   * organization (target-org scoped, so org-admin in org A cannot create keys
   * in org B even when they are also a member of B).
   */
  async createApiKey(
    createDto: CreateApiKeyDto,
    userId: string,
    roles: string[],
    organizationId: string,
  ): Promise<{ apiKey: ApiKey; token: string }> {
    try {
      const caps = await this.authzService.getCapabilities(userId, roles, organizationId);
      if (!caps.includes(Capability.ApiKeyCreate)) {
        throw new ForbiddenException(
          'Organization admin privileges required to create API keys for this organization',
        );
      }

      // Pre-check for duplicate description within the same organization.
      // The (organization_id, description) unique index is the source of
      // truth, but checking here lets us return a friendly 409 instead of
      // letting the DB raise QueryFailedError → 500.
      const existing = await this.apiKeyRepository.findByOrganizationAndDescription(
        organizationId,
        createDto.description,
      );
      if (existing) {
        throw new ConflictException(
          `An API key with description "${createDto.description}" already exists in this organization.`,
        );
      }

      const uuid = uuidv4();

      // Create token in format: base64(description#uuid)
      const token = Buffer.from(`${createDto.description}#${uuid}`).toString('base64');

      // Parse TTL (e.g., "30d", "1w", "6M", "1y")
      const validUntil = this.parseTtl(createDto.ttl);

      // Hash the token
      const hashedToken = await bcrypt.hash(token, this.saltRounds);

      // Prevent privilege escalation: validate requested roles against creator's roles
      const callerIsGlobalAdmin = await this.isGlobalAdminUser(userId, roles);
      this.validateRequestedRoles(createDto.roles || [], roles, callerIsGlobalAdmin);

      // Default to empty roles (principle of least privilege) if not provided
      const apiKeyRoles = createDto.roles || [];

      // Insert into database with ownership tracking
      const apiKey = await this.apiKeyRepository.create({
        apiKey: hashedToken,
        description: createDto.description,
        validUntil: validUntil,
        roles: apiKeyRoles,
        organization_id: organizationId,
        created_by: userId,
        updated_by: userId,
      } as ApiKey);

      if (!apiKey) {
        throw new DatabaseException('Failed to create API key');
      }

      // Cache the newly created API key for immediate use
      await this.apiKeyCacheService.cacheKey(apiKey);

      this.auditService.logCreate(apiKey as unknown as OwnedResource);

      this.logger.log(`API key created for description: ${createDto.description} with roles: ${apiKeyRoles.join(', ') || 'none'} by user: ${userId}`);

      return { apiKey, token };
    } catch (error) {
      // Don't log expected validation/conflict errors as service-level failures.
      if (error instanceof ConflictException || error instanceof ForbiddenException) {
        throw error;
      }
      // Defense in depth for the rare race where two concurrent creates both
      // pass the pre-check: translate the unique-index violation into 409.
      if (this.isUniqueDescriptionViolation(error)) {
        throw new ConflictException(
          `An API key with description "${createDto.description}" already exists in this organization.`,
        );
      }
      this.logger.error('Failed to create API key:', error);
      throw error;
    }
  }

  /**
   * Pg unique_violation (SQLSTATE 23505) on the composite description index.
   * TypeORM normally hoists pg's `code`/`constraint` onto the QueryFailedError
   * itself, but some driver/version combos surface them only on the wrapped
   * `driverError`. Check both shapes so the race-translation never silently
   * falls through to a 500.
   */
  private isUniqueDescriptionViolation(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const top = error as { code?: string; constraint?: string; driverError?: { code?: string; constraint?: string } };
    const code = top.code ?? top.driverError?.code;
    const constraint = top.constraint ?? top.driverError?.constraint;
    return (
      code === '23505' &&
      (constraint === 'api_keys_organization_id_description_key' ||
        constraint === 'api_keys_description_key')
    );
  }

  private isExpired(validUntil: Date | null | undefined): boolean {
    return !!validUntil && new Date(validUntil) <= new Date();
  }

  /**
   * Delete an API key
   *
   * Authorization: caller must have `Capability.ApiKeyDelete` for the key's
   * organization. Legacy keys (null organization_id) are deletable only by
   * global admins.
   */
  async deleteApiKey(id: string, userId: string, roles: string[]): Promise<void> {
    try {
      const apiKey = await this.apiKeyRepository.findById(id);
      if (!apiKey) {
        throw new ResourceNotFoundException('API key', id);
      }

      const caps = await this.authzService.getCapabilities(userId, roles, apiKey.organization_id);
      if (!caps.includes(Capability.ApiKeyDelete)) {
        throw new ForbiddenException(
          'Organization admin privileges required to delete API keys in this organization',
        );
      }

      // Invalidate before AND after the delete. Before, so no new request can
      // warm a cache off the soon-to-be-dead row; after, because a request that
      // authenticated concurrently with this one can re-populate both caches in
      // the window between the first invalidation and the commit —
      // validateApiKey serves from the description cache with no existence
      // re-check, so a purely-before invalidation can leave a deleted key
      // working for a full API_KEY_CACHE_TTL_SECONDS.
      await this.apiKeyCacheService.invalidateKey(apiKey.description);
      await this.apiKeyCacheService.invalidateAllValidationResults();
      // AuthorizationService caches org/team membership under the api-key:<id>
      // principal for AUTH_CACHE_TTL_SECONDS.
      await this.authzService.invalidateUserCache(`api-key:${id}`);

      this.auditService.logDelete(apiKey as unknown as OwnedResource);
      await this.apiKeyRepository.delete(id);

      await this.apiKeyCacheService.invalidateKey(apiKey.description);
      await this.apiKeyCacheService.invalidateAllValidationResults();
      await this.authzService.invalidateUserCache(`api-key:${id}`);
      this.logger.log(`[deleteApiKey] API key ${id} deleted by user: ${userId}`);
    } catch (error) {
      if (
        error instanceof ResourceNotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      this.logger.error('Failed to delete API key:', error);
      throw error;
    }
  }

  /**
   * Validate API key with intelligent caching
   *
   * Performance Optimization Strategy:
   * 1. Check validation result cache (fastest - avoids bcrypt comparison)
   * 2. Decode token and extract description
   * 3. Check API key cache by description (fast - single Redis GET)
   * 4. If cache miss, query database by description only (targeted query)
   * 5. Cache both the API key and validation result for future requests
   *
   * Performance Impact:
   * - Before: O(n) database query loading ALL API keys
   * - After: O(1) Redis GET or single targeted DB query
   * - Expected cache hit rate: >95% in production
   */
  async validateApiKey(token: string): Promise<ApiKey | null> {
    try {
      // Quick check: if token contains dots, it's likely a JWT token, not our API key format
      if (token.includes('.') || token.length < 20) {
        return null;
      }

      // Step 1: Check validation result cache first (fastest path)
      const cachedValidationResult = await this.apiKeyCacheService.getCachedValidationResult(token);
      if (cachedValidationResult === false) {
        // Token was previously validated and found invalid - no need to check again
        this.logger.debug('Validation result cache HIT: invalid token');
        return null;
      }

      let description: string;

      try {
        // Decode base64 token and extract description
        const decoded = Buffer.from(token, 'base64').toString('utf-8');
        const parts = decoded.split('#');
        description = parts[0] || '';

        // Additional validation: description should be readable text (printable ASCII/UTF-8)
        // Check for minimum length and that it contains only valid characters
        const hasInvalidChars = !description || description.length < 3 || !/^[\t\n\r\x20-\x7E-￿]+$/.test(description);
        if (hasInvalidChars) {
          return null;
        }
      } catch (decodeError) {
        return null;
      }

      // Step 2: Check API key cache by description.
      // NB: cache is keyed by description only, but descriptions are now unique
      // PER ORGANIZATION (not globally — see migration 1777100000000). When two
      // orgs share a description, the cache will hold whichever key got cached
      // first; that key's bcrypt hash will not match the other org's token. We
      // treat the cached key as a hint, not a verdict: if it doesn't match, we
      // fall through to a full DB scan over every candidate with that
      // description and bcrypt-compare each one.
      const cachedCandidate = await this.apiKeyCacheService.getCachedKey(description);
      let apiKeyDoc: ApiKey | null = null;

      if (cachedCandidate && this.isExpired(cachedCandidate.validUntil)) {
        // Cached key is expired — ignore it and let DB scan find a fresh one.
      } else if (cachedCandidate && (await bcrypt.compare(token, cachedCandidate.apiKey))) {
        apiKeyDoc = cachedCandidate;
      }

      // Step 3: If cached key did not match, scan the DB for every key with
      // this description and bcrypt-compare each. Picking only the first row
      // (the pre-RBAC behaviour) is now incorrect because descriptions can
      // legitimately collide across organizations.
      if (!apiKeyDoc) {
        const candidates = (await this.apiKeyRepository.searchByDescription(description))
          .filter(key => key.description === description);

        for (const candidate of candidates) {
          if (this.isExpired(candidate.validUntil)) continue;
          if (await bcrypt.compare(token, candidate.apiKey)) {
            apiKeyDoc = candidate;
            // Cache the matching key. If a later validation for a different
            // org's same-description key wins the cache slot, this one will
            // re-resolve via the DB scan above — slower but correct.
            await this.apiKeyCacheService.cacheKey(apiKeyDoc);
            break;
          }
        }
      }

      if (!apiKeyDoc) {
        // No candidate matched — likely an expired key or a JWT misrouted here.
        await this.apiKeyCacheService.cacheValidationResult(token, false, 300);
        return null;
      }

      // bcrypt already passed in either the cache or DB-scan branch above.
      // Cache the positive result and buffer the last_used update — the flusher
      // writes it in a single batch every 30 s, keeping the hot row lock-free.
      await this.apiKeyCacheService.cacheValidationResult(token, true);
      this.lastUsedFlusher.record(apiKeyDoc.id);
      return apiKeyDoc;
    } catch (error) {
      this.logger.error('Error validating API key:', error);
      return null;
    }
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats() {
    return this.apiKeyCacheService.getCacheStats();
  }

  /**
   * Clear all API key caches (for maintenance/troubleshooting)
   */
  async clearCaches(): Promise<void> {
    await this.apiKeyCacheService.clearAllCaches();
    this.logger.log('All API key caches cleared');
  }

  /**
   * Warm cache with frequently used API keys
   * This can be called during application startup
   */
  async warmCaches(): Promise<void> {
    try {
      // Get recently used API keys (last 30 days)
      const recentKeys = await this.apiKeyRepository.findRecentlyCreated(30);

      if (recentKeys.length > 0) {
        await this.apiKeyCacheService.warmCache(recentKeys);
        this.logger.log(`Cache warmed with ${recentKeys.length} recently used API keys`);
      }
    } catch (error) {
      this.logger.error(`Failed to warm caches: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
    }
  }

  /**
   * Validate that requested API key roles are a subset of the creator's roles.
   * Prevents privilege escalation (e.g., org-admin creating a perfana-admin key).
   *
   * Global admins bypass this check (they can assign any role). The bypass is
   * computed by the caller via the capability layer (`isGlobalAdminUser`) and
   * passed in as a flag — this method stays synchronous and trivially testable.
   */
  private validateRequestedRoles(
    requestedRoles: string[],
    creatorRoles: string[],
    isGlobalAdmin: boolean,
  ): void {
    if (!requestedRoles || requestedRoles.length === 0) return;
    if (isGlobalAdmin) return;

    const safeCreatorRoles = creatorRoles ?? [];
    const disallowed = requestedRoles.filter(r => !safeCreatorRoles.includes(r));
    if (disallowed.length > 0) {
      throw new ValidationException(
        `Cannot assign roles you do not have: ${disallowed.join(', ')}`
      );
    }
  }

  private parseTtl(ttl: string): Date {
    const ttlPattern = /^(\d+)([dwMy])$/;
    const match = ttl.match(ttlPattern);

    if (!match) {
      throw new ValidationException(`Invalid TTL format: ${ttl}. Expected format: number + unit (d/w/M/y)`);
    }

    const [, numberStr, unit] = match;
    const number = parseInt(numberStr || '0', 10);
    const date = new Date();

    switch (unit) {
      case 'd': // days
        date.setDate(date.getDate() + number);
        break;
      case 'w': // weeks
        date.setDate(date.getDate() + (number * 7));
        break;
      case 'M': // months
        date.setMonth(date.getMonth() + number);
        break;
      case 'y': // years
        date.setFullYear(date.getFullYear() + number);
        break;
      default:
        throw new Error(`Invalid TTL unit: ${unit}`);
    }

    return date;
  }
}
