# Grafana Sync Implementation Tasks

**Date:** 2025-11-02
**Status:** Ready for Implementation
**Estimated Effort:** 3-4 days

## Overview

This document provides step-by-step implementation tasks for migrating perfana-grafana to the NestJS monorepo. Each task includes:
- File locations
- Code examples
- Dependencies
- Testing requirements
- Acceptance criteria

## Implementation Order

We'll implement in this order to build incrementally:

1. **GrafanaApiService** - Foundation for all Grafana HTTP calls
2. **StoreDashboardService** - Core sync logic for adding dashboards
3. **UpdateDashboardsService** - Dashboard update logic
4. **RestoreDashboardService** - Dashboard restoration
5. **AutoConfigService** - Automatic dashboard configuration
6. **Integration Testing** - End-to-end validation

---

## Task 1: Create GrafanaApiService

**File:** `apps/grafana-sync/src/modules/grafana-api/grafana-api.service.ts`

**Purpose:** Wrapper around worker's GrafanaClient to provide a NestJS-friendly interface

**Dependencies:**
- `apps/worker/src/lib/grafana/client.ts` (existing)
- `@perfana/shared/entities` (GrafanaInstance)

**Implementation:**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GrafanaInstance } from '@perfana/shared/entities';

// Import worker's GrafanaClient
import { GrafanaClient } from '../../../worker/src/lib/grafana/client';

interface GrafanaConfig {
  url: string;
  apiKey: string;
  orgId?: number;
  timeout?: number;
  concurrency?: number;
  batchSize?: number;
}

@Injectable()
export class GrafanaApiService {
  private readonly logger = new Logger(GrafanaApiService.name);
  private clients: Map<string, GrafanaClient> = new Map();

  constructor(
    @InjectRepository(GrafanaInstance)
    private grafanaInstanceRepo: Repository<GrafanaInstance>,
  ) {}

  /**
   * Get or create GrafanaClient for a specific instance
   * Reuses worker's implementation with connection pooling and batching
   */
  async getClient(instanceId: string): Promise<GrafanaClient> {
    if (this.clients.has(instanceId)) {
      return this.clients.get(instanceId)!;
    }

    const instance = await this.grafanaInstanceRepo.findOne({
      where: { id: instanceId },
    });

    if (!instance) {
      throw new Error(`Grafana instance ${instanceId} not found`);
    }

    if (!instance.api_key) {
      throw new Error(`Grafana instance ${instance.label} has no API key configured`);
    }

    const config: GrafanaConfig = {
      url: instance.server_url || instance.client_url,
      apiKey: instance.api_key,
      orgId: instance.org_id,
      timeout: 30000,
      concurrency: 30,
      batchSize: 20,
    };

    const client = new GrafanaClient(config);
    this.clients.set(instanceId, client);

    this.logger.log(`Created GrafanaClient for instance: ${instance.label}`);

    return client;
  }

  /**
   * Fetch dashboard by UID from Grafana
   */
  async getDashboardByUid(instanceId: string, uid: string): Promise<any> {
    const client = await this.getClient(instanceId);

    try {
      // Use worker's client method if available, otherwise construct endpoint
      const response = await this.makeRequest(client, 'GET', `/api/dashboards/uid/${uid}`);
      return response;
    } catch (error) {
      this.logger.error(`Failed to fetch dashboard ${uid}`, error.stack);
      throw error;
    }
  }

  /**
   * Search for dashboards
   */
  async searchDashboards(
    instanceId: string,
    params: { tag?: string; query?: string; limit?: number; dashboardUIDs?: string[] }
  ): Promise<any[]> {
    const client = await this.getClient(instanceId);

    const queryParams = new URLSearchParams();
    if (params.tag) queryParams.append('tag', params.tag);
    if (params.query) queryParams.append('query', params.query);
    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.dashboardUIDs) {
      params.dashboardUIDs.forEach(uid => queryParams.append('dashboardUIDs', uid));
    }

    const endpoint = `/api/search?${queryParams.toString()}`;

