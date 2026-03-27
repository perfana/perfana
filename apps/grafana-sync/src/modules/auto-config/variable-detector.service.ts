/**
 * Handles datasource-specific variable value detection:
 * - InfluxDB queries
 * - Prometheus queries (label_values and simple queries)
 * - PostgreSQL queries via Grafana's unified query API
 */

import { Injectable, Logger } from '@nestjs/common';
import { GrafanaApiService } from '../grafana-api/grafana-api.service';
import { GrafanaDashboard, GrafanaInstance } from '@perfana/shared/entities';
import { validateRegexPattern } from '@perfana/shared/utils';

export interface TemplatingVariable {
  name: string;
  type: string;
  query?: string | { query: string };
  datasource?: any;
  regex?: string;
  includeAll?: boolean;
  allValue?: string;
  multi?: boolean;
}

@Injectable()
export class VariableDetectorService {
  private readonly logger = new Logger(VariableDetectorService.name);

  constructor(private grafanaApiService: GrafanaApiService) {}

  /**
   * Apply regex filter to a value and collect results.
   * Handles: strip leading/trailing `/` from regex, validate for ReDoS safety,
   * use captured groups when available, or whole match otherwise, and deduplicate.
   */
  private applyRegexFilterAndCollect(
    value: string,
    variable: TemplatingVariable,
    variableValues: string[],
  ): void {
    if (variable.regex && variable.regex !== '') {
      const regexPattern = variable.regex.replace(/^\/|\/$/g, '');
      const validationResult = validateRegexPattern(regexPattern);

      if (!validationResult.safe || !validationResult.regex) {
        this.logger.warn(
          `Invalid or unsafe regex pattern in variable "${variable.name}": ${validationResult.error}`,
        );
        if (variableValues.indexOf(value) === -1) {
          variableValues.push(value);
        }
      } else {
        const matches = value.match(validationResult.regex);

        if (matches && matches.length > 1) {
          let valueAfterRegex = '';
          for (let i = 1; i < matches.length; i++) {
            valueAfterRegex += matches[i];
          }
          if (valueAfterRegex && variableValues.indexOf(valueAfterRegex) === -1) {
            variableValues.push(valueAfterRegex);
          }
        } else if (matches && variableValues.indexOf(value) === -1) {
          variableValues.push(value);
        }
      }
    } else {
      if (variableValues.indexOf(value) === -1) {
        variableValues.push(value);
      }
    }
  }

  async getValuesFromDatasourceQuery(
    grafanaInstance: GrafanaInstance,
    grafanaDashboard: GrafanaDashboard,
    templatingVariable: TemplatingVariable,
    systemUnderTestQuery: string,
  ): Promise<string[]> {
    // Get datasource info from Grafana API
    let datasource: any;

    if (templatingVariable.datasource && typeof templatingVariable.datasource === 'object') {
      // Datasource specified as object with uid
      const datasourceUid = (templatingVariable.datasource as any).uid;
      if (datasourceUid) {
        datasource = await this.grafanaApiService.getDatasourceByUidWithLabel(
          grafanaInstance.label,
          datasourceUid,
        );
      } else {
        this.logger.warn(
          `Datasource for variable "${templatingVariable.name}" has no uid, skipping query`,
        );
        return [];
      }
    } else if (typeof templatingVariable.datasource === 'string') {
      // Datasource specified as string (name)
      datasource = await this.grafanaApiService.getDatasourceByNameWithLabel(
        grafanaInstance.label,
        templatingVariable.datasource,
      );
    } else {
      this.logger.warn(`No datasource specified for variable "${templatingVariable.name}"`);
      return [];
    }

    // Route to datasource-specific implementation
    switch (datasource.type) {
      case 'influxdb':
        return await this.getInfluxVariableValues(
          grafanaInstance,
          grafanaDashboard,
          datasource,
          templatingVariable,
          systemUnderTestQuery,
        );

      case 'prometheus':
        return await this.getPrometheusVariableValues(
          grafanaInstance,
          grafanaDashboard,
          datasource,
          templatingVariable,
          systemUnderTestQuery,
        );

      case 'postgres':
      case 'grafana-postgresql-datasource':
        return await this.getPostgresVariableValues(
          grafanaInstance,
          grafanaDashboard,
          datasource,
          templatingVariable,
          systemUnderTestQuery,
        );

      case 'graphite':
        this.logger.warn(
          `Graphite datasource queries not yet implemented for variable "${templatingVariable.name}"`,
        );
        return [];

      default:
        this.logger.warn(
          `Datasource type "${datasource.type}" not supported for variable "${templatingVariable.name}"`,
        );
        return [];
    }
  }

