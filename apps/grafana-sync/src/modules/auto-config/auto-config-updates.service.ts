/**
 * Copyright 2025 Perfana Contributors
 *
 * AutoConfigUpdatesService
 *
 * Migrated from: perfana-grafana/auto-config/auto-config-updates.js (84 lines)
 * Implementation from: perfana-grafana/database/typeorm-autoconfig.js (write operations)
 *
 * Provides database write operations for auto-configuration of Grafana dashboards.
 * All methods preserve the exact logic from the old working implementation.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  ApplicationDashboard,
  Benchmark,
  GrafanaDashboard,
  GrafanaInstance,
  MetricsSource,
  SystemUnderTest,
} from '@perfana/shared/entities';
import {
  upsertMetricsSource,
  inferSourceTypeFromDashboardUid,
} from '@perfana/shared/services/metrics-source-upsert';
import { MappedTestRun, MappedProfileBenchmark } from './auto-config-finders.service';
import { DashboardVariables } from './types';

/**
 * Application dashboard data for insertion
 */
export interface ApplicationDashboardInsertData {
  application: string;
  testEnvironment: string;
  grafana: string;
  grafanaDashboardId?: string;
  dashboardName: string;
  dashboardLabel: string;
  dashboardId: number;
  dashboardUid: string;
  templateDashboardUid?: string;
  tags?: string[];
  variables?: DashboardVariables;
  organizationId?: string; // RBAC: inherit organization from test run
}

/**
 * Grafana dashboard data for upsert
 */
export interface GrafanaDashboardUpsertData {
  grafana: string;
  uid: string;
  title: string;
  id: number;
  grafanaJson?: string | any;
  usedBySUT?: string[];
  panels?: any;
}

@Injectable()
export class AutoConfigUpdatesService {
  private readonly logger = new Logger(AutoConfigUpdatesService.name);

  constructor(
    @InjectRepository(ApplicationDashboard)
    private applicationDashboardRepo: Repository<ApplicationDashboard>,
    @InjectRepository(Benchmark)
    private benchmarkRepo: Repository<Benchmark>,
    @InjectRepository(GrafanaDashboard)
    private grafanaDashboardRepo: Repository<GrafanaDashboard>,
    @InjectRepository(GrafanaInstance)
    private grafanaInstanceRepo: Repository<GrafanaInstance>,
    @InjectRepository(SystemUnderTest)
    private systemUnderTestRepo: Repository<SystemUnderTest>,
    private dataSource: DataSource,
  ) {}

  private get metricsSourceRepo(): Repository<MetricsSource> {
    return this.dataSource.getRepository(MetricsSource);
  }