    try {
      return await this.makeRequest(client, 'GET', endpoint);
    } catch (error) {
      this.logger.error(`Failed to search dashboards`, error.stack);
      throw error;
    }
  }

  /**
   * Get datasource by UID
   */
  async getDatasourceByUid(instanceId: string, datasourceUid: string): Promise<any> {
    const client = await this.getClient(instanceId);

    try {
      return await this.makeRequest(client, 'GET', `/api/datasources/uid/${datasourceUid}`);
    } catch (error) {
      this.logger.error(`Failed to fetch datasource ${datasourceUid}`, error.stack);
      throw error;
    }
  }

  /**
   * Get datasource by name
   */
  async getDatasourceByName(instanceId: string, datasourceName: string): Promise<any> {
    const client = await this.getClient(instanceId);

    try {
      return await this.makeRequest(client, 'GET', `/api/datasources/name/${datasourceName}`);
    } catch (error) {
      this.logger.error(`Failed to fetch datasource ${datasourceName}`, error.stack);
      throw error;
    }
  }

  /**
   * Create dashboard in Grafana
   */
  async createDashboard(instanceId: string, dashboard: any): Promise<any> {
    const client = await this.getClient(instanceId);

    try {
      return await this.makeRequest(client, 'POST', '/api/dashboards/db', dashboard);
    } catch (error) {
      this.logger.error(`Failed to create dashboard`, error.stack);
      throw error;
    }
  }

  /**
   * Delete dashboard by UID
   */
  async deleteDashboard(instanceId: string, uid: string): Promise<any> {
    const client = await this.getClient(instanceId);

    try {
      return await this.makeRequest(client, 'DELETE', `/api/dashboards/uid/${uid}`);
    } catch (error) {
      this.logger.error(`Failed to delete dashboard ${uid}`, error.stack);
      throw error;
    }
  }

  /**
   * Create or find folder
   */
  async createOrFindFolder(instanceId: string, folderTitle: string): Promise<number> {
    const client = await this.getClient(instanceId);
    const folderUid = folderTitle.toLowerCase().replace(/ /g, '-');

    try {
      // Search for existing folder
      const searchResults = await this.makeRequest(
        client,
        'GET',
        `/api/search?type=dash-folder&query=${folderUid}`
      );

      if (searchResults.length > 0) {
        this.logger.debug(`Found existing folder: ${folderTitle} (ID: ${searchResults[0].id})`);
        return searchResults[0].id;
      }

      // Create new folder
      const createResponse = await this.makeRequest(client, 'POST', '/api/folders', {
        title: folderTitle,
        uid: folderUid,
      });

      this.logger.log(`Created new folder: ${folderTitle} (ID: ${createResponse.id})`);
      return createResponse.id;
    } catch (error) {
      this.logger.error(`Failed to create/find folder ${folderTitle}, using General folder (0)`, error.stack);
      return 0; // Fallback to General folder
    }
  }

  /**
   * Generic HTTP request method
   * This wraps the worker's client for now, but could be enhanced
   */
  private async makeRequest(
    client: GrafanaClient,
    method: 'GET' | 'POST' | 'DELETE',
    endpoint: string,
    data?: any
  ): Promise<any> {
    // For now, we'll implement basic fetch since worker's client might not expose all methods
    // TODO: Enhance worker's GrafanaClient to expose these methods directly

    const config = (client as any).config; // Access internal config
    const url = config.url + endpoint;

    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
    };

    if (data && (method === 'POST' || method === 'PUT')) {
      options.body = JSON.stringify(data);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      throw new Error(
        `Grafana API request failed: ${method} ${endpoint} - ${response.status} ${response.statusText}`
      );
    }

    return response.json();
  }

  /**
   * Clear cached client (useful for testing or when instance config changes)
   */
  clearClient(instanceId: string): void {
    this.clients.delete(instanceId);
    this.logger.debug(`Cleared cached client for instance: ${instanceId}`);
  }
}
```

**Testing:**

```typescript
// grafana-api.service.spec.ts
describe('GrafanaApiService', () => {
  let service: GrafanaApiService;
  let grafanaInstanceRepo: Repository<GrafanaInstance>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GrafanaApiService,
        {
          provide: getRepositoryToken(GrafanaInstance),
          useValue: {
            findOne: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<GrafanaApiService>(GrafanaApiService);
    grafanaInstanceRepo = module.get(getRepositoryToken(GrafanaInstance));
  });

  it('should create client for instance', async () => {
    const instance = {
      id: 'test-id',
      label: 'Test Grafana',
      client_url: 'http://grafana.test',
      api_key: 'test-key',
    };

    jest.spyOn(grafanaInstanceRepo, 'findOne').mockResolvedValue(instance as any);

    const client = await service.getClient('test-id');
    expect(client).toBeDefined();
  });

  it('should throw error if instance not found', async () => {
    jest.spyOn(grafanaInstanceRepo, 'findOne').mockResolvedValue(null);

    await expect(service.getClient('invalid-id')).rejects.toThrow('Grafana instance invalid-id not found');
  });
});
```

**Acceptance Criteria:**
- ✅ Creates GrafanaClient instance with worker's implementation
- ✅ Caches clients per instance ID
- ✅ Provides methods for all Grafana API operations
- ✅ Handles errors gracefully with logging
- ✅ Unit tests pass with >80% coverage

---

## Task 2: Implement StoreDashboardService.getDashboardsToAdd()

**File:** `apps/grafana-sync/src/modules/grafana-sync/store-dashboard.service.ts`

**Purpose:** Find dashboards that exist in Grafana but not yet stored in Perfana DB

**Implementation:**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GrafanaInstance, GrafanaDashboard } from '@perfana/shared/entities';
import { GrafanaApiService } from '../grafana-api/grafana-api.service';

@Injectable()
export class StoreDashboardService {
  private readonly logger = new Logger(StoreDashboardService.name);

  constructor(
    @InjectRepository(GrafanaDashboard)
    private dashboardRepo: Repository<GrafanaDashboard>,
    private grafanaApiService: GrafanaApiService,
  ) {}

  /**
   * Find dashboards to add from a Grafana instance
   * Based on: perfana-grafana/grafana-sync/store-dashboard/get-dashboards-to-add.js
   */
  async getDashboardsToAdd(grafanaInstance: GrafanaInstance): Promise<any[]> {
    this.logger.debug(`Finding dashboards to add for instance: ${grafanaInstance.label}`);

    try {
      // Get stored dashboards for this instance
      const storedDashboards = await this.dashboardRepo.find({
        where: { grafanaInstance: { id: grafanaInstance.id } },
        select: ['uid'],
      });

      const storedUids = new Set(storedDashboards.map(d => d.uid));

      // Fetch dashboards from Grafana with 'perfana' tag
      const grafanaDashboards = await this.grafanaApiService.searchDashboards(
        grafanaInstance.id,
        { tag: 'perfana', limit: 5000 }
      );

      // Filter to only dashboards tagged 'perfana' that aren't stored yet
      const dashboardsToAdd = grafanaDashboards.filter(dashboard => {
        const hasPerfanaTag = dashboard.tags
          ?.map((tag: string) => tag.toLowerCase())
          .includes('perfana');

        const notStored = !storedUids.has(dashboard.uid);

        return hasPerfanaTag && notStored;
      });

      if (dashboardsToAdd.length > 0) {
        this.logger.log(
          `Found ${dashboardsToAdd.length} dashboards to add: ${dashboardsToAdd.map(d => d.title).join(', ')}`
        );
      } else {
        this.logger.debug('No dashboards to add');
      }

      return dashboardsToAdd;
    } catch (error) {
      this.logger.error(`Failed to get dashboards to add for ${grafanaInstance.label}`, error.stack);
      return [];
    }
  }

  /**
   * Optional: Direct Grafana DB access for better performance
   * Only implement if GRAFANA_USE_DB_DIRECT_ACCESS is enabled
   */
  async getDashboardsToAddWithDirectAccess(
    grafanaInstance: GrafanaInstance,
    grafanaDbConnection: any // PostgreSQL or MySQL connection
  ): Promise<any[]> {
    // TODO: Implement direct database access as optimization
    // Query: SELECT DISTINCT uid FROM dashboard WHERE created > (NOW() - INTERVAL '24 HOURS')
    // This is optional and can be added later
    throw new Error('Direct DB access not yet implemented');
  }
}
```

