import type { CheckResultTarget, CheckResultRequirement } from '@/lib/types';
/**
 * Types for ApdexScenarioTable component and related sub-components
 */

export interface SortConfig {
  field: 'series' | 'threshold' | 'avgResponseTime' | 'value' | 'result';
  direction: 'asc' | 'desc';
}

export interface TransactionSample {
  sampler_name: string;
  /** null when the sampler matched no URL pattern — the API sends null, not absence. */
  url_pattern?: string | null;
  avg_response_time?: number;
  p95_response_time?: number;
  p99_response_time?: number;
  passed_count: number;
  failed_count: number;
}

/** Apdex view of a check result target. */
export type ApdexTarget = CheckResultTarget;

/** The subset of a CheckResult the apdex table reads. */
export interface ApdexResult {
  targets?: CheckResultTarget[];
  requirement?: CheckResultRequirement;
  exclude_ramp_up_time?: boolean;
}

export interface ApdexScenarioTableProps {
  result: ApdexResult;
  resultKey: string;
  sortConfig: Map<string, SortConfig>;
  onSort: (resultKey: string, field: SortConfig['field']) => void;
  expandedTransactions: Set<string>;
  onToggleTransaction: (transactionKey: string, transactionName: string, excludeRampUp: boolean) => void;
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
  /** Omitted when the header is not collapsible (single scenario). */
  expanded?: boolean;
  onToggle?: () => void;
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
  excludeRampUp: boolean;
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
  excludeRampUp: boolean;
  onOpenRequestActionMenu: (
    e: React.MouseEvent<HTMLElement>,
    transactionName: string,
    scenarioName: string,
    samplerName: string
  ) => void;
}
