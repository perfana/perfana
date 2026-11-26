import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { TestRun, ProfileBenchmark, ProfileGrafanaDashboard } from '@perfana/shared/entities';
import { matchProfilesForRun } from '@perfana/shared/utils/profile-match';
import type { AdditionalSutMonitoring } from '@perfana/shared/types';
import { asMonitoringRun, readAdditionalSutMonitoring } from './additional-monitoring';
import { TestRunFinderService } from './test-run-finder.service';
import { DashboardFinderService } from './dashboard-finder.service';
import { DashboardConfiguratorService } from './dashboard-configurator.service';
import { BenchmarkProcessorService } from './benchmark-processor.service';
import {
  GroupingRuleProcessorService,
  type ProfileGroupingRuleRow,
} from './grouping-rule-processor.service';

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
    private groupingRuleProcessorService: GroupingRuleProcessorService,
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

      const { testRuns, profiles, dashboards, benchmarks, groupingRules } = context;
      for (const testRun of testRuns) {
        await this.processTestRun(testRun, profiles, dashboards, benchmarks, groupingRules);
      }
    } finally {
      this.logger.log('AutoConfig processing end');
    }
  }

  private async loadAutoConfigContext() {
    const lastSyncTimestamp = new Date(Date.now() - 5 * 60 * 1000);
    const recentTestRuns = await this.testRunFinderService.findRecentTestRuns(lastSyncTimestamp);

    // An untagged run still has work when an additional-monitoring entry carries its own tags.
    const hasWork = (tr: TestRun) =>
      (tr.tags || []).length > 0 || readAdditionalSutMonitoring(tr).some((e) => e.tags);

    recentTestRuns
      .filter((tr) => !hasWork(tr))
      .forEach((tr) =>
        this.logger.log(
          `No AutoConfig process for test run because there are no tags: ${tr.testRunId}`,
        ),
      );

    const testRuns = recentTestRuns.filter(hasWork);

    if (testRuns.length === 0) {
      this.logger.log('No recent test runs with tags found. AutoConfig processing skipped.');
      return null;
    }

    // Collect org IDs from test runs for RBAC-scoped queries
    const orgIds = [
      ...new Set(testRuns.map((tr) => tr.organizationId).filter(Boolean)),
    ] as string[];
    const orgFilter = orgIds.length > 0 ? orgIds : undefined;

    // Load profiles, dashboards, benchmarks and series grouping rules in parallel
    const [profiles, dashboards, benchmarks, groupingRules] = await Promise.all([
      this.testRunFinderService.findProfiles(orgFilter),
      this.dashboardFinderService.findAutoConfigGrafanaDashboards(orgFilter),
      this.testRunFinderService.findProfileBenchmarks(orgFilter),
      this.groupingRuleProcessorService.findProfileGroupingRules(orgFilter),
    ]);

    if (profiles.length === 0) {
      this.logger.log('No profiles found. AutoConfig processing skipped.');
      return null;
    }

    // A perf-test profile benchmark needs no profile dashboard, so an org with only those
    // still has work to do here.
    if (dashboards.length === 0 && benchmarks.length === 0) {
      this.logger.log(
        'No auto config dashboards or profile benchmarks found. AutoConfig processing skipped.',
      );
      return null;
    }

    return { testRuns, profiles, dashboards, benchmarks, groupingRules };
  }

  /** Process a single test run */
  private async processTestRun(
    testRun: TestRun,
    profiles: any[],
    autoConfigDashboards: ProfileGrafanaDashboard[],
    profileBenchmarks: ProfileBenchmark[],
    groupingRules: ProfileGroupingRuleRow[],
  ): Promise<void> {
    try {
      // Tags and organization, failing closed on a missing organization: one rule, shared with the
      // API's golden-path applier for profile compare-config templates.
      const testRunProfiles = matchProfilesForRun(
        { tags: testRun.tags, organizationId: testRun.organizationId },
        profiles,
      );
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

      // After the dashboards: a rule needs the application dashboard it sits on.
      if (groupingRules.length > 0) {
        await this.groupingRuleProcessorService.processProfileGroupingRules(
          testRun,
          profileNames,
          groupingRules,
        );
      }

      for (const target of readAdditionalSutMonitoring(testRun, (m) => this.logger.warn(m))) {
        await this.processAdditionalSutMonitoring(
          testRun,
          target,
          target.tags
            ? matchProfilesForRun(
                { tags: target.tags, organizationId: testRun.organizationId },
                profiles,
              ).map((p) => p.name)
            : profileNames,
          autoConfigDashboards,
          profileBenchmarks,
          groupingRules,
        );
      }
    } catch (error) {
      this.logger.error(`Error processing test run: ${testRun.testRunId}`, error);
    }
  }

  /**
   * Dashboards, profile SLOs and grouping rules of `profileNames` for one extra system/environment
   * combination, stored under the run's own system and environment (see additional-monitoring.ts).
   * One failing entry does not stop the next.
   */
  private async processAdditionalSutMonitoring(
    testRun: TestRun,
    target: AdditionalSutMonitoring,
    profileNames: string[],
    autoConfigDashboards: ProfileGrafanaDashboard[],
    profileBenchmarks: ProfileBenchmark[],
    groupingRules: ProfileGroupingRuleRow[],
  ): Promise<void> {
    if (profileNames.length === 0) {
      // log, not warn: auto-config re-reads a recent run every pass.
      this.logger.log(
        `Additional SUT monitoring for test run ${testRun.testRunId}: no profile matches ` +
          `${target.systemUnderTest} / ${target.testEnvironment}` +
          `${target.tags ? ` (tags ${target.tags.join(', ')})` : ''}, entry skipped`,
      );
      return;
    }
    this.logger.log(
      `Additional SUT monitoring for test run ${testRun.testRunId}: ` +
        `${target.systemUnderTest} / ${target.testEnvironment} with profiles ${profileNames.join(', ')}`,
    );
    try {
      await this.processAutoConfigDashboardsForTestRun(
        asMonitoringRun(testRun, target),
        profileNames,
        autoConfigDashboards,
        testRun.variables || [],
      );
      // SLOs and rules belong to the run's own system/environment/workload, so they get the run
      // itself, scoped to this combination's dashboards.
      if (profileBenchmarks.length > 0) {
        await this.benchmarkProcessorService.processProfileBenchmarks(
          testRun,
          profileNames,
          profileBenchmarks,
          target,
        );
      }
      if (groupingRules.length > 0) {
        await this.groupingRuleProcessorService.processProfileGroupingRules(
          testRun,
          profileNames,
          groupingRules,
          target,
        );
      }
    } catch (error) {
      this.logger.error(
        `Error processing additional SUT monitoring ${target.systemUnderTest} / ${target.testEnvironment} ` +
          `for test run: ${testRun.testRunId}`,
        error,
      );
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
