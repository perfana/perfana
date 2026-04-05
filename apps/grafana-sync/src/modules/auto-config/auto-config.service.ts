import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { TestRun, ProfileBenchmark, ProfileGrafanaDashboard } from '@perfana/shared/entities';
import { TestRunFinderService } from './test-run-finder.service';
import { DashboardFinderService } from './dashboard-finder.service';
import { DashboardConfiguratorService } from './dashboard-configurator.service';
import { BenchmarkProcessorService } from './benchmark-processor.service';

@Injectable()
export class AutoConfigService {
  private readonly logger = new Logger(AutoConfigService.name);
  private isProcessing = false;

  constructor(
    private configService: ConfigService,
    private testRunFinderService: TestRunFinderService,
    private dashboardFinderService: DashboardFinderService,
    private dashboardConfiguratorService: DashboardConfiguratorService,
    private benchmarkProcessorService: BenchmarkProcessorService,
  ) {
    const enabled = this.configService.get<boolean>('AUTO_CONFIG_ENABLED', true);
    this.logger.log(`AutoConfigService initialized - AUTO_CONFIG_ENABLED: ${enabled}`);
  }

  @Cron('*/2 * * * *')
  async handleAutoConfig() {
    this.logger.log('Auto-config cron triggered');
    if (!this.configService.get<boolean>('AUTO_CONFIG_ENABLED', true)) {
      this.logger.warn('Auto-config disabled via AUTO_CONFIG_ENABLED');
      return;
    }
    if (this.isProcessing) {
      this.logger.warn('Auto-config already in progress, skipping...');
      return;
    }

    try {
      this.isProcessing = true;
      this.logger.log('Starting auto-config check...');
      await this.processAutoConfigDashboards();
    } catch (error) {
      const msg = error instanceof Error ? error.stack : String(error);
      this.logger.error('Auto-config failed:', msg);
    } finally {
      this.isProcessing = false;
    }
  }

  async processAutoConfigDashboards(): Promise<void> {
    this.logger.log('AutoConfig process start');
    try {
      const context = await this.loadAutoConfigContext();
      if (!context) return;

      const { testRuns, profiles, dashboards, benchmarks } = context;
      for (const testRun of testRuns) {
        await this.processTestRun(testRun, profiles, dashboards, benchmarks);
      }
    } finally {
      this.logger.log('AutoConfig processing end');
    }
  }

  private async loadAutoConfigContext() {
    const lastSyncTimestamp = new Date(Date.now() - 5 * 60 * 1000);
    const recentTestRuns = await this.testRunFinderService.findRecentTestRuns(lastSyncTimestamp);

    recentTestRuns
      .filter((tr) => !(tr.tags || []).length)
      .forEach((tr) =>
        this.logger.log(
          `No AutoConfig process for test run because there are no tags: ${tr.testRunId}`,
        ),
      );

    const testRuns = recentTestRuns.filter((tr) => (tr.tags || []).length > 0);

    if (testRuns.length === 0) {
      this.logger.log('No recent test runs with tags found. AutoConfig processing skipped.');
      return null;
    }

    // Collect org IDs from test runs for RBAC-scoped queries
    const orgIds = [
      ...new Set(testRuns.map((tr) => tr.organizationId).filter(Boolean)),
    ] as string[];
    const orgFilter = orgIds.length > 0 ? orgIds : undefined;

    // Load profiles, dashboards and benchmarks in parallel
    const [profiles, dashboards, benchmarks] = await Promise.all([
      this.testRunFinderService.findProfiles(orgFilter),
      this.dashboardFinderService.findAutoConfigGrafanaDashboards(orgFilter),
      this.testRunFinderService.findProfileBenchmarks(orgFilter),
    ]);

    if (profiles.length === 0) {
      this.logger.log('No profiles found. AutoConfig processing skipped.');
      return null;
    }

    if (dashboards.length === 0) {
      this.logger.log('No auto config dashboards found. AutoConfig processing skipped.');
      return null;
    }

    return { testRuns, profiles, dashboards, benchmarks };
  }

  /** Process a single test run */
  private async processTestRun(
    testRun: TestRun,
    profiles: any[],
    autoConfigDashboards: ProfileGrafanaDashboard[],
    profileBenchmarks: ProfileBenchmark[],
  ): Promise<void> {
    try {
      // Filter profiles by organization and tags
      const testRunTags = testRun.tags || [];
      const testRunProfiles = profiles.filter((profile) => {
        // Filter by tags (existing logic)
        const hasMatchingTag = testRunTags.some((tag) => profile.tags?.includes(tag));
        if (!hasMatchingTag) return false;

        // Filter by organization (RBAC)
        // If test run has an organizationId, only include profiles that:
        // 1. Have the same organizationId, OR
        // 2. Have null/undefined organizationId (for backward compatibility)
        if (testRun.organizationId) {
          return (
            profile.organizationId === testRun.organizationId ||
            profile.organizationId === null ||
            profile.organizationId === undefined
          );
        }

        // If test run has no organizationId, include all profiles (backward compatibility)
        return true;
      });
      const profileNames = testRunProfiles.map((p) => p.name);

      this.logger.log(
        `Processing AutoConfig for test run: ${testRun.testRunId} ` +
          `(organizationId: ${testRun.organizationId || 'null'}, matched ${testRunProfiles.length} profiles)`,
      );
      await this.processAutoConfigDashboardsForTestRun(
        testRun,
        profileNames,
        autoConfigDashboards,
        testRun.variables || [],
      );

      if (profileBenchmarks.length > 0) {
        await this.benchmarkProcessorService.processProfileBenchmarks(
          testRun,
          profileNames,
          profileBenchmarks,
        );
      }
    } catch (error) {
      this.logger.error(`Error processing test run: ${testRun.testRunId}`, error);
    }
  }

  /** Process auto config dashboards for a specific test run */
  private async processAutoConfigDashboardsForTestRun(
    testRun: TestRun,
    profileNames: string[],
    autoConfigDashboards: ProfileGrafanaDashboard[],
    testRunVariables: any[],
  ): Promise<void> {
    this.logger.log(`AutoConfig sync for test run: ${testRun.testRunId}`);

    const filtered = autoConfigDashboards.filter((d) => profileNames.includes(d.profile));
    this.logger.log(`Found ${filtered.length} auto config dashboards for '${testRun.testRunId}'`);

    for (const dashboard of filtered) {
      try {
        await this.dashboardConfiguratorService.processAutoConfigDashboard(
          testRun,
          dashboard,
          testRunVariables,
        );
      } catch (error) {
        this.logger.error(
          `Error processing auto config dashboard: ${JSON.stringify(dashboard)}`,
          error,
        );
      }
    }
  }
}
