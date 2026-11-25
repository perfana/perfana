// Value: protects=the Compare Traces result a diff-tab comment records names the request it was
// computed for, its counts and durations, and only likely root causes; fails_when=the summary drops
// the request (a stale result reads as current) or lists every root-cause candidate.
import { summarizeTraceAnalysis } from '../trace-formatters';
import type { TraceAnalysisResponse } from '@/lib/trace-analysis-api';

const result = {
  summary: { currentTraceCount: 120, baselineTraceCount: 118, avgDurationCurrent: 245.31, avgDurationBaseline: 198.1, avgDurationChange: 47.2, avgDurationChangePercent: 23.83, avgSpanCountCurrent: 14.2, avgSpanCountBaseline: 13.9, avgSpanCountChange: 0.3 },
  spanComposition: { newSpans: ['cache.get'], missingSpans: [], commonSpans: [] },
  rootCauses: [
    { spanName: 'db.query', serviceName: 'orders', percentIncrease: 45.2, isLikelyRootCause: true, confidence: 'high' },
    { spanName: 'http.get', serviceName: 'orders', percentIncrease: 3, isLikelyRootCause: false, confidence: 'low' },
  ],
  errorAnalysis: { newErrors: [] },
} as unknown as TraceAnalysisResponse;

describe('summarizeTraceAnalysis', () => {
  it('summarises the result for the request it was computed for', () => {
    expect(summarizeTraceAnalysis(result, 'Checkout / Pay vs run App-00005').split('\n')).toEqual([
      'Compare Traces for Checkout / Pay vs run App-00005:',
      'Traces: 120 current / 118 baseline',
      'Avg duration: 245.3 ms vs 198.1 ms baseline (+23.8%)',
      'Avg spans: 14.2 vs 13.9 baseline',
      'Likely root causes: db.query (orders) +45.2%, high confidence',
      'New spans: cache.get',
    ]);
  });

  it('reports a failed comparison', () => {
    expect(summarizeTraceAnalysis({ ...result, error: 'no traces' })).toBe('Compare Traces failed: no traces');
  });
});
