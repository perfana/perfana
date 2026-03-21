import { ReactNode } from 'react';
import { TransactionStat, SamplerStat, DrillDownFilters } from '../../types/performance-analysis.types';

export type { TransactionStat, SamplerStat, DrillDownFilters };

export interface Top10Item {
  scenarioName: string;
  transactionName: string;
  requestName: string;
  url: string;
  avgResponseTime: number;
  impact: number;
  callCount: number;
  errorCount: number;
  errorRate: number;
  throughput: number;
}

export type Top10SortField = 'scenarioName' | 'transactionName' | 'requestName' | 'url' | 'value';
export type Top10SortOrder = 'asc' | 'desc';

export interface Top10Dimension {
  title: string;
  icon: ReactNode;
  data: Top10Item[];
  valueField: keyof Top10Item;
  valueFormatter: (val: number) => string;
  color: string;
  description?: string;
  showErrorCount?: boolean;
}

export interface Top10ListsRequestsProps {
  testRunId: string;
  hasDistributedTracing?: boolean;
  hasDynatrace?: boolean;
  onDrillDownToDistributedTracing?: (filters: DrillDownFilters) => void;
  onDrillDownToDynatrace?: (filters: DrillDownFilters) => void;
}

export interface SamplerWithTransaction extends SamplerStat {
  transaction_name: string;
}