**Testing:**

```typescript
describe('StoreDashboardService.getDashboardsToAdd', () => {
  it('should return dashboards with perfana tag not yet stored', async () => {
    const grafanaInstance = { id: 'test-id', label: 'Test' };

    // Mock stored dashboards (UID: stored-1)
    jest.spyOn(dashboardRepo, 'find').mockResolvedValue([
      { uid: 'stored-1' } as any
    ]);

    // Mock Grafana API returns 3 dashboards
    jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([
      { uid: 'stored-1', title: 'Already Stored', tags: ['perfana'] },
      { uid: 'new-1', title: 'New Dashboard 1', tags: ['perfana'] },
      { uid: 'new-2', title: 'New Dashboard 2', tags: ['perfana'] },
      { uid: 'no-tag', title: 'No Perfana Tag', tags: ['other'] },
    ]);

    const result = await service.getDashboardsToAdd(grafanaInstance as any);

    expect(result).toHaveLength(2);
    expect(result[0].uid).toBe('new-1');
    expect(result[1].uid).toBe('new-2');
  });

  it('should return empty array if all dashboards already stored', async () => {
    jest.spyOn(dashboardRepo, 'find').mockResolvedValue([
      { uid: 'dashboard-1' } as any,
      { uid: 'dashboard-2' } as any,
    ]);

    jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([
      { uid: 'dashboard-1', tags: ['perfana'] },
      { uid: 'dashboard-2', tags: ['perfana'] },
    ]);

    const result = await service.getDashboardsToAdd({} as any);
    expect(result).toHaveLength(0);
  });
});
```

**Acceptance Criteria:**
- ✅ Fetches stored dashboard UIDs from database
- ✅ Queries Grafana API for dashboards with 'perfana' tag
- ✅ Filters to only new dashboards (not in stored UIDs)
- ✅ Handles errors gracefully, returns empty array
- ✅ Logs results appropriately

---

## Task 3: Implement StoreDashboardService.storeDashboard()

**File:** `apps/grafana-sync/src/modules/grafana-sync/store-dashboard.service.ts` (continue)

**Purpose:** Store a dashboard from Grafana to Perfana database

**Implementation:**

