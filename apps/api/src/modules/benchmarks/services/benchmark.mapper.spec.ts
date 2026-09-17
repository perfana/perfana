import { BenchmarkMapper } from './benchmark.mapper';
import { Benchmark as BenchmarkEntity } from '../../../entities';

/**
 * The mapper is the API's read-side contract for Apdex SLOs. Rows written before
 * migration 1808 have no apdex_min_samples in memory (the column default only
 * applies on INSERT), so the mapper has to hand the web the same 50 the worker uses.
 */
describe('BenchmarkMapper.mapEntityToBenchmark — apdex_min_samples', () => {
  const baseEntity = (overrides: Partial<BenchmarkEntity>): BenchmarkEntity =>
    ({
      id: 'bm-1',
      system_under_test_id: 'sut-1',
      test_environment: 'production',
      workload: 'loadTest',
      source: 'custom',
      benchmark_type: 'apdex',
      min_apdex_score: '0.85',
      enabled: true,
      valid: true,
      tags: [],
      configuration: { type: 'apdex' },
      metadata: {},
      created_at: new Date('2026-09-17T00:00:00Z'),
      updated_at: new Date('2026-09-17T00:00:00Z'),
      ...overrides,
    }) as unknown as BenchmarkEntity;

  it('passes an explicit apdex_min_samples through', () => {
    const mapped = BenchmarkMapper.mapEntityToBenchmark(baseEntity({ apdex_min_samples: 25 }));

    expect(mapped.apdex_min_samples).toBe(25);
  });

  it('defaults apdex_min_samples to 50 when the entity carries none', () => {
    const mapped = BenchmarkMapper.mapEntityToBenchmark(
      baseEntity({ apdex_min_samples: undefined as unknown as number }),
    );

    expect(mapped.apdex_min_samples).toBe(50);
  });

  it('does not treat a null column as 0', () => {
    const mapped = BenchmarkMapper.mapEntityToBenchmark(
      baseEntity({ apdex_min_samples: null as unknown as number }),
    );

    expect(mapped.apdex_min_samples).toBe(50);
  });
});
