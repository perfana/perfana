import Redis from 'ioredis';

/**
 * Redis connection configuration
 */
export interface RedisConfig {
  url: string;
  password?: string;
}

/**
 * Create a Redis connection with standard configuration
 */
export function createRedisConnection(config: RedisConfig): Redis {
  return new Redis(config.url, {
    password: config.password,
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
    lazyConnect: false,
  });
}

/**
 * Create a Redis connection for subscribing (separate from publisher)
 * Redis pub/sub requires separate connections for publishing and subscribing
 */
export function createRedisSubscriber(config: RedisConfig): Redis {
  return new Redis(config.url, {
    password: config.password,
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
    lazyConnect: false,
  });
}
