import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CommonModule } from '../common/common.module.js';
import { IncrementalCollectionScheduler } from './IncrementalCollectionScheduler.js';
import { AuditRetentionManager } from './AuditRetentionManager.js';

/**
 * Schedulers Module
 *
 * Provides scheduled tasks for the worker application.
 * Currently includes:
 * - IncrementalCollectionScheduler: Polls for in-progress test runs and triggers incremental metric collection
 * - AuditRetentionManager: deletes audit_logs rows past AUDIT_RETENTION_MONTHS,
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
    AuditRetentionManager,
  ],
  exports: [
    IncrementalCollectionScheduler,
    AuditRetentionManager,
  ],
})
export class SchedulersModule {}
