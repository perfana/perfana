/**
 * Dashboard Manager for Performance Test Metrics Pipeline
 *
 * Manages scenario-specific dashboards and transaction-specific panels
 * using the new architecture:
 * - One dashboard per scenario
 * - One panel per transaction within each dashboard
 * - Special "scenario-level" panel for scenario-wide metrics
 */

import { DataSource } from 'typeorm';
import type { Logger } from 'pino';
import {
  generateScenarioDashboardUuid,
  generateScenarioDashboardUid,
  generateScenarioDashboardLabel,
} from '../../utils/uuid-generator.js';
import {
  generateTransactionPanelId,
  getScenarioLevelPanelId,
  SCENARIO_LEVEL_PANEL_NAME,
} from '../../utils/panel-id-generator.js';
import { METRIC_TYPE_PANEL_NAMES } from '../../constants/performance-metrics.js';

/**
 * Dashboard metadata
 */
export interface DashboardMetadata {
  dashboardId: string; // UUID
  dashboardUid: string; // Grafana UID
  dashboardLabel: string; // Human-readable label
}

/**
 * Panel metadata
 */
export interface PanelMetadata {
  panelId: number; // Hash-based panel ID
  panelName: string; // Transaction name or SCENARIO_LEVEL_PANEL_NAME
}

/**
 * Dashboard Manager Class
 * Handles creation and tracking of scenario-based dashboards and transaction-based panels
 */
export class DashboardManager {
  private dashboardCache: Map<string, DashboardMetadata> = new Map();
  private panelCache: Map<string, PanelMetadata> = new Map();

  constructor(
    private dataSource: DataSource,
    private logger: Logger
  ) {}

  /**
   * Get or create a dashboard for a specific scenario
   *
   * @param scenarioName - The scenario name (e.g., "loadtest", "smoketest")
   * @param systemUnderTestId - The system under test UUID
   * @param testEnvironment - The test environment (e.g., "production")
   * @returns Dashboard metadata
   */
  async getOrCreateScenarioDashboard(
    scenarioName: string,
    systemUnderTestId: string,
    testEnvironment: string
  ): Promise<DashboardMetadata> {
    const cacheKey = `${systemUnderTestId}::${testEnvironment}::${scenarioName}`;

    // Check cache first
    if (this.dashboardCache.has(cacheKey)) {
      return this.dashboardCache.get(cacheKey)!;
    }

    // Generate deterministic dashboard identifiers
    const dashboardId = generateScenarioDashboardUuid(
      systemUnderTestId,
      testEnvironment,
      scenarioName
    );
    const dashboardUid = generateScenarioDashboardUid(scenarioName);
    const dashboardLabel = generateScenarioDashboardLabel(scenarioName);

    // Check if dashboard already exists
    const existing = await this.dataSource.query(
      `SELECT id FROM application_dashboards WHERE id = $1`,
      [dashboardId]
    );

    if (!existing || existing.length === 0) {
      // Create the dashboard
      await this.createScenarioDashboard(
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
   * Create a scenario-specific dashboard in the database
   */
  private async createScenarioDashboard(
    dashboardId: string,
    dashboardUid: string,
    dashboardLabel: string,
    systemUnderTestId: string,
    testEnvironment: string
  ): Promise<void> {
    this.logger.info(
      `🔧 Creating scenario dashboard: ${dashboardLabel} (${dashboardUid})`
    );

    // Get the first available grafana instance
    const grafanaInstances = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM grafana_instances LIMIT 1`
    );

    if (!grafanaInstances || grafanaInstances.length === 0) {
      throw new Error(
        'No Grafana instances found in database - cannot create scenario dashboard'
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
      // Create synthetic grafana_dashboard
      const result = await this.dataSource.query<Array<{ id: string }>>(
        `INSERT INTO grafana_dashboards (
          grafana_instance_id, grafana_id, uid, name, panels
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING id`,
        [
          grafanaInstanceId,
          Math.floor(Math.random() * 1000000) + 900000, // Random synthetic Grafana ID
          dashboardUid,
          dashboardLabel,
          JSON.stringify([]), // Empty panels array
        ]
      );
      grafanaDashboardId = result[0].id;
      this.logger.info(`✅ Created synthetic grafana_dashboard: ${grafanaDashboardId}`);
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

    this.logger.info(`✅ Created scenario dashboard: ${dashboardId}`);
  }

  /**
   * Get panel metadata for a specific transaction
   *
   * @param transactionName - The transaction name (e.g., "checkout", "login")
   * @returns Panel metadata
   */
  getTransactionPanel(transactionName: string): PanelMetadata {
    const cacheKey = `transaction::${transactionName}`;

    // Check cache first
    if (this.panelCache.has(cacheKey)) {
      return this.panelCache.get(cacheKey)!;
    }

    // Generate panel ID from transaction name
    const panelId = generateTransactionPanelId(transactionName);

    const metadata: PanelMetadata = {
      panelId,
      panelName: transactionName,
    };

    // Cache the metadata
    this.panelCache.set(cacheKey, metadata);

    return metadata;
  }

  /**
   * Get panel metadata for scenario-level metrics
   *
   * @returns Panel metadata for scenario-level panel
   */
  getScenarioLevelPanel(): PanelMetadata {
    const cacheKey = 'scenario-level';

    // Check cache first
    if (this.panelCache.has(cacheKey)) {
      return this.panelCache.get(cacheKey)!;
    }

    const metadata: PanelMetadata = {
      panelId: getScenarioLevelPanelId(),
      panelName: SCENARIO_LEVEL_PANEL_NAME,
    };

    // Cache the metadata
    this.panelCache.set(cacheKey, metadata);

    return metadata;
  }

  /**
   * Get panel metadata for a fixed metric-type panel (v2 architecture).
   *
   * @param panelId - One of the METRIC_TYPE_PANEL_IDS values (101-303)
   * @returns Panel metadata with fixed ID and human-readable name
   */
  getMetricTypePanel(panelId: number): PanelMetadata {
    const cacheKey = `metric-type::${panelId}`;

    if (this.panelCache.has(cacheKey)) {
      return this.panelCache.get(cacheKey)!;
    }

    const panelName = METRIC_TYPE_PANEL_NAMES[panelId];
    if (!panelName) {
      throw new Error(`Unknown metric type panel ID: ${panelId}`);
    }

    const metadata: PanelMetadata = {
      panelId,
      panelName,
    };

    this.panelCache.set(cacheKey, metadata);

    return metadata;
  }

  /**
   * Clear all caches (useful for testing)
   */
  clearCaches(): void {
    this.dashboardCache.clear();
    this.panelCache.clear();
  }
}
