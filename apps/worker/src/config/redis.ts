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