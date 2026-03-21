'use client';

import { Box, Chip, Alert } from '@mui/material';

// Types
import type { TraceAnalysisReportProps } from './trace-analysis/types';

// Hooks
import { useTraceAnalysisData } from './trace-analysis/hooks';

// Components
import {
  CollapsibleSection,
  SummaryCard,
  TraceSpanList,
  RootCausesList,
  SpanCompositionDisplay,
  ExecutionPatternDisplay,
  ContentionTable,
  SamplerBreakdownTable,
  ErrorAnalysisDisplay,
} from './trace-analysis/components';

/**
 * Comprehensive trace analysis report component
 * Displays performance comparison between current and baseline traces
 */
export default function TraceAnalysisReport({ analysis, onDrillDown }: TraceAnalysisReportProps) {
  const {
    expandedSections,
    toggleSection,
    summary,
    isRegression,
    isImprovement,
    hasSamplerBreakdown,
    hasRootCauses,
    hasSpanCompositionChanges,
    hasExecutionPatternChanges,
    hasContentionAnalysis,
    hasErrorAnalysis,
    hasWarnings,
    hasSamplerIssues,
    hasHighConfidenceRootCause,
    hasNewErrors,
    likelyRootCausesCount,
    contentionPointsCount,
  } = useTraceAnalysisData({ analysis });

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Warnings */}
      {hasWarnings && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          {analysis.warnings?.join(' • ')}
        </Alert>
      )}

      {/* Summary Statistics */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
          gap: 2,
        }}
      >
        <SummaryCard
          label="Trace Count"
          current={summary.currentTraceCount}
          baseline={summary.baselineTraceCount}
          format="number"
        />
        <SummaryCard
          label="Avg Duration"
          current={summary.avgDurationCurrent}
          baseline={summary.avgDurationBaseline}
          change={summary.avgDurationChange}
          changePercent={summary.avgDurationChangePercent}
          format="ms"
          invertColors
        />
        <SummaryCard
          label="Avg Span Count"
          current={summary.avgSpanCountCurrent}
          baseline={summary.avgSpanCountBaseline}
          change={summary.avgSpanCountChange}
          format="number"
        />
        <SummaryCard
          label="Overall Status"
          isStatus
          isRegression={isRegression}
          isImprovement={isImprovement}
          changePercent={summary.avgDurationChangePercent}
        />
      </Box>

      {/* Per-Sampler Breakdown */}
      {hasSamplerBreakdown && analysis.samplerBreakdown && (
        <CollapsibleSection
          title="Per-Request Breakdown"
          subtitle={`${analysis.samplerBreakdown.length} requests analyzed${onDrillDown ? ' - Click a request to drill down' : ''}`}
          expanded={expandedSections.samplerBreakdown}
          onToggle={() => toggleSection('samplerBreakdown')}
          badge={
            hasSamplerIssues ? (
              <Chip label="Issues found" size="small" color="warning" />
            ) : undefined
          }
        >
          <SamplerBreakdownTable samplers={analysis.samplerBreakdown} onDrillDown={onDrillDown} />
        </CollapsibleSection>
      )}

      {/* Span Performance Comparison */}
      <CollapsibleSection
        title="Span Performance Comparison"
        subtitle={`${analysis.spanComparison.length} spans compared`}
        expanded={expandedSections.spanComparison}
        onToggle={() => toggleSection('spanComparison')}
      >
        <TraceSpanList spans={analysis.spanComparison.slice(0, 15)} />
      </CollapsibleSection>

      {/* Root Cause Analysis */}
      {hasRootCauses && (
        <CollapsibleSection
          title="Root Cause Analysis"
          subtitle={`${likelyRootCausesCount} likely root causes identified`}
          expanded={expandedSections.rootCauses}
          onToggle={() => toggleSection('rootCauses')}
          badge={
            hasHighConfidenceRootCause ? (
              <Chip label="High confidence" size="small" color="error" />
            ) : undefined
          }
        >
          <RootCausesList rootCauses={analysis.rootCauses} />
        </CollapsibleSection>
      )}

      {/* Span Composition Changes */}
      {hasSpanCompositionChanges && (
        <CollapsibleSection
          title="Span Composition Changes"
          subtitle={`${analysis.spanComposition.newSpans.length} new, ${analysis.spanComposition.missingSpans.length} missing`}
          expanded={expandedSections.spanComposition}
          onToggle={() => toggleSection('spanComposition')}
        >
          <SpanCompositionDisplay composition={analysis.spanComposition} />
        </CollapsibleSection>
      )}

      {/* Execution Patterns */}
      {hasExecutionPatternChanges && (
        <CollapsibleSection
          title="Execution Pattern Changes"
          subtitle="Parallelism changes detected"
          expanded={expandedSections.executionPatterns}
          onToggle={() => toggleSection('executionPatterns')}
        >
          <ExecutionPatternDisplay patterns={analysis.executionPatterns} />
        </CollapsibleSection>
      )}

      {/* Contention Analysis */}
      {hasContentionAnalysis && (
        <CollapsibleSection
          title="Contention Analysis"
          subtitle={`${contentionPointsCount} potential contention points`}
          expanded={expandedSections.contention}
          onToggle={() => toggleSection('contention')}
        >
          <ContentionTable contentions={analysis.contentionAnalysis} />
        </CollapsibleSection>
      )}

      {/* Error Analysis */}
      {hasErrorAnalysis && (
        <CollapsibleSection
          title="Error Analysis"
          subtitle={`${analysis.errorAnalysis.newErrors.length} new errors, ${analysis.errorAnalysis.resolvedErrors.length} resolved`}
          expanded={expandedSections.errors}
          onToggle={() => toggleSection('errors')}
          badge={
            hasNewErrors ? (
              <Chip label="New errors" size="small" color="error" />
            ) : undefined
          }
        >
          <ErrorAnalysisDisplay errorAnalysis={analysis.errorAnalysis} />
        </CollapsibleSection>
      )}
    </Box>
  );
}
