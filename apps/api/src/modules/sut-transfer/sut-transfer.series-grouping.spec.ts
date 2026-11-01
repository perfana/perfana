import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createGunzip, gzipSync } from 'zlib';
import * as readline from 'readline';
import { SutExportService } from './sut-export.service';
import { SutImportService } from './sut-import.service';

/**
 * Series grouping in the SUT bundle (migration 1819), without a database.
 *
 * `sut-import.service.spec.ts` is the real round-trip, but it needs a live Postgres; this file
 * pins the same contract for the two new tables against an in-memory stand-in, so the parts
 * that can silently break are guarded on every run:
 *
 *  - what the exporter selects for each table, and which rows that keeps and drops;
 *  - the order the tables sit in the bundle, which is the order the importer inserts them in;
 *  - that the importer writes both tables as plain `SELECT *` inserts with their source primary
 *    keys and foreign keys untouched, rewrites only ownership, and purges neither.
 *
 * Neither table has a serial id, so `SERIAL_ID_TABLES` is deliberately unchanged: a table in
 * that set would lose its source `id`, and `ds_metric_series_groups.rule_id` would then point
 * at a rule that no longer exists under that id.
 */

const SUT_ID = '11111111-0000-0000-0000-000000000001';
const SRC_ORG = '22222222-0000-0000-0000-000000000001';
const TARGET_ORG = '22222222-0000-0000-0000-000000000002';
const APP_DASH_ID = '33333333-0000-0000-0000-000000000001';
const RULE_ID = '44444444-0000-0000-0000-000000000001';
/** A different rule already in the target, holding the slot the bundle's rule wants. */
const OTHER_RULE_ID = '44444444-0000-0000-0000-0000000000ff';
const RUN_UUID = '55555555-0000-0000-0000-000000000001';
const RUN_KEY = 'sg-run-1';
const OTHER_RUN_KEY = 'sg-run-2-not-selected';

type Row = Record<string, unknown>;
type Call = { sql: string; params: unknown[] };

const RULE_ROW: Row = {
  id: RULE_ID,
  system_under_test_id: SUT_ID,
  test_environment: 'test',
  workload: 'wl-1',
  application_dashboard_id: APP_DASH_ID,
  panel_id: null,
  preset: 'k8s-pod',
  pattern: null,
  replacement: '',
  aggregation: 'avg',
  track_member_count: true,
  enabled: true,
  origin: 'manual',
  organization_id: SRC_ORG,
  team_id: '66666666-0000-0000-0000-000000000001',
  created_by: 'alice',
  updated_by: 'alice',
  created_at: '2026-11-01T10:00:00+00:00',
  updated_at: '2026-11-01T10:00:00+00:00',
};

const membership = (runKey: string, metric: string, group: string): Row => ({
  test_run_id: runKey,
  application_dashboard_id: APP_DASH_ID,
  panel_id: 101,
  metric_name: metric,
  group_name: group,
  dashboard_label: 'k8s',
  panel_title: 'CPU',
  aggregation: 'avg',
  avg_members: 3,
  rule_id: RULE_ID,
  rule_hash: 'abc123',
  organization_id: null,
  team_id: null,
  created_at: '2026-11-01T10:05:00+00:00',
});

/** What the fake database holds, by table. Only tables with rows need an entry. */
const STORE: Record<string, Row[]> = {
  systems_under_test: [{ id: SUT_ID, name: 'sg-sut', organization_id: SRC_ORG, team_id: null }],
  test_runs: [
    { id: RUN_UUID, test_run_id: RUN_KEY, system_under_test_id: SUT_ID, organization_id: SRC_ORG },
  ],
  application_dashboards: [
    { id: APP_DASH_ID, system_under_test_id: SUT_ID, organization_id: SRC_ORG },
  ],
  series_grouping_rules: [RULE_ROW],
  ds_metric_series_groups: [
    membership(RUN_KEY, 'pod-a-7d9f8c6b5-x2x4z', 'pod-a'),
    membership(RUN_KEY, 'pod-a-7d9f8c6b5-q8w3e', 'pod-a'),
    // A run that is NOT in the export selection: its membership rows must not travel.
    membership(OTHER_RUN_KEY, 'pod-a-7d9f8c6b5-zzzzz', 'pod-a'),
  ],
};

/** Reads `FROM <table>` out of the exporter's `SELECT row_to_json(t) AS r FROM <table> t ...`. */
const tableOf = (sql: string): string | undefined => /FROM\s+(\w+)\s+t\b/.exec(sql)?.[1];

