import { PoolClient as _PoolClient } from 'pg';
import { TestRun } from '../../types/pipeline.js';
import { getLogger } from '../../lib/utils/logger.js';

const logger = getLogger('panels-helpers');

// Supported panel types - only these should be stored in the database
const SUPPORTED_PANEL_TYPES = [
  'graph',
  'table-old',
  'table',
  'stat',
  'singlestat',
  'timeseries'
];

// Tag/description to exclude dashboards and panels from anomaly detection
const NO_ANOMALY_DETECTION_MARKER = 'no-anomaly-detection';

/**
 * Determines if a panel should be stored in the database
 * Filters out:
 * 1. Panels with "grafana" datasource
 * 2. Panels with unsupported types
 */
function shouldStorePanel(panel: any, datasourceType: string | null): boolean {
  // Filter 1: Skip panels with "grafana" datasource
  if (datasourceType === 'grafana') {
    logger.debug(`Skipping panel ${panel.id} (${panel.title}): grafana datasource`);
    return false;
  }

  if (panel.datasource === 'grafana' || panel.datasource?.uid === 'grafana') {
    logger.debug(`Skipping panel ${panel.id} (${panel.title}): grafana datasource`);
    return false;
  }

  // Filter 2: Skip panels with unsupported types
  if (!SUPPORTED_PANEL_TYPES.includes(panel.type)) {
    logger.debug(`Skipping panel ${panel.id} (${panel.title}): unsupported type '${panel.type}'`);
    return false;
  }

  return true;
}

export interface ApplicationDashboard {
  id: string;
  name: string;
  system_under_test_id: string;
  test_environment?: string;
  workload?: string;
  dashboard_uid?: string;
  dashboard_label?: string;
  metrics_source_id?: string;
  variables?: Array<{
    name: string;
    values: string[];
  }>;
}

export interface GrafanaDashboard {
  id: string;
  uid: string;
  title: string;
  dashboard: any; // JSONB dashboard definition
  application_dashboard_id: string;
  tags?: string[];
}

export interface Benchmark {
  id: string;
  name: string;
  system_under_test_id: string;
  test_environment?: string;
  workload?: string;
  requirements?: any;
}

export interface PerfanaData {
  test_run_id: string;
  test_run: TestRun;
  application_dashboards: ApplicationDashboard[];
  benchmarks: Benchmark[];
  dashboards: GrafanaDashboard[];
}

export async function getApplicationDashboardsForTestRun(
  pool: import('pg').Pool,
  testRun: TestRun
): Promise<ApplicationDashboard[]> {
  const _logger = getLogger('panels-helpers');

  // The Python code queries by application name and test environment
  // In PostgreSQL, we need to find application dashboards that match the test run's system and environment
  let query = `
    SELECT ad.id, ad.dashboard_name as name, ad.system_under_test_id, ad.test_environment,
           ad.dashboard_uid, ad.dashboard_label, ad.variables, ad.metrics_source_id
    FROM application_dashboards ad
    WHERE ad.system_under_test_id = $1
    AND ad.test_environment = $2
  `;

  const params: any[] = [
    testRun.system_under_test_id,
    testRun.test_environment
  ];

  // RBAC: Filter by organization (backward compatible with NULL)
  if (testRun.organization_id) {
    query += `    AND (ad.organization_id = $3 OR ad.organization_id IS NULL)\n`;
    params.push(testRun.organization_id);
  }

  const result = await pool.query(query, params);

  return result.rows;
}

export async function getGrafanaDashboardsForApplicationDashboards(
  pool: import('pg').Pool,
  applicationDashboards: ApplicationDashboard[]
): Promise<GrafanaDashboard[]> {
  const logger = getLogger('panels-helpers');

  if (applicationDashboards.length === 0) {
    return [];
  }

  // Extract dashboard UIDs from application dashboards and deduplicate
  const dashboardUids = [...new Set(applicationDashboards.map(ad => ad.dashboard_uid).filter(uid => uid))];

  if (dashboardUids.length === 0) {
    logger.warn('No dashboard UIDs found in application dashboards');
    return [];
  }

  const placeholders = dashboardUids.map((_, i) => `$${i + 1}`).join(',');

  const query = `
    SELECT id, uid, name as title, grafana_json as dashboard, tags
    FROM grafana_dashboards
    WHERE uid IN (${placeholders})
  `;

  const result = await pool.query(query, dashboardUids);

  // Parse the dashboard JSON for each result
  const dashboards = result.rows.map(row => {
    let parsedDashboard = null;
    try {
      parsedDashboard = typeof row.dashboard === 'string' ? JSON.parse(row.dashboard) : row.dashboard;
    } catch (error) {
      logger.warn(`Failed to parse dashboard JSON for UID ${row.uid}: ${(error as Error).message}`);
      return null;
    }

    return {
      id: row.id,
      uid: row.uid,
      title: row.title,
      dashboard: parsedDashboard,
      application_dashboard_id: applicationDashboards.find(ad => ad.dashboard_uid === row.uid)?.id || '',
      tags: row.tags || []
    };
  }).filter(dashboard => dashboard !== null);

  return dashboards as GrafanaDashboard[];
}

