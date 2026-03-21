import { Injectable } from '@nestjs/common';
import { OTelTrace } from '../../tempo/dto/tempo.dto';
import {
  TraceAnalysisResponseDto,
  TraceSummary,
  SpanComposition,
  ExecutionPatternComparison,
  SpanComparison,
  RootCauseAnalysis,
  ContentionAnalysis,
  ErrorAnalysis,
  SamplerBreakdown,
} from '../dto/trace-analysis.dto';
import {
  SpanAggregationService,
  HierarchyBuilderService,
  SpanCompositionAnalyzer,
  ExecutionPatternAnalyzer,
  SpanComparisonAnalyzer,
  RootCauseAnalyzer,
  ContentionAnalyzer,
  ErrorAnalyzer,
  SamplerAnalyzer,
  SpanAggregation,
  HierarchyInfo,
} from './analyzers';

// Re-export types for backward compatibility
export { SpanAggregation, HierarchyInfo };

/**
 * Orchestrator service for trace analysis
 * Delegates to specialized analyzers for different aspects of trace analysis
 */
@Injectable()
export class TraceAnalyzerService {
  constructor(
    private readonly spanAggregation: SpanAggregationService,
    private readonly hierarchyBuilder: HierarchyBuilderService,
    private readonly spanCompositionAnalyzer: SpanCompositionAnalyzer,
    private readonly executionPatternAnalyzer: ExecutionPatternAnalyzer,
    private readonly spanComparisonAnalyzer: SpanComparisonAnalyzer,
    private readonly rootCauseAnalyzer: RootCauseAnalyzer,
    private readonly contentionAnalyzer: ContentionAnalyzer,
    private readonly errorAnalyzer: ErrorAnalyzer,
    private readonly samplerAnalyzer: SamplerAnalyzer,
  ) {}

  /**
   * Calculate summary statistics for current vs baseline traces
   */
  calculateSummary(
    currentTraces: OTelTrace[],
    baselineTraces: OTelTrace[],
  ): TraceSummary {
    return this.spanAggregation.calculateSummary(currentTraces, baselineTraces);
  }

  /**
   * Aggregate spans across multiple traces
   */
  aggregateSpans(traces: OTelTrace[]): Map<string, SpanAggregation> {
    return this.spanAggregation.aggregateSpans(traces);
  }

  /**
   * Build hierarchy information maps for span relationships
   */
  buildHierarchyMaps(
    current: Map<string, SpanAggregation>,
    baseline: Map<string, SpanAggregation>,
  ): HierarchyInfo {
    return this.hierarchyBuilder.buildHierarchyMaps(current, baseline);
  }

  /**
   * Analyze span composition changes between current and baseline
   */
  analyzeSpanComposition(
    current: Map<string, SpanAggregation>,
    baseline: Map<string, SpanAggregation>,
  ): SpanComposition {
    return this.spanCompositionAnalyzer.analyzeSpanComposition(current, baseline);
  }

  /**
   * Analyze execution patterns (sequential vs parallel)
   */
  analyzeExecutionPatterns(
    currentTraces: OTelTrace[],
    baselineTraces: OTelTrace[],
  ): ExecutionPatternComparison {
    return this.executionPatternAnalyzer.analyzeExecutionPatterns(currentTraces, baselineTraces);
  }

  /**
   * Compare individual spans between current and baseline
   */
  compareSpans(
    current: Map<string, SpanAggregation>,
    baseline: Map<string, SpanAggregation>,
    hierarchyInfo?: HierarchyInfo,
  ): SpanComparison[] {
    return this.spanComparisonAnalyzer.compareSpans(current, baseline, hierarchyInfo);
  }

  /**
   * Analyze root causes of performance degradation
   */
  analyzeRootCauses(
    current: Map<string, SpanAggregation>,
    baseline: Map<string, SpanAggregation>,
    summary: TraceSummary,
    hierarchyInfo?: HierarchyInfo,
  ): RootCauseAnalysis[] {
    return this.rootCauseAnalyzer.analyzeRootCauses(current, baseline, summary, hierarchyInfo);
  }

  /**
   * Analyze contention patterns
   */
  analyzeContention(
    current: Map<string, SpanAggregation>,
    baseline: Map<string, SpanAggregation>,
    hierarchyInfo?: HierarchyInfo,
  ): ContentionAnalysis[] {
    return this.contentionAnalyzer.analyzeContention(current, baseline, hierarchyInfo);
  }

  /**
   * Analyze error patterns
   */
  analyzeErrors(
    currentTraces: OTelTrace[],
    baselineTraces: OTelTrace[],
  ): ErrorAnalysis {
    return this.errorAnalyzer.analyzeErrors(currentTraces, baselineTraces);
  }

  /**
   * Analyze per-sampler breakdown when analyzing at transaction level
   */
  analyzeSamplerBreakdown(
    currentTraces: OTelTrace[],
    baselineTraces: OTelTrace[],
    summary: TraceSummary,
  ): SamplerBreakdown[] {
    return this.samplerAnalyzer.analyzeSamplerBreakdown(currentTraces, baselineTraces, summary);
  }

  /**
   * Create empty analysis response
   */
  createEmptyAnalysis(warnings: string[]): TraceAnalysisResponseDto {
    return {
      summary: {
        currentTraceCount: 0,
        baselineTraceCount: 0,
        avgDurationCurrent: 0,
        avgDurationBaseline: 0,
        avgDurationChange: 0,
        avgDurationChangePercent: 0,
        avgSpanCountCurrent: 0,
        avgSpanCountBaseline: 0,
        avgSpanCountChange: 0,
      },
      spanComposition: {
        newSpans: [],
        missingSpans: [],
        commonSpans: [],
      },
      executionPatterns: {
        current: {
          isSequential: true,
          parallelismRatio: 0,
          maxConcurrentSpans: 0,
          avgConcurrentSpans: 0,
        },
        baseline: {
          isSequential: true,
          parallelismRatio: 0,
          maxConcurrentSpans: 0,
          avgConcurrentSpans: 0,
        },
        patternChanged: false,
        parallelismChange: 0,
      },
      spanComparison: [],
      rootCauses: [],
      contentionAnalysis: [],
      errorAnalysis: {
        current: { totalErrorSpans: 0, errorRate: 0, errorsByType: {} },
        baseline: { totalErrorSpans: 0, errorRate: 0, errorsByType: {} },
        comparison: [],
        newErrors: [],
        resolvedErrors: [],
      },
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }
}
