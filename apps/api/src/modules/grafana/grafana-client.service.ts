import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GrafanaInstance as GrafanaInstanceEntity } from '../../entities';
import { withRequestEm } from '../../common/db/request-em';
import { validateGrafanaUrl } from '../../common/security';
import { ProxyResolverService } from '../proxy/proxy-resolver.service';

interface GrafanaInstance {
  id: string;
  label: string;
  client_url: string;
  server_url?: string;
  org_id: string;
  api_key: string;
  username?: string;
  password?: string;
  organizationId: string;
  useProxy: boolean;
}

interface GrafanaDatasource {
  id: number;
  name: string;
  type: string;
  uid: string;
  database?: string;
  url?: string;
  // Grafana's InfluxDB datasource sets jsonData.version to "Flux" when the
  // datasource speaks Flux (InfluxDB v2) instead of InfluxQL (InfluxDB v1).
  jsonData?: { version?: string };
}

@Injectable()
export class GrafanaClientService {
  private readonly logger = new Logger(GrafanaClientService.name);

  constructor(
    @InjectRepository(GrafanaInstanceEntity)
    private grafanaInstanceRepo: Repository<GrafanaInstanceEntity>,
    private readonly proxyResolver: ProxyResolverService,
  ) {}

  async getGrafanaInstance(grafanaInstanceId: string): Promise<GrafanaInstance> {
    const result = await withRequestEm(this.grafanaInstanceRepo).findOne({ where: { id: grafanaInstanceId } });

    if (!result) {
      throw new Error(`Grafana instance with ID ${grafanaInstanceId} not found`);
    }

    return {
      id: result.id,
      label: result.label,
      client_url: result.client_url,
      server_url: result.server_url,
      org_id: result.orgId,
      api_key: result.apiKey || '',
      username: result.username,
      password: result.password,
      organizationId: result.organizationId,
      useProxy: result.useProxy,
    };
  }

  async grafanaCall(grafanaInstance: GrafanaInstance, endpoint: string): Promise<unknown> {
    const baseUrl = grafanaInstance.server_url || grafanaInstance.client_url;

    // Validate URL to prevent SSRF attacks
    const urlValidation = validateGrafanaUrl(baseUrl);
    if (!urlValidation.isValid) {
      throw new BadRequestException(`Invalid Grafana URL: ${urlValidation.error}`);
    }

    const apiUrl = `${baseUrl}${endpoint}`;

    const agents = await this.proxyResolver.resolve(grafanaInstance.organizationId, grafanaInstance.useProxy);
    const options: RequestInit & { dispatcher?: unknown } = {
      headers: {
        'Authorization': `Bearer ${grafanaInstance.api_key}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      ...(agents ? { dispatcher: agents.dispatcher } : {}),
    };

    try {
      const response = await fetch(apiUrl, options);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Error calling Grafana API: ${endpoint}`, error);
      throw error;
    }
  }

