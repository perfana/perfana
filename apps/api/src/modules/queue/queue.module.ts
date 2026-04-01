import { Global, Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { QueueService } from './queue.service';

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
    {
      provide: 'BULL_QUEUE',
      useFactory: (redis: IORedis) => {
        const logger = new Logger('BullMQFactory');
        logger.log('Initializing BullMQ queue...');

        const queue = new Queue('perfana-jobs', {
          connection: redis,
          defaultJobOptions: {
            removeOnComplete: 100,
            removeOnFail: 50,
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
          },
        });

        logger.log('BullMQ queue initialized successfully');
        return queue;
      },
      inject: ['REDIS_CLIENT'],
    },
    QueueService,
  ],
  exports: ['REDIS_CLIENT', 'BULL_QUEUE', QueueService],
})
export class QueueModule {}