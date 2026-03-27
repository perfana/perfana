import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ProfileGrafanaDashboard,
  GrafanaDashboard,
  GrafanaInstance,
  ApplicationDashboard,
  TestRun,
} from '@perfana/shared/entities';
import { DashboardUid } from './dashboard-uid.util';
import { DashboardVariable } from './types';

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

  async findAutoConfigGrafanaDashboards(organizationIds?: string[]): Promise<ProfileGrafanaDashboard[]> {
    try {
      if (organizationIds && organizationIds.length > 0) {
        return await this.profileDashboardRepo
          .createQueryBuilder('pgd')
          .where('(pgd.organization_id IN (:...orgIds) OR pgd.organization_id IS NULL)', {
            orgIds: organizationIds,
          })
          .getMany();
      }
      return await this.profileDashboardRepo.find() ?? [];
    } catch (e) {
      this.logger.error('findAutoConfigGrafanaDashboards failed:', e);
      return [];
    }
  }

  async findGrafanaDashboardOrNull(
    grafana: string,
    dashboardUids: string[],
  ): Promise<GrafanaDashboard | null> {
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

      const row = data[0];
      // Set grafanaInstance so consumers can access .grafanaInstance.label
      row.grafanaInstance = grafanaInstance;
      return row;
    } catch (e) {
      this.logger.error('findGrafanaDashboardOrNull failed:', e);
      throw e;
    }
  }

  /**
   * Find grafana dashboard (throws if not found)
   */
  async findGrafanaDashboard(
    grafana: string,
    dashboardUids: string[],
  ): Promise<GrafanaDashboard> {
    const dashboard = await this.findGrafanaDashboardOrNull(grafana, dashboardUids);
    if (!dashboard) {
      throw new Error(
        `Could not find Grafana dashboard with one of uids '${dashboardUids}' for Grafana '${grafana}'`,
      );
    }
    return dashboard;
  }

  /**
   * Find application dashboards for system under test.
   * RBAC: Scoped by organization when present on the test run.
   */
  async findApplicationDashboardsForSystemUnderTest(
    testRun: TestRun,
    grafana: string,
    dashboardUid: string,
    dashboardLabel: string | null = null,
  ): Promise<ApplicationDashboard[]> {
    try {
      const systemUnderTestName = testRun.systemUnderTest?.name || testRun.systemUnderTestId;
      this.logger.log(
        `Querying application_dashboards: sut=${systemUnderTestName}, env=${testRun.testEnvironment}, grafana=${grafana}, uid=${dashboardUid}, label=${dashboardLabel}, org=${testRun.organizationId}`,
      );

      let query = this.applicationDashboardRepo
        .createQueryBuilder('ad')
        .innerJoin('ad.systemUnderTest', 'sut')
        .innerJoin('ad.grafanaInstance', 'gi')
        .where('sut.name = :sutName', { sutName: systemUnderTestName })
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
   */
  async findExistingGrafanaDashboards(
    grafana: string,
    dashboardUids: string[],
  ): Promise<GrafanaDashboard[]> {
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

      // Set grafanaInstance on each row so consumers can access .grafanaInstance.label
      return (data || []).map((row) => {
        row.grafanaInstance = grafanaInstance;
        return row;
      });
    } catch (e) {
      this.logger.error('findExistingGrafanaDashboards failed:', e);
      throw e;
    }
  }

  /**
   * Find grafana configuration by label
   */
  async findGrafanaConfiguration(grafana: string): Promise<GrafanaInstance | null> {
    try {
      const data = await this.grafanaInstanceRepo.findOne({ where: { label: grafana } });
      return data || null;
    } catch (e) {
      this.logger.error('findGrafanaConfiguration failed:', e);
      return null;
    }
  }

  /**
   * Find application dashboards by template dashboard UID.
   * RBAC: Scoped by organization when provided.
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
   * Find application dashboards via the generated dashboard uid
   */
  async findApplicationDashboards(
    grafanaFromTemplate: string,
    testRun: TestRun,
    autoConfigDashboard: ProfileGrafanaDashboard,
    applicationDashboardVariables: DashboardVariable[],
  ): Promise<any[]> {
    // When createSeparateDashboardForVariable is set, we need to use the variable-specific UID
    const dashboardUid = this.resolveDashboardUid(
      testRun,
      autoConfigDashboard,
      applicationDashboardVariables,
    );

    // For separate dashboards, we need to find by specific dashboard label
    const dashboardLabel = this.resolveDashboardLabel(
      autoConfigDashboard,
      applicationDashboardVariables,
    );

    this.logger.log(`Looking for application dashboards with label: "${dashboardLabel}"`);

    let applicationDashboards: any[] = [];
    if (grafanaFromTemplate) {
      applicationDashboards = await this.findApplicationDashboardsForSystemUnderTest(
        testRun,
        grafanaFromTemplate,
        dashboardUid,
        dashboardLabel,
      );
    }

    if (applicationDashboards.length > 0) {
      this.logger.log(`Determined dashboard uid: ${dashboardUid}`);
    }

    return applicationDashboards;
  }

  /**
   * Find existing grafana dashboards by resolved UID
   */
  async findExistingGrafanaDashboardsByResolvedUid(
    grafanaTemplateDashboard: GrafanaDashboard,
    testRun: TestRun,
    autoConfigDashboard: ProfileGrafanaDashboard,
    applicationDashboardVariables: DashboardVariable[],
  ): Promise<any[]> {
    const dashboardUid = this.resolveDashboardUid(
      testRun,
      autoConfigDashboard,
      applicationDashboardVariables,
    );

    const grafanaDashboards = await this.findExistingGrafanaDashboards(
      grafanaTemplateDashboard.grafanaInstance?.label || '',
      [dashboardUid],
    );

    return grafanaDashboards;
  }

  /**
   * Resolve dashboard UID based on createSeparateDashboardForVariable setting
   */
  private resolveDashboardUid(
    testRun: TestRun,
    autoConfigDashboard: ProfileGrafanaDashboard,
    applicationDashboardVariables: DashboardVariable[],
  ): string {
    if (autoConfigDashboard.createSeparateDashboardForVariable) {
      // Use the utility function that includes variables in the UID
      return DashboardUid.legacyFrom(
        testRun,
        autoConfigDashboard,
        applicationDashboardVariables,
      ).dashboardUid;
    } else {
      return DashboardUid.from(testRun, autoConfigDashboard).dashboardUid;
    }
  }

  /**
   * Resolve dashboard label based on createSeparateDashboardForVariable setting
   */
  private resolveDashboardLabel(
    autoConfigDashboard: ProfileGrafanaDashboard,
    applicationDashboardVariables: DashboardVariable[],
  ): string {
    let dashboardLabel = autoConfigDashboard.dashboardName;

    if (autoConfigDashboard.createSeparateDashboardForVariable) {
      const separateVariable = applicationDashboardVariables.find(
        (v) => v.name === autoConfigDashboard.createSeparateDashboardForVariable,
      );
      if (separateVariable && separateVariable.values.length > 0) {
        // For separate dashboards, construct the label with the first variable value
        dashboardLabel = `${autoConfigDashboard.dashboardName} ${separateVariable.values[0]}`;
      }
    }

    return dashboardLabel;
  }

}