export async function getBenchmarksForTestRun(
  pool: import('pg').Pool,
  testRun: TestRun
): Promise<Benchmark[]> {
  const _logger = getLogger('panels-helpers');

  // The Python code filters by application, testType, testEnvironment
  // We need to find benchmarks that match the test run characteristics
  let query = `
    SELECT id, config_title as name, system_under_test_id, test_environment, workload, configuration as requirements
    FROM benchmarks
    WHERE system_under_test_id = $1
    AND test_environment = $2
    AND workload = $3
  `;

  const params: any[] = [
    testRun.system_under_test_id,
    testRun.test_environment,
    testRun.workload
  ];

  // RBAC: Filter by organization (backward compatible with NULL)
  if (testRun.organization_id) {
    query += `    AND (organization_id = $4 OR organization_id IS NULL)\n`;
    params.push(testRun.organization_id);
  }

  const result = await pool.query(query, params);

  return result.rows;
}

export async function createPanelDocuments(
  perfanaData: PerfanaData,
  systemUnderTestName: string
): Promise<any[]> {
  const logger = getLogger('panels-helpers');

  // Step 1: Collect all unique datasource UIDs from panels
  const datasourceUids = new Set<string>();
  for (const dashboard of perfanaData.dashboards) {
    if (!dashboard.dashboard || !dashboard.dashboard.dashboard || !dashboard.dashboard.dashboard.panels) {
      continue;
    }
    for (const panel of dashboard.dashboard.dashboard.panels) {
      if (panel.targets) {
        for (const target of panel.targets) {
          if (target.datasource) {
            let uid: string | undefined;
            if (typeof target.datasource === 'object' && target.datasource.uid) {
              uid = target.datasource.uid;
            } else if (typeof target.datasource === 'string') {
              uid = target.datasource;
            }
            // Fall back to panel-level datasource when target has corrupted datasource
            if (!uid && panel.datasource && typeof panel.datasource === 'object' && panel.datasource.uid) {
              uid = panel.datasource.uid;
            }
            if (uid && uid !== 'grafana') {
              datasourceUids.add(uid);
            }
          }
        }
      }
    }
  }

  logger.info(`🔍 Found ${datasourceUids.size} unique datasource UIDs: ${Array.from(datasourceUids).join(', ')}`);

  // Step 2: Fetch datasource info from Grafana API to get numeric IDs
  const { GrafanaClient } = await import('@perfana/shared/services/grafana');
  const { getGrafanaConfig } = await import('../../config/grafana-config-cache.js');
  const grafanaConfig = getGrafanaConfig();
  const grafanaClient = new GrafanaClient(grafanaConfig);
  const datasourceMap = new Map<string, { id: number; uid: string; name: string; type: string }>();

  for (const uid of datasourceUids) {
    try {
      const datasource = await grafanaClient.getDatasourceByUid(uid);
      if (datasource) {
        datasourceMap.set(uid, datasource);
        logger.info(`✅ Fetched datasource ${uid}: id=${datasource.id}, name=${datasource.name}, type=${datasource.type}`);
      } else {
        logger.warn(`⚠️ Could not fetch datasource for UID: ${uid}`);
      }
    } catch (error) {
      logger.error(`❌ Error fetching datasource ${uid}:`, error);
    }
  }

  const panelDocuments: any[] = [];

  // Process all dashboards and create panel documents
  for (const dashboard of perfanaData.dashboards) {

    if (!dashboard.dashboard || !dashboard.dashboard.dashboard || !dashboard.dashboard.dashboard.panels) {
      continue;
    }

    // Filter 1: Skip dashboards with "no-anomaly-detection" tag
    if (dashboard.tags && dashboard.tags.includes(NO_ANOMALY_DETECTION_MARKER)) {
      logger.info(`⏭️ Skipping dashboard ${dashboard.uid} (${dashboard.title}): has "${NO_ANOMALY_DETECTION_MARKER}" tag`);
      continue;
    }


    // Find ALL corresponding application dashboards (multiple can have same dashboard_uid)
    const matchingAppDashboards = perfanaData.application_dashboards.filter(
      ad => ad.dashboard_uid === dashboard.uid
    );


    if (matchingAppDashboards.length === 0) {
      continue;
    }

    // Create panels for each matching application dashboard
    for (const appDashboard of matchingAppDashboards) {
      for (const panel of dashboard.dashboard.dashboard.panels) {
      if (!panel.id || !panel.title) {
        continue;
      }

      // Filter 2: Skip panels with "no-anomaly-detection" in description
      if (panel.description && panel.description.toLowerCase().includes(NO_ANOMALY_DETECTION_MARKER)) {
        logger.debug(`Skipping panel ${panel.id} (${panel.title}): has "${NO_ANOMALY_DETECTION_MARKER}" in description`);
        continue;
      }

      // Extract benchmark IDs for this panel
      const benchmarkIds = perfanaData.benchmarks
        .filter(_b => {
          // Panel-benchmark matching logic would go here
          // For now, include all benchmarks
          return true;
        })
        .map(b => b.id);

      // Generate template variable values from application dashboard variables
      const queryVariables = generateTemplateVariablesFromAppDashboard(
        perfanaData.test_run,
        systemUnderTestName,
        appDashboard,
        dashboard.dashboard.dashboard.templating?.list || []
      );

      // Create Grafana API request with variable substitution
      const requests = await createPanelRequests(panel, queryVariables, perfanaData.test_run, datasourceMap);


      // Extract datasource type - handle both string and object datasource formats
      let datasourceType = null;
      if (panel.datasource) {
        if (typeof panel.datasource === 'string') {
          // Datasource is a string name - need to look it up (for now, set as unknown)
          datasourceType = 'unknown';
        } else if (panel.datasource.type) {
          datasourceType = panel.datasource.type;
        }
      }

      // Check for datasource in targets as fallback
      if (!datasourceType && panel.targets && panel.targets.length > 0) {
        const firstTarget = panel.targets[0];
        if (firstTarget.datasource?.type) {
          datasourceType = firstTarget.datasource.type;
        }
      }

      // CRITICAL: Filter out panels that should not be stored
      if (!shouldStorePanel(panel, datasourceType)) {
        continue;
      }

      const panelDocument = {
        test_run_id: perfanaData.test_run_id,
        application_dashboard_id: appDashboard.id,
        metrics_source_id: appDashboard.metrics_source_id || null,
        dashboard_uid: dashboard.uid,
        panel_id: panel.id,
        panel_title: panel.title,
        dashboard_label: appDashboard.dashboard_label,
        benchmark_ids: benchmarkIds.length > 0 ? benchmarkIds : null,
        panel: panel, // Store full panel definition
        query_variables: queryVariables, // Resolved variable values
        datasource_type: datasourceType,
        requests: requests, // Pre-built Grafana API requests
        errors: null,
        warnings: null,
        updated_at: new Date()
      };

      panelDocuments.push(panelDocument);
      }
    }
  }

  return panelDocuments;
}

