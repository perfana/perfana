import { SortField, SortDirection } from './slo.types';

export interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

export interface MetricTarget {
  target?: string;
  value?: number | string | null;
  meets_requirement?: boolean;
  status?: string;
  message?: string;
}

export interface MetricSeriesResult {
  benchmark_id?: string;
  targets?: MetricTarget[];
  metric_unit?: string;
  status?: string;
  message?: string;
  panel_type?: string;
  evaluate_type?: string;
}

export interface Benchmark {
  id?: string;
  updated_at?: string;
}

export interface MetricSeriesTableProps {
  result: MetricSeriesResult;
  resultKey: string;
  sortConfig: Map<string, SortConfig>;
  onSort: (resultKey: string, field: SortField) => void;
  selectedTarget: Map<string, string>;
  onSelectTarget: (resultKey: string, targetName: string | undefined) => void;
  benchmarks: Benchmark[];
}

export interface MetricSeriesStatusChipProps {
  target: MetricTarget;
  result: MetricSeriesResult;
  isStale: boolean;
}

export interface MetricSeriesTableHeaderProps {
  resultKey: string;
  sortConfig: Map<string, SortConfig>;
  onSort: (resultKey: string, field: SortField) => void;
}

export interface MetricSeriesTableRowProps {
  target: MetricTarget;
  sortedIndex: number;
  totalCount: number;
  isSelected: boolean;
  result: MetricSeriesResult;
  isStale: boolean;
  onClick: () => void;
}

export interface MetricSeriesEmptyStateProps {
  message?: string;
}