  /**
   * Insert application dashboard
   * Migrated from: typeorm-autoconfig.js:45-125
   * RBAC: Added organization filtering for SystemUnderTest lookup
   */
  async insertApplicationDashboard(
    applicationDashboard: ApplicationDashboardInsertData,
  ): Promise<{ insertedId: string }> {
    try {
      this.logger.log(
        `Upserting application dashboard for: ${applicationDashboard.application}, org: ${applicationDashboard.organizationId}`,
      );

      // Get system_under_test_id with organization filtering
      const sutWhere: any = { name: applicationDashboard.application };
      if (applicationDashboard.organizationId) {
        // RBAC: Filter by organization to ensure we get the correct SUT for this organization
        sutWhere.organization_id = applicationDashboard.organizationId;
      }

      const sut = await this.systemUnderTestRepo.findOne({
        where: sutWhere,
      });

      if (!sut) {
        throw new Error(
          `System under test '${applicationDashboard.application}' not found for organization ${applicationDashboard.organizationId}`,
        );
      }

      // Get grafana_instance_id
      const grafanaInstance = await this.grafanaInstanceRepo.findOne({
        where: { label: applicationDashboard.grafana },
      });

      if (!grafanaInstance) {
        throw new Error(`Grafana instance '${applicationDashboard.grafana}' not found`);
      }

      // Get grafana_dashboard_id if template dashboard UID is provided
      let grafanaDashboardId = null;
      if (applicationDashboard.templateDashboardUid) {
        const grafanaDashboard = await this.grafanaDashboardRepo.findOne({
          where: {
            uid: applicationDashboard.templateDashboardUid,
            grafanaInstanceId: grafanaInstance.id,
          },
        });

        if (grafanaDashboard) {
          grafanaDashboardId = grafanaDashboard.id;
        } else {
          this.logger.warn('Template dashboard not found in grafana_dashboards table');
        }
      }

      // Check if application dashboard already exists to prevent duplicates
      const existingDashboard = await this.applicationDashboardRepo.findOne({
        where: {
          systemUnderTestId: sut.id,
          testEnvironment: applicationDashboard.testEnvironment,
          grafanaInstanceId: grafanaInstance.id,
          dashboardUid: applicationDashboard.dashboardUid,
          dashboardLabel: applicationDashboard.dashboardLabel,
        },
      });

      const dashboard = {
        systemUnderTestId: sut.id,
        testEnvironment: applicationDashboard.testEnvironment,
        grafanaInstanceId: grafanaInstance.id,
        grafanaDashboardId: grafanaDashboardId,
        dashboardName: applicationDashboard.dashboardName,
        dashboardLabel: applicationDashboard.dashboardLabel,
        dashboardId: applicationDashboard.dashboardId,
        dashboardUid: applicationDashboard.dashboardUid,
        templateDashboardUid: applicationDashboard.templateDashboardUid,
        tags: applicationDashboard.tags || [],
        variables: applicationDashboard.variables || null,
        organizationId: applicationDashboard.organizationId || null, // RBAC: inherit from test run
      };

      let result;
      if (existingDashboard) {
        // Update existing dashboard
        this.logger.log(`Updating existing application dashboard with ID: ${existingDashboard.id}`);
        // Use save with id to update
        result = await this.applicationDashboardRepo.save({
          ...dashboard,
          id: existingDashboard.id,
        });
      } else {
        // Insert new dashboard
        this.logger.log('Inserting new dashboard data:', dashboard);
        result = await this.applicationDashboardRepo.save(dashboard);
      }

      this.logger.log(`Successfully upserted application dashboard with ID: ${result.id}`);

      // Dual-write: also create/update corresponding MetricsSource
      // Failures must not block ApplicationDashboard creation
      try {
        const sourceType = inferSourceTypeFromDashboardUid(applicationDashboard.dashboardUid);
        const metricsSourceId = await upsertMetricsSource(this.metricsSourceRepo, {
          systemUnderTestId: sut.id,
          testEnvironment: applicationDashboard.testEnvironment,
          sourceType,
          sourceConfigId: sourceType === 'grafana' ? grafanaInstance.id : undefined,
          externalRef: applicationDashboard.dashboardUid,
          displayName: applicationDashboard.dashboardName,
          displayLabel: applicationDashboard.dashboardLabel,
          tags: applicationDashboard.tags,
          organizationId: applicationDashboard.organizationId,
        });

        // Set forward link on ApplicationDashboard
        if (metricsSourceId && result.metricsSourceId !== metricsSourceId) {
          await this.applicationDashboardRepo.update(result.id, {
            metricsSourceId,
          });
        }

        this.logger.log(`Dual-write: MetricsSource ${metricsSourceId} for ApplicationDashboard ${result.id}`);
      } catch (msError) {
        this.logger.error(`MetricsSource dual-write failed for ApplicationDashboard ${result.id} (non-blocking):`, msError);
      }

      return { insertedId: result.id };
    } catch (e) {
      this.logger.error('insertApplicationDashboard failed:', e);
      throw e;
    }
  }