/**
 * Generate template variable values from application dashboard variables
 */
function generateTemplateVariablesFromAppDashboard(
  testRun: TestRun,
  systemUnderTestName: string,
  applicationDashboard: ApplicationDashboard,
  templateVariables: any[]
): Record<string, string> {
  const logger = getLogger('panels-helpers');

  const queryVariables: Record<string, string> = {
    // Base test run variables
    system_under_test: systemUnderTestName,
    test_environment: testRun.test_environment,
    timeFilter: `time >= ${testRun.start_time.getTime()}ms AND time <= ${testRun.end_time.getTime()}ms`,
    interval: "15s",
    __interval: "15s"
  };

  // Build a map of template variables for quick lookup
  const templateVarMap = new Map<string, any>();
  if (templateVariables && Array.isArray(templateVariables)) {
    for (const templateVar of templateVariables) {
      if (templateVar.name) {
        templateVarMap.set(templateVar.name, templateVar);
      }
    }
  }

  // Read variables from application dashboard
  if (applicationDashboard.variables && Array.isArray(applicationDashboard.variables)) {
    for (const variable of applicationDashboard.variables) {
      if (!variable.name) {
        continue;
      }

      // Check if variable has values
      if (variable.values && variable.values.length > 0) {
        // Use the first value if multiple values exist
        let value = variable.values[0];

        // Handle "All" as regex wildcard (matches Grafana behavior)
        if (value === 'All') {
          value = '.*';
        }

        queryVariables[variable.name] = value;
        logger.debug(`Variable ${variable.name} = ${value} (from application dashboard)`);
      } else {
        // Variable has empty values - check template definition for fallback
        const templateVar = templateVarMap.get(variable.name);

        if (templateVar) {
          // If template variable has includeAll, use its allValue
          if (templateVar.includeAll && templateVar.allValue) {
            queryVariables[variable.name] = templateVar.allValue;
            logger.debug(`Variable ${variable.name} = ${templateVar.allValue} (from template allValue)`);
          } else if (templateVar.includeAll) {
            // Default to wildcard if includeAll is true but no allValue specified
            queryVariables[variable.name] = '.*';
            logger.debug(`Variable ${variable.name} = .* (default wildcard for includeAll)`);
          } else if (templateVar.current?.value) {
            // Use template's current value as fallback
            queryVariables[variable.name] = templateVar.current.value;
            logger.debug(`Variable ${variable.name} = ${templateVar.current.value} (from template current value)`);
          } else {
            logger.warn(`Variable ${variable.name} has no values and no suitable fallback in template`);
          }
        } else {
          logger.warn(`Variable ${variable.name} has no values and not found in template variables`);
        }
      }
    }
  }

  return queryVariables;
}

