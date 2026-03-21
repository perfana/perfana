/**
 * Copyright 2025 Perfana Contributors
 *
 * DashboardFinderService
 *
 * Split from: auto-config-finders.service.ts
 * Provides database queries for Grafana and Application dashboards.
 * All methods preserve the exact query logic from the old working implementation.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ProfileGrafanaDashboard,
  GrafanaDashboard,
  GrafanaInstance,
  ApplicationDashboard,
} from '@perfana/shared/entities';
import { MappedTestRun } from './test-run-finder.service';

/**
 * Mapped auto-config dashboard structure
 * Preserves field names from old system
 */
export interface MappedAutoConfigDashboard {
  profile: string;
  dashboardName: string;
  dashboardUid: string;
  grafana: string;
  createSeparateDashboardForVariable?: string;
  setHardcodedValueForVariables?: Array<{ name: string; values: string[] }>;
  matchRegexForVariables?: Record<string, string>;
  readOnly?: boolean;
}

/**
 * Mapped grafana dashboard structure
 * Preserves MongoDB-style field names for compatibility
 */
export interface MappedGrafanaDashboard {
  _id: string;
  uid: string;
  grafana: string;
  name: string;
  id: number;
  postgresId: string;
  tags: string[];
  grafanaJson: string | null;
  templateDashboardUid?: string;
  usedBySUT: string[];
  templatingVariables: any[];
}

/**
 * Mapped grafana configuration structure
 */
export interface MappedGrafanaConfig {
  label: string;
  serverUrl: string;
  clientUrl: string;
  apiKey?: string;
  orgId?: number;
  username?: string;
  password?: string;
}

@Injectable()
export class DashboardFinderService {
  private readonly logger = new Logger(DashboardFinderService.name);

  constructor(
    @InjectRepository(ProfileGrafanaDashboard)
    private profileDashboardRepo: Repository<ProfileGrafanaDashboard>,
    @InjectRepository(GrafanaDashboard)
    private grafanaDashboardRepo: Repository<GrafanaDashboard>,
    @InjectRepository(GrafanaInstance)
    private grafanaInstanceRepo: Repository<GrafanaInstance>,
    @InjectRepository(ApplicationDashboard)
    private applicationDashboardRepo: Repository<ApplicationDashboard>,
  ) {}

  /**
   * Find all auto config grafana dashboards
   * Migrated from: typeorm-autoconfig.js:338-361
   */
  async findAutoConfigGrafanaDashboards(): Promise<MappedAutoConfigDashboard[]> {
    try {
      const data = await this.profileDashboardRepo.find();

      // Map to MongoDB structure expected by autoconfig
      const mappedData = data.map((row) => ({
        profile: row.profile,
        dashboardName: row.dashboardName,
        dashboardUid: row.dashboardUid,
        grafana: row.grafanaLabel,
        createSeparateDashboardForVariable: row.createSeparateDashboardForVariable,
        setHardcodedValueForVariables: row.setHardcodedValueForVariables,
        matchRegexForVariables: row.matchRegexForVariables,
        readOnly: row.readOnly,
      }));

      return mappedData;
    } catch (e) {
      this.logger.error('findAutoConfigGrafanaDashboards failed:', e);
      return [];
    }
  }

  /**
   * Find grafana dashboard by grafana instance and dashboard UIDs (returns null if not found)
   * Migrated from: typeorm-autoconfig.js:387-438
   */
  async findGrafanaDashboardOrNull(
    grafana: string,
    dashboardUids: string[],
  ): Promise<MappedGrafanaDashboard | null> {
    try {
      const grafanaInstance = await this.grafanaInstanceRepo.findOne({
        where: { label: grafana },
      });

      if (!grafanaInstance) {
        return null;
      }

      const data = await this.grafanaDashboardRepo
        .createQueryBuilder('gd')
        .where('gd.grafanaInstanceId = :grafanaInstanceId', {
          grafanaInstanceId: grafanaInstance.id,
        })
        .andWhere('gd.uid IN (:...uids)', { uids: dashboardUids })
        .getMany();

      if (!data || data.length === 0) {
        return null;
      }

      if (data.length > 1) {
        throw new Error(
          `Found more than one Grafana dashboard with uid '${dashboardUids}' for Grafana '${grafana}'`,
        );
      }

      // Map to MongoDB structure expected by autoconfig
      const row = data[0];
      const mappedData: MappedGrafanaDashboard = {
        _id: row.id,
        uid: row.uid,
        grafana: grafana,
        name: row.name,
        id: row.grafanaId,
        postgresId: row.id,
        tags: row.tags || [],
        grafanaJson: row.grafanaJson ? JSON.stringify(row.grafanaJson) : null,
        templateDashboardUid: row.templateDashboardUid,
        usedBySUT: row.usedBySut || [],
        templatingVariables: row.templatingVariables || [],
      };

      return mappedData;
    } catch (e) {
      this.logger.error('findGrafanaDashboardOrNull failed:', e);
      throw e;
    }
  }

  /**
   * Find grafana dashboard (throws if not found)
   * Migrated from: typeorm-autoconfig.js:440-451
   */
  async findGrafanaDashboard(
    grafana: string,
    dashboardUids: string[],
  ): Promise<MappedGrafanaDashboard> {
    const dashboard = await this.findGrafanaDashboardOrNull(grafana, dashboardUids);
    if (!dashboard) {
      throw new Error(
        `Could not find Grafana dashboard with one of uids '${dashboardUids}' for Grafana '${grafana}'`,
      );
    }
    return dashboard;
  }

