import { GoldenPathTemplate, INSERT_BASE, rebuildConfig, selectWinner } from './golden-path-resolver';
import { OVERRIDE_KEYS, OverrideKey } from '../../provisioning/compare-template-codec';

const t = (over: Partial<GoldenPathTemplate> & { id: string }): GoldenPathTemplate => ({
  regex: false,
  dashboard_uid: null,
  panel_id: 1,
  organization_id: null,
  ...over,
});

describe('golden-path resolver', () => {
  describe('selectWinner', () => {
    // One case per adjacent pair of precedence steps: the earlier step must win even when the
    // loser is better on every later one.
    it.each([
      [
        'exact uid over regex uid, before scope',
        t({ id: 'z', dashboard_uid: 'jvm' }),
        t({ id: 'a', dashboard_uid: '^jvm', regex: true, organization_id: 'org-a' }),
      ],
      [
        'regex uid over wildcard, before scope',
        t({ id: 'z', dashboard_uid: '^jvm', regex: true }),
        t({ id: 'a', organization_id: 'org-a' }),
      ],
      [
        'organization over install-wide, before panel match',
        t({ id: 'z', organization_id: 'org-a', panel_id: null, panel_title: 'Heap' }),
        t({ id: 'a', panel_id: 7 }),
      ],
      [
        'panel id over literal title, before id',
        t({ id: 'z', panel_id: 7 }),
        t({ id: 'a', panel_id: null, panel_title: 'Heap' }),
      ],
      [
        'literal title over regex title, before id',
        t({ id: 'z', dashboard_uid: null, panel_id: null, panel_title: 'Heap' }),
        t({ id: 'a', dashboard_uid: null, regex: true, panel_id: null, panel_title: 'He.*' }),
      ],
    ])('%s', (_label, better, worse) => {
      expect(selectWinner([worse, better])).toEqual({ winner: better, tiedWith: undefined });
      expect(selectWinner([better, worse])).toEqual({ winner: better, tiedWith: undefined });
    });

    it('decides overlapping regexes by template id and reports the tie', () => {
      const broad = t({ id: 'b-broad', dashboard_uid: '^jvm-.*', regex: true });
      const narrow = t({ id: 'a-narrow', dashboard_uid: '^jvm-prod.*', regex: true });

      expect(selectWinner([broad, narrow])).toEqual({ winner: narrow, tiedWith: broad });
      expect(selectWinner([narrow, broad])).toEqual({ winner: narrow, tiedWith: broad });
    });

    it('has no winner without candidates', () => {
      expect(selectWinner([])).toEqual({ winner: undefined, tiedWith: undefined });
    });
  });

  describe('rebuildConfig', () => {
    const base = {
      thresholds: { aggregation: 'mean', iqrThreshold: 2, absoluteThreshold: null, percentageThreshold: 0.1, minSampleCount: 1 },
      metricClassification: { classification: 'none', higherIsBetter: true },
      defaultValueIfControlGroupMissing: 0,
      source: 'dynatrace-host',
    };

    it('applies the fields the template names and keeps every other base field', () => {
      const out = rebuildConfig(
        base,
        t({
          id: 'x', metric_classification: 'USE_utilization',
          config_overrides: { absThreshold: 5, aggregation: 'q95', minSampleCount: 3, ignore: true, defaultValueIfControlGroupMissing: 1 },
        }),
      );
      expect(out).toEqual({
        thresholds: { aggregation: 'q95', iqrThreshold: 2, absoluteThreshold: 5, percentageThreshold: 0.1, minSampleCount: 3 },
        metricClassification: { classification: 'USE_utilization', higherIsBetter: true },
        defaultValueIfControlGroupMissing: 1,
        ignore: true,
        source: 'dynatrace-host',
      });
    });

    it("leaves the row's direction alone when the template does not name one", () => {
      // The behaviour change behind the CHANGELOG callout: a legacy template omitting
      // higherIsBetter used to null a machine-seeded row's direction.
      const out = rebuildConfig(base, t({ id: 'x', metric_classification: 'RED_rate', config_overrides: {} }));
      expect(out.metricClassification).toEqual({ classification: 'RED_rate', higherIsBetter: true });
    });

    it('forces an explicit null direction', () => {
      const out = rebuildConfig(base, t({ id: 'x', metric_classification: 'RED_rate', config_overrides: { higherIsBetter: null } }));
      expect(out.metricClassification).toEqual({ classification: 'RED_rate', higherIsBetter: null });
    });

    it('reads the direction column on a row the backfill has not reached', () => {
      const out = rebuildConfig(base, t({ id: 'x', metric_classification: 'RED_rate', higher_is_better: false, config_overrides: null }));
      expect((out.metricClassification as Record<string, unknown>).higherIsBetter).toBe(false);
    });

    it('reverts a field the template stops naming', () => {
      const before = rebuildConfig(base, t({ id: 'x', metric_classification: 'c', config_overrides: { absThreshold: 5 } }));
      const after = rebuildConfig(base, t({ id: 'x', metric_classification: 'c', config_overrides: {} }));
      expect((before.thresholds as Record<string, unknown>).absoluteThreshold).toBe(5);
      expect((after.thresholds as Record<string, unknown>).absoluteThreshold).toBeNull();
    });

    it('is the base when no template matches any more, and never shares or mutates it', () => {
      const out = rebuildConfig(base, undefined);
      expect(out).toEqual(base);
      expect(out).not.toBe(base);
      rebuildConfig(base, t({ id: 'x', metric_classification: 'c', config_overrides: { absThreshold: 9 } }));
      expect(base.thresholds.absoluteThreshold).toBeNull();
    });

    it('builds the config the insert has always written from INSERT_BASE', () => {
      expect(rebuildConfig({ ...INSERT_BASE }, t({ id: 'x', metric_classification: 'RED_rate', higher_is_better: true }))).toEqual({
        thresholds: { aggregation: 'mean', iqrThreshold: 2, absoluteThreshold: null, percentageThreshold: 0.15 },
        metricClassification: { classification: 'RED_rate', higherIsBetter: true },
        defaultValueIfControlGroupMissing: 0,
      });
    });

    /**
     * Generated by /ship test coverage audit.
     * Value: protects=every override the YAML codec accepts reaches its config_data key, so no file
     *   field is accepted and then silently ignored;
     * fails_when=a key is added to OVERRIDE_KEYS, or dropped from THRESHOLD_FIELDS/TOP_LEVEL_FIELDS,
     *   without the resolver mapping it;
     * why_new=the cases above name 5 of the 9 keys and nothing ties the resolver to the codec's list;
     * seam=none;
     * no_claim=that the worker reads each key (ignoreMeanDiffSmallerThan has no worker reader); pure
     *   functions, unit only
     */
    describe('agrees with the codec on every override key', () => {
      // Each value differs from `base`, so a key the resolver drops cannot pass by coincidence.
      const WRITES: Record<OverrideKey, { value: unknown; at: string[] }> = {
        higherIsBetter: { value: false, at: ['metricClassification', 'higherIsBetter'] },
        absThreshold: { value: 123, at: ['thresholds', 'absoluteThreshold'] },
        ignore: { value: true, at: ['ignore'] },
        ignoreMeanDiffSmallerThan: { value: 7, at: ['ignoreMeanDiffSmallerThan'] },
        percentageThreshold: { value: 0.42, at: ['thresholds', 'percentageThreshold'] },
        iqrThreshold: { value: 9, at: ['thresholds', 'iqrThreshold'] },
        aggregation: { value: 'q99', at: ['thresholds', 'aggregation'] },
        minSampleCount: { value: 11, at: ['thresholds', 'minSampleCount'] },
        defaultValueIfControlGroupMissing: { value: 5, at: ['defaultValueIfControlGroupMissing'] },
      };

      it('maps exactly the keys the codec accepts', () => {
        expect(Object.keys(WRITES).sort()).toEqual([...OVERRIDE_KEYS].sort());
      });

      it.each(OVERRIDE_KEYS.map((key) => [key]))('writes %s where the worker config expects it', (key) => {
        const { value, at } = WRITES[key];
        const out = rebuildConfig(base, t({ id: 'x', metric_classification: 'c', config_overrides: { [key]: value } }));
        expect(at.reduce<unknown>((node, k) => (node as Record<string, unknown>)?.[k], out)).toEqual(value);
      });
    });
  });
});