/**
 * Generate template variable values from test run context (legacy method)
 * Implements the logic from PANEL_PIPELINE.md Section 2.3
 */
function _generateTemplateVariables(
  testRun: TestRun,
  systemUnderTestName: string,
  dashboardTitle: string,
  templateVariables: any[]
): Record<string, string> {
  const queryVariables: Record<string, string> = {
    // Base test run variables - using exact names from the mock script
    system_under_test: systemUnderTestName,
    test_environment: testRun.test_environment,
    timeFilter: `time >= ${testRun.start_time.getTime()}ms AND time <= ${testRun.end_time.getTime()}ms`,
    interval: "15s",
    __interval: "15s"
  };

  // Extract service from JVM dashboard titles (e.g., "JVM afterburner-be" -> service: "afterburner-be")
  if (dashboardTitle.includes('JVM') && dashboardTitle.includes(' ')) {
    const parts = dashboardTitle.split(' ');
    const service = parts[parts.length - 1];
    queryVariables.service = service;
  } else {
    // Default service fallback
    queryVariables.service = systemUnderTestName;
  }

  // Extract simulation from Gatling dashboard titles (e.g., "Gatling AfterburnerBasicSimulation" -> simulation: "AfterburnerBasicSimulation")
  if (dashboardTitle.includes('Gatling') && dashboardTitle.includes(' ')) {
    const parts = dashboardTitle.split(' ');
    const simulation = parts[parts.length - 1];
    queryVariables.simulation = simulation;
  }

  // Process actual template variables from dashboard definition
  if (templateVariables && Array.isArray(templateVariables)) {
    for (const templateVar of templateVariables) {
      if (templateVar.name && templateVar.current?.value) {
        queryVariables[templateVar.name] = templateVar.current.value;
      }
    }
  }

  return queryVariables;
}

/**
 * Create Grafana API requests for a panel with variable substitution
 * Implements the request building logic from the original Python implementation
 */
