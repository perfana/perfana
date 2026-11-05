/**
 * Handles datasource-specific variable value detection:
 * - InfluxDB queries
 * - Prometheus queries (label_values and simple queries)
 * - PostgreSQL queries via Grafana's unified query API
 */

import { Injectable, Logger } from '@nestjs/common';
import { GrafanaApiService } from '../grafana-api/grafana-api.service';
import {
  datasourceVariableUid,
  parseTemplateVariableRef,
  templatingListFromGrafanaJson,
} from './datasource-variable.util';
import { GrafanaDashboard, GrafanaInstance } from '@perfana/shared/entities';
import { validateRegexPattern } from '@perfana/shared/utils';

export interface TemplatingVariable {
  name: string;
  type: string;
  /** Present in grafana_json, not in the trimmed grafana_dashboards.templating_variables. */
  current?: { value?: string | string[]; text?: string | string[] };
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
   * A query variable's own datasource uid, with a `${name}` / `$name` ref resolved against the
   * dashboard's datasource variables. Returns undefined when there is nothing usable, so the
   * caller warns and skips instead of 404ing against the literal.
   */
  private resolveTemplatedDatasourceUid(
    grafanaDashboard: GrafanaDashboard,
    rawUid: unknown,
  ): string | undefined {
    if (typeof rawUid !== 'string' || rawUid.length === 0) {
      return undefined;
    }

    const refName = parseTemplateVariableRef(rawUid);
    if (!refName) {
      return rawUid;
    }

    return datasourceVariableUid(
      templatingListFromGrafanaJson(grafanaDashboard.grafanaJson),
      refName,
    );
  }

  /**
   * A query variable's datasource as `{ uid, type }`, read from the dashboard JSON.
   *
   * `uid` and `type` are all three query paths below need, and Grafana embeds both on every
   * query variable it writes — so this does not ask Grafana about the datasource.
   * `/api/datasources/uid/:uid` needs org **Admin** (`datasources:read` arrives with Admin's
   * `fixed:datasources:writer`; a Viewer holds only `fixed:datasources.id:reader`), which
   * made Admin the minimum role for auto-config, for a type the dashboard already states.
   *
   * The fallback is for a legacy (Grafana 8 schema) dashboard that names its datasource with
   * no type beside it. Returns undefined when there is nothing usable, so the caller skips
   * instead of querying a datasource it guessed at.
   */
  private async resolveVariableDatasource(
    grafanaInstance: GrafanaInstance,
    grafanaDashboard: GrafanaDashboard,
    templatingVariable: TemplatingVariable,
  ): Promise<{ uid: string; type: string } | undefined> {
    const embeddedType = (ds: unknown): string | undefined => {
      const type = (ds as { type?: unknown } | undefined)?.type;
      return typeof type === 'string' && type.length > 0 ? type : undefined;
    };

    if (templatingVariable.datasource && typeof templatingVariable.datasource === 'object') {
      // On a dashboard that leaves its datasource to a variable, Grafana writes
      // `datasource: { uid: '${datasource}' }` onto every QUERY variable too. Passing that
      // literal to /api/datasources/uid/ is a guaranteed 404 whose throw the caller's catch
      // swallows, so the variable is stored with no values — and the dashboard collects
      // nothing for every series those values select (issue #657).
      const rawUid = (templatingVariable.datasource as { uid?: unknown }).uid;
      const uid = this.resolveTemplatedDatasourceUid(grafanaDashboard, rawUid);
      if (!uid) {
        this.logger.warn(
          `Datasource for variable "${templatingVariable.name}" has no resolvable uid` +
            (rawUid ? ` ("${String(rawUid)}" did not resolve)` : '') +
            ', skipping query',
        );
        return undefined;
      }

      const type = embeddedType(templatingVariable.datasource);
      if (type) {
        return { uid, type };
      }
      return this.grafanaApiService.getDatasourceByUidForInstance(grafanaInstance, uid);
    }

    if (typeof templatingVariable.datasource === 'string') {
      // Datasource specified as a bare string. On a legacy (Grafana 8 schema) dashboard that
      // is sometimes `"$datasource"` rather than a name, which the by-name lookup would 404 on
      // — the same dead end the object arm above exists to avoid. `resolvePanelDatasource` in
      // store-dashboard.service.ts treats this shape as real, so resolve it the same way.
      const refName = parseTemplateVariableRef(templatingVariable.datasource);
      if (!refName) {
        return this.grafanaApiService.getDatasourceByNameForInstance(
          grafanaInstance,
          templatingVariable.datasource,
        );
      }

      const uid = this.resolveTemplatedDatasourceUid(
        grafanaDashboard,
        templatingVariable.datasource,
      );
      if (!uid) {
        this.logger.warn(
          `Datasource for variable "${templatingVariable.name}" references "${templatingVariable.datasource}", which did not resolve, skipping query`,
        );
        return undefined;
      }
      return this.grafanaApiService.getDatasourceByUidForInstance(grafanaInstance, uid);
    }

    this.logger.warn(`No datasource specified for variable "${templatingVariable.name}"`);
    return undefined;
  }