```typescript
// Add to StoreDashboardService class

/**
 * Store dashboard from Grafana to Perfana database
 * Based on: perfana-grafana/grafana-sync/store-dashboard/store-dashboard.js
 */
async storeDashboard(
  grafanaInstance: GrafanaInstance,
  grafanaDashboardSummary: any,  // From search API
  update: boolean = false,
): Promise<GrafanaDashboard> {
  this.logger.debug(
    `Storing dashboard: ${grafanaDashboardSummary.title} (UID: ${grafanaDashboardSummary.uid}), update: ${update}`
  );

  try {
    // Check if already stored (skip if update=false)
    if (!update) {
      const existing = await this.dashboardRepo.findOne({
        where: {
          uid: grafanaDashboardSummary.uid,
          grafanaInstance: { id: grafanaInstance.id },
        },
      });

      if (existing) {
        this.logger.debug(`Dashboard ${grafanaDashboardSummary.uid} already stored, skipping`);
        return existing;
      }
    }

    // Fetch full dashboard details from Grafana API
    const dashboardDetails = await this.grafanaApiService.getDashboardByUid(
      grafanaInstance.id,
      grafanaDashboardSummary.uid
    );

    // Extract first graph panel to determine datasource
    const firstGraphPanel = dashboardDetails.dashboard.panels?.find((panel: any) =>
      ['graph', 'timeseries', 'table', 'flamegraph'].includes(panel.type)
    );

    if (!firstGraphPanel) {
      throw new Error(`No graph panel found in dashboard ${grafanaDashboardSummary.title}`);
    }

    // Get datasource information
    let datasource;
    try {
      if (firstGraphPanel.datasource?.uid) {
        datasource = await this.grafanaApiService.getDatasourceByUid(
          grafanaInstance.id,
          firstGraphPanel.datasource.uid
        );
      } else if (firstGraphPanel.datasource) {
        datasource = await this.grafanaApiService.getDatasourceByName(
          grafanaInstance.id,
          firstGraphPanel.datasource
        );
      } else {
        throw new Error('No datasource found in panel');
      }
    } catch (error) {
      this.logger.error(
        `Failed to fetch datasource for panel "${firstGraphPanel.title}" in dashboard "${dashboardDetails.dashboard.title}"`,
        error.stack
      );
      throw error;
    }

    // Build dashboard entity
    const dashboard = new GrafanaDashboard();
    dashboard.grafanaInstance = grafanaInstance;
    dashboard.name = dashboardDetails.dashboard.title;
    dashboard.datasource_type = datasource.type;
    dashboard.uri = dashboardDetails.meta.url;
    dashboard.grafana_id = dashboardDetails.dashboard.id;
    dashboard.uid = dashboardDetails.dashboard.uid;
    dashboard.tags = dashboardDetails.dashboard.tags || [];
    dashboard.slug = dashboardDetails.meta.slug;
    dashboard.grafana_json = dashboardDetails; // Store full JSON

    // Extract panels
    dashboard.panels = this.extractPanels(dashboardDetails.dashboard.panels);

    // Extract templating variables
    if (dashboardDetails.dashboard.templating?.list) {
      dashboard.templating_variables = this.extractTemplatingVariables(
        dashboardDetails.dashboard.templating.list
      );
      dashboard.variables = dashboardDetails.dashboard.templating.list.map((v: any) => ({
        name: v.name,
      }));
    } else {
      dashboard.templating_variables = [];
      dashboard.variables = [];
    }

    // Save to database
    const saved = await this.dashboardRepo.save(dashboard);

    const action = update ? 'Updated' : 'Added';
    this.logger.log(`${action} dashboard: ${dashboard.name} from ${grafanaInstance.label}`);

    return saved;
  } catch (error) {
    const action = update ? 'updating' : 'adding';
    this.logger.error(
      `Failed ${action} dashboard "${grafanaDashboardSummary.title}" for ${grafanaInstance.label}`,
      error.stack
    );
    throw error;
  }
}

/**
 * Extract panel information from dashboard
 */
private extractPanels(panels: any[]): any[] {
  if (!panels) return [];

  return panels
    .filter(panel => !panel.repeatIteration && panel.datasource)
    .map(panel => ({
      id: panel.id,
      title: panel.title,
      type: panel.type,
      description: panel.description,
      y_axes_format: this.extractYAxisFormat(panel),
      repeat: panel.repeat !== 'null' ? panel.repeat : undefined,
    }));
}

/**
 * Extract Y-axis format from panel config
 */
private extractYAxisFormat(panel: any): string | undefined {
  // New format (fieldConfig)
  if (panel.fieldConfig?.defaults?.unit) {
    return panel.fieldConfig.defaults.unit;
  }

  // Old format (yaxes)
  if (panel.yaxes?.[0]?.format) {
    return panel.yaxes[0].format;
  }

  return undefined;
}

/**
 * Extract templating variables
 */
private extractTemplatingVariables(templatingList: any[]): any[] {
  return templatingList.map(variable => ({
    name: variable.name,
    type: variable.type,
    options: variable.regex ? variable.options : undefined,
    datasource: variable.datasource || undefined,
    regex: variable.regex || undefined,
    query: variable.query,
  }));
}
```

**Testing:**

```typescript
describe('StoreDashboardService.storeDashboard', () => {
  it('should store new dashboard with panels and variables', async () => {
    const grafanaInstance = { id: 'test-id', label: 'Test' };
    const dashboardSummary = { uid: 'new-dashboard', title: 'New Dashboard' };

    const dashboardDetails = {
      dashboard: {
        id: 123,
        uid: 'new-dashboard',
        title: 'New Dashboard',
        tags: ['perfana'],
        panels: [
          {
            id: 1,
            title: 'CPU Usage',
            type: 'graph',
            datasource: { uid: 'prometheus-uid', type: 'prometheus' },
            fieldConfig: { defaults: { unit: 'percent' } },
          },
        ],
        templating: {
          list: [
            { name: 'system_under_test', type: 'query', query: 'label_values(system)' },
          ],
        },
      },
      meta: {
        url: '/d/new-dashboard',
        slug: 'new-dashboard',
      },
    };

    jest.spyOn(grafanaApiService, 'getDashboardByUid').mockResolvedValue(dashboardDetails);
    jest.spyOn(grafanaApiService, 'getDatasourceByUid').mockResolvedValue({
      type: 'prometheus',
      name: 'Prometheus',
    });
    jest.spyOn(dashboardRepo, 'save').mockImplementation(async (entity) => entity as any);

    const result = await service.storeDashboard(grafanaInstance as any, dashboardSummary, false);

    expect(result.uid).toBe('new-dashboard');
    expect(result.name).toBe('New Dashboard');
    expect(result.datasource_type).toBe('prometheus');
    expect(result.panels).toHaveLength(1);
    expect(result.panels[0].title).toBe('CPU Usage');
    expect(result.templating_variables).toHaveLength(1);
  });

  it('should skip storing if already exists and update=false', async () => {
    const existing = { uid: 'existing', name: 'Existing' };
    jest.spyOn(dashboardRepo, 'findOne').mockResolvedValue(existing as any);

    const result = await service.storeDashboard({} as any, { uid: 'existing' }, false);

    expect(result).toBe(existing);
    expect(grafanaApiService.getDashboardByUid).not.toHaveBeenCalled();
  });
});
```