function buildExportService(): { service: SutExportService; streamed: Call[] } {
  const streamed: Call[] = [];
  const dataSource = {
    query: jest.fn(async (sql: string) => {
      if (/SELECT name FROM systems_under_test/.test(sql)) return [{ name: 'sg-sut' }];
      if (/SELECT id, test_run_id FROM test_runs/.test(sql)) {
        return [{ id: RUN_UUID, test_run_id: RUN_KEY }];
      }
      if (/SELECT id FROM application_dashboards/.test(sql)) return [{ id: APP_DASH_ID }];
      throw new Error(`unexpected query: ${sql}`);
    }),
    createQueryRunner: jest.fn(() => ({
      connect: jest.fn(async () => undefined),
      release: jest.fn(async () => undefined),
      // Applies the two predicates the exporter uses for these tables, so a filter that is wrong
      // shows up as the wrong rows, not just as different SQL.
      stream: jest.fn(async (sql: string, params: unknown[]) => {
        streamed.push({ sql, params });
        const table = tableOf(sql);
        const all = (table && STORE[table]) || [];
        let rows = all;
        if (/t\.test_run_id = ANY\(\$1\)/.test(sql)) {
          rows = all.filter((r) => (params[0] as string[]).includes(r.test_run_id as string));
        } else if (/t\.system_under_test_id = \$1/.test(sql)) {
          rows = all.filter((r) => r.system_under_test_id === params[0]);
        }
        return (async function* () {
          for (const r of rows) yield { r };
        })();
      }),
    })),
  };
  return { service: new SutExportService(dataSource as unknown as DataSource), streamed };
}

const toBuffer = (s: NodeJS.ReadableStream): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    s.on('data', (c) => chunks.push(Buffer.from(c)));
    s.on('end', () => resolve(Buffer.concat(chunks)));
    s.on('error', reject);
  });

/** Splits a gzipped NDJSON bundle into its tables, in file order. */
async function readBundle(bundle: Buffer): Promise<{ order: string[]; rows: Record<string, Row[]> }> {
  const { Readable } = await import('stream');
  const rl = readline.createInterface({ input: Readable.from(bundle).pipe(createGunzip()) });
  const order: string[] = [];
  const rows: Record<string, Row[]> = {};
  let current: string | null = null;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line);
    if (obj.__manifest__ || obj.__summary__) continue;
    if (obj.__table__) {
      current = obj.__table__ as string;
      order.push(current);
      rows[current] = [];
      continue;
    }
    if (current) rows[current]!.push(obj);
  }
  return { order, rows };
}

/**
 * An importer over a fake transaction that records every statement and accepts every insert.
 *
 * It models the one piece of target state the importer itself asks about: which ids exist in
 * `series_grouping_rules`. A rule insert adds its ids, so a later lookup sees them (as it would
 * inside the real transaction); with `slotHeldByOtherRule` the insert is skipped instead, which is
 * what `ON CONFLICT DO NOTHING` does when `uq_series_grouping_rules_slot` is already taken, and
 * the target keeps holding only the other rule.
 */
function buildImportService(opts: { slotHeldByOtherRule?: boolean } = {}): {
  service: SutImportService;
  manager: Call[];
} {
  const manager: Call[] = [];
  const rulesInTarget = new Set<string>(opts.slotHeldByOtherRule ? [OTHER_RULE_ID] : []);
  const dataSource = {
    // Pre-flight lookups: SUT absent, no name clash -> a clean first import.
    query: jest.fn(async () => []),
    transaction: jest.fn(async (cb: (m: unknown) => Promise<void>) =>
      cb({
        query: jest.fn(async (sql: string, params: unknown[] = []) => {
          manager.push({ sql, params });
          if (/^INSERT INTO series_grouping_rules /.test(sql)) {
            const rows = JSON.parse(params[0] as string) as Row[];
            if (opts.slotHeldByOtherRule) return []; // skipped by the slot's unique index
            rows.forEach((r) => rulesInTarget.add(r.id as string));
            return rows.map(() => ({ '?column?': 1 }));
          }
          if (/FROM series_grouping_rules WHERE id::text = ANY/.test(sql)) {
            return (params[0] as string[]).filter((id) => rulesInTarget.has(id)).map((id) => ({ id }));
          }
          if (/^INSERT INTO/.test(sql)) {
            // RETURNING 1: one row per row written.
            return JSON.parse(params[0] as string).map(() => ({ '?column?': 1 }));
          }
          return []; // assertNoForeignRunKey, etc.
        }),
      }),
    ),
  };
  return { service: new SutImportService(dataSource as unknown as DataSource), manager };
}