  /**
   * Update application dashboard variables
   * Migrated from: typeorm-autoconfig.js:130-145
   */
  async updateApplicationDashboardVariables(
    applicationDashboard: ApplicationDashboard,
  ): Promise<{ modifiedCount: number }> {
    try {
      await this.applicationDashboardRepo.update(applicationDashboard.id, {
        variables: applicationDashboard.variables,
      });

      return { modifiedCount: 1 };
    } catch (e) {
      this.logger.error('updateApplicationDashboardVariables failed:', e);
      throw e;
    }
  }

  /**
   * Upsert grafana dashboard
   * Migrated from: typeorm-autoconfig.js:150-204
   */
  async upsertGrafanaDashboard(
    grafanaDashboard: GrafanaDashboardUpsertData,
  ): Promise<{ value: GrafanaDashboard }> {
    try {
      // Get grafana_instance_id
      const grafanaInstance = await this.grafanaInstanceRepo.findOne({
        where: { label: grafanaDashboard.grafana },
      });

      if (!grafanaInstance) {
        throw new Error(`Grafana instance '${grafanaDashboard.grafana}' not found`);
      }

      // Check if dashboard exists
      const existing = await this.grafanaDashboardRepo.findOne({
        where: {
          grafanaInstanceId: grafanaInstance.id,
          uid: grafanaDashboard.uid,
        },
      });

      const dashboardData = {
        grafanaInstanceId: grafanaInstance.id,
        uid: grafanaDashboard.uid,
        name: grafanaDashboard.title,
        grafanaId: grafanaDashboard.id,
        grafanaJson: grafanaDashboard.grafanaJson
          ? typeof grafanaDashboard.grafanaJson === 'string'
            ? JSON.parse(grafanaDashboard.grafanaJson)
            : grafanaDashboard.grafanaJson
          : null,
        usedBySut: grafanaDashboard.usedBySUT || null,
        panels: grafanaDashboard.panels || null,
        organizationId: grafanaInstance.organizationId || null,
      };

      let result;
      if (existing) {
        // Update existing
        await this.grafanaDashboardRepo.update(existing.id, dashboardData);
        result = await this.grafanaDashboardRepo.findOne({ where: { id: existing.id } });
      } else {
        // Insert new
        result = await this.grafanaDashboardRepo.save(dashboardData);
      }

      if (!result) {
        throw new Error('Failed to upsert grafana dashboard');
      }

      return { value: result };
    } catch (e) {
      this.logger.error('upsertGrafanaDashboard failed:', e);
      throw e;
    }
  }

  /**
   * Update template dashboard's usedBySUT field
   * Migrated from: typeorm-autoconfig.js:209-243
   */
  async updateUsedBySut(
    templateDashboard: any,
    application: string,
  ): Promise<{ modifiedCount: number }> {
    try {
      const postgresId = templateDashboard.postgresId || templateDashboard._id;
      this.logger.log(
        `Updating usedBySut for dashboard PostgreSQL ID: ${postgresId}, application: ${application}`,
      );

      // Get current dashboard
      const dashboard = await this.grafanaDashboardRepo.findOne({ where: { id: postgresId } });

      if (!dashboard) {
        throw new Error(`Dashboard not found with ID: ${postgresId}`);
      }

      const usedBySUT = dashboard.usedBySut || [];

      // Add application if not already present
      if (!usedBySUT.includes(application)) {
        usedBySUT.push(application);
        this.logger.log(`Adding ${application} to usedBySUT array`);
      } else {
        this.logger.log(`${application} already in usedBySUT array`);
      }

      await this.grafanaDashboardRepo.update(postgresId, { usedBySut: usedBySUT });

      this.logger.log(`Successfully updated usedBySut`);
      return { modifiedCount: 1 };
    } catch (e) {
      this.logger.error('updateUsedBySut failed:', e);
      throw e;
    }
  }

