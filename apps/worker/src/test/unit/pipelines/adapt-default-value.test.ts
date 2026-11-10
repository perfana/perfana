/**
 * `defaultValueIfControlGroupMissing`: when the baseline has NO row for a series and the
 * resolved compare config carries an explicit number, ADAPT judges the test value against
 * that constant instead of reporting `incomparable`, and records that it did.
 *
 * DB-free string assertions on the generated SQL; the behaviour against Postgres is covered
 * by the /ship QA probe (see the PR).
 */
import { describe, expect, test } from 'vitest';
import { AdaptSQLFragments } from '../../../pipelines/helpers/adapt/results/sql-fragments.js';
import { AdaptResultsSQLBuilder } from '../../../pipelines/helpers/adapt/results/sql-builder.js';
import { TrackedResultsSQLBuilder } from '../../../pipelines/helpers/adapt/results/tracked-results-sql-builder.js';

const squash = (s: string) => s.replace(/\s+/g, ' ');
const builders = [
  ['results', () => new AdaptResultsSQLBuilder().buildAdaptResultsSQL('$1', '', 1)],
  ['tracked', () => new TrackedResultsSQLBuilder().buildTrackedResultsSQL('$1', 1)],
] as const;

describe('defaultValueIfControlGroupMissing', () => {
  const uses = squash(new AdaptSQLFragments().usesDefaultValueExpr());

  test('applies only with no control row and an explicit number', () => {
    expect(uses).toContain('NOT wcc.control_row_exists');
    expect(uses).toContain("jsonb_typeof(wcc.compare_config->'defaultValueIfControlGroupMissing') = 'number'");
    // an absent key must read false, never NULL (see the probe in the PR)
    expect(uses.startsWith('COALESCE(')).toBe(true);
    expect(uses.trim().endsWith(', false)')).toBe(true);
    // untrusted config: a value float8 cannot hold is refused instead of aborting the batch
    expect(uses).toContain('<= 1e300');
  });

  test('control_exists admits a default only when the TEST side clears the floor', () => {
    const col = squash(new AdaptSQLFragments().buildControlExistsColumn());
    // the default arm checks test_n but never control_n, which is NULL without a row
    const defaultArm = col.slice(col.indexOf('OR ('));
    expect(defaultArm).toContain('NOT wcc.control_row_exists');
    expect(defaultArm).toContain('COALESCE(wcc.test_n, 0) >=');
    expect(defaultArm).not.toContain('control_n');
  });

  test.each(builders)('%s builder substitutes the default for control_stat_value and stores it', (_, build) => {
    const sql = squash(build());
    expect(sql).toContain(
      `CASE WHEN ${uses} THEN (wcc.compare_config->>'defaultValueIfControlGroupMissing')::float ELSE CASE (wcc.compare_config->'thresholds'->>'aggregation')`,
    );
    expect(sql.match(/as control_stat_value/g)).toHaveLength(1);
    expect(sql).toContain('as uses_default_value');
    expect(sql).toContain('as default_value');
    // the old hard-coded "never" is gone
    expect(sql).not.toContain('false as uses_default_value');
    expect(sql).not.toMatch(/NULL as default_value/);
  });

  test('both builders emit the identical default-value columns', () => {
    const pick = (sql: string) => squash(sql).match(/as control_stat_value[\s\S]*?as default_value/)![0];
    expect(pick(builders[0][1]())).toBe(pick(builders[1][1]()));
  });

  test('the IQR check stays invalid on a default, since control_iqr is NULL without a row', () => {
    const sql = squash(builders[0][1]());
    expect(sql).toContain('wds.control_iqr IS NOT NULL AND wds.control_iqr <> 0');
  });
});
