/**
 * Copyright 2025 Perfana Contributors
 *
 * VariableDetectorService
 *
 * Extracted from: variable-discovery.service.ts
 * Migrated from: perfana-grafana/auto-config/get-application-dashboard-variables.js
 *
 * Handles datasource-specific variable value detection:
 * - InfluxDB queries
 * - Prometheus queries (label_values and simple queries)
 * - PostgreSQL queries via Grafana's unified query API
 */

import { Injectable, Logger } from '@nestjs/common';
import { GrafanaApiService } from '../grafana-api/grafana-api.service';
import { MappedGrafanaDashboard } from './auto-config-finders.service';
import { validateRegexPattern } from '@perfana/shared/utils';

/**
 * Template variable from Grafana dashboard
 */
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

/**
 * Grafana instance configuration
 */
export interface GrafanaInstanceConfig {
  label: string;
  serverUrl?: string;
  clientUrl: string;
  apiKey?: string;
}

@Injectable()
export class VariableDetectorService {
  private readonly logger = new Logger(VariableDetectorService.name);

  constructor(private grafanaApiService: GrafanaApiService) {}

  /**
   * Get variable values from datasource query
   * Migrated from: get-application-dashboard-variables.js:187-207 and getVariableValuesFromDatasource:218-235
   */
  async getValuesFromDatasourceQuery(
    grafanaInstance: GrafanaInstanceConfig,
    grafanaDashboard: MappedGrafanaDashboard,
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

  /**
   * Get variable values from InfluxDB datasource
   * Migrated from: helpers/datasources/influxdb.js:20-77
   */
  private async getInfluxVariableValues(
    grafanaInstance: GrafanaInstanceConfig,
    grafanaDashboard: MappedGrafanaDashboard,
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
                  // If query == 'show measurements' values come in array of single strings
                  const variableValue = value.length === 1 ? value[0] : value[1];

                  // Apply regex filter if specified
                  if (variable.regex && variable.regex !== '') {
                    // Remove '/' from start and end of regex
                    const regexPattern = variable.regex.replace(/^\/|\/$/g, '');
                    // Validate regex pattern for ReDoS safety
                    const validationResult = validateRegexPattern(regexPattern);

                    if (!validationResult.safe || !validationResult.regex) {
                      this.logger.warn(
                        `Invalid or unsafe regex pattern in variable "${variable.name}": ${validationResult.error}`,
                      );
                      // Fallback: use original value without regex filtering
                      if (variableValues.indexOf(variableValue) === -1) {
                        variableValues.push(variableValue);
                      }
                    } else {
                      const matches = variableValue.match(validationResult.regex);

                      if (matches && variableValues.indexOf(variableValue) === -1) {
                        variableValues.push(variableValue);
                      }
                    }
                  } else {
                    // No regex filter, add if not duplicate
                    if (variableValues.indexOf(variableValue) === -1) {
                      variableValues.push(variableValue);
                    }
                  }
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

  /**
   * Get variable values from Prometheus datasource
   * Migrated from: helpers/datasources/prometheus.js:25-136
   */
  private async getPrometheusVariableValues(
    grafanaInstance: GrafanaInstanceConfig,
    grafanaDashboard: MappedGrafanaDashboard,
    datasource: any,
    variable: TemplatingVariable,
    query: string,
  ): Promise<string[]> {
    let queryUrl: string;

    // Check if query is label_values(metric, label) format
    const queryRegex = /label_values\((.*),\s*([^)]+)\)/;
    const isLabelValuesQuery = queryRegex.test(query);

    if (isLabelValuesQuery) {
      // Extract metric and label from query
      const match = queryRegex.exec(query);
      const metric = match![1];

      // Query time range (default: 7 days back)
      const timeRangeDays = 7;
      const endTime = Math.round(new Date().getTime() / 1000);
      const startTime = Math.round(
        new Date(new Date().setDate(new Date().getDate() - timeRangeDays)).getTime() / 1000,
      );

      // Use /api/v1/series endpoint for label_values queries
      queryUrl =
        `/api/datasources/proxy/uid/${datasource.uid}/api/v1/series?` +
        `match[]=${encodeURIComponent(metric)}&start=${startTime}&end=${endTime}`;
    } else {
      // Simple label query - use /api/v1/label/{name}/values endpoint
      queryUrl = `/api/datasources/proxy/uid/${datasource.uid}/api/v1/label/${variable.name}/values`;
    }

    const variableValues: string[] = [];

    try {
      const response = await this.grafanaApiService.getByLabel(grafanaInstance.label, queryUrl);

      if (isLabelValuesQuery) {
        // Extract label values from series response
        const match = queryRegex.exec(query);
        const labelName = match![2];

        if (response.data && Array.isArray(response.data)) {
          // Extract unique values for the specified label
          const uniqueValues = new Set<string>();

          response.data.forEach((series: any) => {
            if (series[labelName]) {
              uniqueValues.add(series[labelName]);
            }
          });

          // Apply regex filter if specified
          uniqueValues.forEach((value) => {
            if (variable.regex && variable.regex !== '') {
              const regexPattern = variable.regex.replace(/^\/|\/$/g, '');
              // Validate regex pattern for ReDoS safety
              const validationResult = validateRegexPattern(regexPattern);

              if (!validationResult.safe || !validationResult.regex) {
                this.logger.warn(
                  `Invalid or unsafe regex pattern in variable "${variable.name}": ${validationResult.error}`,
                );
                // Fallback: use original value without regex filtering
                if (variableValues.indexOf(value) === -1) {
                  variableValues.push(value);
                }
              } else {
                const matches = value.match(validationResult.regex);

                if (matches && matches.length > 1) {
                  // Use captured groups if available
                  let valueAfterRegex = '';
                  for (let i = 1; i < matches.length; i++) {
                    valueAfterRegex += matches[i];
                  }
                  if (valueAfterRegex && variableValues.indexOf(valueAfterRegex) === -1) {
                    variableValues.push(valueAfterRegex);
                  }
                } else if (matches && variableValues.indexOf(value) === -1) {
                  // No captured groups, use whole match
                  variableValues.push(value);
                }
              }
            } else {
              // No regex filter
              if (variableValues.indexOf(value) === -1) {
                variableValues.push(value);
              }
            }
          });
        }
      } else {
        // Simple label values response
        if (response.data && Array.isArray(response.data)) {
          response.data.forEach((value: string) => {
            if (variable.regex && variable.regex !== '') {
              const regexPattern = variable.regex.replace(/^\/|\/$/g, '');
              // Validate regex pattern for ReDoS safety
              const validationResult = validateRegexPattern(regexPattern);

              if (!validationResult.safe || !validationResult.regex) {
                this.logger.warn(
                  `Invalid or unsafe regex pattern in variable "${variable.name}": ${validationResult.error}`,
                );
                // Fallback: include value without regex filtering
                if (variableValues.indexOf(value) === -1) {
                  variableValues.push(value);
                }
              } else {
                const matches = value.match(validationResult.regex);

                if (matches && variableValues.indexOf(value) === -1) {
                  variableValues.push(value);
                }
              }
            } else {
              // No regex filter
              if (variableValues.indexOf(value) === -1) {
                variableValues.push(value);
              }
            }
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

  /**
   * Get variable values from PostgreSQL datasource
   * Uses Grafana's unified query API (/api/ds/query) with POST request
   */
  private async getPostgresVariableValues(
    grafanaInstance: GrafanaInstanceConfig,
    grafanaDashboard: MappedGrafanaDashboard,
    datasource: any,
    variable: TemplatingVariable,
    query: string,
  ): Promise<string[]> {
    const variableValues: string[] = [];

    // Build the query payload for Grafana's unified query API
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

      // Parse the response - Grafana returns data in frames format
      if (response.results?.A?.frames) {
        for (const frame of response.results.A.frames) {
          // Each frame has a schema with fields and data with values
          if (frame.data?.values && frame.data.values.length > 0) {
            // Use the first column values (or __text if it's a text/value pair)
            const values = frame.data.values[0];

            if (Array.isArray(values)) {
              for (const value of values) {
                const stringValue = String(value);

                // Apply regex filter if specified
                if (variable.regex && variable.regex !== '') {
                  const regexPattern = variable.regex.replace(/^\/|\/$/g, '');
                  // Validate regex pattern for ReDoS safety
                  const validationResult = validateRegexPattern(regexPattern);

                  if (!validationResult.safe || !validationResult.regex) {
                    this.logger.warn(
                      `Invalid or unsafe regex pattern in variable "${variable.name}": ${validationResult.error}`,
                    );
                    // Fallback: use original value without regex filtering
                    if (variableValues.indexOf(stringValue) === -1) {
                      variableValues.push(stringValue);
                    }
                  } else {
                    const matches = stringValue.match(validationResult.regex);

                    if (matches && matches.length > 1) {
                      // Use captured groups if available
                      let valueAfterRegex = '';
                      for (let i = 1; i < matches.length; i++) {
                        valueAfterRegex += matches[i];
                      }
                      if (valueAfterRegex && variableValues.indexOf(valueAfterRegex) === -1) {
                        variableValues.push(valueAfterRegex);
                      }
                    } else if (matches && variableValues.indexOf(stringValue) === -1) {
                      // No captured groups, use whole match
                      variableValues.push(stringValue);
                    }
                  }
                } else {
                  // No regex filter
                  if (variableValues.indexOf(stringValue) === -1) {
                    variableValues.push(stringValue);
                  }
                }
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
