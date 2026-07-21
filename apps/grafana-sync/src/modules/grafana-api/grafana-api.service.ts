import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
// Specs that jest.mock('@perfana/shared/entities') must include every entity
// injected here (incl. ProxyServer) — a missing class arrives as undefined and
// NestJS throws a spurious circular-dependency error at decoration time.
import { GrafanaInstance, ProxyServer } from '@perfana/shared/entities';
import { validateUrl, sanitizeUrl } from '@perfana/shared/security';
import { buildProxyAgent } from '@perfana/shared/services/proxy';

/**
 * Provides Grafana HTTP API access for dashboard management operations.
 * Uses simple fetch() for HTTP calls rather than the shared GrafanaClient
 * (which is optimized for panel data querying).
 */

interface SearchDashboardParams {
  tag?: string;
  query?: string;
  limit?: number;
  dashboardUIDs?: string[];
}

@Injectable()
export class GrafanaApiService {
  private readonly logger = new Logger(GrafanaApiService.name);

  constructor(
    @InjectRepository(GrafanaInstance)
    private grafanaInstanceRepo: Repository<GrafanaInstance>,
    @InjectRepository(ProxyServer)
    private proxyServerRepo: Repository<ProxyServer>,
  ) {}

  /**
   * Resolve the undici dispatcher for a GrafanaInstance when useProxy is set.
   * Returns undefined when no proxy is needed (fetch options unchanged).
   */
  private async resolveDispatcher(instance: GrafanaInstance): Promise<unknown | undefined> {
    if (!instance.useProxy || !instance.organizationId) return undefined;
    const proxyRow = await this.proxyServerRepo.findOne({
      where: { organizationId: instance.organizationId },
    });
    return buildProxyAgent(proxyRow ?? null)?.dispatcher;
  }

  /**
   * Validate and construct URL for Grafana API requests.
   * Prevents SSRF attacks by validating the URL before making requests.
   *
   * @param instance - The Grafana instance to construct URL from
   * @param endpoint - The API endpoint path
   * @returns The validated URL string
   * @throws Error if the URL is invalid or potentially unsafe
   */
  private validateAndConstructUrl(instance: GrafanaInstance, endpoint: string): string {
    const baseUrl = instance.server_url || instance.client_url;
    const fullUrl = baseUrl + endpoint;

    const validationResult = validateUrl(fullUrl);

    if (!validationResult.isValid) {
      const sanitized = sanitizeUrl(fullUrl) || '[invalid URL]';
      this.logger.error(
        `SSRF validation failed for Grafana instance ${instance.label}: ${validationResult.error}. URL: ${sanitized}`,
      );
      throw new Error(
        `Invalid Grafana URL for instance ${instance.label}: ${validationResult.error}`,
      );
    }

    return fullUrl;
  }

  /**
   * Get Grafana instance from database
   */
  private async getInstance(instanceId: string): Promise<GrafanaInstance> {
    const instance = await this.grafanaInstanceRepo.findOne({
      where: { id: instanceId },
    });

    if (!instance) {
      throw new Error(`Grafana instance ${instanceId} not found`);
    }

    if (!instance.apiKey) {
      throw new Error(`Grafana instance ${instance.label} has no API key configured`);
    }

    return instance;
  }

  /**
   * Get all Grafana instances from database
   */
  async getAllInstances(): Promise<GrafanaInstance[]> {
    return this.grafanaInstanceRepo.find();
  }

  /**
   * Make HTTP GET request to Grafana API
   */
  private async get(instance: GrafanaInstance, endpoint: string): Promise<any> {
    const url = this.validateAndConstructUrl(instance, endpoint);
    const dispatcher = await this.resolveDispatcher(instance);

    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${instance.apiKey}`,
    };

    this.logger.debug(`GET ${sanitizeUrl(url) || url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers,
      ...(dispatcher ? { dispatcher } : {}),
    } as RequestInit & { dispatcher?: unknown });

    if (!response.ok) {
      throw new Error(
        `Grafana API GET ${endpoint} failed: ${response.status} ${response.statusText}`,
      );
    }

