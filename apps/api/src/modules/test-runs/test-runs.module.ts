import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  TestRunsController,
  TestRunsAnalysisController,
  TestRunsDataSourcesController,
  TestRunsMetricsTransactionController,
  TestRunsMetricsApdexController,
  TestRunsComparisonController,
  TestRunsDashboardController,
  TestRunsErrorsController,
  TestController,
  ConfigController,
  InitController,
  JtlUploadController,
} from './controllers';
import { TestRunsService } from './test-runs.service';
import { TestRunsQueryService } from './services/test-runs-query.service';
import { TestRunsMapperService } from './services/test-runs-mapper.service';
import { TestRunsCrudQueryService } from './services/test-runs-crud-query.service';
import { TestRunsDashboardQueryService } from './services/test-runs-dashboard-query.service';
import { TestRunsPerformanceQueryService } from './services/test-runs-performance-query.service';
import { TestRunsTimeSeriesQueryService } from './services/test-runs-timeseries-query.service';
import { TestRunsMutationService } from './services/test-runs-mutation.service';
import { TestRunsConfigService } from './services/test-runs-config.service';
import { TestRunsAnomalyService } from './services/test-runs-anomaly.service';
import { TestRunsChangepointService } from './services/test-runs-changepoint.service';
import { TestRunsMetricsService } from './services/test-runs-metrics.service';
import { TestRunsApdexService } from './services/test-runs-apdex.service';
import { TestRunsBaselineApdexService } from './services/test-runs-baseline-apdex.service';
import { TestRunsStaleDetectionService } from './services/test-runs-stale-detection.service';
import { TestRunsStaleDetectionSchedulerService } from './services/test-runs-stale-detection-scheduler.service';
import { TestRunsErrorAnalysisService } from './services/test-runs-error-analysis.service';
import { TestRunsDataSourcesService } from './services/test-runs-data-sources.service';
import { CreateTestRunHandler } from './handlers/create-test-run.handler';
import { UpdateTestRunHandler } from './handlers/update-test-run.handler';
import { DeleteTestRunHandler } from './handlers/delete-test-run.handler';
import { UpdateTagsHandler } from './handlers/update-tags.handler';
import { UpdateAnnotationsHandler } from './handlers/update-annotations.handler';
import { UpdateAdaptConfigHandler } from './handlers/update-adapt-config.handler';
import { InitTestHandler } from './handlers/init-test.handler';
import { TestRunLookupService } from './services/test-run-lookup.service';
import { JtlParserService } from './services/jtl-parser.service';
import { JtlImportService } from './services/jtl-import.service';
import { SystemsUnderTestModule } from '../systems-under-test/systems-under-test.module';
import { DataScienceModule } from '../data-science/data-science.module';
import { QueueModule } from '../queue/queue.module';
import { TestRunsGateway } from './gateways/test-runs.gateway';
import { WebSocketAuthGuard } from './guards/websocket-auth.guard';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { CommonModule } from '../../common/common.module';
import {
  TestRun,
  TestRunConfiguration,
  SystemUnderTest,
  DsChangePoints,
  DsControlGroups,
  ExpectedConfigChange,
  Organization,
  Team,
  DsAdaptResults,
  DsAdaptTrackedResults,
  DsAdaptConclusion,
  DsCompareConfig,
  ProvisionedTemplateDsCompareConfig,
  DsMetricStatistics,
  DsMetrics,
  DsPanels,
  DsControlGroupStatistics,
  DynatraceQuery,
  ApplicationDashboard,
  TestRunView,
  SparseMetricExclusion,
  TracingService,
  TracingInstance,
  PyroscopeInstance,
  MetricsSource,
  DynatraceConfig,
  GrafanaInstance,
} from '../../entities';
import {
  TestRunRepository,
  TestRunConfigurationRepository
} from '../../repositories';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TestRun,
      TestRunConfiguration,
      SystemUnderTest,
      DsChangePoints,
      DsControlGroups,
      ExpectedConfigChange,
      Organization,
      Team,
      DsAdaptResults,
      DsAdaptTrackedResults,
      DsAdaptConclusion,
      DsCompareConfig,
      ProvisionedTemplateDsCompareConfig,
      DsMetricStatistics,
      DsMetrics,
      DsPanels,
      DsControlGroupStatistics,
      DynatraceQuery,
      ApplicationDashboard,
      TestRunView,
      SparseMetricExclusion,
      // Entities required by TestRunsDataSourcesService
      TracingService,
      TracingInstance,
      PyroscopeInstance,
      MetricsSource,
      DynatraceConfig,
      GrafanaInstance,
    ]),
    SystemsUnderTestModule,
    DataScienceModule,
    QueueModule,
    ApiKeysModule, // Required for WebSocket authentication
    CommonModule, // Provides AuthorizationService for RBAC
  ],
  controllers: [
    // Specific routes MUST come before parameterized routes
    // TestRunsController has @Get(':testRunId') which matches anything
    TestRunsAnalysisController,
    TestRunsDataSourcesController,
    TestRunsMetricsTransactionController,
    TestRunsMetricsApdexController,
    TestRunsComparisonController,
    TestRunsDashboardController,
    TestRunsErrorsController,
    TestController,
    ConfigController,
    InitController,
    JtlUploadController,
    TestRunsController, // LAST - has @Get(':testRunId') catch-all route
  ],
  providers: [
    TestRunsService,
    // Query services (refactored from TestRunsQueryService)
    TestRunsMapperService,
    TestRunsCrudQueryService,
    TestRunsDashboardQueryService,
    TestRunsPerformanceQueryService,
    TestRunsTimeSeriesQueryService,
    TestRunsQueryService, // Facade that delegates to sub-services
    // Command handlers
    CreateTestRunHandler,
    UpdateTestRunHandler,
    DeleteTestRunHandler,
    UpdateTagsHandler,
    UpdateAnnotationsHandler,
    UpdateAdaptConfigHandler,
    InitTestHandler,
    // Helper services
    TestRunLookupService,
    JtlParserService,
    JtlImportService,
    // Other services
    TestRunsMutationService,
    TestRunsConfigService,
    TestRunsAnomalyService,
    TestRunsChangepointService,
    TestRunsMetricsService,
    TestRunsApdexService,
    TestRunsBaselineApdexService,
    TestRunsStaleDetectionService,
    TestRunsStaleDetectionSchedulerService,
    TestRunsErrorAnalysisService,
    TestRunsDataSourcesService,
    TestRunRepository,
    TestRunConfigurationRepository,
    TestRunsGateway, // WebSocket gateway for realtime updates
    WebSocketAuthGuard, // Authentication guard for WebSocket connections
  ],
  exports: [
    TestRunsService,
    TestRunsQueryService, // Export for use in RealtimeService
    TestRunsMutationService, // Export for use in RealtimeService
    TestRunsConfigService, // Export for use in DynatraceModule
    TestRunRepository,
    TestRunConfigurationRepository,
    TestRunsGateway, // Export for use in other modules if needed
  ],
})
export class TestRunsModule {}