  /**
   * Collect variable values out of a `/api/ds/query` dataframe response.
   *
   * Takes the FIRST column of each frame, which is what the Postgres path has always done
   * (a `__text`/`__value` pair resolves to its text, as before). An InfluxQL metadata query
   * comes back as a single "Value" field, so first and last are the same column there.
   */
  private collectFrameValues(response: any, variable: TemplatingVariable): string[] {
    const variableValues: string[] = [];

    for (const frame of response?.results?.A?.frames ?? []) {
      const values = frame?.data?.values?.[0];
      if (!Array.isArray(values)) continue;

      for (const value of values) {
        if (value === null || value === undefined) continue;
        this.applyRegexFilterAndCollect(String(value), variable, variableValues);
      }
    }

    return variableValues;
  }

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
    const datasource = await this.resolveVariableDatasource(
      grafanaInstance,
      grafanaDashboard,
      templatingVariable,
    );
    if (!datasource) {
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
   * InfluxQL variable values via Grafana's unified query API, like the Postgres path below.
   *
   * Not the datasource proxy: `/query?db=` needs the datasource's `database`, which lives
   * only in the datasource config and would cost an org-Admin `/api/datasources/uid/:uid`
   * call to read. `/api/ds/query` has Grafana look the database up itself, so a Viewer token
   * reaches the same values. Verified against InfluxDB 1.8 — the proxy answers
   * `series[].values: [["system_under_test","PerfanaWebshop"]]` and this answers
   * `frames[].data.values: [["PerfanaWebshop"]]`: Grafana drops the tag-key column that the
   * proxy parser had to index past, so the values are identical.
   *
   * It also means `$timeFilter` is interpolated rather than sent literally.
   */
  private async getInfluxVariableValues(
    grafanaInstance: GrafanaInstance,
    grafanaDashboard: GrafanaDashboard,
    datasource: { uid: string; type: string },
    variable: TemplatingVariable,
    query: string,
  ): Promise<string[]> {
    const now = Date.now();
    const queryPayload = {
      queries: [
        {
          refId: 'A',
          datasource: { uid: datasource.uid, type: 'influxdb' },
          query,
          rawQuery: true,
        },
      ],
      // Only consulted for a query that interpolates the dashboard range; the 7 days match
      // the Prometheus path's window below.
      from: String(now - 7 * 24 * 60 * 60 * 1000),
      to: String(now),
    };

    try {
      this.logger.debug(`InfluxQL query for variable "${variable.name}": ${query}`);

      const response = await this.grafanaApiService.postForInstance(
        grafanaInstance,
        '/api/ds/query',
        queryPayload,
      );

      return this.collectFrameValues(response, variable);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.stack : String(err);
      this.logger.error(
        `Error getting values for InfluxQL query for variable "${variable.name}" ` +
          `in dashboard "${grafanaDashboard.name}" from grafana instance "${grafanaInstance.label}": ${errorMessage}`,
      );
      throw err;
    }
  }

  private async getPrometheusVariableValues(
    grafanaInstance: GrafanaInstance,
    grafanaDashboard: GrafanaDashboard,
    datasource: { uid: string; type: string },
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
        `/api/datasources/proxy/uid/${encodeURIComponent(datasource.uid)}/api/v1/series?` +
        `match[]=${encodeURIComponent(metric)}&start=${startTime}&end=${endTime}`;
    } else {
      // variable.name is dashboard-controlled; a `/`, `?` or `#` in it rewrites the proxied
      // path. apps/api's twin of this request encodes its segment the same way.
      queryUrl = `/api/datasources/proxy/uid/${encodeURIComponent(datasource.uid)}/api/v1/label/${encodeURIComponent(variable.name)}/values`;
    }

    const variableValues: string[] = [];

    try {
      const response = await this.grafanaApiService.getForInstance(grafanaInstance, queryUrl);

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
    datasource: { uid: string; type: string },
    variable: TemplatingVariable,
    query: string,
  ): Promise<string[]> {
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

      const response = await this.grafanaApiService.postForInstance(
        grafanaInstance,
        '/api/ds/query',
        queryPayload,
      );

      this.logger.debug(
        `PostgreSQL query response for variable "${variable.name}": ${JSON.stringify(response, null, 2)}`,
      );

      return this.collectFrameValues(response, variable);
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
