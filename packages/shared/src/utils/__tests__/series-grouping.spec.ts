import {
  applySeriesGrouping,
  compileSeriesGroupingRule,
  evaluateGroupingPresets,
  groupSeriesName,
  normalizeAggregations,
  SERIES_GROUPING_PRESETS,
  SERIES_NAME_MAX_LENGTH,
  seriesGroupingRuleHash,
  type SeriesGroupingRuleSpec,
} from '../series-grouping';
import { validateRegexPattern } from '../safe-regex';

const rule = (overrides: Partial<SeriesGroupingRuleSpec> = {}): SeriesGroupingRuleSpec => ({
  preset: 'k8s-pod',
  aggregations: ['avg'],
  ...overrides,
});

const groupOf = (spec: SeriesGroupingRuleSpec, name: string): string =>
  applySeriesGrouping(spec, [name]).mapping.get(name)!;

describe('series grouping presets', () => {
  it.each(Object.entries(SERIES_GROUPING_PRESETS))('%s passes the ReDoS guard', (_key, preset) => {
    expect(validateRegexPattern(preset.pattern, { flags: 'g' }).safe).toBe(true);
  });

  describe('k8s-pod (Deployment / ReplicaSet)', () => {
    it.each([
      ['api-7d9f8c6b5-x2k4p', 'api'],
      ['api-7d9f8c6b5-x2k4p / app', 'api / app'],
      ['container_cpu{pod="api-7d9f8c6b5-x2k4p", container="app"}', 'container_cpu{pod="api", container="app"}'],
      ['payment-service-5c4d9b7f8-m4nb6', 'payment-service'],
    ])('groups %s as %s', (raw, group) => {
      expect(groupOf(rule({ preset: 'k8s-pod' }), raw)).toBe(group);
    });

    it.each([
      'db-0',
      'heap-used',
      'gc-pause-young',
      'p95 response time',
      'kafka-consumer-lag',
      'http-requests',
      // A suffix followed by another `-segment` is not the end of a pod name.
      'api-7d9f8c6b5-x2k4p-extra',
    ])('leaves %s unchanged', (raw) => {
      expect(groupOf(rule({ preset: 'k8s-pod' }), raw)).toBe(raw);
    });
  });

  describe('k8s-daemonset (DaemonSet / Job)', () => {
    it('strips the 5-character suffix', () => {
      expect(groupOf(rule({ preset: 'k8s-daemonset' }), 'node-exporter-h5k2l')).toBe('node-exporter');
    });

    it.each(['db-0', 'heap-used', 'http-requests', 'kafka-consumer-lag'])('leaves %s unchanged', (raw) => {
      expect(groupOf(rule({ preset: 'k8s-daemonset' }), raw)).toBe(raw);
    });

    // Documented edge, not a bug: on a Deployment pod it strips only the last segment, which
    // still changes per deployment. The Deployment preset is the right one there, and
    // evaluateGroupingPresets ranks it higher (see below).
    it('strips only the last segment of a Deployment pod name', () => {
      expect(groupOf(rule({ preset: 'k8s-daemonset' }), 'api-7d9f8c6b5-x2k4p')).toBe('api-7d9f8c6b5');
    });

    // Known false-positive shape: five digits drawn only from 2,4,5,6,7,8,9 are inside the
    // Kubernetes alphabet. Pinned so the behaviour is explicit.
    it('matches a 5-digit suffix made of in-alphabet digits', () => {
      expect(groupOf(rule({ preset: 'k8s-daemonset' }), 'jvm-45627')).toBe('jvm');
    });
  });

  describe('ip-port', () => {
    it.each([
      ['10.42.3.17:8080', '*'],
      ['cpu 10.42.3.17:8080 app', 'cpu * app'],
      ['10.42.3.17', '*'],
    ])('groups %s as %s', (raw, group) => {
      expect(groupOf(rule({ preset: 'ip-port' }), raw)).toBe(group);
    });

    it('leaves a version string unchanged', () => {
      expect(groupOf(rule({ preset: 'ip-port' }), 'v1.2.3')).toBe('v1.2.3');
    });
  });

  it('trailing-id strips a trailing generated id', () => {
    expect(groupOf(rule({ preset: 'trailing-id' }), 'worker_a1b2c3')).toBe('worker');
  });
});