**Acceptance Criteria:**
- ✅ Checks if dashboard already stored (skip if update=false)
- ✅ Fetches full dashboard details from Grafana API
- ✅ Determines datasource type from first graph panel
- ✅ Extracts panels with metadata
- ✅ Extracts templating variables
- ✅ Stores complete dashboard JSON
- ✅ Handles errors and logs appropriately

---

## Task 4: Implement UpdateDashboardsService.getDashboardsToUpdate()

**File:** `apps/grafana-sync/src/modules/grafana-sync/update-dashboards.service.ts`

**Purpose:** Find dashboards that have been updated in Grafana since last sync

**Implementation:**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { GrafanaInstance, GrafanaDashboard } from '@perfana/shared/entities';
import { GrafanaApiService } from '../grafana-api/grafana-api.service';

interface DashboardToUpdate {
  perfanaDashboard: any;  // From search API
  usedBySUT: string[];    // Systems using this dashboard
}

@Injectable()
export class UpdateDashboardsService {
  private readonly logger = new Logger(UpdateDashboardsService.name);

  constructor(
    @InjectRepository(GrafanaDashboard)
    private dashboardRepo: Repository<GrafanaDashboard>,
    private grafanaApiService: GrafanaApiService,
  ) {}

  /**
   * Find dashboards to update from Grafana instance
   * Based on: perfana-grafana/grafana-sync/update-dashboards/get-dashboards-to-update.js
   */
  async getDashboardsToUpdate(grafanaInstance: GrafanaInstance): Promise<DashboardToUpdate[]> {
    this.logger.debug(`Finding dashboards to update for instance: ${grafanaInstance.label}`);

    try {
      // Get stored dashboards for this instance
      const storedDashboards = await this.dashboardRepo.find({
        where: { grafanaInstance: { id: grafanaInstance.id } },
        select: ['uid', 'updated_at', 'used_by_sut'],
      });

      // Fetch all dashboards with 'perfana' tag from Grafana
      const grafanaDashboards = await this.grafanaApiService.searchDashboards(
        grafanaInstance.id,
        { tag: 'perfana', limit: 5000 }
      );

      // Filter to only dashboards with 'perfana' tag
      const perfanaDashboards = grafanaDashboards.filter(dashboard =>
        dashboard.tags?.map((t: string) => t.toLowerCase()).includes('perfana')
      );

      // Process dashboards in batches to respect concurrency limits
      const batchSize = 20; // Same as original PARALLEL_GET_DASHBOARD_CALLS
      const dashboardsToUpdate: DashboardToUpdate[] = [];

      for (let i = 0; i < perfanaDashboards.length; i += batchSize) {
        const batch = perfanaDashboards.slice(i, i + batchSize);

        const batchPromises = batch.map(async (dashboard) => {
          try {
            // Fetch full dashboard details to check update timestamp
            const details = await this.grafanaApiService.getDashboardByUid(
              grafanaInstance.id,
              dashboard.uid
            );

            // Find matching stored dashboard
            const storedDashboard = storedDashboards.find(
              (stored) => stored.uid === dashboard.uid
            );

            if (storedDashboard) {
              // Check if Grafana dashboard is newer than stored
              const grafanaUpdated = new Date(details.meta.updated);
              const storedUpdated = new Date(storedDashboard.updated_at);
              const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

              // Only update if:
              // 1. Grafana dashboard was updated in last hour (reduce noise)
              // 2. Grafana update is newer than stored update
              if (grafanaUpdated > oneHourAgo && grafanaUpdated > storedUpdated) {
                return {
                  perfanaDashboard: dashboard,
                  usedBySUT: storedDashboard.used_by_sut || [],
                };
              }
            }

            return null;
          } catch (error) {
            this.logger.error(
              `Failed to check update status for dashboard ${dashboard.uid}`,
              error.stack
            );
            return null;
          }
        });

        const batchResults = await Promise.allSettled(batchPromises);

        // Collect successful results
        batchResults.forEach((result) => {
          if (result.status === 'fulfilled' && result.value) {
            dashboardsToUpdate.push(result.value);
          }
        });
      }

      if (dashboardsToUpdate.length > 0) {
        this.logger.log(
          `Found ${dashboardsToUpdate.length} dashboards to update: ${dashboardsToUpdate.map(d => d.perfanaDashboard.title).join(', ')}`
        );
      } else {
        this.logger.debug('No dashboards to update');
      }

      return dashboardsToUpdate;
    } catch (error) {
      this.logger.error(`Failed to get dashboards to update for ${grafanaInstance.label}`, error.stack);
      return [];
    }
  }
}
```

**Testing:**

```typescript
describe('UpdateDashboardsService.getDashboardsToUpdate', () => {
  it('should return dashboards updated in Grafana in last hour', async () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    // Stored dashboard updated 2 hours ago
    jest.spyOn(dashboardRepo, 'find').mockResolvedValue([
      { uid: 'dashboard-1', updated_at: twoHoursAgo, used_by_sut: ['app1'] } as any,
    ]);

    // Grafana has same dashboard updated 30 minutes ago
    jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([
      { uid: 'dashboard-1', title: 'Dashboard 1', tags: ['perfana'] },
    ]);

    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
    jest.spyOn(grafanaApiService, 'getDashboardByUid').mockResolvedValue({
      meta: { updated: thirtyMinutesAgo.toISOString() },
      dashboard: { uid: 'dashboard-1' },
    });

    const result = await service.getDashboardsToUpdate({} as any);

    expect(result).toHaveLength(1);
    expect(result[0].perfanaDashboard.uid).toBe('dashboard-1');
    expect(result[0].usedBySUT).toEqual(['app1']);
  });

  it('should not return dashboards updated more than 1 hour ago', async () => {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    jest.spyOn(dashboardRepo, 'find').mockResolvedValue([
      { uid: 'dashboard-1', updated_at: twoHoursAgo } as any,
    ]);

    jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([
      { uid: 'dashboard-1', tags: ['perfana'] },
    ]);

    // Dashboard updated 2 hours ago (not in last hour)
    jest.spyOn(grafanaApiService, 'getDashboardByUid').mockResolvedValue({
      meta: { updated: twoHoursAgo.toISOString() },
    });

    const result = await service.getDashboardsToUpdate({} as any);
    expect(result).toHaveLength(0);
  });
});
```

**Acceptance Criteria:**
- ✅ Fetches stored dashboards with update timestamps
- ✅ Queries Grafana for dashboards with 'perfana' tag
- ✅ Processes in batches of 20 (configurable)
- ✅ Compares update timestamps
- ✅ Only returns dashboards updated in last hour
- ✅ Includes usedBySUT information
- ✅ Handles errors gracefully

---

## Task 5: Implement RestoreDashboardService

**File:** `apps/grafana-sync/src/modules/grafana-sync/restore-dashboard.service.ts`

**Purpose:** Restore dashboards deleted from Grafana but still needed

**Implementation:**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GrafanaInstance, GrafanaDashboard, ApplicationDashboard } from '@perfana/shared/entities';
import { GrafanaApiService } from '../grafana-api/grafana-api.service';

@Injectable()
export class RestoreDashboardService {
  private readonly logger = new Logger(RestoreDashboardService.name);

  constructor(
    @InjectRepository(GrafanaDashboard)
    private dashboardRepo: Repository<GrafanaDashboard>,
    @InjectRepository(ApplicationDashboard)
    private applicationDashboardRepo: Repository<ApplicationDashboard>,
    private grafanaApiService: GrafanaApiService,
  ) {}

  /**
   * Find dashboards to restore
   * Based on: perfana-grafana/grafana-sync/restore-dashboard/get-dashboards-to-restore.js
   */
  async getDashboardsToRestore(grafanaInstance: GrafanaInstance): Promise<GrafanaDashboard[]> {
    this.logger.debug(`Finding dashboards to restore for instance: ${grafanaInstance.label}`);

    try {
      // Get all stored dashboards for this instance
      const storedDashboards = await this.dashboardRepo.find({
        where: { grafanaInstance: { id: grafanaInstance.id } },
      });

      // Get all dashboard UIDs from Grafana
      const allGrafanaDashboards = await this.grafanaApiService.searchDashboards(
        grafanaInstance.id,
        { limit: 5000 }
      );

      // Filter to only actual dashboards (exclude folders)
      const grafanaDashboardUids = new Set(
        allGrafanaDashboards
          .filter(item => item.type === 'dash-db')
          .map(dashboard => dashboard.uid)
      );

      // Find stored dashboards that don't exist in Grafana
      const missingDashboards = storedDashboards.filter(
        stored => !grafanaDashboardUids.has(stored.uid)
      );

      // Filter to only dashboards that should be restored
      const dashboardsToRestore: GrafanaDashboard[] = [];

      for (const missingDashboard of missingDashboards) {
        try {
          // Check if used by application dashboards
          const applicationDashboards = await this.applicationDashboardRepo.find({
            where: { dashboard_uid: missingDashboard.uid },
          });

          const isUsedByApplications = applicationDashboards.length > 0;

          // Check if it's a template dashboard
          const isTemplate = missingDashboard.tags?.includes('perfana-template');

          // Restore if used by applications OR is a template
          if (isUsedByApplications || isTemplate) {
            dashboardsToRestore.push(missingDashboard);
          }
        } catch (error) {
          this.logger.error(
            `Failed to check if dashboard ${missingDashboard.uid} should be restored`,
            error.stack
          );
        }
      }

      if (dashboardsToRestore.length > 0) {
        this.logger.log(
          `Found ${dashboardsToRestore.length} dashboards to restore: ${dashboardsToRestore.map(d => d.name).join(', ')}`
        );
      } else {
        this.logger.debug('No dashboards to restore');
      }

      return dashboardsToRestore;
    } catch (error) {
      this.logger.error(`Failed to get dashboards to restore for ${grafanaInstance.label}`, error.stack);
      return [];
    }
  }

  /**
   * Restore a dashboard to Grafana
   * Based on: perfana-grafana/grafana-sync/restore-dashboard/restore-dashboard.js
   */
  async restoreDashboard(
    grafanaInstance: GrafanaInstance,
    dashboard: GrafanaDashboard,
  ): Promise<void> {
    this.logger.log(`Restoring dashboard: ${dashboard.name} to ${grafanaInstance.label}`);

    try {
      // Parse stored Grafana JSON
      const grafanaJson =
        typeof dashboard.grafana_json === 'string'
          ? JSON.parse(dashboard.grafana_json)
          : dashboard.grafana_json;

      // Prepare dashboard for restoration
      const restorePayload = {
        dashboard: {
          ...grafanaJson.dashboard,
          id: null, // Let Grafana assign new ID
        },
        folderId: grafanaJson.meta?.folderId || 0, // Use stored folder or General
        overwrite: false,
      };

      // Remove meta (not needed for create)
      delete restorePayload.dashboard.id;

      // Create dashboard in Grafana
      await this.grafanaApiService.createDashboard(grafanaInstance.id, restorePayload);

      this.logger.log(`Restored dashboard: ${dashboard.name} to ${grafanaInstance.label}`);
    } catch (error) {
      const errorMessage = error.message || String(error);

      // If restore fails due to precondition (412), remove from Perfana DB
      if (errorMessage.includes('412') || errorMessage.includes('precondition')) {
        this.logger.warn(
          `Dashboard "${dashboard.name}" could not be restored (precondition failed), removing from Perfana database`
        );

        try {
          await this.dashboardRepo.remove(dashboard);
          this.logger.log(`Removed dashboard ${dashboard.name} from Perfana database`);
        } catch (removeError) {
          this.logger.error('Failed to remove dashboard from Perfana database', removeError.stack);
        }
      } else {
        this.logger.error(`Failed to restore dashboard "${dashboard.name}"`, error.stack);
      }
    }
  }
}
```

