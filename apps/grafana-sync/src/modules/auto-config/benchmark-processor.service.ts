/**
 * Copyright 2025 Perfana Contributors
 *
 * BenchmarkProcessorService
 *
 * Extracted from: auto-config.service.ts
 *
 * Handles profile benchmark processing for test runs.
 * Creates Benchmark instances from ProfileBenchmark templates.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  AutoConfigFindersService,
  MappedTestRun,
  MappedProfileBenchmark,
} from './auto-config-finders.service';
import { AutoConfigUpdatesService } from './auto-config-updates.service';
import { validateRegexPattern } from '@perfana/shared/utils';

@Injectable()
export class BenchmarkProcessorService {
  private readonly logger = new Logger(BenchmarkProcessorService.name);

  constructor(
    private findersService: AutoConfigFindersService,
    private updatesService: AutoConfigUpdatesService,
  ) {}

  /**
   * Process profile benchmarks for a test run
   * Creates Benchmark instances from ProfileBenchmark templates
   * Migrated from: perfana-grafana/auto-config/auto-config-service.js:931-985
   */
  async processProfileBenchmarks(
    testRun: MappedTestRun,
    profileNames: string[],
    profileBenchmarks: MappedProfileBenchmark[],
  ): Promise<void> {
    this.logger.log(`Processing profile benchmarks for test run: ${testRun.testRunId}`);

    // Filter profile benchmarks that match the test run's profiles
    const matchingBenchmarks = profileBenchmarks.filter((benchmark) =>
      profileNames.includes(benchmark.profileName),
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
    testRun: MappedTestRun,
    profileBenchmark: MappedProfileBenchmark,
  ): Promise<void> {
    try {
      // Match workload pattern against test run workload/test type
      if (!this.matchesWorkloadPattern(testRun, profileBenchmark)) {
        return;
      }

      this.logger.log(
        `Processing profile benchmark: ${profileBenchmark.panelTitle || profileBenchmark.id}`,
      );

      // Find application dashboards that match this profile benchmark's dashboard UID
      // RBAC: Pass organizationId to filter dashboards by organization
      const applicationDashboards =
        await this.findersService.findApplicationDashboardsByTemplateDashboardUid(
          profileBenchmark.dashboardUid!,
          testRun.systemUnderTestName,
          testRun.testEnvironment,
          testRun.organizationId,
        );

      this.logger.log(
        `Found ${applicationDashboards.length} application dashboards for dashboard UID ${profileBenchmark.dashboardUid}`,
      );

      // For each matching application dashboard, create a benchmark if it doesn't exist
      for (const applicationDashboard of applicationDashboards) {
        await this.createBenchmarkIfNotExists(testRun, profileBenchmark, applicationDashboard);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.stack : String(error);
      this.logger.error(`Error processing profile benchmark ${profileBenchmark.id}:`, errorMessage);
    }
  }

  /**
   * Check if test run workload matches the benchmark's workload pattern
   */
  private matchesWorkloadPattern(
    testRun: MappedTestRun,
    profileBenchmark: MappedProfileBenchmark,
  ): boolean {
    // Validate regex pattern for ReDoS safety
    const validationResult = validateRegexPattern(profileBenchmark.workloadPattern, { flags: 'i' });

    if (!validationResult.safe || !validationResult.regex) {
      this.logger.warn(
        `Invalid or unsafe regex pattern in profile benchmark "${profileBenchmark.id}": ${profileBenchmark.workloadPattern} - ${validationResult.error}`,
      );
      return false;
    }

    const workloadToMatch = testRun.workload || '';

    if (!validationResult.regex.test(workloadToMatch)) {
      this.logger.log(
        `Profile benchmark ${profileBenchmark.id} workload pattern '${profileBenchmark.workloadPattern}' does not match workload '${workloadToMatch}', skipping`,
      );
      return false;
    }

    return true;
  }

  /**
   * Create benchmark if it doesn't already exist
   */
  private async createBenchmarkIfNotExists(
    testRun: MappedTestRun,
    profileBenchmark: MappedProfileBenchmark,
    applicationDashboard: any,
  ): Promise<void> {
    const existingBenchmark = await this.findersService.findBenchmarkForApplicationDashboardOrNull(
      applicationDashboard,
      profileBenchmark.id,
      testRun.workload,
    );

    if (!existingBenchmark) {
      await this.updatesService.insertBenchmarkBasedOnProfileBenchmark(
        profileBenchmark,
        testRun,
        applicationDashboard,
      );
      this.logger.log(
        `Created benchmark for profile benchmark ${profileBenchmark.panelTitle || profileBenchmark.id}`,
      );
    } else {
      this.logger.debug(
        `Benchmark already exists for profile benchmark '${profileBenchmark.id}' and test run '${testRun.testRunId}'`,
      );
    }
  }
}
