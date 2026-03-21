/**
 * Copyright 2025 Perfana Contributors
 *
 * DashboardFinderService
 *
 * Extracted from: dashboard-configurator.service.ts
 *
 * Handles dashboard lookup operations:
 * - Finding application dashboards by UID and label
 * - Finding existing Grafana dashboards
 * - Resolving dashboard UIDs based on configuration
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  AutoConfigFindersService,
  MappedTestRun,
  MappedAutoConfigDashboard,
  MappedGrafanaDashboard,
} from '../auto-config-finders.service';
import { DashboardVariable } from '../types';
import { DashboardUid } from '../dashboard-uid.util';

@Injectable()
export class DashboardFinderService {
  private readonly logger = new Logger(DashboardFinderService.name);

  constructor(private readonly findersService: AutoConfigFindersService) {}

  /**
   * Find application dashboards via the generated dashboard uid
   */
  async findApplicationDashboards(
    grafanaFromTemplate: string,
    testRun: MappedTestRun,
    autoConfigDashboard: MappedAutoConfigDashboard,
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
      applicationDashboards = await this.findersService.findApplicationDashboardsForSystemUnderTest(
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
   * Find existing grafana dashboards
   */
  async findExistingGrafanaDashboards(
    grafanaTemplateDashboard: MappedGrafanaDashboard,
    testRun: MappedTestRun,
    autoConfigDashboard: MappedAutoConfigDashboard,
    applicationDashboardVariables: DashboardVariable[],
  ): Promise<any[]> {
    const dashboardUid = this.resolveDashboardUid(
      testRun,
      autoConfigDashboard,
      applicationDashboardVariables,
    );

    const grafanaDashboards = await this.findersService.findExistingGrafanaDashboards(
      grafanaTemplateDashboard.grafana,
      [dashboardUid],
    );

    return grafanaDashboards;
  }

  /**
   * Resolve dashboard UID based on createSeparateDashboardForVariable setting
   */
  private resolveDashboardUid(
    testRun: MappedTestRun,
    autoConfigDashboard: MappedAutoConfigDashboard,
    applicationDashboardVariables: DashboardVariable[],
  ): string {
    if (autoConfigDashboard.createSeparateDashboardForVariable) {
      // Use the utility function that includes variables in the UID
      return DashboardUid.legacyFrom(
        testRun as any,
        autoConfigDashboard as any,
        applicationDashboardVariables,
      ).dashboardUid;
    } else {
      return DashboardUid.from(testRun as any, autoConfigDashboard as any).dashboardUid;
    }
  }

  /**
   * Resolve dashboard label based on createSeparateDashboardForVariable setting
   */
  private resolveDashboardLabel(
    autoConfigDashboard: MappedAutoConfigDashboard,
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
