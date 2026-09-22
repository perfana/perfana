import { apdexRating, calculateScenarioMetrics, APDEX_MIN_SAMPLES } from '../performance-formatters';

const tx = (over: Partial<Parameters<typeof calculateScenarioMetrics>[0][number]>) => ({
  total_count: 1000,
  passed_count: 1000,
  failed_count: 0,
  avg_response_time: 100,
  p95_response_time: 200,
  p99_response_time: 300,
  apdex_score: 1,
  ...over,
});

describe('apdexRating', () => {
  it('rates a score backed by enough successful requests', () => {
    const r = apdexRating(0.96, 500);
    expect(r).toMatchObject({ label: 'Excellent', score: '0.960', scoreValue: 0.96, reason: null });
  });

  it('refuses to rate a transaction that failed every execution', () => {
    // The sketch scores the failures' (fast) response times, which read as Excellent.
    const r = apdexRating(1, 0);
    expect(r.reason).toBe('No successful requests to score');
    expect(r.label).not.toBe('Excellent');
    expect(r.scoreValue).toBeNull();
  });

  it('refuses to rate a handful of samples, and names the count', () => {
    const r = apdexRating(1, APDEX_MIN_SAMPLES - 1);
    expect(r.label).toBe('Too few');
    expect(r.reason).toContain(String(APDEX_MIN_SAMPLES));
    expect(r.scoreValue).toBeNull();
  });

  it('treats a missing score as no rating', () => {
    expect(apdexRating(null, 500).reason).toBe('No Apdex score available');
  });
});

describe('calculateScenarioMetrics', () => {
  it('keeps unscoreable transactions out of the weighted Apdex', () => {
    const m = calculateScenarioMetrics([
      tx({ apdex_score: 0.5, total_count: 100, passed_count: 100 }),
      // All-failing: would otherwise contribute a perfect 1.0 over 900 requests.
      tx({ apdex_score: 1, total_count: 900, passed_count: 0, failed_count: 900 }),
    ]);
    expect(m.apdexSampleCount).toBe(100);
    expect(m.weightedApdexScore).toBeCloseTo(0.5);
    expect(m.totalRequests).toBe(1000);
  });

  it('reports no Apdex samples when nothing is scoreable', () => {
    const m = calculateScenarioMetrics([tx({ total_count: 10, passed_count: 10 })]);
    expect(m.apdexSampleCount).toBe(0);
    expect(apdexRating(m.weightedApdexScore, m.apdexSampleCount).reason).not.toBeNull();
  });
});
