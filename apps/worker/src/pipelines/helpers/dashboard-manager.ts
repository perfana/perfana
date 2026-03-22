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
  metricsSourceId?: string; // MetricsSource UUID (Phase 3.3)
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

    // Dual-write: create/lookup MetricsSource (non-blocking)
    let metricsSourceId: string | undefined;
    try {
      metricsSourceId = await this.upsertMetricsSource(
        systemUnderTestId,
        testEnvironment,
        dashboardUid,
        dashboardLabel,
      );
    } catch (err) {
      this.logger.error({ err }, `MetricsSource dual-write failed for dashboard ${dashboardId} (non-blocking)`);
    }

    const metadata: DashboardMetadata = {
      dashboardId,
      dashboardUid,
      dashboardLabel,
      metricsSourceId,
    };

    // Cache the metadata
    this.dashboardCache.set(cacheKey, metadata);

    return metadata;
  }

  /**
   * Create a scenario-specific dashboard in the database.
   * No synthetic GrafanaDashboard is created — grafana columns are NULL for perf-test sources.
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

    // Create application_dashboard without Grafana references (nullable columns)
    await this.dataSource.query(
      `INSERT INTO application_dashboards (
        id, system_under_test_id, test_environment,
        dashboard_name, dashboard_uid, dashboard_label
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT DO NOTHING`,
      [
        dashboardId,
        systemUnderTestId,
        testEnvironment,
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
   * Upsert a MetricsSource for a performance_test dashboard.
   * Returns the metrics_source_id.
   */
  private async upsertMetricsSource(
    systemUnderTestId: string,
    testEnvironment: string,
    dashboardUid: string,
    dashboardLabel: string,
  ): Promise<string | undefined> {
    const result = await this.dataSource.query<Array<{ id: string }>>(
      `INSERT INTO metrics_sources (
        system_under_test_id, test_environment, source_type,
        external_ref, display_name, display_label
      ) VALUES ($1, $2, 'performance_test', $3, $4, $5)
      ON CONFLICT ON CONSTRAINT uq_metrics_sources_unique
      DO UPDATE SET display_label = EXCLUDED.display_label, updated_at = NOW()
      RETURNING id`,
      [systemUnderTestId, testEnvironment, dashboardUid, dashboardLabel, dashboardLabel]
    );
    return result?.[0]?.id;
  }

  /**
   * Clear all caches (useful for testing)
   */
  clearCaches(): void {
    this.dashboardCache.clear();
    this.panelCache.clear();
  }
}