/** A gzipped NDJSON bundle written by hand: manifest, then each table's marker and rows. */
function handmadeBundle(tables: Record<string, Row[]>): Buffer {
  const lines = [
    JSON.stringify({ __manifest__: { schemaVersion: 1, sourceSutId: SUT_ID, sutName: 'sg-sut' } }),
  ];
  for (const [table, rows] of Object.entries(tables)) {
    lines.push(JSON.stringify({ __table__: table }));
    for (const r of rows) lines.push(JSON.stringify(r));
  }
  return gzipSync(Buffer.from(lines.join('\n') + '\n'));
}

/** Exports the fixture SUT and imports the bundle into a fake target. */
async function roundTrip(opts: { slotHeldByOtherRule?: boolean } = {}): Promise<{
  manager: Call[];
  summary: Awaited<ReturnType<SutImportService['import']>>;
}> {
  const { service: exporter } = buildExportService();
  const bundle = await toBuffer(
    await exporter.export(SUT_ID, { testRunIds: [RUN_UUID], includeOptional: false, includeRaw: false }),
  );
  const { service: importer, manager } = buildImportService(opts);
  const summary = await importer.import(bundle, TARGET_ORG);
  return { manager, summary };
}

describe('series grouping in the SUT bundle', () => {
  describe('export', () => {
    it('selects the rules by system_under_test_id and the membership rows by the selected runs\' varchar key', async () => {
      const { service, streamed } = buildExportService();
      await toBuffer(
        await service.export(SUT_ID, { testRunIds: [RUN_UUID], includeOptional: false, includeRaw: false }),
      );

      const rules = streamed.find((c) => tableOf(c.sql) === 'series_grouping_rules');
      expect(rules?.sql).toContain('WHERE t.system_under_test_id = $1');
      expect(rules?.params).toEqual([SUT_ID]);

      const groups = streamed.find((c) => tableOf(c.sql) === 'ds_metric_series_groups');
      expect(groups?.sql).toContain('WHERE t.test_run_id = ANY($1)');
      // The canonical varchar key, not the entity uuid: the table has no uuid test_run_id.
      expect(groups?.params).toEqual([[RUN_KEY]]);
    });

    it('ships both tables with the core data (no includeOptional, no includeRaw) and only the selected run\'s memberships', async () => {
      const { service } = buildExportService();
      const bundle = await toBuffer(
        await service.export(SUT_ID, { testRunIds: [RUN_UUID], includeOptional: false, includeRaw: false }),
      );
      const { order, rows } = await readBundle(bundle);

      expect(rows['series_grouping_rules']).toHaveLength(1);
      expect(rows['ds_metric_series_groups']).toHaveLength(2);
      expect(rows['ds_metric_series_groups']!.every((r) => r.test_run_id === RUN_KEY)).toBe(true);

      // The bundle's table order IS the importer's insert order.
      const at = (t: string): number => order.indexOf(t);
      expect(at('application_dashboards')).toBeLessThan(at('series_grouping_rules'));
      expect(at('series_grouping_rules')).toBeLessThan(at('ds_metric_series_groups'));
      expect(at('ds_metric_statistics')).toBeLessThan(at('ds_metric_series_groups'));
    });

    it('queries no membership rows when no run is selected, but still exports the rules', async () => {
      const streamed: Call[] = [];
      const dataSource = {
        query: jest.fn(async (sql: string) =>
          /SELECT name FROM systems_under_test/.test(sql) ? [{ name: 'sg-sut' }] : [],
        ),
        createQueryRunner: jest.fn(() => ({
          connect: jest.fn(async () => undefined),
          release: jest.fn(async () => undefined),
          stream: jest.fn(async (sql: string, params: unknown[]) => {
            streamed.push({ sql, params });
            return (async function* () {
              /* no rows */
            })();
          }),
        })),
      };
      const exporter = new SutExportService(dataSource as unknown as DataSource);
      await toBuffer(
        await exporter.export(SUT_ID, { testRunIds: [], includeOptional: false, includeRaw: false }),
      );

      // `ANY([])` short-circuits in streamRows, so the run-keyed table is never queried...
      expect(streamed.some((c) => tableOf(c.sql) === 'ds_metric_series_groups')).toBe(false);
      // ...while the rules, which are SUT-level config, still are.
      expect(streamed.some((c) => tableOf(c.sql) === 'series_grouping_rules')).toBe(true);
    });
  });

  describe('export -> import round trip', () => {
    const insertsFor = (manager: Call[], table: string): Call[] =>
      manager.filter((c) => c.sql.startsWith(`INSERT INTO ${table} `));

    it('inserts the rules before the membership rows that point at them', async () => {
      const { manager } = await roundTrip();

      const inserts = manager.filter((c) => c.sql.startsWith('INSERT INTO ')).map((c) => /INSERT INTO (\w+)/.exec(c.sql)![1]);
      const at = (t: string): number => inserts.indexOf(t);

      expect(at('series_grouping_rules')).toBeGreaterThan(-1);
      expect(at('ds_metric_series_groups')).toBeGreaterThan(-1);
      // rule_id and application_dashboard_id are FKs checked on insert.
      expect(at('application_dashboards')).toBeLessThan(at('series_grouping_rules'));
      expect(at('series_grouping_rules')).toBeLessThan(at('ds_metric_series_groups'));
    });

    it('writes both as plain SELECT * inserts, so the source primary keys survive (no serial-id path)', async () => {
      const { manager } = await roundTrip();

      for (const table of ['series_grouping_rules', 'ds_metric_series_groups']) {
        const [insert, ...rest] = insertsFor(manager, table);
        expect(rest).toHaveLength(0);
        expect(insert!.sql).toBe(
          `INSERT INTO ${table} SELECT * FROM json_populate_recordset(null::${table}, $1::json) ON CONFLICT DO NOTHING RETURNING 1`,
        );
      }
    });

    it('keeps every foreign key as exported and rewrites only ownership', async () => {
      const { manager } = await roundTrip();

      const [rule] = JSON.parse(insertsFor(manager, 'series_grouping_rules')[0]!.params[0] as string) as Row[];
      expect(rule).toMatchObject({
        id: RULE_ID, // the rule keeps its id: the memberships below reference it
        system_under_test_id: SUT_ID,
        application_dashboard_id: APP_DASH_ID,
        organization_id: TARGET_ORG, // remapped by the importer's generic ownership rewrite
        team_id: null, // a team does not exist in the target
      });
      // Not part of the ownership rewrite.
      expect(rule!.created_by).toBe('alice');

      const groups = JSON.parse(insertsFor(manager, 'ds_metric_series_groups')[0]!.params[0] as string) as Row[];
      expect(groups).toHaveLength(2);
      for (const g of groups) {
        expect(g).toMatchObject({
          test_run_id: RUN_KEY,
          application_dashboard_id: APP_DASH_ID,
          rule_id: RULE_ID,
          // NULL in the source, still stamped: this table carries organization_id too.
          organization_id: TARGET_ORG,
          team_id: null,
        });
      }
    });

    it('clears nothing first: the composite primary key already makes a re-import a no-op', async () => {
      const { manager } = await roundTrip();

      // PURGE_BY_RUN_TABLES is for tables ON CONFLICT cannot de-duplicate. Adding either new
      // table there would delete a run's membership rows on every top-up import.
      const purges = manager.filter((c) => /^DELETE FROM/.test(c.sql));
      expect(purges.some((c) => /series_grouping_rules|ds_metric_series_groups/.test(c.sql))).toBe(false);
    });

    it('accepts both tables through the allowlist and counts what it wrote', async () => {
      const { summary } = await roundTrip();

      // Both names are in VALID_TABLES because it is derived from the resource graph; an
      // unknown table would have thrown "Unknown table in bundle".
      expect(summary.rowCounts['series_grouping_rules']).toBe(1);
      expect(summary.rowCounts['ds_metric_series_groups']).toBe(2);
      expect(summary.skippedCounts['series_grouping_rules']).toBeUndefined();
      expect(summary.droppedCounts['ds_metric_series_groups']).toBeUndefined();
    });
  });

  // `ds_metric_series_groups.rule_id` is an FK checked on insert. A merge-import can leave it
  // pointing at a rule that never reached the target: the bundle's rule lost ON CONFLICT DO
  // NOTHING to a DIFFERENT rule on the same slot (uq_series_grouping_rules_slot), is counted as
  // "already present", and its id does not exist here. Unhandled, the membership insert raised
  // 23503 and the whole import rolled back — a code the importer does not translate.
  describe('merge-import where another rule already holds the slot', () => {
    const lookups = (manager: Call[]): Call[] =>
      manager.filter((c) => /FROM series_grouping_rules WHERE id::text = ANY/.test(c.sql));
    const membershipRows = (manager: Call[]): Row[] =>
      manager
        .filter((c) => c.sql.startsWith('INSERT INTO ds_metric_series_groups '))
        .flatMap((c) => JSON.parse(c.params[0] as string) as Row[]);

    afterEach(() => jest.restoreAllMocks());

    it('imports the membership rows with rule_id NULL instead of failing on the missing rule', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      const { manager, summary } = await roundTrip({ slotHeldByOtherRule: true });

      // The rule was skipped, as "already present" rather than written or dropped...
      expect(summary.rowCounts['series_grouping_rules']).toBe(0);
      expect(summary.skippedCounts['series_grouping_rules']).toBe(1);
      // ...and both membership rows still landed: kept, not dropped and not skipped.
      expect(summary.rowCounts['ds_metric_series_groups']).toBe(2);
      expect(summary.droppedCounts['ds_metric_series_groups']).toBeUndefined();
      expect(summary.skippedCounts['ds_metric_series_groups']).toBeUndefined();

      const rows = membershipRows(manager);
      expect(rows).toHaveLength(2);
      for (const r of rows) {
        // Only the dangling reference changes; the row is still a valid mapping for its run.
        expect(r).toMatchObject({
          rule_id: null,
          test_run_id: RUN_KEY,
          application_dashboard_id: APP_DASH_ID,
          group_name: 'pod-a',
          rule_hash: 'abc123',
          organization_id: TARGET_ORG,
        });
      }
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Cleared rule_id on 2 ds_metric_series_groups row(s)'));
    });

    it('looks the rules up after they were written and before the memberships are', async () => {
      const { manager } = await roundTrip({ slotHeldByOtherRule: true });

      const at = (pred: (c: Call) => boolean): number => manager.findIndex(pred);
      const rulesInsert = at((c) => c.sql.startsWith('INSERT INTO series_grouping_rules '));
      const lookup = at((c) => /FROM series_grouping_rules WHERE id::text = ANY/.test(c.sql));
      const membershipInsert = at((c) => c.sql.startsWith('INSERT INTO ds_metric_series_groups '));

      expect(rulesInsert).toBeGreaterThan(-1);
      expect(lookup).toBeGreaterThan(rulesInsert);
      expect(membershipInsert).toBeGreaterThan(lookup);
      // Distinct ids only, and the bundle's rule id is the one asked about.
      expect(lookups(manager)[0]!.params).toEqual([[RULE_ID]]);
    });

    it('clears only the references that dangle, and leaves NULLs and present rules alone', async () => {
      const UNKNOWN_RULE_ID = '44444444-0000-0000-0000-0000000000ee';
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const { service, manager } = buildImportService();

      await service.import(
        handmadeBundle({
          series_grouping_rules: [RULE_ROW],
          ds_metric_series_groups: [
            { ...membership(RUN_KEY, 'm-present', 'pod-a'), rule_id: RULE_ID },
            { ...membership(RUN_KEY, 'm-dangling', 'pod-a'), rule_id: UNKNOWN_RULE_ID },
            { ...membership(RUN_KEY, 'm-already-null', 'pod-a'), rule_id: null },
          ],
        }),
        TARGET_ORG,
      );

      const byMetric = Object.fromEntries(membershipRows(manager).map((r) => [r.metric_name, r.rule_id]));
      expect(byMetric).toEqual({ 'm-present': RULE_ID, 'm-dangling': null, 'm-already-null': null });
      // One query for the distinct non-null ids, in bundle order.
      expect(lookups(manager)).toHaveLength(1);
      expect(lookups(manager)[0]!.params).toEqual([[RULE_ID, UNKNOWN_RULE_ID]]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Cleared rule_id on 1 ds_metric_series_groups row(s)'));
    });

    it('asks nothing and warns about nothing when no membership row references a rule', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const { service, manager } = buildImportService();

      const summary = await service.import(
        handmadeBundle({
          ds_metric_series_groups: [
            { ...membership(RUN_KEY, 'm-1', 'pod-a'), rule_id: null },
            { ...membership(RUN_KEY, 'm-2', 'pod-a'), rule_id: null },
          ],
        }),
        TARGET_ORG,
      );

      expect(summary.rowCounts['ds_metric_series_groups']).toBe(2);
      expect(lookups(manager)).toHaveLength(0);
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
