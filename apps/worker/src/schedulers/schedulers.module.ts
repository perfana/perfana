import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CommonModule } from '../common/common.module.js';
import { IncrementalCollectionScheduler } from './IncrementalCollectionScheduler.js';

/**
 * Schedulers Module
 *
 * Provides scheduled tasks for the worker application.
 * Currently includes:
 * - IncrementalCollectionScheduler: Polls for in-progress test runs and triggers incremental metric collection
 *
 * Uses @nestjs/schedule for cron-based scheduling.
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    CommonModule, // Provides WorkerDatabaseService
  ],
  providers: [
    IncrementalCollectionScheduler,
  ],
  exports: [
    IncrementalCollectionScheduler,
  ],
})
export class SchedulersModule {}
