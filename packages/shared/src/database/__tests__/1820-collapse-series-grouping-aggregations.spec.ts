// Lives OUTSIDE src/database/migrations for the same reason as consolidated-schema-split.spec.ts:
// that directory is globbed as migrations by Dockerfile.migrations, apps/api/src/data-source.ts
// and the RLS harness, and a compiled *.spec.js there gets require()d as a migration.
import { QueryRunner } from 'typeorm';
import { CollapseSeriesGroupingAggregations1820000000000 } from '../migrations/1820000000000-CollapseSeriesGroupingAggregations';
import { SERIES_GROUPING_AGGREGATIONS } from '../../utils/series-grouping';

const sqlOf = async (dir: 'up' | 'down'): Promise<string> => {
  const out: string[] = [];
  const runner = { query: async (q: string) => (out.push(q), []) } as unknown as QueryRunner;
  const m = new CollapseSeriesGroupingAggregations1820000000000();
  await (dir === 'up' ? m.up(runner) : m.down(runner));
  return out.join('\n');
};

describe('CollapseSeriesGroupingAggregations (1820)', () => {
  it('converts the v0.2.97.43 columns and drops every one of them', async () => {
    const sql = await sqlOf('up');
    // The three on the rules table and the two on the membership table. Leaving any behind
    // means check:entity-migrations keeps passing while the entity and the database disagree.
    for (const col of ['aggregation', 'track_member_count', 'extra_aggregations', 'member_count_name']) {
      expect(sql).toMatch(new RegExp(`DROP COLUMN IF EXISTS ${col}\\b`));
    }
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS aggregations/);
  });

  it('writes the set in the canonical order, because the rule hash is taken over it', async () => {
    // A set written in a different order changes the hash, which marks every grouped run stale
    // and asks the user to recalculate statistics for nothing.
    const sql = await sqlOf('up');
    const quoted = SERIES_GROUPING_AGGREGATIONS.map((a) => `'${a}'`).join(', ');
    expect(sql).toContain(`ARRAY[${quoted}]::character varying(8)[]`);
  });

  it('gives an UNRENAMED group an empty array, not its old aggregation', async () => {
    // REGRESSION GUARD. The old membership table had `aggregation` NOT NULL on every row,
    // including groups the rule never renamed, so the plain projection yields {avg} for them.
    // A group that passes through under its own name must emit NO derived series: with {avg}
    // the resolver starts offering "<name> (avg)" beside the real series and the picker gains
    // a duplicate that draws nothing. Measured on a real v0.2.97.43 database: 16 of 124
    // membership rows were this case.
    const sql = await sqlOf('up');
    expect(sql).toMatch(
      /CASE WHEN group_name = metric_name THEN ARRAY\[\]::character varying\(8\)\[\]/,
    );
  });

  it('is guarded on the columns rather than on a version, so it is idempotent', async () => {
    const sql = await sqlOf('up');
    // Every branch asks the catalog. A fresh install runs 1819 in the same batch and finds the
    // collapsed shape already there, so each guard is false and the whole migration is a no-op.
    expect(sql).toMatch(/to_regclass\('public\.series_grouping_rules'\) IS NULL/);
    expect(sql).toMatch(/information_schema\.columns[\s\S]*column_name = 'aggregation'/);
    expect(sql).not.toMatch(/DROP TABLE/);
  });

  it('never drops or re-creates either table', async () => {
    // The rules are user-authored, and the membership rows record what each run's statistics
    // were computed with — the resolver prefers them over the live rule precisely so a chart
    // agrees with the numbers beside it.
    const both = (await sqlOf('up')) + (await sqlOf('down'));
    expect(both).not.toMatch(/DROP TABLE/);
    expect(both).not.toMatch(/TRUNCATE/);
    expect(both).not.toMatch(/DELETE FROM/);
  });

  it('sets NOT NULL on membership only after the backfill', async () => {
    // The column is NOT NULL in 1819. Setting it before the UPDATE fails on its own backfill.
    const sql = await sqlOf('up');
    const update = sql.indexOf('UPDATE public.ds_metric_series_groups');
    const notNull = sql.indexOf('ALTER COLUMN aggregations SET NOT NULL');
    expect(update).toBeGreaterThan(-1);
    expect(notNull).toBeGreaterThan(update);
  });

  it('down() restores all five columns and re-adds the old CHECK', async () => {
    const sql = await sqlOf('down');
    for (const col of ['aggregation', 'track_member_count', 'extra_aggregations', 'member_count_name']) {
      expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`));
    }
    expect(sql).toMatch(/ck_series_grouping_rules_aggregation\b/);
    // The old CHECK did not know about 'count' — that is why a count-only rule cannot be
    // represented in the old shape and is restored as avg plus the count switch.
    expect(sql).toMatch(/CHECK \(aggregation IN \('avg', 'sum', 'max'\)\)/);
    expect(sql).toMatch(/DROP COLUMN IF EXISTS aggregations/);
  });
});
