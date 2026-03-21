import { Injectable, Inject } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import IORedis from 'ioredis';

// Define the storage record interface locally since it's not exported in v6
interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Redis-backed storage for @nestjs/throttler using ioredis
 *
 * This implementation provides distributed rate limiting across multiple
 * API instances by storing rate limit counters in Redis.
 *
 * @see https://github.com/nestjs/throttler
 */
@Injectable()
export class ThrottlerStorageRedisService implements ThrottlerStorage {
  private scriptSha: string | null = null;

  // Lua script for atomic increment with TTL
  private readonly incrWithTtlScript = `
    local key = KEYS[1]
    local ttl = tonumber(ARGV[1])
    local current = redis.call('incr', key)
    if current == 1 then
      redis.call('expire', key, ttl)
    end
    local remaining_ttl = redis.call('ttl', key)
    return {current, remaining_ttl}
  `;

  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redis: IORedis,
  ) {}

  /**
   * Load the Lua script into Redis
   * This is called automatically on first use
   */
  private async loadScript(): Promise<string> {
    if (!this.scriptSha) {
      const sha = await this.redis.script('LOAD', this.incrWithTtlScript) as string;
      this.scriptSha = sha;
    }
    return this.scriptSha;
  }

  /**
   * Increment the counter for a given key
   * Returns the storage record with hit count and TTL information
   *
   * @param key - The throttle key (includes IP, route, etc.)
   * @param ttl - Time to live in seconds
   * @param limit - Maximum number of requests allowed
   * @param blockDuration - Duration to block after exceeding limit (seconds)
   * @param throttlerName - Name of the throttler configuration
   * @returns ThrottlerStorageRecord with hit count and expiry info
   */
  async increment(
    key: string,
    ttl: number,
    limit: number,
    _blockDuration: number,
    _throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    try {
      // Use atomic Lua script for increment + TTL
      const sha = await this.loadScript();

      try {
        const result = await this.redis.evalsha(sha, 1, key, ttl) as [number, number];
        const totalHits = result[0];
        const remainingTtl = result[1];

        return {
          totalHits,
          timeToExpire: remainingTtl * 1000, // Convert to milliseconds
          isBlocked: totalHits > limit,
          timeToBlockExpire: remainingTtl * 1000,
        };
      } catch (error) {
        // If script not found (Redis restart), reload and retry
        if (error && typeof error === 'object' && 'message' in error &&
            (error as Error).message.includes('NOSCRIPT')) {
          this.scriptSha = null;
          const newSha = await this.loadScript();
          const result = await this.redis.evalsha(newSha, 1, key, ttl) as [number, number];
          const totalHits = result[0];
          const remainingTtl = result[1];

          return {
            totalHits,
            timeToExpire: remainingTtl * 1000,
            isBlocked: totalHits > limit,
            timeToBlockExpire: remainingTtl * 1000,
          };
        }
        throw error;
      }
    } catch (error) {
      // Fallback to basic commands if Lua script fails
      const multi = this.redis.multi();
      multi.incr(key);
      multi.ttl(key);

      const results = await multi.exec();

      if (!results) {
        throw new Error('Redis multi command failed');
      }

      const count = (results[0]?.[1] as number) || 0;
      const currentTtl = (results[1]?.[1] as number) || -1;

      // Set TTL only if key doesn't have one
      if (currentTtl === -1) {
        await this.redis.expire(key, ttl);
      }

      return {
        totalHits: count,
        timeToExpire: (currentTtl > 0 ? currentTtl : ttl) * 1000,
        isBlocked: count > limit,
        timeToBlockExpire: (currentTtl > 0 ? currentTtl : ttl) * 1000,
      };
    }
  }

  /**
   * Reset/delete a throttle key
   * Used for testing or manual resets
   *
   * @param key - The throttle key to reset
   */
  async reset(key: string): Promise<void> {
    await this.redis.del(key);
  }

  /**
   * Get the current count for a key without incrementing
   *
   * @param key - The throttle key
   * @returns Current hit count or 0 if key doesn't exist
   */
  async get(key: string): Promise<number> {
    const value = await this.redis.get(key);
    return value ? parseInt(value, 10) : 0;
  }

  /**
   * Get the TTL (time to live) for a key
   *
   * @param key - The throttle key
   * @returns Remaining TTL in seconds, or -1 if key doesn't exist
   */
  async getTtl(key: string): Promise<number> {
    return await this.redis.ttl(key);
  }
}
