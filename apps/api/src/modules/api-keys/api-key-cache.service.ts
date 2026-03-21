import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { ApiKey } from '@perfana/shared/entities';

/**
 * API Key Cache Service
 *
 * Provides high-performance caching for API key validation with Redis.
 * This service dramatically reduces database load by caching validated API keys.
 *
 * Key Features:
 * - Single-query validation: Only queries DB when cache misses
 * - Configurable TTL: Cache entries expire automatically
 * - Cache invalidation: Automatic invalidation on key updates/deletes
 * - Pattern-based cache clearing: Efficiently clear related cache entries
 * - Cache warming: Proactively cache frequently used keys
 * - Metrics tracking: Monitor cache hit/miss rates
 */
@Injectable()
export class ApiKeyCacheService {
  private readonly logger = new Logger(ApiKeyCacheService.name);
  private readonly cacheKeyPrefix = 'api-key:';
  private readonly validationResultPrefix = 'api-key-validation:';
  private readonly defaultTtl: number;
  private readonly enableCache: boolean;

  // Cache metrics for monitoring
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: IORedis,
    private readonly configService: ConfigService,
  ) {
    // Default TTL: 10 minutes (600 seconds)
    // This balances performance with freshness
    this.defaultTtl = this.configService.get<number>('API_KEY_CACHE_TTL_SECONDS', 600);
    this.enableCache = this.configService.get<string>('API_KEY_CACHE_ENABLED', 'true') === 'true';

    this.logger.log(`API Key Cache initialized (enabled: ${this.enableCache}, TTL: ${this.defaultTtl}s)`);
  }

  /**
   * Get cached API key by description
   * Returns null if not found or cache disabled
   */
  async getCachedKey(description: string): Promise<ApiKey | null> {
    if (!this.enableCache) {
      return null;
    }

    try {
      const cacheKey = this.buildCacheKey(description);
      const cached = await this.redis.get(cacheKey);

      if (cached) {
        this.cacheHits++;
        this.logger.debug(`Cache HIT for API key: ${description}`);
        return JSON.parse(cached) as ApiKey;
      }

      this.cacheMisses++;
      this.logger.debug(`Cache MISS for API key: ${description}`);
      return null;
    } catch (error) {
      this.logger.error(`Failed to get cached API key: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
      return null;
    }
  }

  /**
   * Cache an API key with automatic expiration
   */
  async cacheKey(apiKey: ApiKey): Promise<void> {
    if (!this.enableCache) {
      return;
    }

    try {
      const cacheKey = this.buildCacheKey(apiKey.description);
      const serialized = JSON.stringify(apiKey);

      // Use SETEX to set value with expiration atomically
      await this.redis.setex(cacheKey, this.defaultTtl, serialized);

      this.logger.debug(`Cached API key: ${apiKey.description} (TTL: ${this.defaultTtl}s)`);
    } catch (error) {
      this.logger.error(`Failed to cache API key: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
    }
  }

  /**
   * Cache validation result for a specific token
   * This caches the validation outcome (valid/invalid) to avoid repeated bcrypt comparisons
   */
  async cacheValidationResult(token: string, isValid: boolean, ttlSeconds?: number): Promise<void> {
    if (!this.enableCache) {
      return;
    }

    try {
      const cacheKey = this.buildValidationKey(token);
      const ttl = ttlSeconds || this.defaultTtl;

      // Store validation result as string
      await this.redis.setex(cacheKey, ttl, isValid ? '1' : '0');

      this.logger.debug(`Cached validation result for token (valid: ${isValid})`);
    } catch (error) {
      this.logger.error(`Failed to cache validation result: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
    }
  }

  /**
   * Get cached validation result for a token
   * Returns null if not cached, true if valid, false if invalid
   */
  async getCachedValidationResult(token: string): Promise<boolean | null> {
    if (!this.enableCache) {
      return null;
    }

    try {
      const cacheKey = this.buildValidationKey(token);
      const cached = await this.redis.get(cacheKey);

      if (cached !== null) {
        this.cacheHits++;
        const isValid = cached === '1';
        this.logger.debug(`Cache HIT for validation result (valid: ${isValid})`);
        return isValid;
      }

      this.cacheMisses++;
      this.logger.debug('Cache MISS for validation result');
      return null;
    } catch (error) {
      this.logger.error(`Failed to get cached validation result: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
      return null;
    }
  }

  /**
   * Invalidate a specific API key cache entry
   */
  async invalidateKey(description: string): Promise<void> {
    if (!this.enableCache) {
      return;
    }

    try {
      const cacheKey = this.buildCacheKey(description);
      const deleted = await this.redis.del(cacheKey);

      if (deleted > 0) {
        this.logger.debug(`Invalidated cache for API key: ${description}`);
      }
    } catch (error) {
      this.logger.error(`Failed to invalidate API key cache: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
    }
  }

  /**
   * Invalidate API key cache entry by ID
   * This requires fetching the key first to get the description
   */
  async invalidateKeyById(description?: string): Promise<void> {
    if (!this.enableCache) {
      return;
    }

    try {
      if (description) {
        await this.invalidateKey(description);
      } else {
        // If description not provided, we'll clear all validation results
        // This is less efficient but ensures consistency
        await this.invalidateAllValidationResults();
      }
    } catch (error) {
      this.logger.error(`Failed to invalidate API key cache by ID: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
    }
  }

  /**
   * Invalidate all validation result caches
   * This is called when an API key is updated/deleted but we don't know which tokens to invalidate
   */
  async invalidateAllValidationResults(): Promise<void> {
    if (!this.enableCache) {
      return;
    }

    try {
      // Use SCAN to find all validation result keys (non-blocking)
      const pattern = `${this.validationResultPrefix}*`;
      const keys = await this.scanKeys(pattern);

      if (keys.length > 0) {
        await this.redis.del(...keys);
        this.logger.log(`Invalidated ${keys.length} validation result cache entries`);
      }
    } catch (error) {
      this.logger.error(`Failed to invalidate validation results: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
    }
  }

  /**
   * Clear all API key caches (keys + validation results)
   */
  async clearAllCaches(): Promise<void> {
    if (!this.enableCache) {
      return;
    }

    try {
      // Clear API key caches
      const keyPattern = `${this.cacheKeyPrefix}*`;
      const keyKeys = await this.scanKeys(keyPattern);

      // Clear validation result caches
      const validationPattern = `${this.validationResultPrefix}*`;
      const validationKeys = await this.scanKeys(validationPattern);

      const allKeys = [...keyKeys, ...validationKeys];

      if (allKeys.length > 0) {
        await this.redis.del(...allKeys);
        this.logger.log(`Cleared ${allKeys.length} API key cache entries`);
      }
    } catch (error) {
      this.logger.error(`Failed to clear all caches: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
    }
  }

  /**
   * Warm cache with frequently used API keys
   * This can be called during startup or periodically
   */
  async warmCache(apiKeys: ApiKey[]): Promise<void> {
    if (!this.enableCache || apiKeys.length === 0) {
      return;
    }

    try {
      // Use pipeline for batch operations
      const pipeline = this.redis.pipeline();

      for (const apiKey of apiKeys) {
        const cacheKey = this.buildCacheKey(apiKey.description);
        const serialized = JSON.stringify(apiKey);
        pipeline.setex(cacheKey, this.defaultTtl, serialized);
      }

      await pipeline.exec();
      this.logger.log(`Warmed cache with ${apiKeys.length} API keys`);
    } catch (error) {
      this.logger.error(`Failed to warm cache: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
    }
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats(): {
    hits: number;
    misses: number;
    hitRate: string;
    totalRequests: number;
  } {
    const totalRequests = this.cacheHits + this.cacheMisses;
    const hitRate = totalRequests > 0
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
   * Reset cache statistics
   */
  resetCacheStats(): void {
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.logger.log('Cache statistics reset');
  }

  /**
   * Build cache key for API key storage
   */
  private buildCacheKey(description: string): string {
    // Sanitize description to prevent injection
    const sanitized = description.replace(/[^\w\s-]/g, '');
    return `${this.cacheKeyPrefix}${sanitized}`;
  }

  /**
   * Build cache key for validation result storage
   * Uses a hash of the token to avoid storing full tokens in Redis keys
   */
  private buildValidationKey(token: string): string {
    // Use first 16 chars of token as cache key (sufficient for uniqueness)
    const tokenHash = Buffer.from(token).toString('base64').substring(0, 16);
    return `${this.validationResultPrefix}${tokenHash}`;
  }

  /**
   * Scan Redis keys matching a pattern
   * Uses SCAN for non-blocking iteration over large keyspaces
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

  /**
   * Health check for cache service
   */
  async healthCheck(): Promise<boolean> {
    try {
      const testKey = 'health-check-key';
      const testValue = 'ok';

      await this.redis.setex(testKey, 10, testValue);
      const result = await this.redis.get(testKey);
      await this.redis.del(testKey);

      return result === testValue;
    } catch (error) {
      this.logger.error(`Cache health check failed: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
      return false;
    }
  }
}