async function createPanelRequests(
  panel: any,
  queryVariables: Record<string, string>,
  testRun: TestRun,
  datasourceMap: Map<string, { id: number; uid: string; name: string; type: string }>
): Promise<any[]> {
  if (!panel.targets || panel.targets.length === 0) {
    return [];
  }

  const requests = [];

  for (let targetIndex = 0; targetIndex < panel.targets.length; targetIndex++) {
    const target = panel.targets[targetIndex];


    // Substitute variables in the target query
    const substitutedTarget = substituteVariablesInTarget(target, queryVariables, panel);

    // CRITICAL: Add datasourceId to query root level for Grafana API
    // The datasource info is in the target.datasource object but Grafana needs numeric datasourceId at root
    if (substitutedTarget.datasource && !substitutedTarget.datasourceId) {
      let uid: string | undefined;
      if (typeof substitutedTarget.datasource === 'object' && substitutedTarget.datasource.uid) {
        uid = substitutedTarget.datasource.uid;
      } else if (typeof substitutedTarget.datasource === 'string') {
        uid = substitutedTarget.datasource;
      }

      // Fall back to panel-level datasource when target datasource is corrupted
      // (e.g. a string like "Mimir" spread into {"0":"M","1":"i",...} by a buggy dashboard import)
      if (!uid && typeof substitutedTarget.datasource === 'object' && !substitutedTarget.datasource.uid) {
        const panelDs = panel.datasource;
        if (panelDs && typeof panelDs === 'object' && panelDs.uid) {
          uid = panelDs.uid;
          // Fix the target datasource so the query uses the correct datasource
          substitutedTarget.datasource = { uid: panelDs.uid, type: panelDs.type || 'prometheus' };
          logger.warn(`⚠️ Panel ${panel.id} target[${targetIndex}] has corrupted datasource, falling back to panel datasource: ${uid}`);
        }
      }

      if (uid) {
        const datasourceInfo = datasourceMap.get(uid);
        if (datasourceInfo) {
          // Use the numeric datasource ID from Grafana API (matches Python expectation)
          substitutedTarget.datasourceId = datasourceInfo.id;
        } else if (uid !== 'grafana') {
          // Skip warning for 'grafana' datasource - these panels are filtered by shouldStorePanel()
          logger.warn(`⚠️ Datasource UID ${uid} not found in datasource map, using UID as fallback`);
          substitutedTarget.datasourceId = uid; // Fallback to string UID if not found
        }
      }
    }

    // Debug logging for specific panels (can be removed after debugging)
    // if (panel.id === 106) {
    //   logger.info(`📝 Panel ${panel.id} substituted target[${targetIndex}]:`);
    //   logger.info(`   expr: ${substitutedTarget.expr || 'undefined'}`);
    //   logger.info(`   datasource: ${JSON.stringify(substitutedTarget.datasource) || 'undefined'}`);
    //   logger.info(`   datasourceId: ${substitutedTarget.datasourceId || 'undefined'}`);
    //   logger.info(`   refId: ${substitutedTarget.refId || 'undefined'}`);
    //   logger.info(`   interval: ${substitutedTarget.interval || 'undefined'}`);
    //   logger.info(`   intervalMs: ${substitutedTarget.intervalMs || 'undefined'}`);
    //   logger.info(`   step: ${substitutedTarget.step || 'undefined'}`);
    //   logger.info(`   All target properties: ${Object.keys(substitutedTarget).join(', ')}`);
    // }

    const request = {
      request_body: {
        queries: [substitutedTarget],
        from: testRun.start_time.getTime().toString(),
        to: testRun.end_time.getTime().toString(),
        interval: queryVariables.interval || "15s"
      }
    };

    requests.push(request);
  }

  return requests;
}

/**
 * Substitute template variables in a Grafana target query
 */
function substituteVariablesInTarget(target: any, queryVariables: Record<string, string>, _panel?: any): any {
  const substitutedTarget = JSON.parse(JSON.stringify(target)); // Deep clone

  // For Prometheus queries, ensure proper interval/step settings
  // Remove the huge default step that causes no data to be returned

  // Set parameters to match exact legacy structure
  substitutedTarget.step = 2400;
  // substitutedTarget.format = "time_series";
  substitutedTarget.instant = false;
  substitutedTarget.intervalFactor = 1;

  // Add missing parameters if not present
  if (!substitutedTarget.metric) {
    substitutedTarget.metric = "";
  }

  if (substitutedTarget.hide === undefined) {
    substitutedTarget.hide = false;
  }

  // Remove non-legacy parameters
  delete substitutedTarget.interval;
  delete substitutedTarget.intervalMs;
  delete substitutedTarget.maxDataPoints;

  // Substitute variables in all string fields recursively
  function substituteInObject(obj: any): any {
    if (typeof obj === 'string') {
      let result = obj;
      for (const [key, value] of Object.entries(queryVariables)) {
        if (value) {
          // Replace both $variable and ${variable} formats
          const dollarVarRegex = new RegExp(`\\$${key}\\b`, 'g');
          const bracesVarRegex = new RegExp(`\\$\\{${key}\\}`, 'g');

          result = result.replace(dollarVarRegex, value);
          result = result.replace(bracesVarRegex, value);

        }
      }
      return result;
    } else if (Array.isArray(obj)) {
      return obj.map(item => substituteInObject(item));
    } else if (obj && typeof obj === 'object') {
      const substituted: any = {};
      for (const [k, v] of Object.entries(obj)) {
        substituted[k] = substituteInObject(v);
      }
      return substituted;
    }
    return obj;
  }

  const result = substituteInObject(substitutedTarget);

  // Debug logging for final step values (can be removed after debugging)
  // if (panel && panel.id === 106) {
  //   logger.info(`🏁 Panel ${panel.id} final step: ${result.step}`);
  // }

  // After substitution, ensure interval is reasonable for Prometheus queries
  // This ensures we don't use huge step values that result in no data
  if (result.interval && result.interval.includes('h')) {
    const hours = parseInt(result.interval);
    // If interval is more than 1 hour, cap it at 1 minute for test data
    if (hours > 1) {
      result.interval = "1m";
    }
  }

  return result;
}