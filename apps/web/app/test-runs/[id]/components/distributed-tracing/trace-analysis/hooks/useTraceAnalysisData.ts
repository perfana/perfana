'use client';

import { useState, useCallback, useMemo } from 'react';
import type { TraceAnalysisResponse } from '../types';
import { DEFAULT_EXPANDED_SECTIONS, type SectionKey, type ExpandedSections } from '../types';

export interface UseTraceAnalysisDataProps {
  analysis: TraceAnalysisResponse;
}

export function useTraceAnalysisData({ analysis }: UseTraceAnalysisDataProps) {
  const [expandedSections, setExpandedSections] = useState<ExpandedSections>(DEFAULT_EXPANDED_SECTIONS);

  // Toggle a section's expanded state
  const toggleSection = useCallback((section: SectionKey) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }, []);

  // Derived status values
  const { summary } = analysis;
  const isRegression = summary.avgDurationChangePercent > 5;
  const isImprovement = summary.avgDurationChangePercent < -5;

  // Computed visibility checks
  const hasSamplerBreakdown = useMemo(
    () => analysis.samplerBreakdown && analysis.samplerBreakdown.length > 0,
    [analysis.samplerBreakdown]
  );

  const hasRootCauses = useMemo(
    () => analysis.rootCauses.length > 0,
    [analysis.rootCauses]
  );

  const hasSpanCompositionChanges = useMemo(
    () =>
      analysis.spanComposition.newSpans.length > 0 ||
      analysis.spanComposition.missingSpans.length > 0,
    [analysis.spanComposition]
  );

  const hasExecutionPatternChanges = useMemo(
    () => analysis.executionPatterns.patternChanged,
    [analysis.executionPatterns]
  );

  const hasContentionAnalysis = useMemo(
    () => analysis.contentionAnalysis.length > 0,
    [analysis.contentionAnalysis]
  );

  const hasErrorAnalysis = useMemo(
    () =>
      analysis.errorAnalysis.newErrors.length > 0 ||
      analysis.errorAnalysis.resolvedErrors.length > 0 ||
      analysis.errorAnalysis.current.totalErrorSpans > 0,
    [analysis.errorAnalysis]
  );

  const hasWarnings = useMemo(
    () => analysis.warnings && analysis.warnings.length > 0,
    [analysis.warnings]
  );

  // Computed badge visibility
  const hasSamplerIssues = useMemo(
    () => analysis.samplerBreakdown?.some((s) => s.isLikelyProblem) ?? false,
    [analysis.samplerBreakdown]
  );

  const hasHighConfidenceRootCause = useMemo(
    () => analysis.rootCauses.some((r) => r.confidence === 'high'),
    [analysis.rootCauses]
  );

  const hasNewErrors = useMemo(
    () => analysis.errorAnalysis.newErrors.length > 0,
    [analysis.errorAnalysis]
  );

  // Count of likely root causes
  const likelyRootCausesCount = useMemo(
    () => analysis.rootCauses.filter((r) => r.isLikelyRootCause).length,
    [analysis.rootCauses]
  );

  // Count of potential contention points
  const contentionPointsCount = useMemo(
    () => analysis.contentionAnalysis.filter((c) => c.isContentionIndicator).length,
    [analysis.contentionAnalysis]
  );

  return {
    // State
    expandedSections,

    // Actions
    toggleSection,

    // Derived data
    summary,
    isRegression,
    isImprovement,

    // Visibility checks
    hasSamplerBreakdown,
    hasRootCauses,
    hasSpanCompositionChanges,
    hasExecutionPatternChanges,
    hasContentionAnalysis,
    hasErrorAnalysis,
    hasWarnings,

    // Badge visibility
    hasSamplerIssues,
    hasHighConfidenceRootCause,
    hasNewErrors,

    // Counts
    likelyRootCausesCount,
    contentionPointsCount,
  };
}