**Testing:**

```typescript
describe('RestoreDashboardService', () => {
  describe('getDashboardsToRestore', () => {
    it('should find dashboards missing in Grafana that are templates', async () => {
      // Stored dashboards
      jest.spyOn(dashboardRepo, 'find').mockResolvedValue([
        { uid: 'exists-1', name: 'Dashboard 1', tags: [] } as any,
        { uid: 'missing-template', name: 'Template', tags: ['perfana-template'] } as any,
      ]);

      // Grafana only has 'exists-1'
      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([
        { uid: 'exists-1', type: 'dash-db' },
      ]);

      jest.spyOn(applicationDashboardRepo, 'find').mockResolvedValue([]);

      const result = await service.getDashboardsToRestore({} as any);

      expect(result).toHaveLength(1);
      expect(result[0].uid).toBe('missing-template');
    });

    it('should find dashboards used by applications', async () => {
      jest.spyOn(dashboardRepo, 'find').mockResolvedValue([
        { uid: 'used-dashboard', name: 'Used Dashboard', tags: [] } as any,
      ]);

      jest.spyOn(grafanaApiService, 'searchDashboards').mockResolvedValue([]);

      // Dashboard is used by an application
      jest.spyOn(applicationDashboardRepo, 'find').mockResolvedValue([
        { dashboard_uid: 'used-dashboard' } as any,
      ]);

      const result = await service.getDashboardsToRestore({} as any);

      expect(result).toHaveLength(1);
      expect(result[0].uid).toBe('used-dashboard');
    });
  });

  describe('restoreDashboard', () => {
    it('should restore dashboard to Grafana', async () => {
      const dashboard = {
        name: 'Test Dashboard',
        grafana_json: JSON.stringify({
          dashboard: { id: 123, uid: 'test', title: 'Test' },
          meta: { folderId: 5 },
        }),
      };

      jest.spyOn(grafanaApiService, 'createDashboard').mockResolvedValue({});

      await service.restoreDashboard({} as any, dashboard as any);

      expect(grafanaApiService.createDashboard).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          dashboard: expect.objectContaining({ uid: 'test' }),
          folderId: 5,
        })
      );
    });

    it('should remove dashboard if restore fails with 412', async () => {
      const dashboard = {
        name: 'Test Dashboard',
        grafana_json: '{"dashboard": {}}',
      };

      const error = new Error('statusCode: 412 precondition failed');
      jest.spyOn(grafanaApiService, 'createDashboard').mockRejectedValue(error);
      jest.spyOn(dashboardRepo, 'remove').mockResolvedValue({} as any);

      await service.restoreDashboard({} as any, dashboard as any);

      expect(dashboardRepo.remove).toHaveBeenCalledWith(dashboard);
    });
  });
});
```

