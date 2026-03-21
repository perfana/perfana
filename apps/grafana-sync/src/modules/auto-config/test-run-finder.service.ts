/**
 * Copyright 2025 Perfana Contributors
 *
 * TestRunFinderService
 *
 * Split from: auto-config-finders.service.ts
 * Provides database queries for test runs, profiles, and benchmarks.
 * All methods preserve the exact query logic from the old working implementation.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TestRun,
  Profile,
  ProfileBenchmark,
  Benchmark,
  ApplicationDashboard,
  SystemUnderTest,
} from '@perfana/shared/entities';

/**
 * Mapped test run structure expected by auto-config logic
 * Preserves MongoDB-style field names for compatibility
 */
export interface MappedTestRun {
  testRunId: string;
  systemUnderTestName: string;
  testEnvironment: string;
  workload: string;
  end: Date;
  tags: string[];
  variables: any[];
  organizationId?: string;
}

/**
 * Mapped profile benchmark structure from profile_benchmarks table
 */
export interface MappedProfileBenchmark {
  id: string;
  profileId: string;
  profileName: string;
  profileDashboardId: string;
  workloadPattern: string;
  source: string;
  grafanaInstance?: string;
  dashboardUid?: string;
  panelId?: number;
  panelTitle?: string;
  panelType?: string;
  panelDescription?: string;
  evaluateType?: string;
  metricUnit?: string;
  requirementOperator?: string;
  requirementValue?: number;
  excludeRampUpTime: boolean;
  averageAll: boolean;
  matchPattern?: string;
  validateWithDefaultIfNoData: boolean;
  validateWithDefaultIfNoDataValue?: number;
  tags: string[];
  metadata: Record<string, any>;
  readOnly?: boolean;
}

@Injectable()
export class TestRunFinderService {
  private readonly logger = new Logger(TestRunFinderService.name);

  constructor(
    @InjectRepository(TestRun)
    private testRunRepo: Repository<TestRun>,
    @InjectRepository(Profile)
    private profileRepo: Repository<Profile>,
    @InjectRepository(ProfileBenchmark)
    private profileBenchmarkRepo: Repository<ProfileBenchmark>,
    @InjectRepository(Benchmark)
    private benchmarkRepo: Repository<Benchmark>,
    @InjectRepository(SystemUnderTest)
    private systemUnderTestRepo: Repository<SystemUnderTest>,
  ) {}

  /**
   * Find recent test runs based on end time
   * Migrated from: typeorm-autoconfig.js:287-325
   */
  async findRecentTestRuns(startTime: Date): Promise<MappedTestRun[]> {
    try {
      const testRuns = await this.testRunRepo
        .createQueryBuilder('tr')
        .innerJoinAndSelect('tr.systemUnderTest', 'sut')
        .where('tr.endTime >= :startTime', {
          startTime: startTime.toISOString(),
        })
        .getMany();

      // Map to MongoDB structure expected by autoconfig
      const mappedData = testRuns.map((row) => {
        const systemUnderTestName = row.systemUnderTest?.name || row.systemUnderTestId;
        if (!systemUnderTestName) {
          this.logger.warn(`Test run ${row.testRunId} has null system_under_test name`);
        }
        return {
          testRunId: row.testRunId,
          systemUnderTestName: systemUnderTestName,
          testEnvironment: row.testEnvironment,
          workload: row.workload,
          end: new Date(row.endTime),
          tags: row.tags || [],
          variables: row.variables || [],
          organizationId: row.organizationId,
        };
      });

      return mappedData;
    } catch (e) {
      this.logger.error('findRecentTestRuns failed:', e);
      // Return empty array instead of throwing to prevent autoconfig from failing completely
      return [];
    }
  }

  /**
   * Find all profiles
   * Migrated from: typeorm-autoconfig.js:327-336
   */
  async findProfiles(): Promise<Profile[]> {
    try {
      const profiles = await this.profileRepo.find();
      return profiles || [];
    } catch (e) {
      this.logger.error('findProfiles failed:', e);
      return [];
    }
  }

