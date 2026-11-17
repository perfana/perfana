/**
 * Orchestrates variable discovery for dashboard templates by:
 * - Parsing dashboard JSON for template variables
 * - Delegating to VariableDetectorService for datasource queries
 * - Delegating to VariableMatcherService for filtering/matching
 * - Returning array of { name, values }
 */

import { Injectable, Logger } from '@nestjs/common';
import { TestRun, GrafanaDashboard, GrafanaInstance } from '@perfana/shared/entities';
import { DashboardVariable } from './types';
import { VariableDetectorService, TemplatingVariable } from './variable-detector.service';
import { datasourceVariableUid, templatingListFromGrafanaJson } from './datasource-variable.util';
import { VariableMatcherService } from './variable-matcher.service';

/** The two variables auto-config fills from the test run rather than from Grafana. */
const SEEDED_VARIABLE_NAMES = ['system_under_test', 'test_environment'] as const;

/**
 * A value the seeded-value gate may substitute and compare literally: names, hosts, paths and
 * versions. Anything else (quotes, regex syntax such as `.*`/`|`, `All`-style patterns from a
 * hardcoded override) is not checked at all, so it is never compared as a literal against what
 * is really a pattern, and cannot close a quoted string literal in the query. It does NOT make
 * an unquoted reference safe: the template's query text decides that, exactly as it does for
 * the same name substituted into every panel query.
 */
const SAFE_SEEDED_VALUE = /^[A-Za-z0-9 _.:\-/@,]+$/;

