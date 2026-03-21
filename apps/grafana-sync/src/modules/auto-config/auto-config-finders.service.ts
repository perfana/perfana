/**
 * Copyright 2025 Perfana Contributors
 *
 * AutoConfigFindersService
 *
 * Facade service that delegates to specialized finder services.
 * Re-exports all interfaces for backward compatibility.
 *
 * Split into:
 * - TestRunFinderService: Test runs, profiles, benchmarks
 * - DashboardFinderService: Grafana and application dashboards
 */

import { Injectable, Logger } from '@nestjs/common';
import { Profile, Benchmark, ApplicationDashboard } from '@perfana/shared/entities';
import {
  TestRunFinderService,
  MappedTestRun,
  MappedProfileBenchmark,
} from './test-run-finder.service';
import {
  DashboardFinderService,
  MappedAutoConfigDashboard,
  MappedGrafanaDashboard,
  MappedGrafanaConfig,
} from './dashboard-finder.service';

// Re-export all interfaces for backward compatibility
export { MappedTestRun, MappedProfileBenchmark } from './test-run-finder.service';
export {
  MappedAutoConfigDashboard,
  MappedGrafanaDashboard,
  MappedGrafanaConfig,
} from './dashboard-finder.service';

@Injectable()
export class AutoConfigFindersService {
  private readonly logger = new Logger(AutoConfigFindersService.name);

  constructor(
    private readonly testRunFinder: TestRunFinderService,
    private readonly dashboardFinder: DashboardFinderService,
  ) {}

  // ============================================
  // Test Run Finder Methods (delegated)
  // ============================================

  /**
   * Find recent test runs based on end time
   */
  async findRecentTestRuns(startTime: Date): Promise<MappedTestRun[]> {
    return this.testRunFinder.findRecentTestRuns(startTime);
  }

  /**
   * Find all profiles
   */
  async findProfiles(): Promise<Profile[]> {
    return this.testRunFinder.findProfiles();
  }

  /**
   * Find all profile benchmarks from profile_benchmarks table
   */
  async findProfileBenchmarks(): Promise<MappedProfileBenchmark[]> {
    return this.testRunFinder.findProfileBenchmarks();
  }

  /**
   * Find all generic deep links - TEMPORARILY DISABLED
   */
  async findGenericDeepLinks(): Promise<any[]> {
    return this.testRunFinder.findGenericDeepLinks();
  }

  /**
   * Find all generic report panels - TEMPORARILY DISABLED
   */
  async findGenericReportPanels(): Promise<any[]> {
    return this.testRunFinder.findGenericReportPanels();
  }

  /**
   * Find benchmark for application dashboard and profile benchmark
   */
  async findBenchmarkForApplicationDashboardOrNull(
    applicationDashboard: ApplicationDashboard,
    profileBenchmarkId: string,
    workload: string,
  ): Promise<Benchmark | null> {
    return this.testRunFinder.findBenchmarkForApplicationDashboardOrNull(
      applicationDashboard,
      profileBenchmarkId,
      workload,
    );
  }

  /**
   * Find deep link for test run - TEMPORARILY DISABLED
   */
  async findDeepLinkForTestRunOrNull(
    genericDeepLink: any,
    testRun: MappedTestRun,
  ): Promise<any | null> {
    return this.testRunFinder.findDeepLinkForTestRunOrNull(genericDeepLink, testRun);
  }

  // ============================================
  // Dashboard Finder Methods (delegated)
  // ============================================

  /**
   * Find all auto config grafana dashboards
   */
  async findAutoConfigGrafanaDashboards(): Promise<MappedAutoConfigDashboard[]> {
    return this.dashboardFinder.findAutoConfigGrafanaDashboards();
  }

  /**
   * Find grafana dashboard by grafana instance and dashboard UIDs (returns null if not found)
   */
  async findGrafanaDashboardOrNull(
    grafana: string,
    dashboardUids: string[],
  ): Promise<MappedGrafanaDashboard | null> {
    return this.dashboardFinder.findGrafanaDashboardOrNull(grafana, dashboardUids);
  }

  /**
   * Find grafana dashboard (throws if not found)
   */
  async findGrafanaDashboard(
    grafana: string,
    dashboardUids: string[],
  ): Promise<MappedGrafanaDashboard> {
    return this.dashboardFinder.findGrafanaDashboard(grafana, dashboardUids);
  }

  /**
   * Find application dashboards for system under test
   */
  async findApplicationDashboardsForSystemUnderTest(
    testRun: MappedTestRun,
    grafana: string,
    dashboardUid: string,
    dashboardLabel: string | null = null,
  ): Promise<ApplicationDashboard[]> {
    return this.dashboardFinder.findApplicationDashboardsForSystemUnderTest(
      testRun,
      grafana,
      dashboardUid,
      dashboardLabel,
    );
  }

  /**
   * Find existing grafana dashboards by grafana instance and UIDs
   */
  async findExistingGrafanaDashboards(
    grafana: string,
    dashboardUids: string[],
  ): Promise<MappedGrafanaDashboard[]> {
    return this.dashboardFinder.findExistingGrafanaDashboards(grafana, dashboardUids);
  }

  /**
   * Find grafana configuration by label
   */
  async findGrafanaConfiguration(grafana: string): Promise<MappedGrafanaConfig | null> {
    return this.dashboardFinder.findGrafanaConfiguration(grafana);
  }

  /**
   * Find application dashboards by template dashboard UID
   */
  async findApplicationDashboardsByTemplateDashboardUid(
    dashboardUid: string,
    application: string,
    testEnvironment: string,
    organizationId?: string,
  ): Promise<ApplicationDashboard[]> {
    return this.dashboardFinder.findApplicationDashboardsByTemplateDashboardUid(
      dashboardUid,
      application,
      testEnvironment,
      organizationId,
    );
  }

  /**
   * Find report panel for application dashboard - TEMPORARILY DISABLED
   */
  async findReportPanelForApplicationDashboardOrNull(
    applicationDashboard: ApplicationDashboard,
    genericReportPanelId: string,
    testType: string,
  ): Promise<any | null> {
    return this.dashboardFinder.findReportPanelForApplicationDashboardOrNull(
      applicationDashboard,
      genericReportPanelId,
      testType,
    );
  }
}
