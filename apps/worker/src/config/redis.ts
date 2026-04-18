import Redis, { RedisOptions } from 'ioredis';
import { getConfig } from './environment.js';
import { getLogger } from '../lib/utils/logger.js';

const logger = getLogger('redis-config');

export interface RedisConfiguration extends RedisOptions {
  host: string;
  port: number;
  password?: string;
  db: number;
  retryDelayOnFailover: number;
  maxRetriesPerRequest: number | null;
  lazyConnect: boolean;
  keepAlive: number;
  family: number;
  maxLoadingTimeout?: number;
}

export function createRedisConfig(): RedisConfiguration {
  const config = getConfig();

  return {
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD,
    db: config.REDIS_DB,
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: null,
    lazyConnect: true,
    keepAlive: 30000,
    family: 4, // IPv4
    // Connection timeout
    connectTimeout: 10000,
    // Command timeout - disabled for BullMQ polling operations
    commandTimeout: undefined,
    // Health check - disabled for BullMQ compatibility
    enableReadyCheck: false,
    maxLoadingTimeout: 5000,
  };
}

export function createRedisConnection(): Redis {
  const config = createRedisConfig();
  const redis = new Redis(config);

  // Handle Redis events
  redis.on('connect', () => {
    logger.info('🔗 Redis connected');
  });

  redis.on('ready', () => {
    logger.info('✅ Redis ready');
  });

  redis.on('error', (error: any) => {
    const err = error as any;
    // Filter out command timeout errors from BullMQ polling - these are normal behavior
    if (err.message?.includes('Command timed out')) {
      logger.debug('Redis command timeout during BullMQ polling (normal behavior)', {
        message: err.message
      });
      return;
    }

    // Log other Redis errors normally
    logger.error('❌ Redis error:', {
      message: err.message,
      code: err.code,
      errno: err.errno,
      syscall: err.syscall,
      address: err.address,
      port: err.port
    });
  });

  redis.on('close', () => {
    logger.warn('🔌 Redis connection closed');
  });

  redis.on('reconnecting', (time: number) => {
    logger.info(`🔄 Redis reconnecting in ${time}ms`);
  });

  redis.on('end', () => {
    logger.info('🛑 Redis connection ended');
  });

  return redis;
}

export async function testRedisConnection(redis: Redis): Promise<boolean> {
  try {
    // For lazy connections, ensure we're connected first
    if (redis.status === 'wait') {
      await redis.connect();
    }

    // Test basic Redis functionality
    const pong = await redis.ping();
    if (pong !== 'PONG') {
      throw new Error('Redis ping failed');
    }

    // Test set/get operations
    const testKey = 'test-connection';
    const testValue = new Date().toISOString();

    await redis.set(testKey, testValue, 'EX', 10); // Expire in 10 seconds
    const retrievedValue = await redis.get(testKey);

    if (retrievedValue !== testValue) {
      throw new Error('Redis set/get test failed');
    }

    // Clean up test key
    await redis.del(testKey);

    logger.info('✅ Redis connection test successful');
    return true;
  } catch (error) {
    logger.error('❌ Redis connection test failed:', error);
    return false;
  }
}

export function getRedisConnectionString(): string {
  const config = getConfig();

  // Use REDIS_URL if provided, otherwise construct from individual parts
  if (config.REDIS_URL && config.REDIS_URL !== 'redis://localhost:6379') {
    return config.REDIS_URL;
  }

  const auth = config.REDIS_PASSWORD ? `:${config.REDIS_PASSWORD}@` : '';
  return `redis://${auth}${config.REDIS_HOST}:${config.REDIS_PORT}/${config.REDIS_DB}`;
}