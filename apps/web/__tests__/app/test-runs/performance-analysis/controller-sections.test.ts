import {
  buildSamplerSections,
  controllerKind,
  sectionSamples,
  SamplerGroupSection,
  SamplerSection,
} from '@/app/test-runs/[id]/components/performance-analysis/utils/controller-sections';
import {
  ControllerRef,
  SamplerStat,
} from '@/app/test-runs/[id]/components/performance-analysis/types/performance-analysis.types';

const C = {
  threadGroup: (name = 'Shoppers'): ControllerRef => ({
    name,
    class: 'org.apache.jmeter.threads.ThreadGroup',
  }),
  transaction: (name: string): ControllerRef => ({
    name,
    class: 'org.apache.jmeter.control.TransactionController',
  }),
  parallel: (name: string): ControllerRef => ({
    name,
    class: 'org.apache.jmeter.control.ParallelController',
  }),
  loop: (name: string): ControllerRef => ({
    name,
    class: 'org.apache.jmeter.control.LoopController',
  }),
  forEach: (name: string): ControllerRef => ({
    name,
    class: 'org.apache.jmeter.control.ForeachController',
  }),
  ifCtl: (name: string): ControllerRef => ({
    name,
    class: 'org.apache.jmeter.control.IfController',
  }),
};

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

function asGroup(section: SamplerSection): SamplerGroupSection {
  if (section.kind !== 'group') throw new Error(`expected a group, got ${section.kind}`);
  return section;
}

const names = (sections: SamplerSection[]) =>
  sections.map((s) => (s.kind === 'single' ? s.sample.sampler_name : s.name));

describe('controllerKind', () => {
  it('classifies by class, never by name', () => {
    expect(controllerKind('org.apache.jmeter.control.ParallelController')).toBe('parallel');
    expect(controllerKind('org.apache.jmeter.control.ForeachController')).toBe('loop');
    expect(controllerKind('org.apache.jmeter.control.WhileController')).toBe('loop');
    expect(controllerKind('org.apache.jmeter.control.IfController')).toBe('conditional');
    expect(controllerKind('org.apache.jmeter.control.TransactionController')).toBe('transaction');
  });

  it('gives an unrecognised controller a neutral band rather than dropping the level', () => {
    expect(controllerKind('com.example.custom.MagicController')).toBe('other');
  });
});

