import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AutoConfigService } from './auto-config.service';
import { AutoConfigUpdatesService } from './auto-config-updates.service';
import { TestRunFinderService } from './test-run-finder.service';
import { DashboardFinderService } from './dashboard-finder.service';
import { DashboardConfiguratorService } from './dashboard-configurator.service';
import { BenchmarkProcessorService } from './benchmark-processor.service';
import { VariableDiscoveryService } from './variable-discovery.service';
import { VariableDetectorService } from './variable-detector.service';
import { VariableMatcherService } from './variable-matcher.service';
import { GrafanaApiModule } from '../grafana-api/grafana-api.module';
import { AuditModule } from '../audit/audit.module';
import { DashboardProcessorService } from './services';
import {
  TestRun,
  ApplicationDashboard,
  Benchmark,
  GrafanaDashboard,
  GrafanaInstance,
  Profile,
  ProfileGrafanaDashboard,
  ProfileBenchmark,
  SystemUnderTest,
} from '@perfana/shared/entities';

/**
 * AutoConfigModule
 *
 * Handles automatic dashboard configuration for test runs.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      TestRun,
      ApplicationDashboard,
      Benchmark,
      GrafanaDashboard,
      GrafanaInstance,
      Profile,
      ProfileGrafanaDashboard,
      ProfileBenchmark,
      SystemUnderTest,
    ]),
    GrafanaApiModule,
    AuditModule,
  ],
  providers: [
    AutoConfigService,
    AutoConfigUpdatesService,
    TestRunFinderService,
    DashboardFinderService,
    DashboardConfiguratorService,
    BenchmarkProcessorService,
    VariableDiscoveryService,
    VariableDetectorService,
    VariableMatcherService,
    DashboardProcessorService,
  ],
  exports: [AutoConfigService],
})
export class AutoConfigModule {}
