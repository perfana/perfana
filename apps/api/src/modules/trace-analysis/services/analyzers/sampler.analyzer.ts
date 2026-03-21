import { Injectable } from '@nestjs/common';
import { OTelTrace } from '../../../tempo/dto/tempo.dto';
import {
  SamplerBreakdown,
  TraceSummary,
} from '../../dto/trace-analysis.dto';

/**
 * Service responsible for analyzing per-sampler breakdown
 * Handles: grouping traces by sampler, calculating sampler-specific metrics
 */
@Injectable()
export class SamplerAnalyzer {
  /**
   * Analyze per-sampler breakdown when analyzing at transaction level
   * Extracts sampler name from perfana-request-name attribute (format: Scenario|Transaction|Sampler)
   */
  analyzeSamplerBreakdown(
    currentTraces: OTelTrace[],
    baselineTraces: OTelTrace[],
    summary: TraceSummary,
  ): SamplerBreakdown[] {
    // Group traces by sampler name
    const currentBySampler = this.groupTracesBySampler(currentTraces);
    const baselineBySampler = this.groupTracesBySampler(baselineTraces);

    const allSamplers = new Set([
      ...currentBySampler.keys(),
      ...baselineBySampler.keys(),
    ]);

    if (allSamplers.size <= 1) {
      // Only one sampler, breakdown not useful
      return [];
    }

    const breakdowns: SamplerBreakdown[] = [];
    const totalSlowdown = summary.avgDurationChange;

    for (const samplerName of allSamplers) {
      const currentTraceGroup = currentBySampler.get(samplerName) || [];
      const baselineTraceGroup = baselineBySampler.get(samplerName) || [];

      const currentCount = currentTraceGroup.length;
      const baselineCount = baselineTraceGroup.length;

      const currentAvgDuration =
        currentCount > 0
          ? currentTraceGroup.reduce((sum, t) => sum + t.durationMs, 0) / currentCount
          : 0;
      const baselineAvgDuration =
        baselineCount > 0
          ? baselineTraceGroup.reduce((sum, t) => sum + t.durationMs, 0) / baselineCount
          : 0;

      const durationChange = currentAvgDuration - baselineAvgDuration;
      const durationChangePercent =
        baselineAvgDuration > 0 ? (durationChange / baselineAvgDuration) * 100 : 0;

      // Calculate contribution to overall slowdown
      // Weight by current trace count relative to total
      const totalCurrentTraces = currentTraces.length;
      const weightedContribution =
        totalSlowdown > 0 && totalCurrentTraces > 0
          ? (durationChange * (currentCount / totalCurrentTraces) / totalSlowdown) * 100
          : 0;

      // Determine if this sampler is likely problematic
      const isLikelyProblem =
        durationChange > 0 &&
        (durationChangePercent > 20 || weightedContribution > 25);

      // Generate recommendation
      let recommendation = '';
      if (currentCount === 0 && baselineCount > 0) {
        recommendation = 'This sampler is missing in the current test run';
      } else if (currentCount > 0 && baselineCount === 0) {
        recommendation = 'This is a new sampler not present in the baseline';
      } else if (durationChangePercent > 50) {
        recommendation = `Significant slowdown (${durationChangePercent.toFixed(1)}%). Investigate this sampler first.`;
      } else if (durationChangePercent > 20) {
        recommendation = `Moderate slowdown (${durationChangePercent.toFixed(1)}%). Consider investigating.`;
      } else if (durationChangePercent < -20) {
        recommendation = `Improved performance (${Math.abs(durationChangePercent).toFixed(1)}% faster)`;
      } else {
        recommendation = 'Performance is stable';
      }

      breakdowns.push({
        samplerName,
        currentTraceCount: currentCount,
        baselineTraceCount: baselineCount,
        currentAvgDuration: Math.round(currentAvgDuration * 100) / 100,
        baselineAvgDuration: Math.round(baselineAvgDuration * 100) / 100,
        durationChange: Math.round(durationChange * 100) / 100,
        durationChangePercent: Math.round(durationChangePercent * 10) / 10,
        contributionToSlowdown: Math.round(weightedContribution * 10) / 10,
        isLikelyProblem,
        recommendation,
      });
    }

    // Sort by absolute contribution to slowdown (highest first)
    breakdowns.sort(
      (a, b) => Math.abs(b.contributionToSlowdown) - Math.abs(a.contributionToSlowdown),
    );

    return breakdowns;
  }

  /**
   * Group traces by sampler name extracted from perfana-request-name attribute
   */
  groupTracesBySampler(traces: OTelTrace[]): Map<string, OTelTrace[]> {
    const grouped = new Map<string, OTelTrace[]>();

    for (const trace of traces) {
      // Find the root span (span without parent or first span)
      const rootSpan = trace.spans.find((s) => !s.parentSpanId) || trace.spans[0];
      if (!rootSpan) continue;

      // Extract perfana-request-name from span attributes
      const requestName = rootSpan.attributes?.['perfana-request-name'] as string;
      if (!requestName) continue;

      // Parse sampler name from format: Scenario|Transaction|Sampler
      const parts = requestName.split('|');
      const samplerName = parts.length >= 3 && parts[2] ? parts[2] : 'unknown';

      const existing = grouped.get(samplerName);
      if (existing) {
        existing.push(trace);
      } else {
        grouped.set(samplerName, [trace]);
      }
    }

    return grouped;
  }
}
