/**
 * Dynatrace Dashboard Manager for Dynatrace Metrics Pipeline
 *
 * Creates artificial grafana_dashboards and application_dashboards entries
 * for Dynatrace metrics to enable consistent dashboard/panel architecture.
 *
 * Key features:
 * - Synthetic grafana_dashboards with grafana_id in 800000+ range
 * - Deterministic UUID generation based on systemUnderTestId + testEnvironment + dashboardLabel
 * - Dashboard caching to minimize database queries
 * - Support for HOST entity dashboards and custom Dynatrace dashboards
 *
 * @example
 * ```typescript
 * // Initialize the manager
 * const manager = new DynatraceDashboardManager(dataSource, logger);
 *
 * // Create dashboard for a HOST entity
 * const hostDashboard = await manager.getOrCreateDynatraceDashboard(
 *   'Host: prod-web-server-01',
 *   systemUnderTestId,
 *   'production',
 *   'web-load-test'
 * );
 * // Returns:
 * // {
 * //   dashboardId: 'a1b2c3d4-...',  // Deterministic UUID
 * //   dashboardUid: 'dynatrace-host-prod-web-server-01',
 * //   dashboardLabel: 'Host: prod-web-server-01'
 * // }
 *
 * // Create dashboard for a custom Dynatrace dashboard
 * const customDashboard = await manager.getOrCreateDynatraceDashboard(
 *   'Application Performance',
 *   systemUnderTestId,
 *   'staging'
 * );
 * // Returns:
 * // {
 * //   dashboardId: 'e5f6a7b8-...',  // Different deterministic UUID
 * //   dashboardUid: 'dynatrace-application-performance',
 * //   dashboardLabel: 'Application Performance'
 * // }
 * ```
 */

import { DataSource } from 'typeorm';
import type { Logger } from 'pino';
import { generateDeterministicUuid } from '../../utils/uuid-generator.js';

/**
 * Dashboard metadata
 */
export interface DashboardMetadata {
  dashboardId: string; // UUID
  dashboardUid: string; // Grafana UID
  dashboardLabel: string; // Human-readable label
}

/**
 * Dynatrace Dashboard Manager Class
 * Handles creation and tracking of Dynatrace-based dashboards
 */
export class DynatraceDashboardManager {
  private dashboardCache: Map<string, DashboardMetadata> = new Map();

  constructor(
    private dataSource: DataSource,
    private logger: Logger
  ) {}

  /**
   * Get or create a dashboard for a specific Dynatrace metric set
   *
   * @param dashboardLabel - The dashboard label (e.g., "Host: hostname", "Dynatrace Custom Dashboard")
   * @param systemUnderTestId - The system under test UUID
   * @param testEnvironment - The test environment (e.g., "production")
   * @param workload - Optional workload identifier
   * @returns Dashboard metadata
   */
  async getOrCreateDynatraceDashboard(
    dashboardLabel: string,
    systemUnderTestId: string,
    testEnvironment: string,
    workload?: string
  ): Promise<DashboardMetadata> {
    const cacheKey = `${systemUnderTestId}::${testEnvironment}::${workload || 'default'}::${dashboardLabel}`;

    // Check cache first
    if (this.dashboardCache.has(cacheKey)) {
      return this.dashboardCache.get(cacheKey)!;
    }

    // Generate deterministic dashboard identifiers
    const dashboardId = this.generateDynatraceDashboardUuid(
      systemUnderTestId,
      testEnvironment,
      dashboardLabel,
      workload
    );
    const dashboardUid = this.generateDynatraceDashboardUid(dashboardLabel);

    // Check if dashboard already exists
    const existing = await this.dataSource.query(
      `SELECT id FROM application_dashboards WHERE id = $1`,
      [dashboardId]
    );

    if (!existing || existing.length === 0) {
      // Create the dashboard
      await this.createDynatraceDashboard(
        dashboardId,
        dashboardUid,
        dashboardLabel,
        systemUnderTestId,
        testEnvironment
      );
    }

    const metadata: DashboardMetadata = {
      dashboardId,
      dashboardUid,
      dashboardLabel,
    };

    // Cache the metadata
    this.dashboardCache.set(cacheKey, metadata);

    return metadata;
  }

