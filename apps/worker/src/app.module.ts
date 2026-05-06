import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from './common/common.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { SchedulersModule } from './schedulers/schedulers.module.js';
import { createTypeOrmConfig, createWriteTypeOrmConfig } from './config/typeorm.config.js';
import { createSystemDataSource } from '@perfana/shared/database/data-source-system';

/**
 * Root Application Module for Worker
 *
 * Configures NestJS application with:
 * - Global configuration (environment variables)
 * - TypeORM database connection
 * - Common module with database services
 * - Realtime module for publishing updates to Redis
 * - Schedulers module for scheduled tasks (incremental collection)
 *
 * This allows worker pipelines to use dependency injection and TypeORM
 * while maintaining the existing BullMQ-based worker architecture.
 */
@Module({
  imports: [
    // Global configuration module
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      // The worker uses its own environment.ts config system
      // This makes env vars available via @nestjs/config as well
    }),

    // TypeORM database connection (analytics/read — main pool)
    TypeOrmModule.forRootAsync({
      useFactory: () => createTypeOrmConfig(),
      dataSourceFactory: async (opts) => {
        if (!opts) {
          throw new Error('worker: typeorm options missing');
        }
        return createSystemDataSource('worker', opts);
      },
    }),

    // Dedicated write connection pool — small, never starved by analytical queries
    // See: 2026-03-26 write starvation post-mortem
    //
    // `name: 'write'` MUST be at the OUTER forRootAsync level — that is what
    // @nestjs/typeorm reads to register the named provider token that
    // `@InjectDataSource('write')` in WorkerDatabaseService resolves against.
    // The `name: 'write'` returned by `createWriteTypeOrmConfig()` is read by
    // typeorm's DataSource constructor, but does NOT bubble up to NestJS's
    // provider registry. PR #261 migrated this from `forRoot()` (which read
    // the inner name) to `forRootAsync()` (which doesn't), silently breaking
    // worker DI until the next rebuild.
    TypeOrmModule.forRootAsync({
      name: 'write',
      useFactory: () => createWriteTypeOrmConfig(),
      dataSourceFactory: async (opts) => {
        if (!opts) {
          throw new Error('worker: typeorm write options missing');
        }
        return createSystemDataSource('worker', opts);
      },
    }),

    // Common module with database services and repositories
    CommonModule,

    // Realtime module for publishing updates to Redis
    RealtimeModule,

    // Schedulers module for scheduled tasks
    SchedulersModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
