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
import { VariableMatcherService } from './variable-matcher.service';

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

      default:
        this.logger.warn(`Variable of type ${templatingVariable.type} not supported`);
    }
  }
}