  /**
   * Generate a deterministic UUID for a Dynatrace dashboard
   *
   * @param systemUnderTestId - The system under test UUID
   * @param testEnvironment - The test environment
   * @param dashboardLabel - The dashboard label
   * @param workload - Optional workload identifier
   * @returns A deterministic UUID
   */
  private generateDynatraceDashboardUuid(
    systemUnderTestId: string,
    testEnvironment: string,
    dashboardLabel: string,
    workload?: string
  ): string {
    const workloadPart = workload ? `-${workload}` : '';
    const input = `${systemUnderTestId}-${testEnvironment}${workloadPart}-dynatrace-${dashboardLabel}`;
    return generateDeterministicUuid(input);
  }

  /**
   * Generate a dashboard UID for Grafana integration
   *
   * @param dashboardLabel - The dashboard label
   * @returns A dashboard UID string
   *
   * @example
   * generateDynatraceDashboardUid('Host: my-server-01')
   * // Returns: "dynatrace-host-my-server-01"
   *
   * generateDynatraceDashboardUid('Custom Dashboard')
   * // Returns: "dynatrace-custom-dashboard"
   */
  private generateDynatraceDashboardUid(dashboardLabel: string): string {
    // Sanitize dashboard label for use in UID (lowercase, replace spaces/special chars with hyphens)
    const sanitized = dashboardLabel
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-') // Replace multiple consecutive hyphens with single hyphen
      .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens

    return `dynatrace-${sanitized}`;
  }

  /**
   * Create a Dynatrace-specific dashboard in the database
   */
  private async createDynatraceDashboard(
    dashboardId: string,
    dashboardUid: string,
    dashboardLabel: string,
    systemUnderTestId: string,
    testEnvironment: string
  ): Promise<void> {
    this.logger.info(
      `🔧 Creating Dynatrace dashboard: ${dashboardLabel} (${dashboardUid})`
    );

    // Get the first available grafana instance
    const grafanaInstances = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM grafana_instances LIMIT 1`
    );

    if (!grafanaInstances || grafanaInstances.length === 0) {
      throw new Error(
        'No Grafana instances found in database - cannot create Dynatrace dashboard'
      );
    }

    const grafanaInstanceId = grafanaInstances[0].id;

    // Check if synthetic grafana_dashboard exists for this UID
    const grafanaDashboardExists = await this.dataSource.query(
      `SELECT id FROM grafana_dashboards WHERE uid = $1 AND grafana_instance_id = $2`,
      [dashboardUid, grafanaInstanceId]
    );

    let grafanaDashboardId: string;

    if (!grafanaDashboardExists || grafanaDashboardExists.length === 0) {
      // Create synthetic grafana_dashboard with grafana_id in 800000+ range
      // This distinguishes Dynatrace dashboards from performance test metrics (900000+)
      const syntheticGrafanaId = Math.floor(Math.random() * 100000) + 800000;

      const result = await this.dataSource.query<Array<{ id: string }>>(
        `INSERT INTO grafana_dashboards (
          grafana_instance_id, grafana_id, uid, name, panels
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING id`,
        [
          grafanaInstanceId,
          syntheticGrafanaId,
          dashboardUid,
          dashboardLabel,
          JSON.stringify([]), // Empty panels array
        ]
      );
      grafanaDashboardId = result[0].id;
      this.logger.info(
        `✅ Created synthetic grafana_dashboard: ${grafanaDashboardId} (grafana_id: ${syntheticGrafanaId})`
      );
    } else {
      grafanaDashboardId = grafanaDashboardExists[0].id;
    }

    // Create application_dashboard
    await this.dataSource.query(
      `INSERT INTO application_dashboards (
        id, system_under_test_id, test_environment,
        grafana_instance_id, grafana_dashboard_id,
        dashboard_name, dashboard_uid, dashboard_label
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (system_under_test_id, test_environment, grafana_instance_id, dashboard_uid, dashboard_label)
      DO NOTHING`,
      [
        dashboardId,
        systemUnderTestId,
        testEnvironment,
        grafanaInstanceId,
        grafanaDashboardId,
        dashboardLabel,
        dashboardUid,
        dashboardLabel,
      ]
    );

    this.logger.info(`✅ Created Dynatrace dashboard: ${dashboardId}`);
  }

  /**
   * Clear dashboard cache (useful for testing)
   */
  clearCache(): void {
    this.dashboardCache.clear();
  }
}
