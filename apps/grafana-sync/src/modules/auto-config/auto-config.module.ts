import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AutoConfigService } from './auto-config.service';
import { AutoConfigFindersService } from './auto-config-finders.service';
import { AutoConfigUpdatesService } from './auto-config-updates.service';
import { TestRunFinderService } from './test-run-finder.service';
import { DashboardFinderService as LegacyDashboardFinderService } from './dashboard-finder.service';
import { DashboardConfiguratorService } from './dashboard-configurator.service';
import { BenchmarkProcessorService } from './benchmark-processor.service';
import { VariableDiscoveryService } from './variable-discovery.service';
import { VariableDetectorService } from './variable-detector.service';
import { VariableMatcherService } from './variable-matcher.service';
import { GrafanaApiModule } from '../grafana-api/grafana-api.module';
import {
  DashboardCreatorService,
  ApplicationDashboardCreatorService,
  DashboardFinderService,
  DashboardStorageService,
  DashboardVariableHelperService,
  DashboardProcessorService,
} from './services';
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
  ],
  providers: [
    AutoConfigService,
    AutoConfigFindersService,
    AutoConfigUpdatesService,
    TestRunFinderService,
    LegacyDashboardFinderService,
    DashboardConfiguratorService,
    BenchmarkProcessorService,
    VariableDiscoveryService,
    VariableDetectorService,
    VariableMatcherService,
    // New extracted services
    DashboardCreatorService,
    ApplicationDashboardCreatorService,
    DashboardFinderService,
    DashboardStorageService,
    DashboardVariableHelperService,
    DashboardProcessorService,
  ],
  exports: [AutoConfigService],
})
export class AutoConfigModule {}
