import { ReactNode } from 'react';
import { TransactionStat, DrillDownFilters } from '../../types/performance-analysis.types';

export type { TransactionStat, DrillDownFilters };

/**
 * Top10 item derived from transaction statistics
 */
export interface Top10TransactionItem {
  scenarioName: string;
  transactionName: string;
  avgResponseTime: number;
  impact: number;
  callCount: number;
  errorCount: number;
  errorRate: number;
  throughput: number;
}

export type Top10TableSortField = 'scenarioName' | 'transactionName' | 'value';
export type Top10TableSortOrder = 'asc' | 'desc';

/**
 * Configuration for a Top10 dimension/category
 */
export interface Top10TableDimension {
  title: string;
  icon: ReactNode;
  data: Top10TransactionItem[];
  valueField: keyof Top10TransactionItem;
  valueFormatter: (val: number) => string;
  color: string;
  description?: string;
  showErrorCount?: boolean;
}

/**
 * Props for the Top10ListsTable component
 */
export interface Top10ListsTableProps {
  testRunId: string;
  selectedScenarios?: string[];
  hasDistributedTracing?: boolean;
  hasDynatrace?: boolean;
  onDrillDownToDistributedTracing?: (filters: DrillDownFilters) => void;
  onDrillDownToDynatrace?: (filters: DrillDownFilters) => void;
}
