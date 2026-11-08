import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  compareTemplateRows,
  parseTemplateItem,
  serializeTemplates,
  templateKey,
  TemplateColumns,
} from './compare-template-codec';

const ok = (item: unknown, fileOrg: string | null = null) => {
  const parsed = parseTemplateItem(item, fileOrg);
  if (!parsed.ok) throw new Error(`expected ok, got: ${parsed.error}`);
  return parsed;
};

/** YAML -> rows -> YAML, the path an exported file takes back through provisioning. */
const roundTrip = (canonical: string): string => {
  const doc = yaml.load(canonical) as { organizationId?: string; items: unknown[] };
  const rows = doc.items.map((item) => ok(item, doc.organizationId ?? null).values);
  return serializeTemplates(rows);
};

describe('compare-template codec', () => {
  describe('templateKey parity with migration 1822', () => {
    // apps/api cannot import a migration from packages/shared (not a declared export), so this reads
    // the file the way chart-tokens.spec.ts reads the web tokens, and evaluates its key terms.
    const file = path.resolve(
      __dirname,
      '../../../../../packages/shared/src/database/migrations/1822000000000-CompareTemplateOwnership.ts',
    );

    it('found the migration file', () => {
      expect(fs.existsSync(file)).toBe(true);
    });

    /** Evaluates the three term shapes the key uses, over one row. */
    const sqlKeyOf = (row: Record<string, unknown>): string => {
      const source = fs.readFileSync(file, 'utf8');
      const body = /COMPARE_TEMPLATE_KEY_SQL = `([\s\S]*?)`;/.exec(source)?.[1];
      if (!body) throw new Error('COMPARE_TEMPLATE_KEY_SQL not found');
      const text = (v: unknown) => (v == null ? null : String(v));
      return JSON.stringify(
        body.split(',\n').map((raw) => {
          const term = raw.trim();
          let m = /^COALESCE\((\w+)(?:::text)?, '([^']*)' \|\| (\w+)\)$/.exec(term);
          if (m) return text(row[m[1]]) ?? (row[m[3]] == null ? null : m[2] + row[m[3]]);
          m = /^COALESCE\((\w+)(?:::text)?, '([^']*)'\)$/.exec(term);
          if (m) return text(row[m[1]]) ?? m[2];
          m = /^(\w+)$/.exec(term);
          if (m) return text(row[m[1]] ?? false);
          throw new Error(`unrecognised key term: ${term}`);
        }),
      );
    };

    const rows: Array<Record<string, unknown>> = [
      { panel_id: 5 },
      { panel_id: 5, panel_title: 'renamed' }, // same key: title is descriptive beside an id
      { panel_id: 5, metric_name: 'api' },
      { panel_id: 5, organization_id: 'org-a' },
      { panel_id: 5, regex: true },
      { panel_id: 5, dashboard_uid: 'uid' },
      { panel_title: 'CPU Usage' },
      { panel_title: '5' }, // a title that reads like an id is still a title
      { dashboard_uid: 'a|b', panel_id: 1 },
      { dashboard_uid: 'a', panel_id: 1, metric_name: 'b' },
    ];

    it('agrees with the SQL key on which rows collide', () => {
      for (const a of rows) {
        for (const b of rows) {
          const sqlSame = sqlKeyOf(a) === sqlKeyOf(b);
          const tsSame = templateKey(a) === templateKey(b);
          expect({ a, b, same: tsSame }).toEqual({ a, b, same: sqlSame });
        }
      }
    });
  });

  describe('parseTemplateItem', () => {
    it('reads identity and descriptive fields', () => {
      const { values } = ok({
        dashboardUid: 'jmeter', dashboardLabel: 'JMeter', panelId: 5, panelTitle: 'Errors',
        metricName: 'api', metricClassification: 'RED_errors',
      });
      expect(values).toEqual({
        organization_id: null, dashboard_uid: 'jmeter', regex: false, dashboard_label: 'JMeter',
        panel_id: 5, panel_title: 'Errors', metric_name: 'api', metric_classification: 'RED_errors',
        higher_is_better: null, config_overrides: {},
      });
    });

    it('stores only the overrides an item names, explicit defaults and nulls included', () => {
      const { values } = ok({
        panelId: 1, metricClassification: 'RED_rate',
        higherIsBetter: null, absThreshold: null, percentageThreshold: 0.15, aggregation: 'q95',
      });
      expect(values.config_overrides).toEqual({
        higherIsBetter: null, absThreshold: null, percentageThreshold: 0.15, aggregation: 'q95',
      });
      expect(values.higher_is_better).toBeNull();
    });

    it('keeps higher_is_better in step with the override', () => {
      expect(ok({ panelId: 1, metricClassification: 'x', higherIsBetter: true }).values.higher_is_better).toBe(true);
      expect(ok({ panelId: 1, metricClassification: 'x' }).values.config_overrides).not.toHaveProperty('higherIsBetter');
    });

    it.each([
      [0.5, 1],
      [-3, 1],
      [2.7, 2],
    ])('floors and clamps minSampleCount %p to %p, as the worker reads it', (given, stored) => {
      expect(ok({ panelId: 1, metricClassification: 'x', minSampleCount: given }).values.config_overrides)
        .toEqual({ minSampleCount: stored });
    });

    it('ignores a non-numeric minSampleCount with a warning instead of failing the item', () => {
      const parsed = ok({ panelId: 1, metricClassification: 'x', minSampleCount: 'x' });
      expect(parsed.values.config_overrides).toEqual({});
      expect(parsed.warnings).toEqual([expect.stringMatching(/minSampleCount/)]);
    });

    it('takes the file organization unless the item names its own; null means install-wide', () => {
      expect(ok({ panelId: 1, metricClassification: 'x' }, 'ffffffff-0000-4000-8000-00000000000f').values.organization_id).toBe('ffffffff-0000-4000-8000-00000000000f');
      expect(ok({ panelId: 1, metricClassification: 'x', organizationId: 'eeeeeeee-0000-4000-8000-00000000000e' }, 'ffffffff-0000-4000-8000-00000000000f').values.organization_id).toBe('eeeeeeee-0000-4000-8000-00000000000e');
      expect(ok({ panelId: 1, metricClassification: 'x', organizationId: null }, 'ffffffff-0000-4000-8000-00000000000f').values.organization_id).toBeNull();
    });

    /**
     * Value: protects=an organizationId keys its template the way Postgres stores the uuid, so a
     *   template never flaps between insert and prune, and a non-uuid identifies nothing;
     * fails_when=the id is used as written: an upper-case uuid misses its own row every other boot,
     *   and a typo fails every insert while the prune deletes every stored template;
     * why_new=the fixtures used fake ids, which the database would reject;
     * seam=none; no_claim=Postgres uuid output (lowercase, hyphenated) is assumed, not exercised
     */
    it('lowercases an organizationId to the stored form and refuses one that is not a uuid', () => {
      const upper = 'AAAAAAAA-0000-4000-8000-00000000000A';
      expect(ok({ panelId: 1, metricClassification: 'x' }, upper).key).toBe(templateKey({ organization_id: 'aaaaaaaa-0000-4000-8000-00000000000a', panel_id: 1 }));
      expect(ok({ panelId: 1, metricClassification: 'x', organizationId: ` ${upper} ` }, null).values.organization_id).toBe('aaaaaaaa-0000-4000-8000-00000000000a');
      expect(parseTemplateItem({ panelId: 1, metricClassification: 'x' }, 'acme')).toMatchObject({ ok: false, key: null });
      expect(parseTemplateItem({ panelId: 1, metricClassification: 'x', organizationId: 'acme' }, null)).toMatchObject({ ok: false, key: null });
    });

    it('fails a regex template whose pattern is unsafe, keeping its key declared', () => {
      // It would run on the event loop inside the completion request, against uids Grafana editors control.
      const item = { dashboardUid: '(a+)+$', regex: true, panelId: 1, metricClassification: 'x' };
      const parsed = parseTemplateItem(item, null);
      expect(parsed).toMatchObject({ ok: false, error: expect.stringMatching(/dashboardUid is not a usable regular expression/) });
      expect(parsed.key).toBe(templateKey({ dashboard_uid: '(a+)+$', regex: true, panel_id: 1 }));
    });

    it('warns about a field it does not know, naming the likely intended one', () => {
      const parsed = ok({ panelId: 1, metricClassification: 'x', absoluteThreshold: 5 });
      expect(parsed.values.config_overrides).toEqual({});
      expect(parsed.warnings).toEqual([expect.stringMatching(/unknown field "absoluteThreshold".*absThreshold/)]);
    });

    it('does not offer a prototype member as the intended field', () => {
      expect(ok({ panelId: 1, metricClassification: 'x', constructor: 1 }).warnings).toEqual(['unknown field "constructor" ignored']);
    });

    it('reads a descriptive title beside a panelId as text, not as a pattern', () => {
      // Only a title with no panelId is matched. Checking this one would fail the item and keep a stale row.
      const item = { dashboardUid: '^jvm-', regex: true, panelId: 3, panelTitle: 'Heap (used', metricClassification: 'x' };
      expect(ok(item).values.panel_title).toBe('Heap (used');
    });

    // Rows from 'a string regex' down were added by the /ship test coverage audit.
    // Value: protects=an item whose identity is mistyped declares no key, so it suppresses the prune
    //   instead of declaring a key no stored row has;
    // fails_when=the regex, organizationId or panelId type check is dropped: `regex: 'true'` then keys
    //   as a string, its insert collides with the stored row, and the prune deletes that row;
    // why_new=the table covered dashboardUid and a string panelId only;
    // seam=none;
    // no_claim=how Postgres coerces a mistyped value (pure function; unit only)
    it.each([
      ['a non-mapping', 'nope'],
      ['no panel at all', { metricClassification: 'x' }],
      ['a string panelId', { panelId: '5', metricClassification: 'x' }],
      ['an empty dashboardUid', { dashboardUid: '', panelId: 1, metricClassification: 'x' }],
      ['a string regex', { regex: 'true', panelId: 1, metricClassification: 'x' }],
      ['a numeric organizationId', { organizationId: 5, panelId: 1, metricClassification: 'x' }],
      ['a fractional panelId', { panelId: 1.5, metricClassification: 'x' }],
      ['a blank panelTitle and no panelId', { panelTitle: '  ', metricClassification: 'x' }],
    ])('fails %s with no key, so nothing is declared', (_label, item) => {
      const parsed = parseTemplateItem(item, null);
      expect(parsed).toMatchObject({ ok: false, key: null });
    });

    // Rows from 'a string higherIsBetter' down were added by the /ship test coverage audit.
    // Value: protects=a mistyped override fails the item, keeping its key declared, instead of being
    //   stored and copied into config_data;
    // fails_when=the higherIsBetter, absThreshold or dashboardLabel check is dropped, so `'false'`
    //   (truthy) reaches a row's direction or `'5'` its absolute threshold;
    // why_new=the table exercised only the shared numeric branch, ignore and aggregation;
    // seam=none;
    // no_claim=how the worker would read a mistyped value (pure function; unit only)
    it.each([
      ['an unknown aggregation', { aggregation: 'avg' }],
      ['a non-finite number', { iqrThreshold: Infinity }],
      ['a string number', { percentageThreshold: '0.15' }],
      ['a non-boolean ignore', { ignore: 'yes' }],
      ['a null ignore', { ignore: null }],
      ['a missing classification', { metricClassification: undefined }],
      ['a percentage written as a percent', { percentageThreshold: 15 }],
      ['a negative iqrThreshold', { iqrThreshold: -1 }],
      ['a negative absThreshold', { absThreshold: -5 }],
      ['a string higherIsBetter', { higherIsBetter: 'false' }],
      ['a string absThreshold', { absThreshold: '5' }],
      ['an empty dashboardLabel', { dashboardLabel: '' }],
    ])('fails %s but still declares its key, so the provisioned row survives', (_label, over) => {
      const item = { panelId: 1, metricClassification: 'x', ...over };
      const parsed = parseTemplateItem(item, null);
      expect(parsed.ok).toBe(false);
      expect(parsed.key).toBe(templateKey({ panel_id: 1 }));
    });
  });

  describe('serializeTemplates', () => {
    it('round-trips a canonical install-wide file byte for byte', () => {
      const canonical = [
        'items:',
        '  - panelId: 201',
        '    metricClassification: RED_rate',
        '    higherIsBetter: false',
        '    percentageThreshold: 0.15',
        '  - panelTitle: CPU Usage',
        '    metricClassification: USE_utilization',
        '  - dashboardUid: ^dynatrace-',
        '    regex: true',
        '    panelTitle: Memory.*',
        '    metricClassification: USE_utilization',
        '    higherIsBetter: null',
        '    absThreshold: null',
        '  - dashboardUid: jvm',
        '    panelId: 7',
        '    metricClassification: USE_saturation',
        '    aggregation: q95',
        '    minSampleCount: 3',
        '  - dashboardUid: jvm',
        '    dashboardLabel: JVM',
        '    panelId: 7',
        '    panelTitle: Heap',
        '    metricName: heap used',
        '    metricClassification: USE_saturation',
        '    ignore: true',
        '    ignoreMeanDiffSmallerThan: 5',
        '    iqrThreshold: 3',
        '    defaultValueIfControlGroupMissing: 0',
        '',
      ].join('\n');
      expect(roundTrip(canonical)).toBe(canonical);
    });

    it('writes one file-level organization when every item shares it', () => {
      const canonical = 'organizationId: aaaaaaaa-0000-4000-8000-00000000000a\nitems:\n  - panelId: 1\n    metricClassification: RED_rate\n';
      expect(roundTrip(canonical)).toBe(canonical);
    });

    it('writes per-item organizations, null for install-wide, when scopes are mixed', () => {
      const canonical = [
        'items:',
        '  - organizationId: null',
        '    panelId: 1',
        '    metricClassification: RED_rate',
        '  - organizationId: aaaaaaaa-0000-4000-8000-00000000000a',
        '    panelId: 1',
        '    metricClassification: RED_rate',
        '',
      ].join('\n');
      expect(roundTrip(canonical)).toBe(canonical);
    });

    it('drops a hand-written regex: false, the one spelling that does not survive', () => {
      const out = roundTrip('items:\n  - panelId: 1\n    regex: false\n    metricClassification: RED_rate\n');
      expect(out).toBe('items:\n  - panelId: 1\n    metricClassification: RED_rate\n');
    });

    it('keeps a direction an older API left only in the column', () => {
      // An older API strips the override key and keeps higher_is_better; the applier still reads it.
      const row = { ...ok({ panelId: 1, metricClassification: 'RED_rate' }).values, higher_is_better: false };
      expect(serializeTemplates([row])).toBe('items:\n  - panelId: 1\n    metricClassification: RED_rate\n    higherIsBetter: false\n');
    });

    it('writes an empty file as an explicit empty list', () => {
      expect(serializeTemplates([])).toBe('items: []\n');
    });
  });

  describe('compareTemplateRows', () => {
    const base: Partial<TemplateColumns> = { panel_id: 1 };
    it.each([
      ['scope', { organization_id: null }, { organization_id: 'org-a' }],
      ['organization id', { organization_id: 'org-a' }, { organization_id: 'org-b' }],
      ['dashboard uid, absent first', { dashboard_uid: null }, { dashboard_uid: 'a' }],
      ['dashboard uid', { dashboard_uid: 'a' }, { dashboard_uid: 'b' }],
      ['regex, false first', { regex: false }, { regex: true }],
      ['panel id before title', { panel_id: 99 }, { panel_id: null, panel_title: 'A' }],
      ['panel id', { panel_id: 2 }, { panel_id: 10 }],
      ['panel title', { panel_id: null, panel_title: 'A' }, { panel_id: null, panel_title: 'B' }],
      ['metric, absent first', { metric_name: null }, { metric_name: 'a' }],
      ['metric', { metric_name: 'a' }, { metric_name: 'b' }],
    ])('orders rows that tie on all but %s', (_label, a, b) => {
      expect(compareTemplateRows({ ...base, ...a }, { ...base, ...b })).toBeLessThan(0);
      expect(compareTemplateRows({ ...base, ...b }, { ...base, ...a })).toBeGreaterThan(0);
    });

    it('ignores a descriptive title beside a panel id', () => {
      expect(compareTemplateRows({ panel_id: 1, panel_title: 'Z' }, { panel_id: 1, panel_title: 'A' })).toBe(0);
    });
  });
});
