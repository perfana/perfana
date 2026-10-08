import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GrafanaDashboard, GrafanaInstance } from '@perfana/shared/entities';
import { GrafanaApiService } from '../grafana-api/grafana-api.service';
import { PERFANA_TAG, GRAFANA_SEARCH_LIMIT } from '../../config/constants';

/** Panel datasource as Grafana emits it (concrete UID or template variable ref). */
type PanelDatasource =
  | string
  | {
      uid?: string;
      type?: string;
    };

/** Minimal panel fields needed to resolve datasourceType at sync time. */
interface PanelWithDatasource {
  title?: string;
  datasource?: PanelDatasource;
  targets?: Array<{ datasource?: PanelDatasource }>;
}

/**
 * Subset of dashboard.templating.list used for datasource-type resolution.
 * Mirrors TemplatingVariable in auto-config without coupling the sync module to it.
 */
interface DashboardTemplatingVariable {
  name: string;
  type?: string;
  query?: string | { query?: string };
}

@Injectable()
export class StoreDashboardService {
  private readonly logger = new Logger(StoreDashboardService.name);

  constructor(
    @InjectRepository(GrafanaDashboard)
    private grafanaDashboardRepo: Repository<GrafanaDashboard>,
    @InjectRepository(GrafanaInstance)
    private grafanaInstanceRepo: Repository<GrafanaInstance>,
    private grafanaApiService: GrafanaApiService,
  ) {}

  /**
   * Add new dashboards from all Grafana instances.
   * When instances are provided (from the sync orchestrator), avoids re-fetching.
   */
  async addNewDashboards(instances?: GrafanaInstance[]): Promise<number> {
    this.logger.debug('Checking for new dashboards to add...');

    let totalAdded = 0;

    try {
      const allInstances = instances ?? (await this.grafanaInstanceRepo.find());

      for (const instance of allInstances) {
        const added = await this.addNewDashboardsForInstance(instance);
        totalAdded += added;
      }

      if (totalAdded > 0) {
        this.logger.log(`Added ${totalAdded} new dashboards`);
      }
    } catch (error) {
      this.logger.error('Failed to add new dashboards:', error);
    }

    return totalAdded;
  }

  /**
   * Find dashboards to add from a Grafana instance.
   * The Grafana API search already filters by the perfana tag, so no
   * redundant in-memory tag check is needed.
   */
  async getDashboardsToAdd(grafanaInstance: GrafanaInstance): Promise<any[]> {
    this.logger.debug(`Finding dashboards to add for instance: ${grafanaInstance.label}`);

    try {
      const storedDashboards = await this.grafanaDashboardRepo.find({
        where: { grafanaInstanceId: grafanaInstance.id },
        select: ['uid'],
      });

      const storedUids = new Set(storedDashboards.map((d) => d.uid));

      const grafanaDashboards = await this.grafanaApiService.searchDashboards(grafanaInstance.id, {
        tag: PERFANA_TAG,
        limit: GRAFANA_SEARCH_LIMIT,
      });

      const dashboardsToAdd = grafanaDashboards.filter(
        (dashboard) => !storedUids.has(dashboard.uid),
      );

      if (dashboardsToAdd.length > 0) {
        this.logger.log(
          `Found ${dashboardsToAdd.length} dashboards to add: ${dashboardsToAdd.map((d: any) => d.title).join(', ')}`,
        );
      } else {
        this.logger.debug('No dashboards to add');
      }

      return dashboardsToAdd;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.stack : String(error);
      this.logger.error(
        `Failed to get dashboards to add for ${grafanaInstance.label}`,
        errorMessage,
      );
      return [];
    }
  }