describe('compileSeriesGroupingRule', () => {
  it('compiles a custom pattern with a capture-group replacement', () => {
    const spec = rule({ preset: 'custom', pattern: '^(\\w+)-\\d+$', replacement: '$1' });
    expect(compileSeriesGroupingRule(spec)).toMatchObject({ ok: true, error: null, replacement: '$1' });
    expect(groupOf(spec, 'db-12')).toBe('db');
  });

  it('refuses a custom rule without a pattern', () => {
    const compiled = compileSeriesGroupingRule(rule({ preset: 'custom', pattern: null }));
    expect(compiled.ok).toBe(false);
    expect(compiled.regex).toBeNull();
    expect(compiled.error).toMatch(/pattern/i);
  });

  it('refuses an unsafe custom pattern with the guard message', () => {
    const compiled = compileSeriesGroupingRule(rule({ preset: 'custom', pattern: '(a+)+' }));
    expect(compiled.ok).toBe(false);
    expect(compiled.error).toMatch(/ReDoS/);
  });

  it('ignores pattern and replacement on a preset', () => {
    const spec = rule({ preset: 'k8s-pod', pattern: '.*', replacement: 'x' });
    expect(groupOf(spec, 'api-7d9f8c6b5-x2k4p')).toBe('api');
  });
});

describe('applySeriesGrouping', () => {
  it('groups members, sorted, and counts the renamed ones', () => {
    const result = applySeriesGrouping(rule(), [
      'api-7d9f8c6b5-z9w2t',
      'api-7d9f8c6b5-x2k4p',
      'worker-6b8f7d9c4-h5k2l',
      'heap-used',
    ]);
    expect(result.groups.get('api')).toEqual(['api-7d9f8c6b5-x2k4p', 'api-7d9f8c6b5-z9w2t']);
    expect(result.groups.get('worker')).toEqual(['worker-6b8f7d9c4-h5k2l']);
    // A name the pattern does not change is a group of one.
    expect(result.groups.get('heap-used')).toEqual(['heap-used']);
    expect(result.renamedCount).toBe(3);
  });

  it('keeps the raw name when the pattern reduces it to nothing', () => {
    const spec = rule({ preset: 'custom', pattern: '.+', replacement: '' });
    expect(groupOf(spec, 'anything')).toBe('anything');
    const blank = rule({ preset: 'custom', pattern: '\\S+', replacement: '' });
    expect(groupOf(blank, 'a b')).toBe('a b');
  });

  it('truncates group names to the metric_name column length', () => {
    const long = `${'x'.repeat(300)}-7d9f8c6b5-x2k4p`;
    expect(groupOf(rule(), long)).toHaveLength(SERIES_NAME_MAX_LENGTH);
  });

  it('never ends a truncated name on half a surrogate pair', () => {
    const long = `${'x'.repeat(SERIES_NAME_MAX_LENGTH - 1)}😀-7d9f8c6b5-x2k4p`;
    const group = groupOf(rule(), long);
    expect(group).toBe('x'.repeat(SERIES_NAME_MAX_LENGTH - 1));
  });

  it('emits one series per selected aggregation, in canonical order, for renamed groups only', () => {
    const result = applySeriesGrouping(rule({ aggregations: ['max', 'avg', 'count'] }), [
      'api-7d9f8c6b5-x2k4p',
      'api-7d9f8c6b5-z9w2t',
      'heap-used',
    ]);
    expect(result.seriesAggregations.get('api')).toEqual(['avg', 'max', 'count']);
    // A series the rule left alone is a group of one: it passes through under its own name, and
    // suffixing it would rename a series the rule was never meant to touch. All four aggregations
    // of one member are the same number anyway, bar `count`, which would be a constant 1.
    expect(result.seriesAggregations.has('heap-used')).toBe(false);
    expect(result.isRenamed.get('api')).toBe(true);
    expect(result.isRenamed.get('heap-used')).toBe(false);
  });

  /**
   * Value:
   *   protects — the member count is an ordinary aggregation now (it was a separate
   *     `track_member_count` boolean), so it has to follow every rule the others do.
   *   fails_when — `count` is special-cased back out of the canonical list, or given its own
   *     name shape. The series would then be missing from the picker, or named something the
   *     grouped SQL's `group_name || ' (' || agg || ')'` cannot reproduce — a silent miss.
   *   seam — the one name rule.
   */
  it('treats the member count as an ordinary aggregation, named like the rest', () => {
    const result = applySeriesGrouping(rule({ aggregations: ['count'] }), ['api-7d9f8c6b5-x2k4p']);
    expect(result.seriesAggregations.get('api')).toEqual(['count']);
    expect(groupSeriesName('api', 'count')).toBe('api (count)');
  });

  it('drops a series whose name collides with a real one, or would overflow the column', () => {
    const collided = applySeriesGrouping(rule({ aggregations: ['avg', 'sum'] }), [
      'api-7d9f8c6b5-x2k4p',
      'api (sum)',
    ]);
    // Only the colliding one is dropped; its siblings still emit.
    expect(collided.seriesAggregations.get('api')).toEqual(['avg']);

    // Dropped rather than truncated: the worker rebuilds this name by concatenation in SQL.
    const long = `${'y'.repeat(SERIES_NAME_MAX_LENGTH)}-7d9f8c6b5-x2k4p`;
    expect(applySeriesGrouping(rule({ aggregations: ['sum'] }), [long]).seriesAggregations.size).toBe(0);
  });

  it('is deterministic and does not depend on input order', () => {
    const names = ['b-7d9f8c6b5-x2k4p', 'a-7d9f8c6b5-x2k4p', 'a-7d9f8c6b5-z9w2t'];
    const one = applySeriesGrouping(rule(), names);
    const two = applySeriesGrouping(rule(), [...names].reverse());
    expect([...one.groups.entries()]).toEqual([...two.groups.entries()]);
  });

  it('compiles once and is safe to call repeatedly (no lastIndex leakage)', () => {
    const spec = rule();
    for (let i = 0; i < 3; i++) {
      expect(groupOf(spec, 'api-7d9f8c6b5-x2k4p')).toBe('api');
    }
  });

  it('throws on an invalid rule rather than grouping silently', () => {
    expect(() => applySeriesGrouping(rule({ preset: 'custom', pattern: '(a+)+' }), ['a'])).toThrow(/ReDoS/);
  });
});

