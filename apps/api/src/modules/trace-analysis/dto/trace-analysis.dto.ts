import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID } from 'class-validator';

export class CompareTracesDto {
  @ApiProperty({ description: 'Current test run ID' })
  @IsString()
  currentTestRunId: string;

  @ApiProperty({ description: 'Baseline test run ID' })
  @IsString()
  baselineTestRunId: string;

  @ApiProperty({ description: 'Tracing instance UUID' })
  @IsUUID()
  tracingInstanceId: string;

  @ApiProperty({ description: 'Service name' })
  @IsString()
  serviceName: string;

  @ApiProperty({ description: 'Scenario name' })
  @IsString()
  scenario: string;

  @ApiProperty({ description: 'Transaction name' })
  @IsString()
  transaction: string;

  @ApiPropertyOptional({ description: 'Sampler name (optional)' })
  @IsString()
  @IsOptional()
  sampler?: string;

  @ApiProperty({ description: 'Current test run start time (ISO 8601)' })
  @IsString()
  currentStartTime: string;

  @ApiProperty({ description: 'Current test run end time (ISO 8601)' })
  @IsString()
  currentEndTime: string;

  @ApiProperty({ description: 'Baseline test run start time (ISO 8601)' })
  @IsString()
  baselineStartTime: string;

  @ApiProperty({ description: 'Baseline test run end time (ISO 8601)' })
  @IsString()
  baselineEndTime: string;
}

// Summary statistics
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

// Span composition analysis
export interface SpanComposition {
  newSpans: string[];
  missingSpans: string[];
  commonSpans: string[];
}

// Execution pattern analysis
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

// Span-level comparison
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

// Root cause analysis
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

// Contention analysis
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

// Error analysis
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

// Per-sampler breakdown when analyzing at transaction level
export interface SamplerBreakdown {
  samplerName: string;
  currentTraceCount: number;
  baselineTraceCount: number;
  currentAvgDuration: number;
  baselineAvgDuration: number;
  durationChange: number;
  durationChangePercent: number;
  contributionToSlowdown: number; // Percentage contribution to overall slowdown
  isLikelyProblem: boolean;
  recommendation: string;
}

// Complete analysis response
export class TraceAnalysisResponseDto {
  @ApiProperty({ description: 'Summary statistics' })
  summary: TraceSummary;

  @ApiProperty({ description: 'Span composition changes' })
  spanComposition: SpanComposition;

  @ApiProperty({ description: 'Execution pattern comparison' })
  executionPatterns: ExecutionPatternComparison;

  @ApiProperty({ description: 'Detailed span-level comparison' })
  spanComparison: SpanComparison[];

  @ApiProperty({ description: 'Root cause analysis results' })
  rootCauses: RootCauseAnalysis[];

  @ApiProperty({ description: 'Contention analysis results' })
  contentionAnalysis: ContentionAnalysis[];

  @ApiProperty({ description: 'Error analysis results' })
  errorAnalysis: ErrorAnalysis;

  @ApiPropertyOptional({ description: 'Per-sampler breakdown (when analyzing at transaction level)' })
  samplerBreakdown?: SamplerBreakdown[];

  @ApiPropertyOptional({ description: 'Warning messages' })
  warnings?: string[];

  @ApiPropertyOptional({ description: 'Error message if analysis failed' })
  error?: string;
}
