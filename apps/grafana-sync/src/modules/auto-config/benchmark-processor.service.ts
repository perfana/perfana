/**
 * Handles profile benchmark processing for test runs.
 * Creates Benchmark instances from ProfileBenchmark templates.
 */

import { Injectable, Logger } from '@nestjs/common';
import { TestRun, ProfileBenchmark } from '@perfana/shared/entities';
import { TestRunFinderService } from './test-run-finder.service';
import { DashboardFinderService } from './dashboard-finder.service';
import { AutoConfigUpdatesService } from './auto-config-updates.service';
import { validateRegexPattern } from '@perfana/shared/utils';
import {
  PERF_TEST_PROFILE_SOURCE,
  PERF_TEST_DASHBOARD_UID_PATTERN_DEFAULT,
  DYNATRACE_HOSTS_PROFILE_SOURCE,
  DYNATRACE_HOST_DASHBOARD_UID_PATTERN_DEFAULT,
  dynatraceHostPanelTitle,
  PROVISIONED_SLO_AUTO_DISABLED_KEY,
} from '@perfana/shared/constants';

@Injectable()
export class BenchmarkProcessorService {
  private readonly logger = new Logger(BenchmarkProcessorService.name);

  constructor(
    private testRunFinderService: TestRunFinderService,
    private dashboardFinderService: DashboardFinderService,
    private updatesService: AutoConfigUpdatesService,
  ) {}

  /**
   * Process profile benchmarks for a test run.
   * Creates Benchmark instances from ProfileBenchmark templates.
   */
  async processProfileBenchmarks(
    testRun: TestRun,
    profileNames: string[],
    profileBenchmarks: ProfileBenchmark[],
  ): Promise<void> {
    this.logger.log(`Processing profile benchmarks for test run: ${testRun.testRunId}`);

    // Filter profile benchmarks that match the test run's profiles
    const matchingBenchmarks = profileBenchmarks.filter((benchmark) =>
      profileNames.includes(benchmark.profile?.name || 'Unknown'),
    );

    this.logger.log(
      `Found ${matchingBenchmarks.length} profile benchmarks for profiles: ${profileNames.join(', ')}`,
    );

    for (const profileBenchmark of matchingBenchmarks) {
      await this.processSingleBenchmark(testRun, profileBenchmark);
    }

    this.logger.log(`Completed processing profile benchmarks for test run: ${testRun.testRunId}`);
  }

  /**
   * Process a single profile benchmark
   */
  private async processSingleBenchmark(
    testRun: TestRun,
    profileBenchmark: ProfileBenchmark,
  ): Promise<void> {
    try {
      // Match workload pattern against test run workload/test type
      if (!this.matchesWorkloadPattern(testRun, profileBenchmark)) {
        return;
      }

      this.logger.log(
        `Processing profile benchmark: ${profileBenchmark.panel_title || profileBenchmark.id}`,
      );

      // RBAC: Pass organizationId to filter dashboards by organization
      const systemUnderTestName = testRun.systemUnderTest?.name || testRun.systemUnderTestId;

      if (profileBenchmark.source === DYNATRACE_HOSTS_PROFILE_SOURCE) {
        await this.processDynatraceHostsBenchmark(testRun, profileBenchmark, systemUnderTestName);
        return;
      }

      const isPerfTest = profileBenchmark.source === PERF_TEST_PROFILE_SOURCE;
      // A perf-test benchmark has no Grafana template: `dashboard_uid` is a regex over
      // the worker-written `performance-test-metrics-<scenario>` uids, so one profile row
      // fans out to every scenario dashboard the SUT has, including ones added later.
      const lookup = isPerfTest
        ? profileBenchmark.dashboard_uid || PERF_TEST_DASHBOARD_UID_PATTERN_DEFAULT
        : profileBenchmark.dashboard_uid!;
      if (isPerfTest) {
        // The API validates on write; rows written before it did (or by SQL) reach Postgres `~` here.
        const check = validateRegexPattern(lookup, { maxLength: 255 });
        if (!check.safe) {
          this.logger.warn(
            `Profile benchmark ${profileBenchmark.id} has an unsafe uid pattern '${lookup}': ${check.error} - skipping`,
          );
          return;
        }
      }
      const applicationDashboards = isPerfTest
        ? await this.dashboardFinderService.findApplicationDashboardsByUidPattern(
            lookup,
            systemUnderTestName,
            testRun.testEnvironment,
            testRun.organizationId,
          )
        : await this.dashboardFinderService.findApplicationDashboardsByTemplateDashboardUid(
            lookup,
            systemUnderTestName,
            testRun.testEnvironment,
            testRun.organizationId,
          );

      this.logger.log(
        `Found ${applicationDashboards.length} application dashboards for ${isPerfTest ? 'uid pattern' : 'template uid'} ${lookup}`,
      );

      // For each matching application dashboard, create a benchmark if it doesn't exist.
      // A perf-test row fans out to N scenarios; one failure must not skip the rest.
      for (const applicationDashboard of applicationDashboards) {
        try {
          await this.createBenchmarkIfNotExists(testRun, profileBenchmark, applicationDashboard);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to provision profile benchmark ${profileBenchmark.id} on dashboard ${applicationDashboard.id}: ${msg}`,
          );
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.stack : String(error);
      this.logger.error(`Error processing profile benchmark ${profileBenchmark.id}:`, errorMessage);
    }
  }

  /**
   * A `dynatrace-hosts` benchmark: like a perf-test one, `dashboard_uid` is a regex, here over
   * the `dynatrace-dynatrace-host-metrics-<host>` uids, so one profile row fans out to every
   * mapped host, including hosts mapped later. Unlike perf-test the panel id differs per host,
   * so the synthetic profile panel id is mapped to its title and each host's real id is read
   * from its `dynatrace_queries` row.
   */
  private async processDynatraceHostsBenchmark(
    testRun: TestRun,
    profileBenchmark: ProfileBenchmark,
    systemUnderTestName: string,
  ): Promise<void> {
    const lookup = profileBenchmark.dashboard_uid || DYNATRACE_HOST_DASHBOARD_UID_PATTERN_DEFAULT;
    // The API validates on write; rows written before it did (or by SQL) reach Postgres `~` here.
    const check = validateRegexPattern(lookup, { maxLength: 255 });
    if (!check.safe) {
      this.logger.warn(
        `Profile benchmark ${profileBenchmark.id} has an unsafe uid pattern '${lookup}': ${check.error} - skipping`,
      );
      return;
    }
    const panelTitle =
      dynatraceHostPanelTitle(profileBenchmark.panel_id) ?? profileBenchmark.panel_title;
    if (!panelTitle) {
      this.logger.warn(
        `Profile benchmark ${profileBenchmark.id} names no Dynatrace host panel (panel_id ${profileBenchmark.panel_id}) - skipping`,
      );
      return;
    }

    const hostPanels = await this.dashboardFinderService.findDynatraceHostPanelsByUidPattern(
      lookup,
      panelTitle,
      systemUnderTestName,
      testRun.testEnvironment,
      testRun.workload,
      testRun.organizationId,
    );
    this.logger.log(
      `Found ${hostPanels.length} Dynatrace host dashboards with panel '${panelTitle}' for uid pattern ${lookup}`,
    );

    // One failing host must not skip the rest.
    for (const { applicationDashboard, panelId } of hostPanels) {
      try {
        await this.createBenchmarkIfNotExists(testRun, profileBenchmark, applicationDashboard, {
          panelId,
          panelTitle,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to provision profile benchmark ${profileBenchmark.id} on dashboard ${applicationDashboard.id}: ${msg}`,
        );
      }
    }
  }