describe('buildSamplerSections', () => {
  describe('runs with no controller data', () => {
    it('returns a flat list of singles (older runs)', () => {
      const sections = buildSamplerSections([sampler('a'), sampler('b'), sampler('c')], 'T01');

      expect(sections).toHaveLength(3);
      expect(sections.every((s) => s.kind === 'single')).toBe(true);
    });

    it('treats an explicit null or empty group as sequential', () => {
      const sections = buildSamplerSections(
        [sampler('a', { parallel_group: null }), sampler('b', { parallel_group: '' })],
        'T01',
      );

      expect(sections.every((s) => s.kind === 'single')).toBe(true);
    });

    it('preserves the incoming order of sequential requests', () => {
      const sections = buildSamplerSections(
        [
          sampler('first', { total_count: 100 }),
          sampler('second', { total_count: 50 }),
          sampler('third', { total_count: 10 }),
        ],
        'T01',
      );

      expect(names(sections)).toEqual(['first', 'second', 'third']);
    });
  });

  describe('parallel groups from the parallel_group fallback', () => {
    // A web build ahead of the API still gets the bands it used to, rather than a flat table.
    it('clusters members of the same group', () => {
      const sections = buildSamplerSections(
        [
          sampler('solo'),
          sampler('one', { parallel_group: 'T01_PG1' }),
          sampler('two', { parallel_group: 'T01_PG1' }),
          sampler('after'),
        ],
        'T01',
      );

      expect(sections.map((s) => s.kind)).toEqual(['single', 'group', 'single']);
      const group = asGroup(sections[1]);
      expect(group.name).toBe('T01_PG1');
      expect(group.controller).toBe('parallel');
      expect(sectionSamples(group).map((s) => s.sampler_name)).toEqual(['one', 'two']);
    });

    it('keeps separate groups separate and anchors each at its first member', () => {
      const sections = buildSamplerSections(
        [
          sampler('a', { parallel_group: 'PG1' }),
          sampler('b', { parallel_group: 'PG2' }),
          sampler('c', { parallel_group: 'PG1' }),
          sampler('d', { parallel_group: 'PG2' }),
        ],
        'T01',
      );

      expect(names(sections)).toEqual(['PG1', 'PG2']);
      expect(sectionSamples(sections[0]).map((s) => s.sampler_name)).toEqual(['a', 'c']);
      expect(sectionSamples(sections[1]).map((s) => s.sampler_name)).toEqual(['b', 'd']);
    });

    it('carries the group timings onto the section', () => {
      const stats = {
        parallel_group: 'PG1', executions: 12, passed_count: 12, failed_count: 0,
        avg_elapsed: 156, min_elapsed: 154, max_elapsed: 160, p95_elapsed: 159, p99_elapsed: 160,
      };
      const sections = buildSamplerSections(
        [
          sampler('a', { parallel_group: 'PG1', parallel_group_stats: stats }),
          sampler('b', { parallel_group: 'PG1', parallel_group_stats: stats }),
        ],
        'T01',
      );

      expect(asGroup(sections[0]).stats).toEqual(stats);
    });

    it('leaves stats null when the run predates the rollup', () => {
      const sections = buildSamplerSections(
        [sampler('a', { parallel_group: 'PG1' }), sampler('b', { parallel_group: 'PG1' })],
        'T01',
      );

      expect(asGroup(sections[0]).stats).toBeNull();
    });
  });

  describe('trimming the chain to what differs', () => {
    it('drops the thread group and the transaction the table is already headed by', () => {
      const sections = buildSamplerSections(
        [
          sampler('checkout_cart', {
            parent_controllers: [C.threadGroup(), C.transaction('T02_Checkout')],
          }),
        ],
        'T02_Checkout',
      );

      // Nothing left to band: exactly the flat row it was before controllers were recorded.
      expect(names(sections)).toEqual(['checkout_cart']);
      expect(sections[0].kind).toBe('single');
    });

    it('keeps the parallel band when EVERY request in the transaction ran inside it', () => {
      // Trimming the longest common prefix would erase the band here — the one case it exists
      // for. Only thread groups and the current transaction are ever dropped.
      const chain = [C.threadGroup(), C.transaction('T02_Checkout'), C.parallel('PG1')];
      const sections = buildSamplerSections(
        [
          sampler('asset_css', { parent_controllers: chain }),
          sampler('asset_js', { parent_controllers: chain }),
        ],
        'T02_Checkout',
      );

      expect(names(sections)).toEqual(['PG1']);
      expect(asGroup(sections[0]).controller).toBe('parallel');
    });

    it('keeps a sub-transaction, which is not the one the table is headed by', () => {
      const sections = buildSamplerSections(
        [
          sampler('a', {
            parent_controllers: [
              C.threadGroup(),
              C.transaction('T02_Checkout'),
              C.transaction('T02a_Payment'),
            ],
          }),
          sampler('b', {
            parent_controllers: [
              C.threadGroup(),
              C.transaction('T02_Checkout'),
              C.transaction('T02a_Payment'),
            ],
          }),
        ],
        'T02_Checkout',
      );

      expect(names(sections)).toEqual(['T02a_Payment']);
    });

    it('drops a thread group whatever its subclass', () => {
      const sections = buildSamplerSections(
        [
          sampler('a', {
            parent_controllers: [
              { name: 'Shoppers', class: 'com.blazemeter.jmeter.threads.ConcurrencyThreadGroup' },
              C.loop('warmup_loop'),
            ],
          }),
        ],
        'T01',
      );

      expect(names(sections)).toEqual(['warmup_loop']);
    });
  });

  describe('nesting', () => {
    it('nests a parallel group inside the loop that drives it', () => {
      const sections = buildSamplerSections(
        [
          sampler('product_detail', {
            parent_controllers: [C.threadGroup(), C.forEach('product_loop')],
          }),
          sampler('asset_css', {
            parent_controllers: [C.threadGroup(), C.forEach('product_loop'), C.parallel('PG1')],
          }),
          sampler('asset_js', {
            parent_controllers: [C.threadGroup(), C.forEach('product_loop'), C.parallel('PG1')],
          }),
        ],
        'T03',
      );

      expect(names(sections)).toEqual(['product_loop']);
      const loop = asGroup(sections[0]);
      expect(loop.controller).toBe('loop');
      // The loop's own row order: the sequential request first, then the nested band.
      expect(names(loop.children)).toEqual(['product_detail', 'PG1']);
      expect(asGroup(loop.children[1]).controller).toBe('parallel');
      // Every request under the loop, at any depth.
      expect(sectionSamples(loop).map((s) => s.sampler_name)).toEqual([
        'product_detail',
        'asset_css',
        'asset_js',
      ]);
    });

    it('does not merge two controllers that happen to share a name at different depths', () => {
      const sections = buildSamplerSections(
        [
          sampler('a', { parent_controllers: [C.loop('retry')] }),
          sampler('b', { parent_controllers: [C.loop('outer'), C.loop('retry')] }),
        ],
        'T01',
      );

      expect(names(sections)).toEqual(['retry', 'outer']);
      expect(names(asGroup(sections[1]).children)).toEqual(['retry']);
    });
  });

  describe('bands worth drawing', () => {
    it('does not band a parallel group of one', () => {
      // "These ran together" says nothing about a row with nothing to run together with.
      const sections = buildSamplerSections(
        [sampler('lonely', { parent_controllers: [C.parallel('PG1')] })],
        'T01',
      );

      expect(sections).toHaveLength(1);
      expect(sections[0].kind).toBe('single');
    });

    it('keeps a loop band around a single request', () => {
      // "This repeats" is still true, and still the explanation for its count.
      const sections = buildSamplerSections(
        [sampler('poll_status', { parent_controllers: [C.loop('poll_loop')] })],
        'T01',
      );

      expect(names(sections)).toEqual(['poll_loop']);
      expect(asGroup(sections[0]).controller).toBe('loop');
    });

    it('keeps a conditional band around a single request', () => {
      const sections = buildSamplerSections(
        [sampler('even_thread_extra', { parent_controllers: [C.ifCtl('even_threads_only')] })],
        'T01',
      );

      expect(asGroup(sections[0]).controller).toBe('conditional');
    });
  });
});
