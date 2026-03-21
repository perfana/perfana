import { Module } from '@nestjs/common';
import { TraceAnalysisController } from './trace-analysis.controller';
import { TraceAnalysisService } from './trace-analysis.service';
import { TraceAnalyzerService, TraceQueryService } from './services';
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
} from './services/analyzers';
import { TempoModule } from '../tempo/tempo.module';

@Module({
  imports: [TempoModule],
  controllers: [TraceAnalysisController],
  providers: [
    TraceAnalysisService,
    TraceAnalyzerService,
    TraceQueryService,
    // Analyzer services
    SpanAggregationService,
    HierarchyBuilderService,
    SpanCompositionAnalyzer,
    ExecutionPatternAnalyzer,
    SpanComparisonAnalyzer,
    RootCauseAnalyzer,
    ContentionAnalyzer,
    ErrorAnalyzer,
    SamplerAnalyzer,
  ],
  exports: [
    TraceAnalysisService,
    TraceAnalyzerService,
    TraceQueryService,
  ],
})
export class TraceAnalysisModule {}