  private async getInfluxVariableValues(
    grafanaInstance: GrafanaInstance,
    grafanaDashboard: GrafanaDashboard,
    datasource: any,
    variable: TemplatingVariable,
    query: string,
  ): Promise<string[]> {
    const queryUrl =
      `/api/datasources/proxy/uid/${datasource.uid}/query?` +
      `db=${datasource.database}&q=${encodeURIComponent(query)}`;

    const variableValues: string[] = [];

    try {
      const response = await this.grafanaApiService.getByLabel(grafanaInstance.label, queryUrl);

      if (response.results) {
        response.results.forEach((result: any) => {
          if (result.series) {
            result.series.forEach((serie: any) => {
              if (serie.values) {
                serie.values.forEach((value: any) => {
                  const variableValue = value.length === 1 ? value[0] : value[1];
                  this.applyRegexFilterAndCollect(variableValue, variable, variableValues);
                });
              }
            });
          }
        });
      }

      return variableValues;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.stack : String(err);
      this.logger.error(
        `Error getting values for query "${queryUrl}" for variable "${variable.name}" ` +
          `in dashboard "${grafanaDashboard.name}" from grafana instance "${grafanaInstance.label}": ${errorMessage}`,
      );
      throw err;
    }
  }

  private async getPrometheusVariableValues(
    grafanaInstance: GrafanaInstance,
    grafanaDashboard: GrafanaDashboard,
    datasource: any,
    variable: TemplatingVariable,
    query: string,
  ): Promise<string[]> {
    let queryUrl: string;

    const queryRegex = /label_values\((.*),\s*([^)]+)\)/;
    const isLabelValuesQuery = queryRegex.test(query);

    if (isLabelValuesQuery) {
      const match = queryRegex.exec(query);
      const metric = match![1];

      const timeRangeDays = 7;
      const endTime = Math.round(new Date().getTime() / 1000);
      const startTime = Math.round(
        new Date(new Date().setDate(new Date().getDate() - timeRangeDays)).getTime() / 1000,
      );

      queryUrl =
        `/api/datasources/proxy/uid/${datasource.uid}/api/v1/series?` +
        `match[]=${encodeURIComponent(metric)}&start=${startTime}&end=${endTime}`;
    } else {
      queryUrl = `/api/datasources/proxy/uid/${datasource.uid}/api/v1/label/${variable.name}/values`;
    }

    const variableValues: string[] = [];

    try {
      const response = await this.grafanaApiService.getByLabel(grafanaInstance.label, queryUrl);

      if (isLabelValuesQuery) {
        const match = queryRegex.exec(query);
        const labelName = match![2];

        if (response.data && Array.isArray(response.data)) {
          const uniqueValues = new Set<string>();
          response.data.forEach((series: any) => {
            if (series[labelName]) {
              uniqueValues.add(series[labelName]);
            }
          });

          uniqueValues.forEach((value) => {
            this.applyRegexFilterAndCollect(value, variable, variableValues);
          });
        }
      } else {
        if (response.data && Array.isArray(response.data)) {
          response.data.forEach((value: string) => {
            this.applyRegexFilterAndCollect(value, variable, variableValues);
          });
        }
      }

      return variableValues;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.stack : String(err);
      this.logger.error(
        `Error getting values for query "${queryUrl}" for variable "${variable.name}" ` +
          `in dashboard "${grafanaDashboard.name}" from grafana instance "${grafanaInstance.label}": ${errorMessage}`,
      );
      throw err;
    }
  }

  private async getPostgresVariableValues(
    grafanaInstance: GrafanaInstance,
    grafanaDashboard: GrafanaDashboard,
    datasource: any,
    variable: TemplatingVariable,
    query: string,
  ): Promise<string[]> {
    const variableValues: string[] = [];

    const queryPayload = {
      queries: [
        {
          refId: 'A',
          datasource: {
            uid: datasource.uid,
            type: 'postgres',
          },
          rawSql: query,
          format: 'table',
        },
      ],
    };

    try {
      this.logger.debug(`PostgreSQL query for variable "${variable.name}": ${query}`);

      const response = await this.grafanaApiService.postByLabel(
        grafanaInstance.label,
        '/api/ds/query',
        queryPayload,
      );

      this.logger.debug(
        `PostgreSQL query response for variable "${variable.name}": ${JSON.stringify(response, null, 2)}`,
      );

      if (response.results?.A?.frames) {
        for (const frame of response.results.A.frames) {
          if (frame.data?.values && frame.data.values.length > 0) {
            const values = frame.data.values[0];

            if (Array.isArray(values)) {
              for (const value of values) {
                this.applyRegexFilterAndCollect(String(value), variable, variableValues);
              }
            }
          }
        }
      }

      return variableValues;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.stack : String(err);
      this.logger.error(
        `Error getting values for PostgreSQL query for variable "${variable.name}" ` +
          `in dashboard "${grafanaDashboard.name}" from grafana instance "${grafanaInstance.label}": ${errorMessage}`,
      );
      throw err;
    }
  }
}