  /**
   * Insert benchmark based on profile benchmark
   * Migrated from: perfana-grafana/auto-config/auto-config-updates.js:123-151
   */
  async insertBenchmarkBasedOnProfileBenchmark(
    profileBenchmark: MappedProfileBenchmark,
    testRun: MappedTestRun,
    applicationDashboard: ApplicationDashboard,
  ): Promise<{ insertedId: string; wasCreated?: boolean }> {
    try {
      this.logger.log(
        `Upserting benchmark for profile benchmark ${profileBenchmark.id} and test run ${testRun.testRunId}`,
      );
      this.logger.log(`Profile benchmark data: ${JSON.stringify(profileBenchmark)}`);
      this.logger.log(`Test run data: ${JSON.stringify(testRun)}`);
      this.logger.log(`Application dashboard ID: ${applicationDashboard.id}`);

      // Get system_under_test_id with organization filtering
      this.logger.log(
        `Looking for SUT: ${testRun.systemUnderTestName}, org: ${testRun.organizationId}`,
      );
      const sutWhere: any = { name: testRun.systemUnderTestName };
      if (testRun.organizationId) {
        // RBAC: Filter by organization to ensure we get the correct SUT for this organization
        sutWhere.organization_id = testRun.organizationId;
      }

      const sut = await this.systemUnderTestRepo.findOne({
        where: sutWhere,
      });

      if (!sut) {
        throw new Error(
          `System under test '${testRun.systemUnderTestName}' not found for organization ${testRun.organizationId}`,
        );
      }

      // Check if benchmark already exists (UPSERT pattern)
      const existingBenchmark = await this.benchmarkRepo.findOne({
        where: {
          system_under_test_id: sut.id,
          test_environment: testRun.testEnvironment,
          workload: testRun.workload,
          application_dashboard_id: applicationDashboard.id,
          generic_check_id: profileBenchmark.id,
        },
      });

      // Resolve grafana_instance
      let grafanaInstanceValue: string | undefined;
      if (typeof applicationDashboard.grafanaInstance === 'string') {
        grafanaInstanceValue = applicationDashboard.grafanaInstance;
      } else if (applicationDashboard.grafanaInstance) {
        grafanaInstanceValue = applicationDashboard.grafanaInstance.label;
      } else if (profileBenchmark.grafanaInstance) {
        grafanaInstanceValue = profileBenchmark.grafanaInstance;
      }

      // Prepare benchmark data
      // Note: config_id, config_type, and config_title are generated columns:
      // - config_id = configuration ->> 'id'
      // - config_type = configuration ->> 'type'
      // - config_title = configuration ->> 'title'
      // We populate the configuration object instead of setting these columns directly
      const benchmarkData = {
        system_under_test: sut,
        test_environment: testRun.testEnvironment,
        workload: testRun.workload,
        source: profileBenchmark.source,
        grafana_instance: grafanaInstanceValue,
        dashboard_label: applicationDashboard.dashboardLabel,
        dashboard_id: applicationDashboard.dashboardId,
        dashboard_uid: applicationDashboard.dashboardUid,
        application_dashboard_id: applicationDashboard.id,
        generic_check_id: profileBenchmark.id,
        panel_title: profileBenchmark.panelTitle,
        configuration: {
          id: profileBenchmark.panelId?.toString(),
          dashboardUid: applicationDashboard.dashboardUid,
          type: profileBenchmark.panelType,
          title: profileBenchmark.panelTitle,
          evaluateType: profileBenchmark.evaluateType,
          requirement: {
            operator: profileBenchmark.requirementOperator,
            value: profileBenchmark.requirementValue,
          },
        },
        // FIX: requirement_operator and requirement_value are NOT generated columns
        // They must be set directly from the profile benchmark
        requirement_operator: profileBenchmark.requirementOperator,
        requirement_value: profileBenchmark.requirementValue,
        metric_unit: profileBenchmark.metricUnit,
        exclude_ramp_up_time: profileBenchmark.excludeRampUpTime,
        average_all: profileBenchmark.averageAll,
        match_pattern: profileBenchmark.matchPattern,
        validate_with_default_if_no_data: profileBenchmark.validateWithDefaultIfNoData,
        validate_with_default_if_no_data_value: profileBenchmark.validateWithDefaultIfNoDataValue,
        tags: profileBenchmark.tags || [],
        enabled: true,
        valid: true,
        organization_id: testRun.organizationId || null, // RBAC: inherit from test run
      };

      let savedBenchmark: Benchmark;
      let wasCreated: boolean;

      if (existingBenchmark) {
        // UPDATE existing benchmark
        this.logger.log(`Updating existing benchmark with ID: ${existingBenchmark.id}`);
        savedBenchmark = await this.benchmarkRepo.save({
          ...benchmarkData,
          id: existingBenchmark.id,
        });
        wasCreated = false;
        this.logger.log(`Successfully updated benchmark with ID: ${savedBenchmark.id}`);
      } else {
        // INSERT new benchmark
        this.logger.log('Creating new benchmark');
        const benchmark = this.benchmarkRepo.create(benchmarkData);
        savedBenchmark = await this.benchmarkRepo.save(benchmark);
        wasCreated = true;
        this.logger.log(`Successfully inserted new benchmark with ID: ${savedBenchmark.id}`);
      }

      return { insertedId: savedBenchmark.id, wasCreated };
    } catch (e) {
      this.logger.error('insertBenchmarkBasedOnProfileBenchmark failed:');
      const error = e as any;
      this.logger.error(`Error message: ${error?.message}`);
      this.logger.error(`Error name: ${error?.name}`);
      if (error?.stack) {
        this.logger.error(`Stack trace: ${error.stack}`);
      }
      if (error?.detail) {
        this.logger.error(`Error detail: ${error.detail}`);
      }
      throw e;
    }
  }

