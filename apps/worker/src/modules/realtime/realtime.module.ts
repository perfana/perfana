import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RealtimePublisherService } from '@perfana/shared/realtime';

/**
 * Realtime Module for Worker
 *
 * Provides RealtimePublisherService as a singleton for publishing updates to Redis.
 * Worker pipelines can inject this service to trigger realtime updates.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: RealtimePublisherService,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // Construct Redis URL from REDIS_HOST and REDIS_PORT (set in docker-compose)
        // Fallback to REDIS_URL if provided and not localhost
        const redisUrlEnv = configService.get<string>('REDIS_URL', 'redis://127.0.0.1:6379');
        const redisHost = configService.get<string>('REDIS_HOST', '127.0.0.1');
        const redisPort = configService.get<number>('REDIS_PORT', 6379);

        const redisUrl = redisUrlEnv !== 'redis://127.0.0.1:6379'
          ? redisUrlEnv
          : `redis://${redisHost}:${redisPort}`;

        const redisPassword = configService.get<string>('REDIS_PASSWORD');
        return new RealtimePublisherService(redisUrl, redisPassword);
      },
    },
  ],
  exports: [RealtimePublisherService],
})
export class RealtimeModule {}
