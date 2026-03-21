/**
 * Redis Connection Pool Manager
 * CRITICAL FIX: Prevents Redis connection exhaustion from individual worker connections
 */

import Redis from 'ioredis';
import { createRedisConfig, type RedisConfiguration } from './redis.js';
import { getLogger } from '../lib/utils/logger.js';

const logger = getLogger('redis-pool');

export interface RedisPoolOptions {
  maxConnections: number;
  minConnections: number;
  idleTimeoutMs: number;
  acquireTimeoutMs: number;
  enableHealthCheck: boolean;
}

export interface PoolStats {
  total: number;
  available: number;
  acquired: number;
  pending: number;
  created: number;
  destroyed: number;
  healthChecksFailed: number;
  lastHealthCheck: Date | null;
}

/**
 * Redis Connection Pool Implementation
 */
export class RedisConnectionPool {
  private static instance: RedisConnectionPool | null = null;

  private config: RedisConfiguration;
  private options: RedisPoolOptions;
  private pool: Redis[] = [];
  private acquired: Set<Redis> = new Set();
  private pending: Array<{ resolve: (conn: Redis) => void; reject: (error: Error) => void }> = [];
  private stats: PoolStats;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private destroyed = false;

  private constructor(options: Partial<RedisPoolOptions> = {}) {
    this.config = createRedisConfig();
    this.options = {
      maxConnections: options.maxConnections || 20, // Reduced from unlimited
      minConnections: options.minConnections || 5,
      idleTimeoutMs: options.idleTimeoutMs || 300000, // 5 minutes
      acquireTimeoutMs: options.acquireTimeoutMs || 10000, // 10 seconds
      enableHealthCheck: options.enableHealthCheck ?? true
    };

    this.stats = {
      total: 0,
      available: 0,
      acquired: 0,
      pending: 0,
      created: 0,
      destroyed: 0,
      healthChecksFailed: 0,
      lastHealthCheck: null
    };

    logger.info('🔗 Redis connection pool initialized', {
      maxConnections: this.options.maxConnections,
      minConnections: this.options.minConnections
    });

    this.initializePool();
  }

  /**
   * Get singleton pool instance
   */
  public static getInstance(options?: Partial<RedisPoolOptions>): RedisConnectionPool {
    if (!RedisConnectionPool.instance) {
      RedisConnectionPool.instance = new RedisConnectionPool(options);
    }
    return RedisConnectionPool.instance;
  }

  /**
   * Initialize minimum connections
   */
  private async initializePool(): Promise<void> {
    try {
      const initialConnections = Math.min(this.options.minConnections, this.options.maxConnections);

      for (let i = 0; i < initialConnections; i++) {
        const connection = await this.createConnection();
        this.pool.push(connection);
      }

      if (this.options.enableHealthCheck) {
        this.startHealthCheck();
      }

      logger.info(`✅ Redis pool initialized with ${this.pool.length} connections`);
    } catch (error) {
      logger.error('❌ Failed to initialize Redis pool:', error);
      throw error;
    }
  }

  /**
   * Create a new Redis connection
   */
  private async createConnection(): Promise<Redis> {
    try {
      // CRITICAL: Use minimal BullMQ-compatible configuration
      // DO NOT include extra options like commandTimeout, connectTimeout, keepAlive, family, etc.
      // These interfere with BullMQ's blocking mode (BRPOPLPUSH)
      const connection = new Redis({
        host: this.config.host,
        port: this.config.port,
        password: this.config.password || undefined,
        db: this.config.db,
        maxRetriesPerRequest: null,   // Required for BullMQ
        enableReadyCheck: false,      // Recommended for BullMQ
        lazyConnect: false            // Connect immediately for pool
      });

      // Set up connection event handlers
      connection.on('error', (error) => {
        logger.warn('Redis pool connection error:', {
          connectionId: this.getConnectionId(connection),
          error: error.message
        });
        this.handleConnectionError(connection);
      });

      connection.on('end', () => {
        logger.debug('Redis pool connection ended');
        this.removeConnection(connection);
      });

      // Wait for connection to be ready
      await connection.ping();

      this.stats.created++;
      this.stats.total++;

      logger.debug('✅ New Redis connection created for pool', {
        connectionId: this.getConnectionId(connection),
        totalConnections: this.stats.total
      });

      return connection;
    } catch (error) {
      logger.error('❌ Failed to create Redis connection:', error);
      throw error;
    }
  }

  /**
   * Acquire a connection from the pool
   */
  public async acquire(): Promise<Redis> {
    if (this.destroyed) {
      throw new Error('Redis pool has been destroyed');
    }

    return new Promise((resolve, reject) => {
      // Try to get an available connection immediately
      const connection = this.pool.pop();

      if (connection) {
        this.acquired.add(connection);
        this.updateStats();

        logger.debug('🔗 Redis connection acquired from pool', {
          connectionId: this.getConnectionId(connection),
          availableConnections: this.pool.length
        });

        resolve(connection);
        return;
      }

      // No available connections - check if we can create more
      if (this.stats.total < this.options.maxConnections) {
        this.createConnection()
          .then(newConnection => {
            this.acquired.add(newConnection);
            this.updateStats();
            resolve(newConnection);
          })
          .catch(reject);
        return;
      }

      // Pool is at capacity - queue the request
      this.pending.push({ resolve, reject });
      this.updateStats();

      // Set timeout for acquire
      setTimeout(() => {
        const index = this.pending.findIndex(p => p.resolve === resolve);
        if (index >= 0) {
          this.pending.splice(index, 1);
          reject(new Error(`Redis connection acquire timeout after ${this.options.acquireTimeoutMs}ms`));
        }
      }, this.options.acquireTimeoutMs);

      logger.debug('⏳ Redis connection request queued', {
        pendingRequests: this.pending.length,
        totalConnections: this.stats.total
      });
    });
  }

