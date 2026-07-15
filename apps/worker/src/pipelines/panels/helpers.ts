import { TestRun } from '../../types/pipeline.js';
import { getLogger } from '../../lib/utils/logger.js';

interface PoolLike {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

interface GrafanaTargetJson {
  datasource?: { uid?: string; type?: string } | string;
  refId?: string;
  query?: string;
  datasourceId?: number | string;
  [key: string]: unknown;
}

interface GrafanaPanelJson {
  id?: number;
  title?: string;
  type?: string;
  description?: string;
  datasource?: { uid?: string; type?: string } | string;
  targets?: GrafanaTargetJson[];
  fieldConfig?: { defaults?: { unit?: string } };
  options?: { reduceOptions?: { calcs?: string[] } };
  transformations?: unknown[];
  repeat?: string; // Grafana "repeat by variable" — expand into one panel per variable value
}

// Cap how many panels a single repeating panel expands into, to avoid a large
// host list exploding ds_panels/ds_metrics.
const MAX_REPEAT_EXPANSION = 20;

/** Replace both `$name` and `${name}` occurrences of a template variable in a string. */
function substituteVarInString(str: string, name: string, value: string): string {
  return str
    .replace(new RegExp(`\\$${name}\\b`, 'g'), value)
    .replace(new RegExp(`\\$\\{${name}\\}`, 'g'), value);
}

/**
 * Does the repeat variable appear in the panel's targets (query/legend)? If so, the
 * Grafana series legend already differs per value, so metric_name is naturally unique and
 * we don't need to prefix it. ponytail: substring heuristic, not word-boundary — `$hostname`
 * would match `$host`; upgrade to a tokenized scan only if that collision ever bites.
 */
function repeatVarInTargets(targets: GrafanaTargetJson[] | undefined, name: string): boolean {
  const s = JSON.stringify(targets ?? []);
  return s.includes(`$${name}`) || s.includes(`\${${name}}`);
}

interface GrafanaDashboardContent {
  panels?: GrafanaPanelJson[];
  templating?: { list?: unknown[] };
}

interface GrafanaDashboardJson {
  dashboard?: GrafanaDashboardContent;
}

interface TemplateVariable {
  name?: string;
  includeAll?: boolean;
  allValue?: string;
  current?: { value?: string };
}

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
function shouldStorePanel(panel: unknown, datasourceType: string | null): boolean {
  const p = panel as GrafanaPanelJson;
  // Filter 1: Skip panels with "grafana" datasource
  if (datasourceType === 'grafana') {
    logger.debug(`Skipping panel ${p.id} (${p.title}): grafana datasource`);
    return false;
  }

  if (p.datasource === 'grafana' || (typeof p.datasource === 'object' && p.datasource?.uid === 'grafana')) {
    logger.debug(`Skipping panel ${p.id} (${p.title}): grafana datasource`);
    return false;
  }

  // Filter 2: Skip panels with unsupported types
  if (!p.type || !SUPPORTED_PANEL_TYPES.includes(p.type)) {
    logger.debug(`Skipping panel ${p.id} (${p.title}): unsupported type '${p.type}'`);
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
  dashboard: unknown; // JSONB dashboard definition
  application_dashboard_id: string;
  tags?: string[];
}

export interface Benchmark {
  id: string;
  name: string;
  system_under_test_id: string;
  test_environment?: string;
  workload?: string;
  requirements?: unknown;
}

export interface PerfanaData {
  test_run_id: string;
  test_run: TestRun;
  application_dashboards: ApplicationDashboard[];
  benchmarks: Benchmark[];
  dashboards: GrafanaDashboard[];
}

export async function getApplicationDashboardsForTestRun(
  pool: PoolLike,
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

  const params: unknown[] = [
    testRun.system_under_test_id,
    testRun.test_environment
  ];

  // RBAC: Filter by organization (backward compatible with NULL)
  if (testRun.organization_id) {
    query += `    AND (ad.organization_id = $3 OR ad.organization_id IS NULL)\n`;
    params.push(testRun.organization_id);
  }

  const result = await pool.query(query, params);

  return result.rows as ApplicationDashboard[];
}

export async function getGrafanaDashboardsForApplicationDashboards(
  pool: PoolLike,
  applicationDashboards: ApplicationDashboard[]
): Promise<GrafanaDashboard[]> {
  const logger = getLogger('panels-helpers');

  if (applicationDashboards.length === 0) {
    return [];
  }

  // Extract dashboard UIDs from application dashboards and deduplicate
  const dashboardUids = [...new Set(applicationDashboards.map(ad => ad.dashboard_uid).filter((uid): uid is string => !!uid))];

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
  const dashboards = result.rows.map(rawRow => {
    const row = rawRow as { id: string; uid: string; title: string; dashboard: unknown; tags?: string[] };
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
  pool: PoolLike,
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

  const params: unknown[] = [
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

  return result.rows as Benchmark[];
}

export async function createPanelDocuments(
  perfanaData: PerfanaData,
  systemUnderTestName: string
): Promise<unknown[]> {
  const logger = getLogger('panels-helpers');

  // Step 1: Collect all unique datasource UIDs from panels
  const datasourceUids = new Set<string>();
  for (const dashboard of perfanaData.dashboards) {
    const dashboardJson = dashboard.dashboard as GrafanaDashboardJson | undefined;
    if (!dashboardJson?.dashboard?.panels) {
      continue;
    }
    for (const panel of dashboardJson.dashboard.panels) {
      const p = panel as GrafanaPanelJson;
      if (p.targets) {
        for (const target of p.targets) {
          const t = target as GrafanaTargetJson;
          if (t.datasource) {
            let uid: string | undefined;
            if (typeof t.datasource === 'object' && t.datasource.uid) {
              uid = t.datasource.uid;
            } else if (typeof t.datasource === 'string') {
              uid = t.datasource;
            }
            // Fall back to panel-level datasource when target has corrupted datasource
            if (!uid && p.datasource && typeof p.datasource === 'object' && p.datasource.uid) {
              uid = p.datasource.uid;
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
  const grafanaConfig = await getGrafanaConfig();
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

  const panelDocuments: unknown[] = [];

  // Process all dashboards and create panel documents
  for (const dashboard of perfanaData.dashboards) {
    const dashboardJson = dashboard.dashboard as GrafanaDashboardJson | undefined;

    if (!dashboardJson?.dashboard?.panels) {
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
      for (const panel of dashboardJson.dashboard.panels) {
        const p = panel as GrafanaPanelJson;
      if (!p.id || !p.title) {
        continue;
      }

      // Filter 2: Skip panels with "no-anomaly-detection" in description
      if (p.description && p.description.toLowerCase().includes(NO_ANOMALY_DETECTION_MARKER)) {
        logger.debug(`Skipping panel ${p.id} (${p.title}): has "${NO_ANOMALY_DETECTION_MARKER}" in description`);
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

      // Base template variable values from application dashboard variables
      const baseQueryVariables = generateTemplateVariablesFromAppDashboard(
        perfanaData.test_run,
        systemUnderTestName,
        appDashboard,
        dashboardJson.dashboard.templating?.list || []
      );

      // Extract datasource type - handle both string and object datasource formats
      // (invariant across repeat expansion — depends only on the panel definition)
      let datasourceType = null;
      if (p.datasource) {
        if (typeof p.datasource === 'string') {
          // Datasource is a string name - need to look it up (for now, set as unknown)
          datasourceType = 'unknown';
        } else if (p.datasource.type) {
          datasourceType = p.datasource.type;
        }
      }

      // Check for datasource in targets as fallback
      if (!datasourceType && p.targets && p.targets.length > 0) {
        const firstTarget = p.targets[0];
        const fds = firstTarget.datasource;
        if (fds && typeof fds === 'object' && fds.type) {
          datasourceType = fds.type;
        }
      }

      // CRITICAL: Filter out panels that should not be stored
      if (!shouldStorePanel(p, datasourceType)) {
        continue;
      }

      // Grafana "repeat by variable": expand into one panel per value of the repeat variable.
      // Non-repeating panels (or ones whose variable has no values) yield a single doc (repeatValue = null).
      const repeatVar = p.repeat;
      const repeatValues =
        repeatVar
          ? (appDashboard.variables?.find(v => v.name === repeatVar)?.values ?? [])
          : [];
      let expansionValues: (string | null)[] = [null];
      if (repeatValues.length > 0) {
        if (repeatValues.length > MAX_REPEAT_EXPANSION) {
          logger.warn(
            `Panel ${p.id} (${p.title}) repeats over ${repeatValues.length} "${repeatVar}" values; capping at ${MAX_REPEAT_EXPANSION}`
          );
        }
        expansionValues = repeatValues.slice(0, MAX_REPEAT_EXPANSION);
      }
      // If the repeat var is in the query/legend, metric_name is naturally unique per value;
      // otherwise (var only in title, or nowhere) we must prefix metric_name to avoid ds_metrics collisions.
      const varInTargets = repeatVar ? repeatVarInTargets(p.targets, repeatVar) : false;

      for (const repeatValue of expansionValues) {
        const queryVariables = { ...baseQueryVariables };
        let panelTitle = p.title;
        if (repeatValue !== null && repeatVar) {
          queryVariables[repeatVar] = repeatValue === 'All' ? '.*' : repeatValue;
          panelTitle = substituteVarInString(p.title, repeatVar, repeatValue);
        }

        // Store the (title-resolved) panel. When the repeat value won't surface in the legend,
        // stash a hint the formatter uses to prefix metric_name — keeps the real panel_id (and
        // thus Grafana deep links) intact while making (panel_id, metric_name) unique per value.
        const panelForDoc: GrafanaPanelJson & { __perfanaMetricPrefix?: string } = {
          ...p,
          title: panelTitle,
        };
        if (repeatValue !== null && !varInTargets) {
          panelForDoc.__perfanaMetricPrefix = repeatValue;
        }

        // Create Grafana API request with variable substitution (per repeat value)
        const requests = await createPanelRequests(panelForDoc, queryVariables, perfanaData.test_run, datasourceMap);

        const panelDocument = {
          test_run_id: perfanaData.test_run_id,
          application_dashboard_id: appDashboard.id,
          metrics_source_id: appDashboard.metrics_source_id || null,
          dashboard_uid: dashboard.uid,
          panel_id: p.id,
          panel_title: panelTitle,
          dashboard_label: appDashboard.dashboard_label,
          benchmark_ids: benchmarkIds.length > 0 ? benchmarkIds : null,
          panel: panelForDoc, // Store full panel definition (title resolved, prefix hint when needed)
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
  templateVariables: unknown[]
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
  const templateVarMap = new Map<string, TemplateVariable>();
  if (templateVariables && Array.isArray(templateVariables)) {
    for (const templateVar of templateVariables) {
      const tv = templateVar as TemplateVariable;
      if (tv.name) {
        templateVarMap.set(tv.name, tv);
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
  templateVariables: unknown[]
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
      const tv = templateVar as TemplateVariable;
      if (tv.name && tv.current?.value) {
        queryVariables[tv.name] = tv.current.value;
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
  panel: unknown,
  queryVariables: Record<string, string>,
  testRun: TestRun,
  datasourceMap: Map<string, { id: number; uid: string; name: string; type: string }>
): Promise<Record<string, unknown>[]> {
  const p = panel as GrafanaPanelJson;
  if (!p.targets || p.targets.length === 0) {
    return [];
  }

  const requests = [];

  for (let targetIndex = 0; targetIndex < p.targets.length; targetIndex++) {
    const target = p.targets[targetIndex];


    // Substitute variables in the target query
    const substitutedTarget = substituteVariablesInTarget(target, queryVariables);

    // CRITICAL: Add datasourceId to query root level for Grafana API
    // The datasource info is in the target.datasource object but Grafana needs numeric datasourceId at root
    if (substitutedTarget.datasource && !substitutedTarget.datasourceId) {
      let uid: string | undefined;
      const ds = substitutedTarget.datasource as Record<string, unknown> | string;
      if (typeof ds === 'object' && ds.uid) {
        uid = ds.uid as string;
      } else if (typeof ds === 'string') {
        uid = ds;
      }

      // Fall back to panel-level datasource when target datasource is corrupted
      // (e.g. a string like "Mimir" spread into {"0":"M","1":"i",...} by a buggy dashboard import)
      if (!uid && typeof ds === 'object' && !ds.uid) {
        const panelDs = p.datasource as Record<string, unknown> | undefined;
        if (panelDs && typeof panelDs === 'object' && panelDs.uid) {
          uid = panelDs.uid as string;
          // Fix the target datasource so the query uses the correct datasource
          substitutedTarget.datasource = { uid: panelDs.uid, type: panelDs.type || 'prometheus' };
          logger.warn(`⚠️ Panel ${p.id} target[${targetIndex}] has corrupted datasource, falling back to panel datasource: ${uid}`);
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
function substituteVariablesInTarget(target: unknown, queryVariables: Record<string, string>): Record<string, unknown> {
  const substitutedTarget = structuredClone(target) as Record<string, unknown>;

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
  function substituteInObject(obj: unknown): unknown {
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
      const substituted: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        substituted[k] = substituteInObject(v);
      }
      return substituted;
    }
    return obj;
  }

  const result = substituteInObject(substitutedTarget) as Record<string, unknown>;

  // After substitution, ensure interval is reasonable for Prometheus queries
  // This ensures we don't use huge step values that result in no data
  const interval = result.interval as string | undefined;
  if (interval && interval.includes('h')) {
    const hours = parseInt(interval);
    // If interval is more than 1 hour, cap it at 1 minute for test data
    if (hours > 1) {
      result.interval = "1m";
    }
  }

  return result;
}