  /**
   * Add new dashboards for a specific Grafana instance.
   * Failures are isolated per dashboard so one bad import cannot abort the rest
   * (same shape as updateDashboardsForInstance).
   */
  private async addNewDashboardsForInstance(instance: GrafanaInstance): Promise<number> {
    let addedCount = 0;

    try {
      const dashboardsToAdd = await this.getDashboardsToAdd(instance);

      for (const dashboard of dashboardsToAdd) {
        try {
          await this.storeDashboard(instance, dashboard, false);
          addedCount++;
        } catch (error) {
          // storeDashboard already logged this with a stack; one line is enough to say
          // the loop carried on.
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Skipped dashboard "${dashboard.title}" (UID: ${dashboard.uid}) for ${instance.label}: ${message}`,
          );
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.stack : String(error);
      this.logger.error(`Failed to add dashboards for instance ${instance.label}:`, errorMessage);
    }

    return addedCount;
  }

  /**
   * Store dashboard from Grafana to Perfana database
   */
  async storeDashboard(
    grafanaInstance: GrafanaInstance,
    grafanaDashboardSummary: any, // From search API
    update: boolean = false,
  ): Promise<GrafanaDashboard> {
    this.logger.debug(
      `Storing dashboard: ${grafanaDashboardSummary.title} (UID: ${grafanaDashboardSummary.uid}), update: ${update}`,
    );

    try {
      // Check if already stored
      const existing = await this.grafanaDashboardRepo.findOne({
        where: {
          uid: grafanaDashboardSummary.uid,
          grafanaInstanceId: grafanaInstance.id,
        },
      });

      // If exists and not updating, skip
      if (existing && !update) {
        this.logger.debug(`Dashboard ${grafanaDashboardSummary.uid} already stored, skipping`);
        return existing;
      }

      // Fetch full dashboard details from Grafana API
      const dashboardDetails = await this.grafanaApiService.getDashboardByUid(
        grafanaInstance.id,
        grafanaDashboardSummary.uid,
      );

      // Extract first graph panel to determine datasource
      const firstGraphPanel = dashboardDetails.dashboard.panels?.find((panel: any) =>
        ['graph', 'timeseries', 'table', 'flamegraph'].includes(panel.type),
      );

      if (!firstGraphPanel) {
        throw new Error(`No graph panel found in dashboard ${grafanaDashboardSummary.title}`);
      }

      // Get datasource information. Perfana only persists datasourceType (not a concrete
      // UID); when the panel references a Grafana template variable ($name / ${name}),
      // derive the type from the panel or templating.list — never call
      // /api/datasources/uid/${variable}.
      let datasource: { type: string };
      try {
        datasource = await this.resolvePanelDatasource(
          grafanaInstance.id,
          firstGraphPanel,
          dashboardDetails.dashboard.templating?.list,
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.stack : String(error);
        this.logger.error(
          `Failed to fetch datasource for panel "${firstGraphPanel.title}" in dashboard "${dashboardDetails.dashboard.title}"`,
          errorMessage,
        );
        throw error;
      }

      // Build or update dashboard entity
      const dashboard = existing || new GrafanaDashboard();
      dashboard.grafanaInstanceId = grafanaInstance.id;
      dashboard.grafanaInstance = grafanaInstance;
      dashboard.name = dashboardDetails.dashboard.title;
      dashboard.datasourceType = datasource.type;
      dashboard.uri = dashboardDetails.meta.url;
      dashboard.grafanaId = dashboardDetails.dashboard.id;
      dashboard.uid = dashboardDetails.dashboard.uid;
      dashboard.tags = dashboardDetails.dashboard.tags || [];
      dashboard.slug = dashboardDetails.meta.slug;
      dashboard.grafanaJson = dashboardDetails; // Store full JSON
      dashboard.organizationId = grafanaInstance.organizationId || null;

      // Extract panels
      dashboard.panels = this.extractPanels(dashboardDetails.dashboard.panels);

      // Extract templating variables
      if (dashboardDetails.dashboard.templating?.list) {
        dashboard.templatingVariables = this.extractTemplatingVariables(
          dashboardDetails.dashboard.templating.list,
        );
        dashboard.variables = dashboardDetails.dashboard.templating.list.map((v: any) => ({
          name: v.name,
        }));
      } else {
        dashboard.templatingVariables = [];
        dashboard.variables = [];
      }

      // Save to database (will UPDATE if existing has ID, INSERT if new)
      const saved = await this.grafanaDashboardRepo.save(dashboard);

      const action = update ? 'Updated' : 'Added';
      this.logger.log(`${action} dashboard: ${dashboard.name} from ${grafanaInstance.label}`);

      return saved;
    } catch (error) {
      const action = update ? 'updating' : 'adding';
      const errorMessage = error instanceof Error ? error.stack : String(error);
      this.logger.error(
        `Failed ${action} dashboard "${grafanaDashboardSummary.title}" for ${grafanaInstance.label}`,
        errorMessage,
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
      .filter((panel) => !panel.repeatIteration && panel.datasource)
      .map((panel) => ({
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
    return templatingList.map((variable) => ({
      name: variable.name,
      type: variable.type,
      options: variable.regex ? variable.options : undefined,
      datasource: variable.datasource || undefined,
      regex: variable.regex || undefined,
      query: variable.query,
    }));
  }

  /**
   * Resolve a panel's datasource to at least `{ type }` for persistence.
   * Concrete UIDs/names still hit the Grafana API; template variable refs do not.
   */
  private async resolvePanelDatasource(
    instanceId: string,
    panel: PanelWithDatasource,
    templatingList: DashboardTemplatingVariable[] | undefined,
  ): Promise<{ type: string }> {
    const ds = panel.datasource;
    if (ds == null || ds === '') {
      throw new Error('No datasource found in panel');
    }

    // Grafana embeds the concrete type beside the (possibly templated) uid, on the panel or
    // on its first target. Same two sources the worker uses (panels/helpers.ts).
    const embeddedType = (d: PanelDatasource | undefined): string | undefined =>
      d && typeof d === 'object' && typeof d.type === 'string' && d.type.length > 0
        ? d.type
        : undefined;
    const panelDatasourceType = embeddedType(ds) ?? embeddedType(panel.targets?.[0]?.datasource);

    if (typeof ds === 'object') {
      if (ds.uid) {
        const variableName = this.parseTemplateVariableRef(ds.uid);
        if (variableName) {
          return {
            type: this.resolveDatasourceTypeFromTemplating(
              variableName,
              templatingList,
              panelDatasourceType,
            ),
          };
        }
        return this.grafanaApiService.getDatasourceByUid(instanceId, ds.uid);
      }

      // Object without uid: prior code passed it to getDatasourceByName (not a real name).
      // If Grafana embedded a type, that is all we persist — use it; otherwise fail clearly.
      if (panelDatasourceType) {
        return { type: panelDatasourceType };
      }
      throw new Error('No datasource found in panel');
    }

    const variableName = this.parseTemplateVariableRef(ds);
    if (variableName) {
      return {
        type: this.resolveDatasourceTypeFromTemplating(
          variableName,
          templatingList,
          panelDatasourceType,
        ),
      };
    }
    return this.grafanaApiService.getDatasourceByName(instanceId, ds);
  }

  /**
   * Return the variable name when `value` is a Grafana template ref ($name or ${name}).
   * Does not match partial strings or multi-segment refs.
   */
  private parseTemplateVariableRef(value: string): string | null {
    const braced = /^\$\{([^}]+)\}$/.exec(value);
    if (braced) {
      return braced[1];
    }
    const plain = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(value);
    if (plain) {
      return plain[1];
    }
    return null;
  }

  /**
   * Derive datasourceType for a templated panel datasource without picking a concrete UID.
   * A datasource variable may list many options; Perfana only stores the type.
   */
  private resolveDatasourceTypeFromTemplating(
    variableName: string,
    templatingList: DashboardTemplatingVariable[] | undefined,
    panelDatasourceType: string | undefined,
  ): string {
    // The type Grafana embedded on the panel (or its first target) is authoritative and
    // needs no templating.list entry — checked first so a dashboard whose variable lives
    // elsewhere (library panel, hand-edited JSON) still imports.
    if (typeof panelDatasourceType === 'string' && panelDatasourceType.length > 0) {
      return panelDatasourceType;
    }

    const variable = (templatingList ?? []).find((v) => v.name === variableName);

    if (!variable) {
      throw new Error(
        `Panel datasource references template variable "${variableName}" which is not defined in dashboard.templating.list`,
      );
    }

    // For type=datasource variables, `query` is the type filter (e.g. "prometheus"),
    // not a metric query. Never use current/options — that would invent a single DS.
    if (variable.type === 'datasource') {
      const query = typeof variable.query === 'string' ? variable.query.trim() : '';
      if (query.length > 0) {
        return query;
      }
    }

    throw new Error(
      `Cannot determine datasource type for template variable "${variableName}" ` +
        `(type=${variable.type ?? 'unknown'}). Panel has no datasource.type and the variable has no type filter in templating.list.`,
    );
  }
}