/** A template variable reference left in a query after substitution. */
const UNRESOLVED_VARIABLE_REF = /\$\w|\$\{|\[\[/;

@Injectable()
export class VariableDiscoveryService {
  private readonly logger = new Logger(VariableDiscoveryService.name);

  constructor(
    private variableDetectorService: VariableDetectorService,
    private variableMatcherService: VariableMatcherService,
  ) {}

  /**
   * Get application dashboard variables from template dashboard
   */
  async getApplicationDashboardVariables(
    testRun: TestRun,
    grafanaDashboard: GrafanaDashboard,
    autoConfigGrafanaDashboard: any,
    grafanaInstance: GrafanaInstance,
  ): Promise<DashboardVariable[]> {
    // Set base variables for system_under_test and test_environment
    const systemUnderTestName = testRun.systemUnderTest?.name || testRun.systemUnderTestId;
    let applicationDashboardVariables: DashboardVariable[] = [
      {
        name: 'system_under_test',
        values: [systemUnderTestName],
      },
      {
        name: 'test_environment',
        values: [testRun.testEnvironment],
      },
    ];

    // Filter out templating variable 'system_under_test' and test_environment from Grafana dashboard
    if (grafanaDashboard.templatingVariables && grafanaDashboard.templatingVariables.length > 0) {
      const templatingVariables = (grafanaDashboard.templatingVariables || []).filter(
        (v): v is TemplatingVariable =>
          v &&
          typeof v === 'object' &&
          'name' in v &&
          (v as TemplatingVariable).name !== 'system_under_test' &&
          (v as TemplatingVariable).name !== 'test_environment',
      );

      // Process each templating variable
      for (const templatingVariable of templatingVariables) {
        try {
          await this.getValuesFromDatasource(
            grafanaInstance,
            grafanaDashboard,
            testRun,
            templatingVariable,
            applicationDashboardVariables,
          );

          // Apply overrides + regex filtering immediately, BEFORE the next
          // templating variable is resolved. Template variables can chain:
          // a dependent variable's datasource query references an
          // already-resolved variable (e.g. `... IN ($scenarioName)`). If
          // filtering runs only once after the whole loop, the dependent
          // query is built against the full, unfiltered upstream values, so a
          // regex rule on the upstream variable never narrows the dependent
          // results. Filtering per-variable here lets the narrowed values flow
          // into the chained query (spanmetrics: requestName depends on
          // scenarioName + transaction, so both regex rules must constrain it).
          applicationDashboardVariables = this.variableMatcherService.overrideValues(
            applicationDashboardVariables,
            autoConfigGrafanaDashboard.setHardcodedValueForVariables,
            testRun,
          );
          applicationDashboardVariables = this.variableMatcherService.filterValuesOnRegex(
            applicationDashboardVariables,
            autoConfigGrafanaDashboard,
            testRun,
          );
        } catch (err) {
          const errorMessage = err instanceof Error ? err.stack : String(err);
          this.logger.error(
            `Failed to get values for templating variable "${templatingVariable.name}" in dashboard "${grafanaDashboard.name}"`,
            errorMessage,
          );
          // Continue processing other variables
        }
      }
    }

    // Final pass: guarantees overrides + regex are applied even when there are
    // no templating variables (the loop never runs). Idempotent for variables
    // already processed inside the loop.
    applicationDashboardVariables = this.variableMatcherService.overrideValues(
      applicationDashboardVariables,
      autoConfigGrafanaDashboard.setHardcodedValueForVariables,
      testRun,
    );
    return this.variableMatcherService.filterValuesOnRegex(
      applicationDashboardVariables,
      autoConfigGrafanaDashboard,
      testRun,
    );
  }

  /**
   * The names of the template's `system_under_test` / `test_environment` query variables
   * whose own query does not return the value this run will use — i.e. the datasource
   * has never heard of this system or environment, so every panel filtered on it is empty.
   *
   * `resolvedVariables` supplies the value to look for (after hardcoded overrides), and
   * the system name is substituted into the environment query so a chained
   * `... WHERE system = '$system_under_test'` asks about this system only.
   *
   * Fails open: whenever the answer cannot be trusted, the value counts as present. That is
   * a variable that is not a query or carries a Grafana `regex` (its values are rewritten, so
   * the raw name would never match), a value outside SAFE_SEEDED_VALUE, a query that still
   * references another variable after substitution (`$namespace` sent literally matches
   * nothing), a datasource or query shape the detector cannot read faithfully, a per-query
   * error, and a request that throws. This check may only ever stop a template whose
   * datasource answered cleanly and left the value out.
   */
  async findSeededValuesMissingFromDatasource(
    grafanaDashboard: GrafanaDashboard,
    grafanaInstance: GrafanaInstance,
    resolvedVariables: DashboardVariable[],
  ): Promise<string[]> {
    const valuesOf = (name: string) => resolvedVariables.find((v) => v.name === name)?.values ?? [];
    const valueOf = (name: string) => valuesOf(name)[0] ?? '';
    // Only a single plain literal per variable can be substituted and compared: several
    // values (a hardcoded override) leave the substitution ambiguous, and `All` is a pattern.
    const notLiteral = SEEDED_VARIABLE_NAMES.find((name) => {
      const values = valuesOf(name);
      return (
        values.length > 1 ||
        values.some((v) => v !== '' && (v === 'All' || !SAFE_SEEDED_VALUE.test(v)))
      );
    });
    if (notLiteral !== undefined) {
      this.logger.debug(
        `Template "${grafanaDashboard.name}": "${notLiteral}" is not a single plain value, not checking the template against the datasource`,
      );
      return [];
    }
    const missing: string[] = [];

    for (const name of SEEDED_VARIABLE_NAMES) {
      const variable = (grafanaDashboard.templatingVariables || []).find(
        (v): v is TemplatingVariable =>
          !!v && typeof v === 'object' && (v as TemplatingVariable).name === name,
      );
      if (!variable || variable.type !== 'query' || variable.regex) continue;

      const wanted = valueOf(name);
      if (!wanted) continue;

      const rawQuery = typeof variable.query === 'object' ? variable.query?.query : variable.query;
      let query = typeof rawQuery === 'string' ? rawQuery : '';
      if (!query.trim()) continue;
      // $var, ${var}, ${var:format} and [[var]], every occurrence.
      for (const seeded of SEEDED_VARIABLE_NAMES) {
        const n = this.variableMatcherService.escapeRegExp(seeded);
        const ref = new RegExp(
          `\\$\\{${n}(?::[^}]*)?\\}|\\[\\[${n}\\]\\]|\\$${n}(?![A-Za-z0-9_])`,
          'g',
        );
        const replacement = valueOf(seeded);
        // An empty value stays a reference, so the unresolved check below skips the query
        // rather than sending `system = ''` and reading the clean empty answer as "missing".
        if (replacement) query = query.replace(ref, () => replacement);
      }
      if (UNRESOLVED_VARIABLE_REF.test(query)) {
        this.logger.debug(
          `Template "${grafanaDashboard.name}": its "${name}" variable query references other variables, not checking it`,
        );
        continue;
      }

      try {
        const values = await this.variableDetectorService.getValuesFromDatasourceQueryOrNull(
          grafanaInstance,
          grafanaDashboard,
          variable,
          query,
        );
        // Case-insensitive: a case mismatch only ever loosens this check, never skips more.
        if (values !== null && !values.some((v) => v.toLowerCase() === wanted.toLowerCase())) {
          this.logger.warn(
            `Template "${grafanaDashboard.name}": its "${name}" variable query returned ${values.length} value(s), none of them "${wanted}"`,
          );
          missing.push(name);
        }
      } catch (err) {
        this.logger.warn(
          `Template "${grafanaDashboard.name}": could not run its "${name}" variable query, not using it to decide: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return missing;
  }

  /**
   * Get variable values from data source
   */
  private async getValuesFromDatasource(
    grafanaInstance: GrafanaInstance,
    grafanaDashboard: GrafanaDashboard,
    testRun: TestRun,
    templatingVariable: TemplatingVariable,
    applicationDashboardVariables: DashboardVariable[],
  ): Promise<void> {
    // Replace system_under_test and test_environment placeholders in query
    let templatingVariableQuery =
      typeof templatingVariable.query === 'object'
        ? templatingVariable.query.query
        : templatingVariable.query; // from grafana 7.4.x up query is an object

    if (!templatingVariableQuery) {
      templatingVariableQuery = '';
    }

    const sutName = testRun.systemUnderTest?.name || testRun.systemUnderTestId;
    let systemUnderTestQuery = templatingVariableQuery
      .replace('$system_under_test', sutName)
      .replace('$test_environment', testRun.testEnvironment);

    // Replace other templating variables in query
    applicationDashboardVariables.forEach((applicationDashboardVariable) => {
      const varNameEscaped = this.variableMatcherService.escapeRegExp(
        applicationDashboardVariable.name,
      );
      const placeholder = new RegExp('\\$' + varNameEscaped, 'g');

      if (
        placeholder.test(templatingVariableQuery) &&
        applicationDashboardVariable.name !== 'system_under_test' &&
        applicationDashboardVariable.name !== 'test_environment'
      ) {
        // Detect SQL IN ($var) context — needs quoted CSV, not pipe-separated regex
        const inClausePattern = new RegExp(`\\bIN\\s*\\(\\s*\\$${varNameEscaped}\\s*\\)`, 'i');
        const isInSqlContext = inClausePattern.test(systemUnderTestQuery);

        let replaceValue = '';

        if (isInSqlContext) {
          // Produce 'val1','val2' so IN ('val1','val2') is valid SQL
          replaceValue = applicationDashboardVariable.values
            .map((v) => `'${v.replace(/'/g, "''")}'`)
            .join(',');
        } else {
          replaceValue = applicationDashboardVariable.values
            .map((v) => (v === 'All' ? '.*' : v))
            .join('|');
        }

        systemUnderTestQuery = systemUnderTestQuery.replace(placeholder, replaceValue);
      }
    });

    const templatingVariableValues: string[] = [];

    switch (templatingVariable.type) {
      case 'constant':
        templatingVariableValues.push(templatingVariableQuery);

        applicationDashboardVariables.push({
          name: templatingVariable.name,
          values: templatingVariableValues,
        });
        break;

      case 'interval':
      case 'custom':
        // Store options in db
        templatingVariableQuery &&
          templatingVariableQuery.split(',').forEach((item) => {
            if (templatingVariableValues.indexOf(item) === -1) templatingVariableValues.push(item);
          });

        applicationDashboardVariables.push({
          name: templatingVariable.name,
          values: templatingVariableValues,
        });
        break;

      case 'query':
        try {
          // Execute datasource query to get variable values
          const values = await this.variableDetectorService.getValuesFromDatasourceQuery(
            grafanaInstance,
            grafanaDashboard,
            templatingVariable,
            systemUnderTestQuery,
          );

          // For multi-value variables with "All" option, default to ["All"] if query returns empty
          const finalValues =
            values.length === 0 && templatingVariable.includeAll ? ['All'] : values;

          if (values.length === 0 && templatingVariable.includeAll) {
            this.logger.log(
              `Query returned empty results for variable "${templatingVariable.name}", defaulting to ["All"] (includeAll: true)`,
            );
          }

          applicationDashboardVariables.push({
            name: templatingVariable.name,
            values: finalValues,
          });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.stack : String(err);
          this.logger.error(
            `Failed to execute query for variable "${templatingVariable.name}": ${errorMessage}`,
          );
          // Add variable with default value based on includeAll flag
          // For multi-value variables with "All" option, default to ["All"]
          const defaultValue = templatingVariable.includeAll ? ['All'] : [];
          applicationDashboardVariables.push({
            name: templatingVariable.name,
            values: defaultValue,
          });
          this.logger.log(
            `Set default value for variable "${templatingVariable.name}" to ${JSON.stringify(defaultValue)} (includeAll: ${templatingVariable.includeAll})`,
          );
        }
        break;

      case 'datasource': {
        // Grafana resolves a datasource variable to the uid it is currently set to; the
        // variable's `query` is only the plugin-type filter and cannot be substituted into a
        // panel's `datasource.uid`. Without this row, `${datasource}` reaches /api/ds/query
        // verbatim and every query on the dashboard is rejected (issue #657).
        const datasourceUid = this.getDatasourceVariableUid(
          grafanaDashboard,
          templatingVariable.name,
        );

        if (!datasourceUid) {
          this.logger.warn(
            `Datasource variable "${templatingVariable.name}" has no current value in dashboard "${grafanaDashboard.name}" — set the dropdown in Grafana and save, or add the variable with the datasource uid on the application dashboard`,
          );
          break;
        }

        applicationDashboardVariables.push({
          name: templatingVariable.name,
          values: [datasourceUid],
        });
        break;
      }

      default:
        this.logger.warn(`Variable of type ${templatingVariable.type} not supported`);
    }
  }

  /**
   * The uid a `type: 'datasource'` variable is currently set to, read from grafana_json.
   * Not from `grafanaDashboard.templatingVariables`: `extractTemplatingVariables` drops
   * `current`, and a stored dashboard is only re-extracted when it changes in Grafana, so
   * every dashboard already in the database would stay unresolvable.
   */
  private getDatasourceVariableUid(
    grafanaDashboard: GrafanaDashboard,
    variableName: string,
  ): string | undefined {
    return datasourceVariableUid(
      templatingListFromGrafanaJson(grafanaDashboard.grafanaJson),
      variableName,
    );
  }
}
