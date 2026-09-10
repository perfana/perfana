import { Global, Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';

/**
 * Provides the shared Redis client. Despite the name, this module no longer owns a
 * queue: it used to also create a BullMQ `perfana-jobs` queue and a `QueueService`
 * wrapper, whose sole producer was stale detection. Nothing in the monorepo ever
 * consumed that queue (#584), so jobs accumulated in it forever. Analysis is enqueued
 * through BullMQClientService onto `perfana-analyze`, which the worker actually reads.
 *
 * Every other importer of this module wants REDIS_CLIENT, not a queue.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: (configService: ConfigService) => {
        const logger = new Logger('RedisFactory');
        const redisUrl = configService.get('REDIS_URL', 'redis://localhost:6379');

        logger.log('Initializing Redis client...');
        logger.log(`Redis URL: ${redisUrl.replace(/:\/\/[^@]*@/, '://***@')}`);

        const redis = new IORedis(redisUrl, {
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          lazyConnect: true,
        });

        redis.on('connect', () => {
          logger.log('Redis connected successfully');
        });

        redis.on('error', (error) => {
          logger.error('Redis connection error:', error);
        });

        return redis;
      },
      inject: [ConfigService],
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class QueueModule {}