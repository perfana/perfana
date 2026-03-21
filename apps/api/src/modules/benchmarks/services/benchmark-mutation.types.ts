import type { BenchmarkConfiguration } from './benchmark-query.types';

/**
 * DTO for creating a standard benchmark
 */
export interface CreateBenchmarkDto {
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
  source: string;
  grafanaInstance?: string;
  dashboardLabel?: string;
  dashboardId?: number;
  dashboardUid?: string;
  applicationDashboardId?: string;
  configTitle: string;
  panelTitle: string;
  evaluateType: string;
  requirementOperator: string;
  requirementValue: number;
  description?: string;
  tags?: string[];
  configuration?: Partial<BenchmarkConfiguration>;
}

/**
 * DTO for updating a standard benchmark
 */
export interface UpdateBenchmarkDto {
  systemUnderTestId?: string;
  testEnvironment?: string;
  workload?: string;
  source?: string;
  grafanaInstance?: string;
  dashboardLabel?: string;
  dashboardId?: number;
  dashboardUid?: string;
  configTitle?: string;
  panelTitle?: string;
  evaluateType?: string;
  requirementOperator?: string;
  requirementValue?: number;
  description?: string;
  tags?: string[];
  configuration?: Partial<BenchmarkConfiguration>;
  enabled?: boolean;
  valid?: boolean;
}

/**
 * DTO for creating an Apdex SLO benchmark
 */
export interface CreateApdexSloDto {
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
  transactionName?: string;
  minApdexScore: number;
  apdexThresholdMs?: number;
  includeFailedRequests?: boolean;
  excludeRampUpTime?: boolean;
  description?: string;
  tags?: string[];
}

/**
 * DTO for updating an Apdex SLO benchmark
 */
export interface UpdateApdexSloDto {
  transactionName?: string;
  minApdexScore?: number;
  apdexThresholdMs?: number | null;
  includeFailedRequests?: boolean;
  excludeRampUpTime?: boolean;
  enabled?: boolean;
  description?: string;
  tags?: string[];
}
