// Type exports
// Shared types for entities and domain logic

// Import and re-export test-run types
export * from './test-run.types';

// Import and re-export job progress types
export * from './job-progress.types';

// Import and re-export keycloak types
export * from './keycloak.types';

// Import and re-export database types
export * from './database.types';

// Import and re-export reports types
export * from './reports.types';

// Data source types
export interface DataSource {
  id: string;
  organizationId: string;
  sourceType: string;
  instanceName: string;
  connectionConfig: Record<string, any>;
  supportsRealTime: boolean;
  supportsHistorical: boolean;
  queryRateLimit?: number;
  isActive: boolean;
  lastHealthCheck?: Date;
  healthStatus?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Query and metrics types
export interface DsQuery {
  id: string;
  sourceType: string;
  sourceInstance: string;
  queryName?: string;
  queryHash: string;
  queryDefinition: Record<string, any>;
  queryParameters?: Record<string, any>;
  targetReference?: Record<string, any>;
  expectedMetrics?: string[];
  executionTimeout: number;
  avgExecutionTimeMs?: number;
  successRate?: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DsMetric {
  time: Date;
  testRunId: string;
  queryExecutionId: string;
  sourceType: string;
  sourceInstance: string;
  metricName: string;
  metricPath?: string;
  value: number;
  unit?: string;
  dimensions?: Record<string, any>;
  isRampUp: boolean;
  timestep?: number;
  collectedAt: Date;
}

// Note: Benchmark entity is exported from entities/
// Remove this interface to avoid conflicts

// Results types
export interface CheckResult {
  id: string;
  testRunId: string;
  benchmarkId: string;
  queryExecutionId?: string;
  checkType: string;
  evaluateType: string;
  excludeRampUpTime: boolean;
  sourceType?: string;
  sourceInstance?: string;
  sourceReference?: Record<string, any>;
  requirement: Record<string, any>;
  panelAverage: number;
  meets_requirement: boolean;
  targets?: Record<string, any>;
  status?: string;
  message?: string;
  evaluatedAt: Date;
}

export interface CompareResult {
  id: string;
  testRunId: string;
  baselineTestRunId: string;
  benchmarkId: string;
  queryExecutionId?: string;
  label?: string;
  sourceType?: string;
  sourceInstance?: string;
  sourceReference?: Record<string, any>;
  panelTitle?: string;
  panelId?: string;
  panelType?: string;
  evaluateType: string;
  excludeRampUpTime: boolean;
  panelAverage: number;
  benchmarkBaselineTestRunPanelAverage: number;
  panelAverageDelta?: number;
  panelAverageDeltaPercentage?: number;
  benchmarkBaselineTestRunOk: boolean;
  status?: string;
  message?: string;
  targets?: Record<string, any>;
  evaluatedAt: Date;
}
