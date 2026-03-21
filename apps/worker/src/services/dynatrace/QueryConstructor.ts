import { getLogger } from '../../lib/utils/logger.js';
import { DynatraceQueryConfigFromDb as _DynatraceQueryConfigFromDb, DynatraceQueryConfig } from '../../types/dynatrace/index.js';
import { DynatraceRepository } from './DynatraceRepository.js';

const logger = getLogger('dynatrace-query-constructor');

export interface TestRun {
  testRunId: string;
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
  start: Date;
  end: Date;
}

/**
 * Constructs executable Dynatrace queries from database configurations
 */
export class QueryConstructor {
  constructor(private repository: DynatraceRepository) {}

  /**
   * Construct queries from database for a test run
   */
  async constructQueriesFromDatabase(
    testRun: TestRun,
    dashboardLabel?: string
  ): Promise<DynatraceQueryConfig[]> {
    logger.info(`Loading Dynatrace queries for ${testRun.systemUnderTestId}.${testRun.testEnvironment}.${testRun.workload}`);

    // Load query configurations from database (dynatrace_queries table)
    const queryConfigs = await this.repository.getQueriesForTestRun(
      testRun.systemUnderTestId,
      testRun.testEnvironment,
      testRun.workload,
      dashboardLabel
    );

    if (queryConfigs.length === 0) {
      logger.warn(`No Dynatrace query configurations found`);
      return [];
    }

    logger.info(`Found ${queryConfigs.length} Dynatrace query configurations`);

    const queries: DynatraceQueryConfig[] = [];

    for (const config of queryConfigs) {
      try {
        // Step 1: Replace template variables (e.g., $Cluster, $Node)
        let processedQuery = config.query;
        if (config.templateVariables && Object.keys(config.templateVariables).length > 0) {
          processedQuery = this.replaceTemplateVariables(processedQuery, config.templateVariables);
          logger.debug(`Replaced ${Object.keys(config.templateVariables).length} template variables in query for '${config.panelTitle}'`);
        }

        // Step 2: Clean up any time range references in query
        // Times will be passed separately in API payload
        const finalQuery = this.cleanTimeRangeFromQuery(processedQuery);

        const queryConfig: DynatraceQueryConfig = {
          tileId: String(config.panelId),
          tileTitle: config.panelTitle,
          query: finalQuery,
          visualization: 'timeseries',
          dashboardLabel: config.dashboardLabel,
          applicationDashboardId: config.applicationDashboardId,
          querySettings: {},
          matchMetricPattern: config.matchMetricPattern,
          omitGroupByVariableFromMetricName: config.omitGroupByVariableFromMetricName || [],
          panelId: config.panelId,
          metricName: config.metricName,  // Explicit metric name (e.g., "CPU Usage")
          dynatraceConfigId: config.dynatraceConfigId  // Pass config ID for loading instance config
        };

        queries.push(queryConfig);
        logger.debug(`Prepared query for '${config.panelTitle}' from dashboard '${config.dashboardLabel}'`);

      } catch (error) {
        logger.error(`Failed to process query config ${config.id}`, {
          panelTitle: config.panelTitle,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    logger.info(`Generated ${queries.length} executable queries`);
    return queries;
  }

  /**
   * Replace template variables in DQL query with actual values
   * Example: $Cluster -> "other-k8s-2025-10-06-1759743420"
   */
  private replaceTemplateVariables(query: string, variables: Record<string, any>): string {
    let processedQuery = query;

    for (const [key, value] of Object.entries(variables)) {
      // Replace $VariableName with quoted value
      // Use global regex to replace all occurrences
      // Escape regex special characters in key to prevent reDOS attacks
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\$${escapedKey}\\b`, 'g');
      const quotedValue = typeof value === 'string' ? `"${value}"` : String(value);
      processedQuery = processedQuery.replace(regex, quotedValue);

      logger.debug(`Replaced $${key} with ${quotedValue}`);
    }

    return processedQuery;
  }

  /**
   * Remove time range references from DQL query
   *
   * According to Dynatrace API spec, timeframes should be in the API payload
   * (defaultTimeframeStart/defaultTimeframeEnd), NOT in the query string.
   *
   * This method removes any from:/to: clauses from the query.
   */
  private cleanTimeRangeFromQuery(query: string): string {
    let processedQuery = query;

    // Remove from:/to: after limit commands: "| limit 20, from: ..." → "| limit 20"
    processedQuery = processedQuery
      .replace(/(\|\s*limit\s+\d+),\s*from:\s*[^,\n|]+/g, '$1')
      .replace(/(\|\s*limit\s+\d+),\s*to:\s*[^,\n|]+/g, '$1');

    // Remove from:/to: from timeseries blocks
    processedQuery = processedQuery
      .replace(/,\s*from:\s*["'][^"']*["']/g, '')
      .replace(/,\s*to:\s*["'][^"']*["']/g, '')
      .replace(/,\s*from:\s*-?\d+[mhd]?/g, '')
      .replace(/,\s*to:\s*-?\d+[mhd]?/g, '');

    // Remove standalone from:/to: at end of lines
    processedQuery = processedQuery
      .replace(/,\s*from:\s*["'][^"']*["'](?=\s*$)/gm, '')
      .replace(/,\s*to:\s*["'][^"']*["'](?=\s*$)/gm, '');

    return processedQuery;
  }
}
