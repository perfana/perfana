import { TestRun } from '@/types/test-runs';

// Interface for drill-down filters
export interface DrillDownFilters {
  scenario?: string;
  transaction?: string;
  sampler?: string;
}

// Interface for sampler/request statistics
export interface SamplerStat {
  sampler_name: string;
  scenario_name?: string;
  avg_response_time: number;
  min_response_time: number;
  max_response_time: number;
  p95_response_time: number;
  p99_response_time: number;
  passed_count: number;
  failed_count: number;
  total_count: number;
  avg_latency: number;
  avg_connect_time: number;
  total_request_size: number;
  total_response_size: number;
  apdex_score: number;
  active_threshold: number;
  url_hash: string | null;
  url_pattern: string | null;
}

export interface ServiceLevelObjectivesSectionProps {
  testRun: TestRun | null;
  testRunId: string;
  sloExpanded: boolean;
  setSloExpanded: (expanded: boolean) => void;
  hasDistributedTracing?: boolean;
  hasDynatrace?: boolean;
  onDrillDownToDistributedTracing?: (filters: DrillDownFilters) => void;
  onDrillDownToDynatrace?: (filters: DrillDownFilters) => void;
}

// Sorting state for series tables - key is the check result unique key, value is the sort config
export type SortField = 'series' | 'value' | 'result' | 'threshold' | 'avgResponseTime';
export type SortDirection = 'asc' | 'desc';