**Acceptance Criteria:**
- ✅ Identifies dashboards missing in Grafana
- ✅ Filters to templates or used by applications
- ✅ Restores dashboard with correct payload
- ✅ Handles 412 errors by removing from DB
- ✅ Logs all operations appropriately

---

## Task 6: Integrate Services in GrafanaSyncService

**File:** `apps/grafana-sync/src/modules/grafana-sync/grafana-sync.service.ts`

**Purpose:** Orchestrate the sync workflow

**Implementation:**

```typescript
// Update the existing handleGrafanaSync method

async addNewDashboardsForInstance(instanceId: string): Promise<number> {
  const instance = await this.grafanaInstanceRepo.findOne({ where: { id: instanceId } });
  if (!instance) {
    throw new Error(`Grafana instance ${instanceId} not found`);
  }

  this.logger.log(`Adding new dashboards for instance: ${instance.label}`);

  const dashboardsToAdd = await this.storeDashboardService.getDashboardsToAdd(instance);

  let addedCount = 0;
  for (const dashboard of dashboardsToAdd) {
    try {
      await this.storeDashboardService.storeDashboard(instance, dashboard, false);
      addedCount++;
    } catch (error) {
      this.logger.error(`Failed to add dashboard ${dashboard.uid}`, error.stack);
    }
  }

  this.logger.log(`Added ${addedCount} dashboards for ${instance.label}`);
  return addedCount;
}

async updateDashboardsForInstance(instanceId: string): Promise<number> {
  const instance = await this.grafanaInstanceRepo.findOne({ where: { id: instanceId } });
  if (!instance) {
    throw new Error(`Grafana instance ${instanceId} not found`);
  }

  this.logger.log(`Updating dashboards for instance: ${instance.label}`);

  const dashboardsToUpdate = await this.updateDashboardsService.getDashboardsToUpdate(instance);

  let updatedCount = 0;
  for (const dashboardSpec of dashboardsToUpdate) {
    try {
      await this.storeDashboardService.storeDashboard(
        instance,
        dashboardSpec.perfanaDashboard,
        true // update = true
      );
      updatedCount++;
    } catch (error) {
      this.logger.error(`Failed to update dashboard ${dashboardSpec.perfanaDashboard.uid}`, error.stack);
    }
  }

  this.logger.log(`Updated ${updatedCount} dashboards for ${instance.label}`);
  return updatedCount;
}

async restoreDashboardsForInstance(instanceId: string): Promise<number> {
  const instance = await this.grafanaInstanceRepo.findOne({ where: { id: instanceId } });
  if (!instance) {
    throw new Error(`Grafana instance ${instanceId} not found`);
  }

  this.logger.log(`Restoring dashboards for instance: ${instance.label}`);

  const dashboardsToRestore = await this.restoreDashboardService.getDashboardsToRestore(instance);

  let restoredCount = 0;
  for (const dashboard of dashboardsToRestore) {
    try {
      await this.restoreDashboardService.restoreDashboard(instance, dashboard);
      restoredCount++;
    } catch (error) {
      this.logger.error(`Failed to restore dashboard ${dashboard.uid}`, error.stack);
    }
  }

  this.logger.log(`Restored ${restoredCount} dashboards for ${instance.label}`);
  return restoredCount;
}
```

