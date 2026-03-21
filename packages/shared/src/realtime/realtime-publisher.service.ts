import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { TestRun } from '../entities/index.js';

/**
 * RealtimePublisherService - Publishes test run events to Redis
 *
 * This service is used by both the API and worker to publish realtime updates.
 * The API also subscribes to these Redis channels to broadcast via Socket.IO.
 *
 * Architecture:
 *   Worker Pipeline → RealtimePublisherService.triggerTestRunUpdated()
 *                  → Redis Publish (test_run:updated channel)
 *                  → API RealtimeService subscribes
 *                  → Socket.IO broadcasts to frontend clients
 *                  → Frontend UI updates instantly
 *
 * Note: Uses camelCase format (TypeORM entities) for consistency across the stack
 */
@Injectable()
export class RealtimePublisherService {
  private readonly logger = new Logger(RealtimePublisherService.name);
  private redis: Redis;

  constructor(redisUrl: string, redisPassword?: string) {
    this.redis = new Redis(redisUrl, {
      password: redisPassword,
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
      lazyConnect: false,
    });

    this.redis.on('connect', () => {
      this.logger.log('Connected to Redis for realtime publishing');
    });

    this.redis.on('error', (error) => {
      this.logger.error('Redis error:', error);
    });
  }

  /**
   * Trigger a test run created event
   * Publishes to Redis channel that API subscribes to
   */
  async triggerTestRunCreated(testRun: TestRun): Promise<void> {
    try {
      await this.redis.publish('test_run:created', JSON.stringify(testRun));
      this.logger.debug(`Published test_run:created for ${testRun.testRunId}`);
    } catch (error) {
      this.logger.error('Failed to publish test run creation:', error);
      // Don't throw - realtime updates should not break worker operations
    }
  }

  /**
   * Trigger a test run updated event
   * Publishes to Redis channel that API subscribes to
   */
  async triggerTestRunUpdated(testRun: TestRun): Promise<void> {
    try {
      await this.redis.publish('test_run:updated', JSON.stringify(testRun));
      this.logger.debug(`Published test_run:updated for ${testRun.testRunId}`);
    } catch (error) {
      this.logger.error('Failed to publish test run update:', error);
      // Don't throw - realtime updates should not break worker operations
    }
  }

  /**
   * Trigger a test run deleted event
   */
  async triggerTestRunDeleted(testRunId: string): Promise<void> {
    try {
      await this.redis.publish('test_run:deleted', JSON.stringify({ testRunId }));
      this.logger.debug(`Published test_run:deleted for ${testRunId}`);
    } catch (error) {
      this.logger.error('Failed to publish test run deletion:', error);
      // Don't throw - realtime updates should not break worker operations
    }
  }

  /**
   * Cleanup on shutdown
   */
  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.logger.log('Redis connection closed');
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch (error) {
      this.logger.error('Health check failed:', error);
      return false;
    }
  }
}
