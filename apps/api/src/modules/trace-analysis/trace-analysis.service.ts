import { Injectable, Logger } from '@nestjs/common';
import {
  CompareTracesDto,
  TraceAnalysisResponseDto,
  SamplerBreakdown,
} from './dto/trace-analysis.dto';
import { TraceAnalyzerService, TraceQueryService } from './services';

/**
 * Service for comparing traces between test runs
 * Orchestrates trace fetching via TraceQueryService and delegates analysis to TraceAnalyzerService
 */
@Injectable()
export class TraceAnalysisService {
  private readonly logger = new Logger(TraceAnalysisService.name);

  constructor(
    private readonly traceQueryService: TraceQueryService,
    private readonly traceAnalyzer: TraceAnalyzerService,
  ) {}

  /**
   * Compare traces between current and baseline test runs
   */
  async compareTraces(dto: CompareTracesDto): Promise<TraceAnalysisResponseDto> {
    try {
      // 1. Search for traces in both test runs using the query service
      const queryResult = await this.traceQueryService.searchAndFetchComparisonTraces(
        {
          tracingInstanceId: dto.tracingInstanceId,
          serviceName: dto.serviceName,
          testRunId: dto.currentTestRunId,
          scenario: dto.scenario,
          transaction: dto.transaction,
          sampler: dto.sampler,
          startTime: dto.currentStartTime,
          endTime: dto.currentEndTime,
        },
        {
          tracingInstanceId: dto.tracingInstanceId,
          serviceName: dto.serviceName,
          testRunId: dto.baselineTestRunId,
          scenario: dto.scenario,
          transaction: dto.transaction,
          sampler: dto.sampler,
          startTime: dto.baselineStartTime,
          endTime: dto.baselineEndTime,
        },
      );

      const { currentTraces, baselineTraces, warnings } = queryResult;

      // If either has no traces, return empty analysis
      if (currentTraces.length === 0 || baselineTraces.length === 0) {
        return this.traceAnalyzer.createEmptyAnalysis(warnings);
      }

      // 2. Perform analysis using the analyzer service
      const summary = this.traceAnalyzer.calculateSummary(currentTraces, baselineTraces);
      const currentAggregations = this.traceAnalyzer.aggregateSpans(currentTraces);
      const baselineAggregations = this.traceAnalyzer.aggregateSpans(baselineTraces);

      // Build hierarchy maps (reused across analyses)
      const hierarchyInfo = this.traceAnalyzer.buildHierarchyMaps(currentAggregations, baselineAggregations);

      const spanComposition = this.traceAnalyzer.analyzeSpanComposition(
        currentAggregations,
        baselineAggregations,
      );
      const executionPatterns = this.traceAnalyzer.analyzeExecutionPatterns(currentTraces, baselineTraces);
      const spanComparison = this.traceAnalyzer.compareSpans(currentAggregations, baselineAggregations, hierarchyInfo);
      const rootCauses = this.traceAnalyzer.analyzeRootCauses(
        currentAggregations,
        baselineAggregations,
        summary,
        hierarchyInfo,
      );
      const contentionAnalysis = this.traceAnalyzer.analyzeContention(
        currentAggregations,
        baselineAggregations,
        hierarchyInfo,
      );
      const errorAnalysis = this.traceAnalyzer.analyzeErrors(currentTraces, baselineTraces);

      // Per-sampler breakdown (only when analyzing at transaction level, not sampler level)
      let samplerBreakdown: SamplerBreakdown[] | undefined;
      if (!dto.sampler) {
        samplerBreakdown = this.traceAnalyzer.analyzeSamplerBreakdown(
          currentTraces,
          baselineTraces,
          summary,
        );
        if (samplerBreakdown.length === 0) {
          samplerBreakdown = undefined;
        }
      }

      return {
        summary,
        spanComposition,
        executionPatterns,
        spanComparison,
        rootCauses,
        contentionAnalysis,
        errorAnalysis,
        samplerBreakdown,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      this.logger.error('Trace analysis failed:', error);
      const message =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Analysis failed';
      return {
        ...this.traceAnalyzer.createEmptyAnalysis([]),
        error: message,
      };
    }
  }
}