  /**
   * Release a connection back to the pool
   */
  public release(connection: Redis): void {
    if (this.destroyed) {
      this.destroyConnection(connection);
      return;
    }

    if (!this.acquired.has(connection)) {
      logger.warn('⚠️ Attempting to release connection not acquired from pool');
      return;
    }

    this.acquired.delete(connection);

    // Check if connection is still healthy
    if (connection.status !== 'ready') {
      logger.warn('🔄 Replacing unhealthy connection in pool');
      this.destroyConnection(connection);
      this.createConnection()
        .then(newConnection => this.pool.push(newConnection))
        .catch(error => logger.error('Failed to replace connection:', error));
      return;
    }

    // Serve any pending requests first
    const pending = this.pending.shift();
    if (pending) {
      this.acquired.add(connection);
      pending.resolve(connection);
      logger.debug('📦 Redis connection served to pending request');
    } else {
      // Return to pool
      this.pool.push(connection);
      logger.debug('🔄 Redis connection returned to pool', {
        connectionId: this.getConnectionId(connection),
        availableConnections: this.pool.length
      });
    }

    this.updateStats();
  }

  /**
   * Get current pool statistics
   */
  public getStats(): PoolStats {
    this.updateStats();
    return { ...this.stats };
  }

  /**
   * Update pool statistics
   */
  private updateStats(): void {
    this.stats.available = this.pool.length;
    this.stats.acquired = this.acquired.size;
    this.stats.pending = this.pending.length;
  }

  /**
   * Start health check interval
   */
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, 60000); // Check every minute
  }

  /**
   * Perform health check on all connections
   */
  private async performHealthCheck(): Promise<void> {
    this.stats.lastHealthCheck = new Date();

    logger.debug('🔍 Performing Redis pool health check');

    const healthCheckPromises = this.pool.map(async (connection) => {
      try {
        await connection.ping();
        return { connection, healthy: true };
      } catch (error) {
        logger.warn('❌ Unhealthy connection detected in pool');
        this.stats.healthChecksFailed++;
        return { connection, healthy: false };
      }
    });

    const results = await Promise.allSettled(healthCheckPromises);

    // Remove unhealthy connections
    results.forEach((result, _index) => {
      if (result.status === 'fulfilled' && !result.value.healthy) {
        const connection = result.value.connection;
        this.removeConnection(connection);
        this.destroyConnection(connection);

        // Replace with new connection
        this.createConnection()
          .then(newConnection => this.pool.push(newConnection))
          .catch(error => logger.error('Failed to replace unhealthy connection:', error));
      }
    });
  }

  /**
   * Handle connection errors
   */
  private handleConnectionError(connection: Redis): void {
    if (this.acquired.has(connection)) {
      logger.warn('⚠️ Acquired connection experienced error - will be replaced on release');
    } else {
      this.removeConnection(connection);
      this.destroyConnection(connection);
    }
  }

  /**
   * Remove connection from pool
   */
  private removeConnection(connection: Redis): void {
    const index = this.pool.indexOf(connection);
    if (index >= 0) {
      this.pool.splice(index, 1);
      this.stats.total--;
    }
  }

  /**
   * Destroy a connection
   */
  private destroyConnection(connection: Redis): void {
    try {
      connection.disconnect();
      this.stats.destroyed++;

      logger.debug('🔥 Redis connection destroyed', {
        connectionId: this.getConnectionId(connection)
      });
    } catch (error) {
      logger.warn('Error destroying Redis connection:', error);
    }
  }

  /**
   * Get connection identifier for logging
   */
  private getConnectionId(connection: Redis): string {
    return `${connection.options.host}:${connection.options.port}:${Date.now()}`;
  }

  /**
   * Destroy the entire pool
   */
  public async destroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Reject all pending requests
    this.pending.forEach(({ reject }) => {
      reject(new Error('Redis pool is being destroyed'));
    });
    this.pending.length = 0;

    // Close all connections
    const allConnections = [...this.pool, ...this.acquired];

    await Promise.allSettled(
      allConnections.map(async (connection) => {
        try {
          await connection.quit();
        } catch (error) {
          logger.warn('Error during graceful connection close:', error);
          connection.disconnect();
        }
      })
    );

    this.pool.length = 0;
    this.acquired.clear();

    RedisConnectionPool.instance = null;

    logger.info('🔥 Redis connection pool destroyed');
  }
}

/**
 * Convenience functions for external use
 */
export function getRedisPool(options?: Partial<RedisPoolOptions>): RedisConnectionPool {
  return RedisConnectionPool.getInstance(options);
}

export async function acquireRedisConnection(): Promise<Redis> {
  const pool = getRedisPool();
  return pool.acquire();
}

export function releaseRedisConnection(connection: Redis): void {
  const pool = getRedisPool();
  pool.release(connection);
}

export function getRedisPoolStats(): PoolStats {
  const pool = getRedisPool();
  return pool.getStats();
}