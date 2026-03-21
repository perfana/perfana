import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import IORedis from 'ioredis';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  private redis: IORedis | null = null;

  constructor(private readonly configService: ConfigService) {
    super();
    this.initializeRedis();
  }

  private initializeRedis() {
    const redisHost = this.configService.get('REDIS_HOST', 'localhost');
    const redisPort = this.configService.get('REDIS_PORT', 6379);
    const redisUrl = `redis://${redisHost}:${redisPort}`;

    this.redis = new IORedis(redisUrl, {
      maxRetriesPerRequest: 3,
      connectTimeout: 5000,
      lazyConnect: true,
    });
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      if (!this.redis) {
        throw new Error('Redis client not initialized');
      }

      // Try to connect if not connected
      if (this.redis.status !== 'ready' && this.redis.status !== 'connect') {
        await this.redis.connect();
      }

      // Ping Redis
      const result = await this.redis.ping();

      if (result === 'PONG') {
        return this.getStatus(key, true);
      }

      throw new Error('Redis ping failed');
    } catch (error) {
      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error';

      throw new HealthCheckError(
        'Redis health check failed',
        this.getStatus(key, false, { message: errorMessage }),
      );
    }
  }
}
