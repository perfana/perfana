import { getLogger } from '../../lib/utils/logger.js';
import {
  DynatraceQueryConfigFromDb,
  DynatraceConfig
} from '../../types/dynatrace/index.js';
import { WorkerDatabaseService } from '../../common/database.service.js';

const logger = getLogger('dynatrace-repository');

/**
 * Repository for Dynatrace database operations (TypeORM)
 */
export class DynatraceRepository {
  constructor(private db: WorkerDatabaseService) {}

  /**
   * Get Dynatrace query configurations from database with associated config
   * @param systemUnderTestId System under test ID
   * @param testEnvironment Test environment (acc, prod, etc)
   * @param workload Workload type (loadTest, etc)
   * @param dashboardLabel Optional dashboard filter
   * @returns Query configs with dynatrace_config_id for loading instance config
   */
  async getQueriesForTestRun(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    dashboardLabel?: string
  ): Promise<DynatraceQueryConfigFromDb[]> {
    let query = `
      SELECT
        id,
        system_under_test_id as "systemUnderTestId",
        test_environment as "testEnvironment",
        workload,
        dashboard_label as "dashboardLabel",
        panel_title as "panelTitle",
        query,
        match_metric_pattern as "matchMetricPattern",
        omit_group_by_variable_from_metric_name as "omitGroupByVariableFromMetricName",
        template_variables as "templateVariables",
        application_dashboard_id as "applicationDashboardId",
        panel_id as "panelId",
        metric_unit as "metricUnit",
        metric_name as "metricName",
        dynatrace_config_id as "dynatraceConfigId"
      FROM dynatrace_queries
      WHERE system_under_test_id = $1
        AND test_environment = $2
        AND workload = $3
    `;

    const params: any[] = [systemUnderTestId, testEnvironment, workload];

    if (dashboardLabel) {
      query += ' AND dashboard_label = $4';
      params.push(dashboardLabel);
    }

    query += ' ORDER BY created_at DESC';

    const result = await this.db.query(query, params);

    logger.info(`Found ${result.length} Dynatrace queries for ${systemUnderTestId}.${testEnvironment}.${workload}`);

    return result.map((row: any) => ({
      ...row,
      omitGroupByVariableFromMetricName: row.omitGroupByVariableFromMetricName || []
    }));
  }

  /**
   * Get Dynatrace configuration by ID
   * @param configId Dynatrace config UUID
   */
  async getDynatraceConfigById(configId: string): Promise<DynatraceConfig | null> {
    const result = await this.db.query(
      `SELECT
        id,
        host,
        perfana_test_run_id_attribute as "perfanaTestRunIdAttribute",
        perfana_request_name_attribute as "perfanaRequestNameAttribute",
        api_token as "apiToken",
        platform_api_token as "platformApiToken",
        dynatrace_type as "dynatraceType",
        label
      FROM dynatrace_configs
      WHERE id = $1`,
      [configId]
    );

    if (result.length === 0) {
      logger.warn(`No Dynatrace config found for id: ${configId}`);
      return null;
    }

    return result[0];
  }

  /**
   * Get Dynatrace configuration by host (legacy method for backward compatibility)
   * @param host Dynatrace host URL
   */
  async getDynatraceConfig(host: string): Promise<DynatraceConfig | null> {
    // Normalize host URL by removing trailing slash for consistent lookup
    const normalizedHost = host.endsWith('/') ? host.slice(0, -1) : host;

    const result = await this.db.query(
      `SELECT
        id,
        host,
        perfana_test_run_id_attribute as "perfanaTestRunIdAttribute",
        perfana_request_name_attribute as "perfanaRequestNameAttribute",
        api_token as "apiToken",
        platform_api_token as "platformApiToken",
        dynatrace_type as "dynatraceType",
        label
      FROM dynatrace_configs
      WHERE RTRIM(host, '/') = $1`,
      [normalizedHost]
    );

    if (result.length === 0) {
      logger.warn(`No Dynatrace config found for host: ${host}`);
      return null;
    }

    return result[0];
  }

  /**
   * Get all Dynatrace configurations
   */
  async getAllDynatraceConfigs(): Promise<DynatraceConfig[]> {
    const result = await this.db.query(
      `SELECT
        id,
        host,
        perfana_test_run_id_attribute as "perfanaTestRunIdAttribute",
        perfana_request_name_attribute as "perfanaRequestNameAttribute",
        api_token as "apiToken",
        platform_api_token as "platformApiToken",
        dynatrace_type as "dynatraceType",
        label
      FROM dynatrace_configs
      ORDER BY created_at DESC`
    );

    return result;
  }
}
