/**
 * Trace Analysis Types
 * Type definitions for trace analysis report components
 */

// Re-export types from trace-analysis-api for convenient access
export type {
  TraceAnalysisResponse,
  TraceSummary,
  SpanComparison,
  SpanComposition,
  ExecutionPatternComparison,
  ExecutionPattern,
  RootCauseAnalysis,
  ContentionAnalysis,
  ErrorAnalysis,
  ErrorStats,
  ErrorComparison,
  SamplerBreakdown,
  ConfidenceLevel,
} from '@/lib/trace-analysis-api';

/**
 * Props for TraceAnalysisReport component
 */
export interface TraceAnalysisReportProps {
  analysis: import('@/lib/trace-analysis-api').TraceAnalysisResponse;
  onDrillDown?: (samplerName: string) => void;
}

/**
 * Props for SummaryCard component
 */
export interface SummaryCardProps {
  label: string;
  current?: number;
  baseline?: number;
  change?: number;
  changePercent?: number;
  format?: 'number' | 'ms' | 'percent';
  invertColors?: boolean;
  isStatus?: boolean;
  isRegression?: boolean;
  isImprovement?: boolean;
}

/**
 * Props for CollapsibleSection component
 */
export interface CollapsibleSectionProps {
  title: string;
  subtitle?: string;
  expanded: boolean;
  onToggle: () => void;
  badge?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Props for SpanComparisonTable component
 */
export interface SpanComparisonTableProps {
  spans: import('@/lib/trace-analysis-api').SpanComparison[];
}

/**
 * Props for RootCausesList component
 */
export interface RootCausesListProps {
  rootCauses: import('@/lib/trace-analysis-api').RootCauseAnalysis[];
}

/**
 * Props for SpanCompositionDisplay component
 */
export interface SpanCompositionDisplayProps {
  composition: import('@/lib/trace-analysis-api').SpanComposition;
}

/**
 * Props for ExecutionPatternDisplay component
 */
export interface ExecutionPatternDisplayProps {
  patterns: import('@/lib/trace-analysis-api').ExecutionPatternComparison;
}

/**
 * Props for ContentionTable component
 */
export interface ContentionTableProps {
  contentions: import('@/lib/trace-analysis-api').ContentionAnalysis[];
}

/**
 * Props for SamplerBreakdownTable component
 */
export interface SamplerBreakdownTableProps {
  samplers: import('@/lib/trace-analysis-api').SamplerBreakdown[];
  onDrillDown?: (samplerName: string) => void;
}

/**
 * Props for ErrorAnalysisDisplay component
 */
export interface ErrorAnalysisDisplayProps {
  errorAnalysis: import('@/lib/trace-analysis-api').ErrorAnalysis;
}

/**
 * Section keys for expandable sections
 */
export type SectionKey =
  | 'samplerBreakdown'
  | 'spanComparison'
  | 'rootCauses'
  | 'spanComposition'
  | 'executionPatterns'
  | 'contention'
  | 'errors';

/**
 * State type for expanded sections
 */
export type ExpandedSections = Record<SectionKey, boolean>;

/**
 * Default initial expanded sections state
 */
export const DEFAULT_EXPANDED_SECTIONS: ExpandedSections = {
  samplerBreakdown: true,
  spanComparison: true,
  rootCauses: true,
  spanComposition: false,
  executionPatterns: false,
  contention: false,
  errors: false,
};
