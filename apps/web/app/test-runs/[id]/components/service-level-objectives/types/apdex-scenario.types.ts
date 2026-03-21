/**
 * Types for ApdexScenarioTable component and related sub-components
 */

export interface SortConfig {
  field: 'series' | 'threshold' | 'avgResponseTime' | 'value' | 'result';
  direction: 'asc' | 'desc';
}

export interface TransactionSample {
  sampler_name: string;
  url_pattern?: string;
  avg_response_time?: number;
  p95_response_time?: number;
  p99_response_time?: number;
  passed_count: number;
  failed_count: number;
}

export interface ApdexTarget {
  transaction_name?: string;
  target?: string;
  scenario_name?: string;
  threshold_ms?: number;
  avg_response_time_ms?: number;
  apdex_score?: number;
  value?: number;
  meets_requirement?: boolean;
  satisfied_count?: number;
  tolerating_count?: number;
  frustrated_count?: number;
  total_count?: number;
}

export interface ApdexResult {
  targets?: ApdexTarget[];
  requirement?: {
    threshold_ms?: number;
  };
}

export interface ApdexScenarioTableProps {
  result: ApdexResult;
  resultKey: string;
  sortConfig: Map<string, SortConfig>;
  onSort: (resultKey: string, field: SortConfig['field']) => void;
  expandedTransactions: Set<string>;
  onToggleTransaction: (transactionKey: string, transactionName: string) => void;
  transactionSamples: Record<string, TransactionSample[]>;
  loadingTransactionSamples: Record<string, boolean>;
  transactionSamplesError: Record<string, string>;
  onOpenApdexActionMenu: (
    e: React.MouseEvent<HTMLElement>,
    transactionName: string,
    scenarioName: string,
    threshold: number
  ) => void;
  onOpenRequestActionMenu: (
    e: React.MouseEvent<HTMLElement>,
    transactionName: string,
    scenarioName: string,
    samplerName: string
  ) => void;
  hasDistributedTracing?: boolean;
  hasDynatrace?: boolean;
}

// Props for scenario header component
export interface ScenarioHeaderProps {
  scenario: string;
  transactionCount: number;
  failedCount: number;
}

// Props for sortable table header
export interface SortableTableHeaderProps {
  resultKey: string;
  sortConfig: Map<string, SortConfig>;
  onSort: (resultKey: string, field: SortConfig['field']) => void;
}

// Props for transaction row
export interface ApdexTransactionRowProps {
  target: ApdexTarget;
  transactionKey: string;
  isExpanded: boolean;
  isLastRow: boolean;
  isEvenRow: boolean;
  defaultThreshold: number;
  scenario: string;
  onToggle: () => void;
  onOpenActionMenu: (e: React.MouseEvent<HTMLElement>) => void;
}

// Props for expanded content
export interface ApdexExpandedContentProps {
  target: ApdexTarget;
  transactionKey: string;
  isLastRow: boolean;
  scenario: string;
  transactionSamples: TransactionSample[];
  isLoading: boolean;
  error?: string;
  hasDistributedTracing: boolean;
  hasDynatrace: boolean;
  onOpenRequestActionMenu: (
    e: React.MouseEvent<HTMLElement>,
    transactionName: string,
    scenarioName: string,
    samplerName: string
  ) => void;
}

// Props for requests breakdown table
export interface RequestsBreakdownTableProps {
  samples: TransactionSample[];
  transactionName: string;
  scenarioName: string;
  hasDistributedTracing: boolean;
  hasDynatrace: boolean;
  onOpenRequestActionMenu: (
    e: React.MouseEvent<HTMLElement>,
    transactionName: string,
    scenarioName: string,
    samplerName: string
  ) => void;
}
