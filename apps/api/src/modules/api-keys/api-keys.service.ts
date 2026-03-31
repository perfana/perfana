import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { In } from 'typeorm';
import { ResourceNotFoundException, ValidationException, DatabaseException } from '../../common/exceptions/business.exception';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { ApiKeyRepository } from '../../repositories/api-key.repository';
import { ApiKey } from '../../entities';
import { ApiKeyCacheService } from './api-key-cache.service';
import { AuthorizationService } from '../../common/services/authorization.service';

/**
 * Service responsible for managing API keys.
 *
 * Authorization:
 * - All methods accept userId and roles parameters for authorization
 * - Currently ApiKey entity does not have organization_id, so all data is treated as legacy
 * - When organization_id is added to ApiKey (Phase 4), authorization checks will be enabled
 * - Global admins bypass all authorization checks
 */
@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);
  private readonly saltRounds = 10;

  constructor(
    private readonly apiKeyRepository: ApiKeyRepository,
    private readonly apiKeyCacheService: ApiKeyCacheService,
    private readonly authzService: AuthorizationService,
  ) {}

  /**
   * Check if user is org-admin in any of their organizations
   * @throws Error if user is not an org-admin
   */
  private async requireOrgAdmin(userId: string, roles: string[]): Promise<void> {
    // Global admins always have access
    if (this.authzService.isGlobalAdmin(roles)) {
      return;
    }

    // Check if user is org-admin in any organization
    const isOrgAdmin = await this.authzService.isOrgAdminInAnyOrganization(userId);
    if (!isOrgAdmin) {
      throw new ForbiddenException('Organization admin privileges required to manage API keys');
    }
  }

  /**
   * Find all API keys
   *
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: ApiKey entity does not have organization_id yet, so org filtering is not applied.
   * Full org filtering will be enabled when Phase 4 adds organization_id column.
   */
  async findAll(userId: string, roles: string[], organizationId?: string): Promise<ApiKey[]> {
    const isAdmin = this.authzService.isGlobalAdmin(roles);
    this.logger.log(`[findAll] START - userId=${userId}, isGlobalAdmin=${isAdmin}, organizationId=${organizationId}`);

    // Resolve which org IDs to filter by
    let orgIds: string[];
    if (organizationId) {
      // Explicit org selected — always filter, even for admins
      orgIds = [organizationId];
    } else if (isAdmin) {
      // Admin without explicit org — no filter, see all
      const apiKeys = await this.apiKeyRepository.findAll({
        order: { createdAt: 'DESC' }
      });
      this.logger.log(`[findAll] ADMIN PATH (all orgs) - Returning ${apiKeys.length} API keys`);
      return apiKeys;
    } else {
      // Non-admin without explicit org — filter by accessible orgs
      orgIds = await this.authzService.getAccessibleOrganizations(userId);
    }

    if (orgIds.length === 0) {
      this.logger.log(`[findAll] User has no organizations - returning empty array`);
      return [];
    }

    const apiKeys = await this.apiKeyRepository.findAll({
      where: {
        organization_id: In(orgIds)
      },
      order: { createdAt: 'DESC' }
    });

    this.logger.log(`[findAll] FILTERED RESULT - Returning ${apiKeys.length} API keys (orgs: ${orgIds.join(',')})`);
    return apiKeys;
  }

  /**
   * Find a single API key by ID
   *
   * @param id - The API key ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: ApiKey entity does not have organization_id yet, so access checks are not applied.
   * Full access permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async findOne(id: string, userId: string, roles: string[]): Promise<ApiKey> {
    try {
      // Log authorization context for debugging
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.log(`[findOne] START - id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      const apiKey = await this.apiKeyRepository.findById(id);

      if (!apiKey) {
        throw new ResourceNotFoundException('API key', id);
      }

      // Check organization access for non-admin users
      if (!isAdmin) {
        // If API key has no organization (legacy data), only admins can access
        if (!apiKey.organization_id) {
          this.logger.warn(`[findOne] Access denied: user ${userId} attempted to access API key ${id} with NULL organization_id`);
          throw new ResourceNotFoundException('API key', id);
        }

        // Check if user is member of the API key's organization
        const isMember = await this.authzService.isOrganizationMember(userId, apiKey.organization_id);
        if (!isMember) {
          this.logger.warn(`[findOne] Access denied: user ${userId} attempted to access API key ${id} in organization ${apiKey.organization_id}`);
          throw new ResourceNotFoundException('API key', id);
        }
      }

      this.logger.log(`[findOne] Access granted for API key ${id}`);
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
   * @param createDto - The API key creation DTO
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   * @param organizationId - The organization ID to associate with the API key
   */
  async createApiKey(
    createDto: CreateApiKeyDto,
    userId: string,
    roles: string[],
    organizationId: string,
  ): Promise<{ apiKey: ApiKey; token: string }> {
    try {
      // Log authorization context for debugging
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.debug(`createApiKey: userId=${userId}, isGlobalAdmin=${isAdmin}`);

      // Check if user is org-admin in any organization
      await this.requireOrgAdmin(userId, roles);

      const uuid = uuidv4();

      // Create token in format: base64(description#uuid)
      const token = Buffer.from(`${createDto.description}#${uuid}`).toString('base64');

      // Parse TTL (e.g., "30d", "1w", "6M", "1y")
      const validUntil = this.parseTtl(createDto.ttl);

      // Hash the token
      const hashedToken = await bcrypt.hash(token, this.saltRounds);

      // Prevent privilege escalation: validate requested roles against creator's roles
      this.validateRequestedRoles(createDto.roles || [], roles);

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

      this.logger.log(`API key created for description: ${createDto.description} with roles: ${apiKeyRoles.join(', ') || 'none'} by user: ${userId}`);

      return { apiKey, token };
    } catch (error) {
      this.logger.error('Failed to create API key:', error);
      throw error;
    }
  }

  /**
   * Delete an API key
   *
   * @param id - The API key ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   */
  async deleteApiKey(id: string, userId: string, roles: string[]): Promise<void> {
    try {
      // Log authorization context for debugging
      const isAdmin = this.authzService.isGlobalAdmin(roles);
      this.logger.log(`[deleteApiKey] START - id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      // Check if user is org-admin in any organization
      await this.requireOrgAdmin(userId, roles);

      // Check if it exists first
      const apiKey = await this.apiKeyRepository.findById(id);
      if (!apiKey) {
        throw new ResourceNotFoundException('API key', id);
      }

      // Verify user has admin access to the key's organization (not just any org)
      if (!this.authzService.isGlobalAdmin(roles) && apiKey.organization_id) {
        const userOrgs = await this.authzService.getAccessibleOrganizations(userId);
        if (!userOrgs.includes(apiKey.organization_id)) {
          throw new ValidationException('Cannot delete API key from an organization you do not belong to');
        }
      }

      // Invalidate cache before deletion
      await this.apiKeyCacheService.invalidateKey(apiKey.description);
      await this.apiKeyCacheService.invalidateAllValidationResults();

      await this.apiKeyRepository.delete(id);
      this.logger.log(`[deleteApiKey] API key ${id} deleted successfully by user: ${userId}`);
    } catch (error) {
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
        const hasInvalidChars = !description || description.length < 3 || !/^[\t\n\r\x20-\x7E\u0080-\uFFFF]+$/.test(description);
        if (hasInvalidChars) {
          return null;
        }
      } catch (decodeError) {
        return null;
      }

      // Step 2: Check API key cache by description
      let apiKeyDoc = await this.apiKeyCacheService.getCachedKey(description);

      // Step 3: If cache miss, query database with targeted query (not all keys!)
      if (!apiKeyDoc) {
        apiKeyDoc = await this.apiKeyRepository.searchByDescription(description)
          .then(keys => keys.find(key => key.description === description) || null);

        if (!apiKeyDoc) {
          // Don't log as error - this is expected when JWT tokens are passed to this method
          // Cache the negative result to avoid repeated lookups
          await this.apiKeyCacheService.cacheValidationResult(token, false, 300); // Cache for 5 minutes
          return null;
        }

        // Cache the API key for future requests
        await this.apiKeyCacheService.cacheKey(apiKeyDoc);
      }

      // Step 4: Check if key is expired
      if (apiKeyDoc.validUntil && new Date(apiKeyDoc.validUntil) <= new Date()) {
        this.logger.error(`API key expired for description: ${description}`);
        // Cache the negative result
        await this.apiKeyCacheService.cacheValidationResult(token, false, 300);
        return null;
      }

      // Step 5: Compare hashed token (expensive bcrypt operation)
      const isValid = await bcrypt.compare(token, apiKeyDoc.apiKey);

      // Step 6: Cache validation result
      if (isValid) {
        // Cache positive validation result
        await this.apiKeyCacheService.cacheValidationResult(token, true);

        // Update last_used timestamp (non-blocking)
        this.updateLastUsed(apiKeyDoc.id).catch(err => {
          this.logger.warn(`Failed to update last_used: ${err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Unknown error'}`);
        });

        return apiKeyDoc;
      } else {
        // Cache negative validation result
        await this.apiKeyCacheService.cacheValidationResult(token, false, 300);
      }

      return null;
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

  private async updateLastUsed(id: string): Promise<void> {
    try {
      await this.apiKeyRepository.updateLastUsed(id);
    } catch (error) {
      this.logger.warn('Failed to update last_used timestamp:', error);
      // Don't throw error as this is not critical
    }
  }

  /**
   * Validate that requested API key roles are a subset of the creator's roles.
   * Prevents privilege escalation (e.g., org-admin creating a perfana-admin key).
   */
  private validateRequestedRoles(requestedRoles: string[], creatorRoles: string[]): void {
    if (!requestedRoles || requestedRoles.length === 0) return;

    // Global admins can assign any role
    if (this.authzService.isGlobalAdmin(creatorRoles)) return;

    const disallowed = requestedRoles.filter(r => !creatorRoles.includes(r));
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
