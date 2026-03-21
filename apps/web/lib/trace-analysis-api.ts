import { authenticatedFetch } from './api';

// Types matching the backend DTOs
export interface TraceSummary {
  currentTraceCount: number;
  baselineTraceCount: number;
  avgDurationCurrent: number;
  avgDurationBaseline: number;
  avgDurationChange: number;
  avgDurationChangePercent: number;
  avgSpanCountCurrent: number;
  avgSpanCountBaseline: number;
  avgSpanCountChange: number;
}

export interface SpanComposition {
  newSpans: string[];
  missingSpans: string[];
  commonSpans: string[];
}

export interface ExecutionPattern {
  isSequential: boolean;
  parallelismRatio: number;
  maxConcurrentSpans: number;
  avgConcurrentSpans: number;
}

export interface ExecutionPatternComparison {
  current: ExecutionPattern;
  baseline: ExecutionPattern;
  patternChanged: boolean;
  parallelismChange: number;
}

export interface SpanComparison {
  spanName: string;
  serviceName: string;
  currentAvgDuration: number;
  baselineAvgDuration: number;
  durationChange: number;
  durationChangePercent: number;
  currentCallCount: number;
  baselineCallCount: number;
  callCountChange: number;
  isNewSpan: boolean;
  isMissingSpan: boolean;
  // Hierarchy info for tree visualization
  parentSpanName?: string;
  depth: number;
  hasChildren: boolean;
}

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface RootCauseAnalysis {
  spanName: string;
  serviceName: string;
  durationIncrease: number;
  percentIncrease: number;
  selfDurationIncrease: number;
  selfPercentIncrease: number;
  isLikelyRootCause: boolean;
  confidence: ConfidenceLevel;
  explanation: string;
  contributionToTotalIncrease: number;
  // Hierarchy info
  parentSpanName?: string;
  depth: number;
}

export interface ContentionAnalysis {
  spanName: string;
  parentSpanName: string;
  currentStartDelay: number;
  baselineStartDelay: number;
  startDelayIncrease: number;
  isContentionIndicator: boolean;
  confidence: ConfidenceLevel;
  explanation: string;
  // Hierarchy info
  depth: number;
}

export interface ErrorStats {
  totalErrorSpans: number;
  errorRate: number;
  errorsByType: Record<string, number>;
}

export interface ErrorComparison {
  spanName: string;
  currentErrorCount: number;
  baselineErrorCount: number;
  errorChange: number;
  isNewError: boolean;
  errorMessages: string[];
}

export interface ErrorAnalysis {
  current: ErrorStats;
  baseline: ErrorStats;
  comparison: ErrorComparison[];
  newErrors: string[];
  resolvedErrors: string[];
}

export interface SamplerBreakdown {
  samplerName: string;
  currentTraceCount: number;
  baselineTraceCount: number;
  currentAvgDuration: number;
  baselineAvgDuration: number;
  durationChange: number;
  durationChangePercent: number;
  contributionToSlowdown: number;
  isLikelyProblem: boolean;
  recommendation: string;
}

export interface TraceAnalysisResponse {
  summary: TraceSummary;
  spanComposition: SpanComposition;
  executionPatterns: ExecutionPatternComparison;
  spanComparison: SpanComparison[];
  rootCauses: RootCauseAnalysis[];
  contentionAnalysis: ContentionAnalysis[];
  errorAnalysis: ErrorAnalysis;
  samplerBreakdown?: SamplerBreakdown[];
  warnings?: string[];
  error?: string;
}

export interface CompareTracesParams {
  currentTestRunId: string;
  baselineTestRunId: string;
  tracingInstanceId: string;
  serviceName: string;
  scenario: string;
  transaction: string;
  sampler?: string;
  currentStartTime: string;
  currentEndTime: string;
  baselineStartTime: string;
  baselineEndTime: string;
}

/**
 * Compare traces between two test runs
 */
export async function compareTraces(
  params: CompareTracesParams
): Promise<TraceAnalysisResponse> {
  const response = await authenticatedFetch('/trace-analysis/compare', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to compare traces: ${response.status}`);
  }

  return response.json();
}

/**
 * Check Tempo health
 */
export async function checkTempoHealth(
  tracingInstanceId: string
): Promise<{ success: boolean; message: string }> {
  const response = await authenticatedFetch('/tempo/health', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tracingInstanceId }),
  });

  if (!response.ok) {
    return { success: false, message: `Health check failed: ${response.status}` };
  }

  return response.json();
}
