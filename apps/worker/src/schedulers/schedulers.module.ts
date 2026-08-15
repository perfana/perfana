import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CommonModule } from '../common/common.module.js';
import { IncrementalCollectionScheduler } from './IncrementalCollectionScheduler.js';
import { AuditPartitionManager } from './AuditPartitionManager.js';

/**
 * Schedulers Module
 *
 * Provides scheduled tasks for the worker application.
 * Currently includes:
 * - IncrementalCollectionScheduler: Polls for in-progress test runs and triggers incremental metric collection
 * - AuditPartitionManager: Look-ahead partition creation + expired partition drop for audit_logs,
 *   on boot and daily
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
    AuditPartitionManager,
  ],
  exports: [
    IncrementalCollectionScheduler,
    AuditPartitionManager,
  ],
})
export class SchedulersModule {}