describe('seriesGroupingRuleHash', () => {
  it('is stable and 8 hex characters', () => {
    const a = seriesGroupingRuleHash(rule());
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(seriesGroupingRuleHash(rule())).toBe(a);
  });

  it('changes with every field that changes grouping', () => {
    const base = seriesGroupingRuleHash(rule());
    expect(seriesGroupingRuleHash(rule({ aggregations: ['sum'] }))).not.toBe(base);
    expect(seriesGroupingRuleHash(rule({ aggregations: ['avg', 'count'] }))).not.toBe(base);
    expect(seriesGroupingRuleHash(rule({ preset: 'k8s-daemonset' }))).not.toBe(base);
    const custom = rule({ preset: 'custom', pattern: 'a', replacement: '' });
    expect(seriesGroupingRuleHash({ ...custom, replacement: 'b' })).not.toBe(seriesGroupingRuleHash(custom));
  });

  // The insights page reads a changed hash as "this run is stale", so ticking the same boxes in a
  // different order must not light up every grouped run in the deployment.
  it('does not depend on the order the boxes were ticked in, or on junk values', () => {
    expect(seriesGroupingRuleHash(rule({ aggregations: ['count', 'avg', 'sum'] }))).toBe(
      seriesGroupingRuleHash(rule({ aggregations: ['avg', 'sum', 'count'] })),
    );
    expect(seriesGroupingRuleHash(rule({ aggregations: ['avg', 'avg'] }))).toBe(seriesGroupingRuleHash(rule()));
  });
});

describe('aggregation helpers', () => {
  // The worker's grouped statement rebuilds this as `group_name || ' (' || agg || ')'`.
  it('names a series the way the grouped SQL concatenates it', () => {
    expect(groupSeriesName('api', 'sum')).toBe('api (sum)');
    expect(groupSeriesName('api', 'count')).toBe('api (count)');
  });

  it('normalizes to canonical order, de-duplicated, dropping unknown values', () => {
    expect(normalizeAggregations(['count', 'max', 'sum', 'max', 'avg'])).toEqual(['avg', 'sum', 'max', 'count']);
    // Empty is NOT defaulted to ['avg']: the DTO and the CHECK refuse it, and a rule that somehow
    // emits nothing must be skipped loudly rather than quietly behaving like a different rule.
    expect(normalizeAggregations([])).toEqual([]);
    expect(normalizeAggregations(null)).toEqual([]);
    expect(normalizeAggregations(undefined)).toEqual([]);
    expect(normalizeAggregations(['nope' as never])).toEqual([]);
  });
});

describe('evaluateGroupingPresets', () => {
  const current = ['api-7d9f8c6b5-x2k4p', 'api-7d9f8c6b5-z9w2t'];
  const baseline = ['api-5c4d9b7f8-q8r2m'];

  it('scores the Deployment preset highest on renamed Deployment pods', () => {
    const [best, ...rest] = evaluateGroupingPresets(current, baseline);
    expect(best).toEqual({ preset: 'k8s-pod', matchedBefore: 0, matchedAfter: 1, currentGroups: 1 });
    // The DaemonSet preset keeps the per-deployment hash, so it matches nothing.
    expect(rest.find((e) => e.preset === 'k8s-daemonset')!.matchedAfter).toBe(0);
  });

  it('sorts by matchedAfter, then by preset order', () => {
    const order = evaluateGroupingPresets(['heap-used'], ['heap-used']).map((e) => e.preset);
    expect(order).toEqual(['k8s-pod', 'k8s-daemonset', 'ip-port', 'trailing-id']);
  });

  it('returns zeros for an empty current list', () => {
    for (const e of evaluateGroupingPresets([], baseline)) {
      expect(e).toMatchObject({ matchedBefore: 0, matchedAfter: 0, currentGroups: 0 });
    }
  });
});