  /**
   * Check if test run workload matches the benchmark's workload pattern
   */
  private matchesWorkloadPattern(testRun: TestRun, profileBenchmark: ProfileBenchmark): boolean {
    // Validate regex pattern for ReDoS safety
    const validationResult = validateRegexPattern(profileBenchmark.workload_pattern, {
      flags: 'i',
    });

    if (!validationResult.safe || !validationResult.regex) {
      this.logger.warn(
        `Invalid or unsafe regex pattern in profile benchmark "${profileBenchmark.id}": ${profileBenchmark.workload_pattern} - ${validationResult.error}`,
      );
      return false;
    }

    const workloadToMatch = testRun.workload || '';

    if (!validationResult.regex.test(workloadToMatch)) {
      this.logger.log(
        `Profile benchmark ${profileBenchmark.id} workload pattern '${profileBenchmark.workload_pattern}' does not match workload '${workloadToMatch}', skipping`,
      );
      return false;
    }

    return true;
  }

  /**
   * Create the benchmark if it does not exist yet. An existing row is left alone — a person may
   * have tweaked it, and their version wins — unless the system switched it off
   * (PROVISIONED_SLO_AUTO_DISABLED_KEY: the profile SLO was retargeted, or the host query was
   * unmapped) and nobody has edited it since: then this profile SLO still matches the
   * dashboard, so the row is re-synced from it and switched back on.
   */
  private async createBenchmarkIfNotExists(
    testRun: TestRun,
    profileBenchmark: ProfileBenchmark,
    applicationDashboard: any,
    panel?: { panelId: number; panelTitle: string },
  ): Promise<void> {
    const existingBenchmark =
      await this.testRunFinderService.findBenchmarkForApplicationDashboardOrNull(
        applicationDashboard,
        profileBenchmark.id,
        testRun.workload,
      );

    const autoDisabled =
      !!existingBenchmark &&
      !existingBenchmark.enabled &&
      !existingBenchmark.updated_by &&
      !!existingBenchmark.metadata?.[PROVISIONED_SLO_AUTO_DISABLED_KEY];

    if (!existingBenchmark || autoDisabled) {
      await this.updatesService.insertBenchmarkBasedOnProfileBenchmark(
        profileBenchmark,
        testRun,
        applicationDashboard,
        panel,
      );
      this.logger.log(
        `${autoDisabled ? 'Re-enabled' : 'Created'} benchmark for profile benchmark ${panel?.panelTitle ?? (profileBenchmark.panel_title || profileBenchmark.id)} on dashboard ${applicationDashboard.id}`,
      );
    } else {
      this.logger.debug(
        `Benchmark already exists for profile benchmark '${profileBenchmark.id}' and test run '${testRun.testRunId}'`,
      );
    }
  }
}