  /**
   * Find application dashboards for system under test
   * Migrated from: typeorm-autoconfig.js:510-551
   * RBAC: Added organization filtering to ensure multi-tenant isolation
   */
  async findApplicationDashboardsForSystemUnderTest(
    testRun: MappedTestRun,
    grafana: string,
    dashboardUid: string,
    dashboardLabel: string | null = null,
  ): Promise<ApplicationDashboard[]> {
    try {
      this.logger.log(
        `Querying application_dashboards: sut=${testRun.systemUnderTestName}, env=${testRun.testEnvironment}, grafana=${grafana}, uid=${dashboardUid}, label=${dashboardLabel}, org=${testRun.organizationId}`,
      );

      let query = this.applicationDashboardRepo
        .createQueryBuilder('ad')
        .innerJoin('ad.systemUnderTest', 'sut')
        .innerJoin('ad.grafanaInstance', 'gi')
        .where('sut.name = :sutName', { sutName: testRun.systemUnderTestName })
        .andWhere('ad.testEnvironment = :testEnvironment', {
          testEnvironment: testRun.testEnvironment,
        })
        .andWhere('gi.label = :grafanaLabel', { grafanaLabel: grafana })
        .andWhere('ad.dashboardUid = :dashboardUid', { dashboardUid });

      // RBAC: Filter by organization if present (backward compatible with NULL)
      if (testRun.organizationId) {
        query = query.andWhere(
          '(ad.organization_id = :organizationId OR ad.organization_id IS NULL)',
          { organizationId: testRun.organizationId },
        );
      }

      if (dashboardLabel) {
        query = query.andWhere('ad.dashboardLabel = :dashboardLabel', {
          dashboardLabel,
        });
      }

      const data = await query.getMany();

      this.logger.log(`Found ${data ? data.length : 0} application dashboards`);
      return data || [];
    } catch (e) {
      this.logger.error('findApplicationDashboardsForSystemUnderTest failed:', e);
      throw e;
    }
  }

  /**
   * Find existing grafana dashboards by grafana instance and UIDs
   * Migrated from: typeorm-autoconfig.js:453-478
   */
  async findExistingGrafanaDashboards(
    grafana: string,
    dashboardUids: string[],
  ): Promise<MappedGrafanaDashboard[]> {
    try {
      const grafanaInstance = await this.grafanaInstanceRepo.findOne({
        where: { label: grafana },
      });

      if (!grafanaInstance) {
        return [];
      }

      const data = await this.grafanaDashboardRepo
        .createQueryBuilder('gd')
        .where('gd.grafanaInstanceId = :grafanaInstanceId', {
          grafanaInstanceId: grafanaInstance.id,
        })
        .andWhere('gd.uid IN (:...uids)', { uids: dashboardUids })
        .getMany();

      // Map TypeORM entities to MappedGrafanaDashboard objects
      return (data || []).map((row) => ({
        _id: row.id,
        uid: row.uid,
        grafana: grafana,
        name: row.name,
        id: row.grafanaId,
        postgresId: row.id,
        tags: row.tags || [],
        grafanaJson: row.grafanaJson ? JSON.stringify(row.grafanaJson) : null,
        templateDashboardUid: row.templateDashboardUid,
        usedBySUT: row.usedBySut || [],
        templatingVariables: row.templatingVariables || [],
      }));
    } catch (e) {
      this.logger.error('findExistingGrafanaDashboards failed:', e);
      throw e;
    }
  }

  /**
   * Find grafana configuration by label
   * Migrated from: typeorm-autoconfig.js:480-505
   */
  async findGrafanaConfiguration(grafana: string): Promise<MappedGrafanaConfig | null> {
    try {
      const data = await this.grafanaInstanceRepo.findOne({ where: { label: grafana } });

      if (!data) {
        return null;
      }

      // Map to MongoDB structure expected by autoconfig
      const mappedData: MappedGrafanaConfig = {
        label: data.label,
        serverUrl: data.server_url || '',
        clientUrl: data.client_url,
        apiKey: data.apiKey,
        orgId: data.orgId ? parseInt(data.orgId, 10) : undefined,
        username: data.username,
        password: data.password,
      };

      return mappedData;
    } catch (e) {
      this.logger.error('findGrafanaConfiguration failed:', e);
      return null;
    }
  }

  /**
   * Find application dashboards by template dashboard UID
   * Migrated from: typeorm-autoconfig.js:553-579
   * RBAC: Added organization filtering
   */
  async findApplicationDashboardsByTemplateDashboardUid(
    dashboardUid: string,
    application: string,
    testEnvironment: string,
    organizationId?: string,
  ): Promise<ApplicationDashboard[]> {
    try {
      let query = this.applicationDashboardRepo
        .createQueryBuilder('ad')
        .innerJoin('ad.systemUnderTest', 'sut')
        .where('ad.templateDashboardUid = :templateUid', {
          templateUid: dashboardUid,
        })
        .andWhere('sut.name = :application', { application })
        .andWhere('ad.testEnvironment = :testEnvironment', { testEnvironment });

      // RBAC: Filter by organization if present (backward compatible with NULL)
      if (organizationId) {
        query = query.andWhere(
          '(ad.organization_id = :organizationId OR ad.organization_id IS NULL)',
          { organizationId },
        );
      }

      const data = await query.getMany();

      return data || [];
    } catch (e) {
      this.logger.error('findApplicationDashboardsByTemplateDashboardUid failed:', e);
      throw e;
    }
  }

  /**
   * Find report panel for application dashboard - TEMPORARILY DISABLED
   * Migrated from: typeorm-autoconfig.js:602-611
   */
  async findReportPanelForApplicationDashboardOrNull(
    _applicationDashboard: ApplicationDashboard,
    _genericReportPanelId: string,
    _testType: string,
  ): Promise<any | null> {
    this.logger.log(
      'findReportPanelForApplicationDashboardOrNull temporarily disabled for genericChecks migration',
    );
    return null;
  }
}
