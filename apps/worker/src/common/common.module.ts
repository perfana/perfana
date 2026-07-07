import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkerDatabaseService } from './database.service.js';
import {
  TestRun,
  ApplicationDashboard,
  GrafanaInstance,
  GrafanaDashboard,
  MetricsSource,
  Benchmark,
  DsMetrics,
  DsPanels,
  DsMetricStatistics,
  DsMetricCollectionStatus,
  DsAdaptResults,
  DsAdaptConclusion,
  DsControlGroups,
  DsControlGroupStatistics,
  DynatraceConfig,
  DynatraceQuery,
  DynatraceEntityMapping,
  SystemUnderTest,
  Team,
  Organization,
  ApiKey,
  TestRunConfiguration,
  PyroscopeInstance,
  ProxyServer,
} from '@perfana/shared/entities';

/**
 * Common Module
 *
 * Provides database services and repositories to all worker modules/pipelines.
 * Follows the exact same pattern as the API's CommonModule.
 */
@Module({
  imports: [
    // Register all entities that the worker needs access to
    // IMPORTANT: Entity order matters for relations - referenced entities must come first
    TypeOrmModule.forFeature([
      // Foundation entities (no dependencies)
      Team,
      Organization,
      ApiKey,
      PyroscopeInstance,

      // Core entities (depend on foundation entities)
      SystemUnderTest, // depends on Team, PyroscopeInstance
      TestRun, // depends on SystemUnderTest
      TestRunConfiguration,

      // Dashboard & Grafana entities
      GrafanaInstance,
      GrafanaDashboard,
      MetricsSource,
      ApplicationDashboard,

      // Benchmark entities
      Benchmark,

      // Data Science entities
      DsMetrics,
      DsPanels,
      DsMetricStatistics,
      DsMetricCollectionStatus,
      DsAdaptResults,
      DsAdaptConclusion,
      DsControlGroups,
      DsControlGroupStatistics,

      // Dynatrace entities
      DynatraceConfig,
      DynatraceQuery,
      DynatraceEntityMapping,

      // Proxy configuration
      ProxyServer,
    ]),
  ],
  providers: [WorkerDatabaseService],
  exports: [WorkerDatabaseService, TypeOrmModule],
})
export class CommonModule {}
