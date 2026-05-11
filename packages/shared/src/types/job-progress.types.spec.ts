import { getStageName, PIPELINE_STAGES } from './job-progress.types';

describe('getStageName', () => {
  it('returns human-readable name for transaction-stats-rollup', () => {
    expect(getStageName('transaction-stats-rollup')).toBe('Transaction stats rollup');
  });

  it('returns human-readable name for data-sanity-check', () => {
    expect(getStageName('data-sanity-check')).toBe('Data sanity check');
  });

  it('falls back to the raw id for unknown stages', () => {
    expect(getStageName('unknown-stage')).toBe('unknown-stage');
  });

  it('transaction-stats-rollup appears between performance-test-metrics and metrics-collection', () => {
    const ids = PIPELINE_STAGES.map((s) => s.id);
    const perfIdx = ids.indexOf('performance-test-metrics');
    const rollupIdx = ids.indexOf('transaction-stats-rollup');
    const metricsIdx = ids.indexOf('metrics-collection');
    expect(rollupIdx).toBeGreaterThan(perfIdx);
    expect(rollupIdx).toBeLessThan(metricsIdx);
  });

  it('data-sanity-check appears after adapt-analysis', () => {
    const ids = PIPELINE_STAGES.map((s) => s.id);
    const adaptIdx = ids.indexOf('adapt-analysis');
    const sanityIdx = ids.indexOf('data-sanity-check');
    expect(sanityIdx).toBeGreaterThan(adaptIdx);
  });
});
