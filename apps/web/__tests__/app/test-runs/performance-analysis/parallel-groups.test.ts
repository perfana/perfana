import {
  buildSamplerSections,
  summariseGroup,
} from '@/app/test-runs/[id]/components/performance-analysis/utils/parallel-groups';
import { SamplerStat } from '@/app/test-runs/[id]/components/performance-analysis/types/performance-analysis.types';

function sampler(name: string, overrides: Partial<SamplerStat> = {}): SamplerStat {
  return {
    sampler_name: name,
    avg_response_time: 10,
    min_response_time: 1,
    max_response_time: 20,
    p95_response_time: 18,
    p99_response_time: 19,
    passed_count: 1,
    failed_count: 0,
    total_count: 1,
    avg_latency: 1,
    avg_connect_time: 1,
    total_request_size: 1,
    total_response_size: 1,
    apdex_score: 1,
    active_threshold: 500,
    url_hash: null,
    url_pattern: null,
    ...overrides,
  };
}

describe('buildSamplerSections', () => {
  it('returns a flat list of singles when nothing is tagged (older runs)', () => {
    const sections = buildSamplerSections([sampler('a'), sampler('b'), sampler('c')]);

    expect(sections).toHaveLength(3);
    expect(sections.every((s) => s.kind === 'single')).toBe(true);
  });

  it('treats an explicit null or empty group as sequential', () => {
    const sections = buildSamplerSections([
      sampler('a', { parallel_group: null }),
      sampler('b', { parallel_group: '' }),
    ]);

    expect(sections.every((s) => s.kind === 'single')).toBe(true);
  });

  it('clusters members of the same group', () => {
    const sections = buildSamplerSections([
      sampler('solo'),
      sampler('one', { parallel_group: 'T01_PG1' }),
      sampler('two', { parallel_group: 'T01_PG1' }),
      sampler('after'),
    ]);

    expect(sections.map((s) => s.kind)).toEqual(['single', 'group', 'single']);
    const group = sections[1];
    if (group.kind !== 'group') throw new Error('expected a group');
    expect(group.name).toBe('T01_PG1');
    expect(group.samples.map((s) => s.sampler_name)).toEqual(['one', 'two']);
  });

  it('keeps separate groups separate and anchors each at its first member', () => {
    const sections = buildSamplerSections([
      sampler('a', { parallel_group: 'PG1' }),
      sampler('b', { parallel_group: 'PG2' }),
      sampler('c', { parallel_group: 'PG1' }),
      sampler('d', { parallel_group: 'PG2' }),
    ]);

    expect(sections).toHaveLength(2);
    const [first, second] = sections;
    if (first.kind !== 'group' || second.kind !== 'group') throw new Error('expected two groups');
    expect(first.name).toBe('PG1');
    expect(first.samples.map((s) => s.sampler_name)).toEqual(['a', 'c']);
    expect(second.name).toBe('PG2');
    expect(second.samples.map((s) => s.sampler_name)).toEqual(['b', 'd']);
  });

  it('does not draw a band around a group of one', () => {
    const sections = buildSamplerSections([sampler('lonely', { parallel_group: 'PG1' })]);

    expect(sections).toHaveLength(1);
    expect(sections[0].kind).toBe('single');
  });

  it('preserves the incoming order of sequential requests', () => {
    const sections = buildSamplerSections([
      sampler('first', { total_count: 100 }),
      sampler('second', { total_count: 50 }),
      sampler('third', { total_count: 10 }),
    ]);

    const names = sections.map((s) => (s.kind === 'single' ? s.sample.sampler_name : s.name));
    expect(names).toEqual(['first', 'second', 'third']);
  });
});

describe('summariseGroup', () => {
  it('reports wall clock as the slowest member', () => {
    const timing = summariseGroup([
      sampler('slow', { avg_response_time: 158 }),
      sampler('medium', { avg_response_time: 117 }),
      sampler('fast', { avg_response_time: 7 }),
    ]);

    expect(timing.wallClockMs).toBe(158);
    expect(timing.concurrency).toBe(3);
  });

  it('handles an empty group without producing -Infinity', () => {
    expect(summariseGroup([])).toEqual({ wallClockMs: 0, concurrency: 0 });
  });
});