  /**
   * Insert deep link based on generic deep link - TEMPORARILY DISABLED
   * Migrated from: typeorm-autoconfig.js:262-267
   */
  async insertDeepLinkBasedOnGenericDeepLink(
    _genericDeepLink: any,
    _testRun: MappedTestRun,
  ): Promise<{ insertedId: string | null }> {
    this.logger.log(
      'insertDeepLinkBasedOnGenericDeepLink temporarily disabled for genericChecks migration',
    );
    return { insertedId: null };
  }

  /**
   * Insert report panel based on generic report panel - TEMPORARILY DISABLED
   * Migrated from: typeorm-autoconfig.js:272-282
   */
  async insertReportPanelBasedOnGenericReportPanel(
    _genericReportPanel: any,
    _testRun: MappedTestRun,
    _applicationDashboard: ApplicationDashboard,
    _index: number,
  ): Promise<{ insertedId: string | null }> {
    this.logger.log(
      'insertReportPanelBasedOnGenericReportPanel temporarily disabled for genericChecks migration',
    );
    return { insertedId: null };
  }

  /**
   * Check if dashboard variables need updating
   * Compares current variables with new variables
   */
  variablesNeedUpdate(
    currentVariables: Record<string, any> | undefined,
    newVariables: Array<{ name: string; values: string[] }>,
  ): boolean {
    if (!currentVariables || Object.keys(currentVariables).length === 0) {
      return newVariables.length > 0;
    }

    // Check if any variable has different values
    for (const newVar of newVariables) {
      const currentValue = currentVariables[newVar.name];

      if (!currentValue) {
        return true; // New variable added
      }

      // Compare arrays
      const currentArray = Array.isArray(currentValue) ? currentValue : [currentValue];
      const newArray = newVar.values;

      if (currentArray.length !== newArray.length) {
        return true;
      }

      if (!currentArray.every((val, index) => val === newArray[index])) {
        return true;
      }
    }

    return false;
  }
}