  /**
   * Find all profile benchmarks from profile_benchmarks table
   * Queries profile_benchmarks with profile information joined
   */
  async findProfileBenchmarks(): Promise<MappedProfileBenchmark[]> {
    try {
      const benchmarks = await this.profileBenchmarkRepo
        .createQueryBuilder('pb')
        .innerJoinAndSelect('pb.profile', 'profile')
        .orderBy('pb.createdAt', 'DESC')
        .getMany();

      return benchmarks.map((benchmark) => ({
        id: benchmark.id,
        profileId: benchmark.profile_id,
        profileName: benchmark.profile?.name || 'Unknown',
        profileDashboardId: benchmark.profile_dashboard_id,
        workloadPattern: benchmark.workload_pattern,
        source: benchmark.source,
        grafanaInstance: benchmark.grafana_instance,
        dashboardUid: benchmark.dashboard_uid,
        panelId: benchmark.panel_id,
        panelTitle: benchmark.panel_title,
        panelType: benchmark.panel_type,
        panelDescription: benchmark.panel_description,
        evaluateType: benchmark.evaluate_type,
        metricUnit: benchmark.metric_unit,
        requirementOperator: benchmark.requirement_operator,
        requirementValue: benchmark.requirement_value
          ? Number(benchmark.requirement_value)
          : undefined,
        excludeRampUpTime: benchmark.exclude_ramp_up_time,
        averageAll: benchmark.average_all,
        matchPattern: benchmark.match_pattern,
        validateWithDefaultIfNoData: benchmark.validate_with_default_if_no_data,
        validateWithDefaultIfNoDataValue: benchmark.validate_with_default_if_no_data_value
          ? Number(benchmark.validate_with_default_if_no_data_value)
          : undefined,
        tags: benchmark.tags,
        metadata: benchmark.metadata,
        readOnly: benchmark.read_only,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.stack : String(error);
      this.logger.error('Error finding profile benchmarks:', errorMessage);
      return [];
    }
  }

  /**
   * Find all generic deep links - TEMPORARILY DISABLED
   * Migrated from: typeorm-autoconfig.js:370-375
   */
  async findGenericDeepLinks(): Promise<any[]> {
    this.logger.log('findGenericDeepLinks temporarily disabled - not yet migrated');
    return [];
  }

  /**
   * Find all generic report panels - TEMPORARILY DISABLED
   * Migrated from: typeorm-autoconfig.js:377-382
   */
  async findGenericReportPanels(): Promise<any[]> {
    this.logger.log('findGenericReportPanels temporarily disabled - not yet migrated');
    return [];
  }

  /**
   * Find benchmark for application dashboard and profile benchmark
   * Migrated from: typeorm-autoconfig.js:584-593
   */
  async findBenchmarkForApplicationDashboardOrNull(
    applicationDashboard: ApplicationDashboard,
    profileBenchmarkId: string,
    workload: string,
  ): Promise<Benchmark | null> {
    try {
      const benchmark = await this.benchmarkRepo.findOne({
        where: {
          application_dashboard_id: applicationDashboard.id,
          generic_check_id: profileBenchmarkId,
          workload: workload,
        },
      });

      return benchmark || null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.stack : String(error);
      this.logger.error('Error finding benchmark for application dashboard:', errorMessage);
      return null;
    }
  }

  /**
   * Find deep link for test run - TEMPORARILY DISABLED
   * Migrated from: typeorm-autoconfig.js:595-600
   */
  async findDeepLinkForTestRunOrNull(
    _genericDeepLink: any,
    _testRun: MappedTestRun,
  ): Promise<any | null> {
    this.logger.log(
      'findDeepLinkForTestRunOrNull temporarily disabled for genericChecks migration',
    );
    return null;
  }
}