---

## Task 7: Implement AutoConfigService (Phase 2)

This is a larger task that will be broken down in a separate document due to complexity.

**Reference:** Original implementation in `perfana-grafana/auto-config/auto-config-service.js`

**Key Components:**
1. Variable discovery
2. Dashboard UID generation
3. Dashboard creation/update logic
4. Application dashboard management
5. Generic checks/deep links/report panels

This will be documented separately once core sync is working.

---

## Task 8: End-to-End Testing

**File:** `apps/grafana-sync/test/e2e/grafana-sync.e2e.spec.ts`

**Test Scenarios:**

1. **Complete sync workflow**
   - Add new dashboards
   - Update existing dashboards
   - Restore missing dashboards
   - Verify database state

2. **Error handling**
   - Invalid Grafana instance
   - API failures
   - Database failures

3. **Concurrency**
   - Multiple instances syncing
   - Batch processing

4. **Auto-configuration** (Phase 2)
   - Test run with tags
   - Dashboard creation
   - Variable discovery

---

## Implementation Timeline

| Task | Estimated Time | Priority |
|------|---------------|----------|
| Task 1: GrafanaApiService | 4 hours | HIGH |
| Task 2: StoreDashboardService.getDashboardsToAdd | 2 hours | HIGH |
| Task 3: StoreDashboardService.storeDashboard | 4 hours | HIGH |
| Task 4: UpdateDashboardsService | 3 hours | HIGH |
| Task 5: RestoreDashboardService | 3 hours | HIGH |
| Task 6: Integration | 2 hours | HIGH |
| Task 7: AutoConfigService | 8 hours | MEDIUM |
| Task 8: E2E Testing | 4 hours | MEDIUM |
| **Total** | **30 hours** (~4 days) | |

---

## Next Steps

1. **Review this document** with team
2. **Set up development environment** with test Grafana instance
3. **Start with Task 1** (GrafanaApiService)
4. **Implement tasks sequentially** with tests
5. **Integration testing** after Task 6
6. **Phase 2** (AutoConfig) after core sync working

## References

- Original Implementation Analysis: `GRAFANA_SYNC_ORIGINAL_IMPLEMENTATION_ANALYSIS.md`
- Migration Plan: `GRAFANA_SYNC_MIGRATION_PLAN.md`
- Worker's GrafanaClient: `apps/worker/src/lib/grafana/client.ts`
- Shared Entities: `packages/shared/src/entities/`
