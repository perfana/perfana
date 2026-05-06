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
  metricsSourceId?: string; // MetricsSource UUID (Phase 3.3)
}

/**
 * Owner identity used for system-driven writes from the worker.
 * Mirrors `created_by = 'worker-pipeline'` used by the surrounding pipeline writes
 * (ds_metrics, ds_panels, …).
 */
const WORKER_PIPELINE_ACTOR = 'worker-pipeline';

/**
 * SUT ownership snapshot loaded once per (systemUnderTestId) and cached on the
 * manager. `organizationId` is required for `INSERT INTO application_dashboards`
 * since migration `1777700000000-OrganizationIdNotNull` made the column NOT NULL.
 */
interface SutOwnership {
  organizationId: string;
  teamId: string | null;
}

/**
 * Dynatrace Dashboard Manager Class
 * Handles creation and tracking of Dynatrace-based dashboards
 */
export class DynatraceDashboardManager {
  private dashboardCache: Map<string, DashboardMetadata> = new Map();
  private sutOwnershipCache: Map<string, SutOwnership> = new Map();

  constructor(
    private dataSource: DataSource,
    private logger: Logger
  ) {}

  /**
   * Resolve the owning organization (and optional team) for a SUT. The result
   * is cached per `systemUnderTestId` for the lifetime of the manager — one SELECT
   * per SUT per pipeline run.
   *
   * Throws if the SUT row is missing or has no organization_id, since callers
   * cannot satisfy the `application_dashboards.organization_id` NOT NULL
   * constraint without it.
   */
  private async getSutOwnership(systemUnderTestId: string): Promise<SutOwnership> {
    const cached = this.sutOwnershipCache.get(systemUnderTestId);
    if (cached) {
      return cached;
    }

    const rows = await this.dataSource.query<Array<{ organization_id: string | null; team_id: string | null }>>(
      `SELECT organization_id, team_id FROM systems_under_test WHERE id = $1`,
      [systemUnderTestId]
    );

    const row = rows?.[0];
    if (!row) {
      throw new Error(`SUT not found for systemUnderTestId=${systemUnderTestId}`);
    }
    if (!row.organization_id) {
      throw new Error(
        `SUT ${systemUnderTestId} has no organization_id; cannot create Dynatrace dashboard`
      );
    }

    const ownership: SutOwnership = {
      organizationId: row.organization_id,
      teamId: row.team_id ?? null,
    };
    this.sutOwnershipCache.set(systemUnderTestId, ownership);
    return ownership;
  }

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

    // Resolve owning org/team from the parent SUT — required for both INSERTs
    // below since `application_dashboards.organization_id` is NOT NULL and
    // `metrics_sources.organization_id` is part of the RBAC sweep.
    const ownership = await this.getSutOwnership(systemUnderTestId);

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
        testEnvironment,
        ownership
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
        ownership,
      );
    } catch (err) {
      this.logger.error({ err }, `MetricsSource dual-write failed for Dynatrace dashboard ${dashboardId} (non-blocking)`);
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
   * Create a Dynatrace-specific dashboard in the database.
   * No synthetic GrafanaDashboard is created — grafana columns are NULL for Dynatrace sources.
   */
  private async createDynatraceDashboard(
    dashboardId: string,
    dashboardUid: string,
    dashboardLabel: string,
    systemUnderTestId: string,
    testEnvironment: string,
    ownership: SutOwnership
  ): Promise<void> {
    this.logger.info(
      `🔧 Creating Dynatrace dashboard: ${dashboardLabel} (${dashboardUid})`
    );

    // Create application_dashboard without Grafana references (nullable columns).
    // organization_id is required (NOT NULL since 1777700000000-OrganizationIdNotNull)
    // and is sourced from the parent SUT.
    await this.dataSource.query(
      `INSERT INTO application_dashboards (
        id, system_under_test_id, test_environment,
        dashboard_name, dashboard_uid, dashboard_label,
        organization_id, team_id, created_by, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
      ON CONFLICT DO NOTHING`,
      [
        dashboardId,
        systemUnderTestId,
        testEnvironment,
        dashboardLabel,
        dashboardUid,
        dashboardLabel,
        ownership.organizationId,
        ownership.teamId,
        WORKER_PIPELINE_ACTOR,
      ]
    );

    this.logger.info(`✅ Created Dynatrace dashboard: ${dashboardId}`);
  }

  /**
   * Upsert a MetricsSource for a dynatrace dashboard.
   * Returns the metrics_source_id.
   */
  private async upsertMetricsSource(
    systemUnderTestId: string,
    testEnvironment: string,
    dashboardUid: string,
    dashboardLabel: string,
    ownership: SutOwnership,
  ): Promise<string | undefined> {
    const result = await this.dataSource.query<Array<{ id: string }>>(
      `INSERT INTO metrics_sources (
        system_under_test_id, test_environment, source_type,
        external_ref, display_name, display_label,
        organization_id, team_id, created_by
      ) VALUES ($1, $2, 'dynatrace', $3, $4, $5, $6, $7, $8)
      ON CONFLICT ON CONSTRAINT uq_metrics_sources_unique
      DO UPDATE SET
        display_label = EXCLUDED.display_label,
        organization_id = EXCLUDED.organization_id,
        team_id = EXCLUDED.team_id,
        updated_at = NOW()
      RETURNING id`,
      [
        systemUnderTestId,
        testEnvironment,
        dashboardUid,
        dashboardLabel,
        dashboardLabel,
        ownership.organizationId,
        ownership.teamId,
        WORKER_PIPELINE_ACTOR,
      ]
    );
    return result?.[0]?.id;
  }

  /**
   * Clear dashboard cache (useful for testing)
   */
  clearCache(): void {
    this.dashboardCache.clear();
    this.sutOwnershipCache.clear();
  }
}
