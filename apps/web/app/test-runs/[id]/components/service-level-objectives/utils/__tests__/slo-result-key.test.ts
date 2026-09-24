import { getCheckResultKey } from '../slo-formatters';

/**
 * Regression guard for the duplicate-SLO bug: two check results that differ only in
 * `benchmark_id` (WERKNL / Performance test metrics T_WG_Mijn_Vacatures / Transaction Error
 * Rate, panel 105, metric_name NULL) shared a React key, so React dropped the duplicate
 * sibling and neither row could be expanded.
 */
const base = {
  panel_type: 'graph',
  evaluate_type: 'avg',
  application_dashboard_id: '7bb99616-7541-516c-a11d-defac89c3518',
  panel_id: 105,
  metric_name: null,
  panel_title: 'Transaction Error Rate',
} as const;

describe('getCheckResultKey', () => {
  it('separates two SLOs that share dashboard, panel and metric name', () => {
    const a = getCheckResultKey({ ...base, benchmark_id: '1626ebcc' });
    const b = getCheckResultKey({ ...base, benchmark_id: '9f2a8ea0' });
    expect(a).not.toEqual(b);
  });

  it('is stable across a re-evaluate, which rewrites check_results with fresh ids', () => {
    const before = getCheckResultKey({ ...base, benchmark_id: '1626ebcc' });
    const after = getCheckResultKey({ ...base, benchmark_id: '1626ebcc' });
    expect(after).toEqual(before);
  });

  it('separates two apdex SLOs on the same panel title', () => {
    const apdex = { ...base, panel_type: 'apdex', evaluate_type: 'apdex' };
    expect(getCheckResultKey({ ...apdex, benchmark_id: 'a' })).not.toEqual(
      getCheckResultKey({ ...apdex, benchmark_id: 'b' }),
    );
  });

  it('falls back to benchmark_id when there is no application dashboard', () => {
    expect(
      getCheckResultKey({ ...base, application_dashboard_id: null, benchmark_id: 'only-id' }),
    ).toContain('only-id');
  });
});

describe('getCheckResultKey — the null fields real check_results carry', () => {
  it('substitutes "unknown" for a null metric name rather than collapsing to a bare prefix', () => {
    expect(getCheckResultKey({ ...base, benchmark_id: 'bm-1' })).toBe(
      '7bb99616-7541-516c-a11d-defac89c3518_105_unknown_bm-1',
    );
  });

  it('still separates two metrics on one panel', () => {
    const a = getCheckResultKey({ ...base, metric_name: 'GET /a', benchmark_id: 'bm-1' });
    const b = getCheckResultKey({ ...base, metric_name: 'GET /b', benchmark_id: 'bm-1' });
    expect(a).not.toEqual(b);
  });

  it('substitutes "unknown" for a null panel id — 0 is a real panel id and must survive', () => {
    expect(getCheckResultKey({ ...base, panel_id: null, benchmark_id: 'bm-1' })).toContain(
      '_unknown_unknown_bm-1',
    );
    expect(getCheckResultKey({ ...base, panel_id: 0, benchmark_id: 'bm-1' })).toContain('_0_');
  });

  // Both fallbacks at once: nothing identifying is left, so every such row shares one key.
  // That is the floor of the scheme, asserted so a change to it is deliberate.
  it('falls back to "unknown" on both halves when benchmark_id is null too', () => {
    expect(
      getCheckResultKey({ ...base, application_dashboard_id: null, benchmark_id: null }),
    ).toBe('unknown_105_unknown_unknown');
  });

  it('keys an apdex result on benchmark_id even when the panel title is null', () => {
    expect(
      getCheckResultKey({
        ...base,
        panel_type: 'apdex',
        evaluate_type: 'apdex',
        panel_title: null,
        benchmark_id: 'bm-apdex',
      }),
    ).toBe('apdex_bm-apdex_unknown');
  });

  // An apdex row and a metric row for the same benchmark must never share a key.
  it('never collides an apdex key with a metric key', () => {
    const metric = getCheckResultKey({ ...base, benchmark_id: 'bm-1' });
    const apdex = getCheckResultKey({
      ...base,
      panel_type: 'apdex',
      evaluate_type: 'apdex',
      benchmark_id: 'bm-1',
    });
    expect(metric).not.toEqual(apdex);
  });

  // panel_type may be absent while evaluate_type says apdex, and vice versa.
  it('takes either field as the apdex signal', () => {
    const viaEvaluate = getCheckResultKey({ ...base, evaluate_type: 'apdex', benchmark_id: 'bm-1' });
    const viaPanel = getCheckResultKey({ ...base, panel_type: 'apdex', benchmark_id: 'bm-1' });
    expect(viaEvaluate).toMatch(/^apdex_/);
    expect(viaPanel).toMatch(/^apdex_/);
  });
});