    return response.json();
  }

  /**
   * Make HTTP POST request to Grafana API
   */
  private async post(instance: GrafanaInstance, endpoint: string, data: any): Promise<any> {
    const url = this.validateAndConstructUrl(instance, endpoint);
    const dispatcher = await this.resolveDispatcher(instance);

    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${instance.apiKey}`,
    };

    this.logger.debug(`POST ${sanitizeUrl(url) || url}`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
        ...(dispatcher ? { dispatcher } : {}),
      } as RequestInit & { dispatcher?: unknown });

      if (!response.ok) {
        throw new Error(`statusCode: ${response.status} statusText: ${response.statusText}`);
      }

      return response.json();
    } catch (error) {
      const safeUrl = sanitizeUrl(url) || '[invalid URL]';
      const message = `POST call to Grafana instance ${instance.label}, endpoint ${safeUrl} failed, ${error}`;
      throw new Error(message);
    }
  }

  /**
   * Make HTTP DELETE request to Grafana API
   */
  private async delete(instance: GrafanaInstance, endpoint: string): Promise<any> {
    const url = this.validateAndConstructUrl(instance, endpoint);
    const dispatcher = await this.resolveDispatcher(instance);

    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${instance.apiKey}`,
    };

    this.logger.debug(`DELETE ${sanitizeUrl(url) || url}`);

    const response = await fetch(url, {
      method: 'DELETE',
      headers,
      ...(dispatcher ? { dispatcher } : {}),
    } as RequestInit & { dispatcher?: unknown });

    if (!response.ok) {
      throw new Error(
        `Grafana API DELETE ${endpoint} failed: ${response.status} ${response.statusText}`,
      );
    }

    return response.json();
  }

  /**
   * Fetch dashboard by UID from Grafana
   * Returns full dashboard details including panels, variables, etc.
   */
  async getDashboardByUid(instanceId: string, uid: string): Promise<any> {
    const instance = await this.getInstance(instanceId);
    return this.get(instance, `/api/dashboards/uid/${uid}`);
  }

  /**
   * Check if dashboard exists in Grafana by UID
   * Returns true if exists, false if not found
   */
  async dashboardExists(instanceId: string, uid: string): Promise<boolean> {
    try {
      await this.getDashboardByUid(instanceId, uid);
      return true;
    } catch (error) {
      // Dashboard not found
      return false;
    }
  }

  /**
   * Search for dashboards
   * Supports filtering by tags, UIDs, query, etc.
   */
  async searchDashboards(instanceId: string, params: SearchDashboardParams): Promise<any[]> {
    const instance = await this.getInstance(instanceId);

    const queryParams = new URLSearchParams();
    if (params.tag) queryParams.append('tag', params.tag);
    if (params.query) queryParams.append('query', params.query);
    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.dashboardUIDs) {
      params.dashboardUIDs.forEach((uid) => queryParams.append('dashboardUIDs', uid));
    }

    const endpoint = `/api/search?${queryParams.toString()}`;
    return this.get(instance, endpoint);
  }

  /**
   * Get datasource by UID
   */
  async getDatasourceByUid(instanceId: string, datasourceUid: string): Promise<any> {
    const instance = await this.getInstance(instanceId);
    return this.get(instance, `/api/datasources/uid/${datasourceUid}`);
  }

  /**
   * Get datasource by name
   */
  async getDatasourceByName(instanceId: string, datasourceName: string): Promise<any> {
    const instance = await this.getInstance(instanceId);
    return this.get(instance, `/api/datasources/name/${datasourceName}`);
  }

  /**
   * Create dashboard in Grafana
   * Payload should include: { dashboard: {...}, folderId: number, overwrite: boolean }
   */
  async createDashboard(instanceId: string, dashboard: any): Promise<any> {
    const instance = await this.getInstance(instanceId);
    return this.post(instance, '/api/dashboards/db', dashboard);
  }

  /**
   * Delete dashboard by UID
   */
  async deleteDashboard(instanceId: string, uid: string): Promise<any> {
    const instance = await this.getInstance(instanceId);
    return this.delete(instance, `/api/dashboards/uid/${uid}`);
  }

  /**
   * Create or find folder in Grafana
   */
  async createOrFindFolder(
    instanceId: string,
    folderTitle: string,
  ): Promise<{ id: number; uid: string }> {
    const instance = await this.getInstance(instanceId);
    const folderUid = folderTitle.toLowerCase().replace(/ /g, '-');

    try {
      // Search for existing folder
      const searchResults = await this.get(
        instance,
        `/api/search?type=dash-folder&query=${folderUid}`,
      );

      if (searchResults.length > 0) {
        this.logger.debug(
          `Found existing folder: ${folderTitle} (ID: ${searchResults[0].id}, UID: ${searchResults[0].uid})`,
        );
        return { id: searchResults[0].id, uid: searchResults[0].uid };
      }

      // Create new folder
      const createResponse = await this.post(instance, '/api/folders', {
        title: folderTitle,
        uid: folderUid,
      });

      this.logger.log(
        `Created new folder: ${folderTitle} (ID: ${createResponse.id}, UID: ${createResponse.uid})`,
      );
      return { id: createResponse.id, uid: createResponse.uid };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.stack : String(error);
      this.logger.error(
        `Failed to create/find folder ${folderTitle}, using General folder (0)`,
        errorMessage,
      );
      return { id: 0, uid: '' }; // Fallback to General folder
    }
  }

  /**
   * Get Grafana instance by label
   */
  async getInstanceByLabel(label: string): Promise<GrafanaInstance> {
    const instance = await this.grafanaInstanceRepo.findOne({
      where: { label },
    });

    if (!instance) {
      throw new Error(`Grafana instance with label "${label}" not found`);
    }

    if (!instance.apiKey) {
      throw new Error(`Grafana instance ${instance.label} has no API key configured`);
    }

    return instance;
  }

  /**
   * Make GET request using instance label instead of ID
   */
  async getByLabel(label: string, endpoint: string): Promise<any> {
    const instance = await this.getInstanceByLabel(label);
    return this.get(instance, endpoint);
  }

  /**
   * Get datasource by UID using instance label
   */
  async getDatasourceByUidWithLabel(label: string, datasourceUid: string): Promise<any> {
    const instance = await this.getInstanceByLabel(label);
    return this.get(instance, `/api/datasources/uid/${datasourceUid}`);
  }

  /**
   * Get datasource by name using instance label
   */
  async getDatasourceByNameWithLabel(label: string, datasourceName: string): Promise<any> {
    const instance = await this.getInstanceByLabel(label);
    return this.get(instance, `/api/datasources/name/${datasourceName}`);
  }

  /**
   * Make POST request using instance label instead of ID
   */
  async postByLabel(label: string, endpoint: string, data: any): Promise<any> {
    const instance = await this.getInstanceByLabel(label);
    return this.post(instance, endpoint, data);
  }
}
