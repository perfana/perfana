/**
 * Regression test for #417 (part 4): zero-variance / saturated-metric IQR sensitivity.
 *
 * When a baseline is perfectly constant (control_iqr = 0, e.g. Apdex saturated at ~1.0),
 * the IQR band `control ± (iqr * threshold)` collapses to zero width, so any nonzero diff
 * would trip "partial regression". The classifier now guards the IQR check with
 * `control_iqr <> 0` so classification falls through to the pct/abs checks instead.
 *
 * These are DB-free string assertions on the generated SQL — the integration path that
 * actually executes the SQL lives in adapt-pipeline.integration.test.ts (needs a live DB).
 */
import { describe, test, expect } from 'vitest';
import { AdaptSQLFragments } from '../../../pipelines/helpers/adapt/results/sql-fragments.js';
import { TrackedResultsSQLBuilder } from '../../../pipelines/helpers/adapt/results/tracked-results-sql-builder.js';

describe('ADAPT IQR zero-variance guard (#417)', () => {
  test('buildChecksJSONB guards the iqr check with control_iqr <> 0', () => {
    const checks = new AdaptSQLFragments().buildChecksJSONB();
    // The guard must appear in both the `valid` flag and the `isDifference` CASE,
    // so a zero-variance baseline yields valid=false / isDifference=false.
    const occurrences = checks.match(/wds\.control_iqr <> 0/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  test('tracked-results checks JSONB guards the iqr check with control_iqr <> 0', () => {
    const sql = new TrackedResultsSQLBuilder().buildTrackedResultsSQL('$1', 1);
    const occurrences = sql.match(/wds\.control_iqr <> 0/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });
});