  /**
   * Delete a dashboard from Grafana by its UID
   * @param grafanaInstance The Grafana instance to delete from
   * @param dashboardUid The UID of the dashboard to delete
   * @returns The response from Grafana API
   */
  async deleteDashboard(grafanaInstance: GrafanaInstance, dashboardUid: string): Promise<{ title: string; message: string }> {
    const baseUrl = grafanaInstance.server_url || grafanaInstance.client_url;

    // Validate URL to prevent SSRF attacks
    const urlValidation = validateGrafanaUrl(baseUrl);
    if (!urlValidation.isValid) {
      throw new BadRequestException(`Invalid Grafana URL: ${urlValidation.error}`);
    }

    const apiUrl = `${baseUrl}/api/dashboards/uid/${dashboardUid}`;

    const agents = await this.proxyResolver.resolve(grafanaInstance.organizationId, grafanaInstance.useProxy);
    const options: RequestInit & { dispatcher?: unknown } = {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${grafanaInstance.api_key}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      ...(agents ? { dispatcher: agents.dispatcher } : {}),
    };

    try {
      this.logger.log(`Deleting dashboard ${dashboardUid} from Grafana instance ${grafanaInstance.label}`);
      const response = await fetch(apiUrl, options);

      if (!response.ok) {
        // Handle 404 gracefully - dashboard might already be deleted
        if (response.status === 404) {
          this.logger.warn(`Dashboard ${dashboardUid} not found in Grafana (already deleted?)`);
          return { title: dashboardUid, message: 'Dashboard not found (already deleted)' };
        }
        const errorText = await response.text();
        throw new Error(`Failed to delete dashboard: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      this.logger.log(`Successfully deleted dashboard ${dashboardUid} from Grafana`);
      return data;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Error deleting dashboard ${dashboardUid} from Grafana:`, error);
      throw error;
    }
  }

  /**
   * Create an annotation on a Grafana dashboard
   */
  async createAnnotation(
    grafanaInstance: GrafanaInstance,
    params: { dashboardId?: number; dashboardUID?: string; time: number; timeEnd?: number; tags?: string[]; text: string },
  ): Promise<{ id: number; message: string }> {
    const baseUrl = grafanaInstance.server_url || grafanaInstance.client_url;

    const urlValidation = validateGrafanaUrl(baseUrl);
    if (!urlValidation.isValid) {
      throw new BadRequestException(`Invalid Grafana URL: ${urlValidation.error}`);
    }

    const apiUrl = `${baseUrl}/api/annotations`;
    const body: Record<string, unknown> = {
      time: params.time,
      text: params.text,
    };
    if (params.dashboardId != null) body.dashboardId = params.dashboardId;
    if (params.dashboardUID) body.dashboardUID = params.dashboardUID;
    if (params.timeEnd != null) body.timeEnd = params.timeEnd;
    if (params.tags?.length) body.tags = params.tags;

    const agents = await this.proxyResolver.resolve(grafanaInstance.organizationId, grafanaInstance.useProxy);
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${grafanaInstance.api_key}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(body),
        ...(agents ? { dispatcher: agents.dispatcher } : {}),
      } as RequestInit & { dispatcher?: unknown });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create annotation: ${response.status} - ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.debug(`Annotation create failed: ${error}`);
      throw error;
    }
  }

  /**
   * Delete an annotation from Grafana by its ID
   */
  async deleteAnnotation(grafanaInstance: GrafanaInstance, annotationId: number): Promise<void> {
    const baseUrl = grafanaInstance.server_url || grafanaInstance.client_url;

    const urlValidation = validateGrafanaUrl(baseUrl);
    if (!urlValidation.isValid) {
      throw new BadRequestException(`Invalid Grafana URL: ${urlValidation.error}`);
    }

    const apiUrl = `${baseUrl}/api/annotations/${annotationId}`;

    const agents = await this.proxyResolver.resolve(grafanaInstance.organizationId, grafanaInstance.useProxy);
    try {
      const response = await fetch(apiUrl, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${grafanaInstance.api_key}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        ...(agents ? { dispatcher: agents.dispatcher } : {}),
      } as RequestInit & { dispatcher?: unknown });

      if (!response.ok && response.status !== 404) {
        const errorText = await response.text();
        throw new Error(`Failed to delete annotation: ${response.status} - ${errorText}`);
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.debug(`Annotation delete failed (${annotationId}): ${error}`);
      throw error;
    }
  }

  async getDatasource(grafanaInstance: GrafanaInstance, datasourceUid: string): Promise<GrafanaDatasource> {
    try {
      const endpoint = `/api/datasources/uid/${datasourceUid}`;
      const datasource = await this.grafanaCall(grafanaInstance, endpoint) as GrafanaDatasource;
      return datasource;
    } catch (error) {
      this.logger.error(`Error getting datasource ${datasourceUid}:`, error);
      throw error;
    }
  }

  async getInfluxVariableValues(
    grafanaInstance: GrafanaInstance, 
    datasource: GrafanaDatasource, 
    query: string,
    regex?: string
  ): Promise<string[]> {
    // Flux (InfluxDB v2) datasources can't answer the legacy InfluxQL
    // /query?db=&q= endpoint. Grafana runs Flux variable queries through
    // POST /api/ds/query, which returns dataframes. Detect Flux via the
    // datasource version, with a query-shape fallback for older configs.
    if (this.isFluxDatasource(datasource, query)) {
      return this.getFluxVariableValues(grafanaInstance, datasource, query, regex);
    }

    try {
      const encodedQuery = encodeURIComponent(query);
      const queryUrl = `/api/datasources/proxy/uid/${datasource.uid}/query?db=${datasource.database}&q=${encodedQuery}`;

      const response = await this.grafanaCall(grafanaInstance, queryUrl) as Record<string, unknown>;
      const variableValues: string[] = [];

      if (response.results) {
        (response.results as Record<string, unknown>[]).forEach((result: Record<string, unknown>) => {
          if (result.series) {
            (result.series as Record<string, unknown>[]).forEach((serie: Record<string, unknown>) => {
              if (serie.values) {
                (serie.values as string[][]).forEach((value: string[]) => {
                  const variableValue: string = (value.length === 1 ? value[0] : value[1]) ?? '';
                  let valueAfterRegex = '';

                  if (regex && regex !== '') {
                    const valueRegex = new RegExp(regex.replace(/^\/|\/$/g, ''));
                    const matches = variableValue.match(valueRegex);
                    if (matches) {
                      matches.forEach((match: string, i: number) => {
                        if (i > 0) valueAfterRegex += match;
                      });
                    }
                  }

                  const pushValue = valueAfterRegex !== '' ? valueAfterRegex : variableValue;
                  if (variableValues.indexOf(pushValue) === -1) {
                    variableValues.push(pushValue);
                  }
                });
              }
            });
          }
        });
      }

      return variableValues;
    } catch (error) {
      this.logger.error(`Error getting InfluxDB variable values:`, error);
      throw error;
    }
  }

  /**
   * A Flux datasource is either explicitly marked (jsonData.version === 'Flux')
   * or gives itself away with Flux syntax in the variable query.
   */
  private isFluxDatasource(datasource: GrafanaDatasource, query: string): boolean {
    if (datasource.jsonData?.version === 'Flux') return true;
    return /\bimport\s+"|\bfrom\s*\(\s*bucket\s*:|\|>/.test(query);
  }

  /**
   * Resolve Flux (InfluxDB v2) variable values via POST /api/ds/query.
   * The response is Grafana's dataframe format: results[refId].frames[].data.values
   * with the tag values in a string-typed field (typically "_value").
   */
  private async getFluxVariableValues(
    grafanaInstance: GrafanaInstance,
    datasource: GrafanaDatasource,
    query: string,
    regex?: string,
  ): Promise<string[]> {
    const now = Date.now();
    const body = {
      queries: [
        {
          refId: 'metricFindQuery',
          query,
          rawQuery: true,
          datasource: { type: datasource.type, uid: datasource.uid },
          datasourceId: datasource.id,
          maxDataPoints: 1000,
        },
      ],
      from: String(now - 24 * 60 * 60 * 1000),
      to: String(now),
    };

    const response = (await this.grafanaPost(grafanaInstance, '/api/ds/query', body)) as Record<string, unknown>;
    return this.parseFluxVariableFrames(response, regex);
  }

  /**
   * Extract distinct string values from a Grafana dataframe response.
   * Mirrors the InfluxQL parser's regex-capture behavior.
   */
  private parseFluxVariableFrames(response: Record<string, unknown>, regex?: string): string[] {
    const variableValues: string[] = [];
    const results = response?.results as Record<string, unknown> | undefined;
    if (!results) return variableValues;

    for (const result of Object.values(results)) {
      const frames = (result as Record<string, unknown>)?.frames;
      if (!Array.isArray(frames)) continue;

      for (const frame of frames) {
        const values = (frame as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
        const columns = values?.values;
        if (!Array.isArray(columns) || columns.length === 0) continue;

        // Variable queries return the value in the last column ("_value", or
        // the value column of a text/value pair). Match the InfluxQL parser.
        const valueColumn = columns[columns.length - 1];
        if (!Array.isArray(valueColumn)) continue;

        for (const raw of valueColumn) {
          if (raw === null || raw === undefined) continue;
          const variableValue = String(raw);
          const pushValue = this.applyVariableRegex(variableValue, regex);
          if (pushValue !== '' && variableValues.indexOf(pushValue) === -1) {
            variableValues.push(pushValue);
          }
        }
      }
    }

    return variableValues;
  }

  /** Apply an optional variable regex, returning the concatenated capture groups. */
  private applyVariableRegex(variableValue: string, regex?: string): string {
    if (!regex || regex === '') return variableValue;
    const valueRegex = new RegExp(regex.replace(/^\/|\/$/g, ''));
    const matches = variableValue.match(valueRegex);
    if (!matches) return variableValue;
    let valueAfterRegex = '';
    matches.forEach((match: string, i: number) => {
      if (i > 0) valueAfterRegex += match;
    });
    return valueAfterRegex !== '' ? valueAfterRegex : variableValue;
  }

  /** POST helper for Grafana endpoints (GET counterpart is grafanaCall). */
  private async grafanaPost(
    grafanaInstance: GrafanaInstance,
    endpoint: string,
    body: unknown,
  ): Promise<unknown> {
    const baseUrl = grafanaInstance.server_url || grafanaInstance.client_url;

    const urlValidation = validateGrafanaUrl(baseUrl);
    if (!urlValidation.isValid) {
      throw new BadRequestException(`Invalid Grafana URL: ${urlValidation.error}`);
    }

    const apiUrl = `${baseUrl}${endpoint}`;
    const agents = await this.proxyResolver.resolve(grafanaInstance.organizationId, grafanaInstance.useProxy);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${grafanaInstance.api_key}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
      ...(agents ? { dispatcher: agents.dispatcher } : {}),
    } as RequestInit & { dispatcher?: unknown });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }

    return response.json();
  }

  async getPrometheusVariableValues(
    grafanaInstance: GrafanaInstance, 
    datasource: GrafanaDatasource, 
    query: string,
    regex?: string
  ): Promise<string[]> {
    try {
      let queryUrl: string;
      const variableValues: string[] = [];

      // Check if it's a label_values query
      const labelValuesRegex = /label_values\((.*),\s*([^)]+)\)/;
      if (labelValuesRegex.test(query)) {
        const matches = labelValuesRegex.exec(query);
        if (matches && matches.length >= 3) {
          const metric = matches[1];
          const labelName = matches[2];
          
          if (!metric) {
            this.logger.warn('No metric found in label_values query');
            return variableValues;
          }
          
          // Use Prometheus series API to get label values
          const startTime = Math.round(new Date(Date.now() - 24 * 60 * 60 * 1000).getTime() / 1000);
          const endTime = Math.round(new Date().getTime() / 1000);
          
          queryUrl = `/api/datasources/proxy/uid/${datasource.uid}/api/v1/series?match[]=${encodeURIComponent(metric)}&start=${startTime}&end=${endTime}`;
          
          const response = await this.grafanaCall(grafanaInstance, queryUrl) as Record<string, unknown>;

          if (response && response.data && labelName) {
            (response.data as Record<string, string>[]).forEach((item: Record<string, string>) => {
              if (item[labelName]) {
                variableValues.push(item[labelName]);
              }
            });
          }
        }
      } else {
        // Simple label values query
        queryUrl = `/api/datasources/proxy/uid/${datasource.uid}/api/v1/label/${encodeURIComponent(query)}/values`;
        const response = await this.grafanaCall(grafanaInstance, queryUrl) as Record<string, unknown>;

        if (response && response.data) {
          (response.data as string[]).forEach((value: string) => {
            variableValues.push(value);
          });
        }
      }

      // Apply regex if provided
      let processedValues = variableValues;
      if (regex && regex !== '') {
        const valueRegex = new RegExp(regex.replace(/^\/|\/$/g, ''));
        processedValues = [];
        
        variableValues.forEach((variableValue) => {
          let valueAfterRegex = '';
          const matches = variableValue.match(valueRegex);
          
          if (matches) {
            matches.forEach((match, i) => {
              if (i > 0) valueAfterRegex += match;
            });
          }

          const pushValue = valueAfterRegex !== '' ? valueAfterRegex : variableValue;
          if (processedValues.indexOf(pushValue) === -1) {
            processedValues.push(pushValue);
          }
        });
      }

      return [...new Set(processedValues)]; // Remove duplicates
    } catch (error) {
      this.logger.error(`Error getting Prometheus variable values:`, error);
      throw error;
    }
  }
}