import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../../common/common.module';

// Entities
import { AwrReport, AwrAnalysis } from './entities';
import { TestRun } from '../../entities';

// Controllers
import { AwrReportsController } from './controllers';

// Services
import {
  AwrReportsService,
  AwrParserService,
  AwrAnalysisService,
  AwrComparisonService,
} from './services';

// Comparison services
import {
  ComparisonDataFetcherService,
  ComparisonExecutorService,
  SqlComparisonBuilderService,
  WaitEventComparisonBuilderService,
  LoadProfileComparisonBuilderService,
  ComparisonResultPersisterService,
  ComparisonSummaryBuilderService,
} from './services/comparison';

/**
 * AWR (Automatic Workload Repository) Module
 *
 * Provides functionality for uploading, parsing, analyzing, and comparing
 * Oracle AWR reports. Supports HTML format reports with extraction of:
 * - Load profile metrics
 * - Top SQL statements
 * - Wait events analysis
 * - Resource utilization patterns
 *
 * Key features:
 * - Strategy pattern for extensible section parsers
 * - Configurable analysis thresholds
 * - Baseline comparison for regression detection
 * - Async parsing support via status tracking
 *
 * @example
 * // Import in AppModule
 * @Module({
 *   imports: [AwrModule],
 * })
 * export class AppModule {}
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AwrReport,
      AwrAnalysis,
      TestRun,
    ]),
    CommonModule, // Provides AuthorizationService for RBAC
  ],
  controllers: [
    AwrReportsController,
  ],
  providers: [
    // CRUD service for AWR reports
    AwrReportsService,
    // HTML parsing orchestration service
    AwrParserService,
    // Analysis orchestration with multiple analyzers
    AwrAnalysisService,
    // Baseline comparison orchestration service
    AwrComparisonService,
    // Comparison specialized services
    ComparisonDataFetcherService,
    ComparisonExecutorService,
    SqlComparisonBuilderService,
    WaitEventComparisonBuilderService,
    LoadProfileComparisonBuilderService,
    ComparisonResultPersisterService,
    ComparisonSummaryBuilderService,
  ],
  exports: [
    // Export services for use in other modules (e.g., worker, queue processors)
    AwrReportsService,
    AwrParserService,
    AwrAnalysisService,
    AwrComparisonService,
  ],
})
export class AwrModule {}
