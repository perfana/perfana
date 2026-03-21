// Grafana-related type definitions
// Equivalent to MongoDB collections: grafanas, grafanaDashboards, applicationDashboards

export interface GrafanaInstance {
  id: string;
  label: string;
  clientUrl: string;
  serverUrl?: string;
  orgId: string;
  apiKey?: string;
  username?: string;
  password?: string;
  snapshotInstance: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGrafanaInstanceDto {
  label: string;
  clientUrl: string;
  serverUrl?: string;
  orgId: string;
  apiKey?: string;
  username?: string;
  password?: string;
  snapshotInstance?: boolean;
}

export interface UpdateGrafanaInstanceDto extends Partial<CreateGrafanaInstanceDto> {}

// Dashboard templating variable structure
export interface TemplatingVariable {
  name: string;
  query?: string;
  type?: string;
  datasource?: Record<string, any>;
  regex?: string;
}

// Dashboard panel structure (simplified - contains complex nested objects)
export interface DashboardPanel {
  id: number;
  title: string;
  type: string;
  datasourceId?: number;
  datasourceType?: string;
  datasourceDatabase?: string;
  minTimeInterval?: string;
  yAxesFormat?: string;
  description?: string;
  repeat?: string;
  targets?: Array<{
    query?: string;
    rp?: string; // retention policy
    measurement?: string;
    field?: string;
    whereFilter?: string;
    groupBy?: string[];
    legendFormat?: string;
  }>;
}

// Dashboard variable structure
export interface DashboardVariable {
  name: string;
  [key: string]: any; // Allow additional properties
}

export interface GrafanaDashboard {
  id: string;
  grafanaInstanceId: string;
  grafanaId: number; // Grafana's internal ID
  datasourceType?: string;
  uid: string;
  slug?: string;
  name: string;
  uri?: string;
  templatingVariables?: TemplatingVariable[];
  panels: DashboardPanel[];
  variables?: DashboardVariable[];
  tags?: string[];
  usedBySut?: string[]; // Array of system under test names
  updated: string;
  createdAt: string;
}

export interface CreateGrafanaDashboardDto {
  grafanaInstanceId: string;
  grafanaId: number;
  datasourceType?: string;
  uid: string;
  slug?: string;
  name: string;
  uri?: string;
  templatingVariables?: TemplatingVariable[];
  panels: DashboardPanel[];
  variables?: DashboardVariable[];
  tags?: string[];
  usedBySut?: string[];
}

export interface UpdateGrafanaDashboardDto extends Partial<CreateGrafanaDashboardDto> {}

// Application dashboard variable configuration
export interface ApplicationDashboardVariable {
  name: string;
  values: string[];
}

// Replaced templating variable structure
export interface ReplacedTemplatingVariable {
  name: string;
  value: string[];
}

export interface ApplicationDashboard {
  id: string;
  systemUnderTestId: string;
  testEnvironment: string;
  grafanaInstanceId: string;
  grafanaDashboardId: string;
  dashboardName: string;
  dashboardId?: number;
  dashboardUid?: string;
  dashboardLabel: string;
  tags?: string[];
  templateDashboardUid?: string;
  variables?: ApplicationDashboardVariable[];
  replacedTemplatingVariables?: ReplacedTemplatingVariable[];
  snapshotTimeout: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateApplicationDashboardDto {
  systemUnderTestId: string;
  testEnvironment: string;
  grafanaInstanceId: string;
  grafanaDashboardId: string;
  dashboardName: string;
  dashboardId?: number;
  dashboardUid?: string;
  dashboardLabel: string;
  tags?: string[];
  templateDashboardUid?: string;
  variables?: ApplicationDashboardVariable[];
  replacedTemplatingVariables?: ReplacedTemplatingVariable[];
  snapshotTimeout?: number;
}

export interface UpdateApplicationDashboardDto extends Partial<CreateApplicationDashboardDto> {}

// Query/Filter interfaces for API operations
export interface GrafanaInstanceQuery {
  label?: string;
  snapshotInstance?: boolean;
}

export interface GrafanaDashboardQuery {
  grafanaInstanceId?: string;
  name?: string;
  uid?: string;
  tags?: string[];
  usedBySut?: string;
}

export interface ApplicationDashboardQuery {
  systemUnderTestId?: string;
  testEnvironment?: string;
  grafanaInstanceId?: string;
  dashboardLabel?: string;
}

// Response interfaces for lists
export interface GrafanaInstanceListResponse {
  instances: GrafanaInstance[];
  total: number;
}

export interface GrafanaDashboardListResponse {
  dashboards: GrafanaDashboard[];
  total: number;
}

export interface ApplicationDashboardListResponse {
  dashboards: ApplicationDashboard[];
  total: number;
}

// Extended interfaces with joined data for API responses
export interface GrafanaDashboardWithInstance extends GrafanaDashboard {
  grafanaInstance: Pick<GrafanaInstance, 'id' | 'label' | 'clientUrl'>;
}

export interface ApplicationDashboardWithDetails extends ApplicationDashboard {
  grafanaInstance: Pick<GrafanaInstance, 'id' | 'label' | 'clientUrl'>;
  grafanaDashboard: Pick<GrafanaDashboard, 'id' | 'name' | 'uid' | 'tags'>;
  systemUnderTest: {
    id: string;
    name: string;
  };
}

// Utility types for dashboard operations
export interface DashboardSnapshot {
  id: string;
  dashboardId: string;
  snapshotUrl: string;
  createdAt: string;
  expiresAt?: string;
}

export interface DashboardVariableValues {
  variableName: string;
  possibleValues: string[];
  selectedValues: string[];
}

export interface DashboardRenderRequest {
  applicationDashboardId: string;
  variables?: Record<string, string[]>;
  timeRange?: {
    from: string;
    to: string;
  };
  snapshotTimeout?: number;
}