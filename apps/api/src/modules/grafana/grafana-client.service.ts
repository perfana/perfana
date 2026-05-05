import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GrafanaInstance as GrafanaInstanceEntity } from '../../entities';
import { withRequestEm } from '../../common/db/request-em';
import { validateGrafanaUrl } from '../../common/security';

interface GrafanaInstance {
  id: string;
  label: string;
  client_url: string;
  server_url?: string;
  org_id: string;
  api_key: string;
  username?: string;
  password?: string;
}

interface GrafanaDatasource {
  id: number;
  name: string;
  type: string;
  uid: string;
  database?: string;
  url?: string;
}

@Injectable()
export class GrafanaClientService {
  private readonly logger = new Logger(GrafanaClientService.name);

  constructor(
    @InjectRepository(GrafanaInstanceEntity)
    private grafanaInstanceRepo: Repository<GrafanaInstanceEntity>
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
      password: result.password
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

    const options: RequestInit = {
      headers: {
        'Authorization': `Bearer ${grafanaInstance.api_key}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
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

    const options: RequestInit = {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${grafanaInstance.api_key}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
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

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${grafanaInstance.api_key}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(body),
      });

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

    try {
      const response = await fetch(apiUrl, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${grafanaInstance.api_key}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });

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
    try {
      const encodedQuery = encodeURIComponent(query);
      const queryUrl = `/api/datasources/proxy/${datasource.id}/query?db=${datasource.database}&q=${encodedQuery}`;
      
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
          
          queryUrl = `/api/datasources/proxy/${datasource.id}/api/v1/series?match[]=${encodeURIComponent(metric)}&start=${startTime}&end=${endTime}`;
          
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
        queryUrl = `/api/datasources/proxy/${datasource.id}/api/v1/label/${encodeURIComponent(query)}/values`;
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