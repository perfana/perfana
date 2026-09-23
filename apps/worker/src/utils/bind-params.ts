/**
 * Row limits for multi-VALUES statements, derived from Postgres' bind-parameter cap.
 *
 * The extended query protocol carries the parameter count as an Int16, so a single
 * statement can bind at most 65535 values. A bulk `INSERT ... VALUES (...), (...)`
 * spends `rows x columns` of that budget, which makes the safe row count a function
 * of the column list — not a number anyone should be writing by hand.
 *
 * Two sites got this wrong in opposite directions (worker pipeline review 2026-09-14,
 * COL-P4 and COL-P7):
 *
 *   - `MetricProcessor.upsertMetricsToDatabase` hard-coded 200 rows against a 19-column
 *     insert, spending 3800 of 65535 and paying ~17x more round trips than it needed to.
 *   - `PanelsPipeline.insertPanelDocuments` chunked at nothing at all. Also 19 columns,
 *     so a run with more than 3449 panels fails the whole panels stage outright. That is
 *     a latent failure rather than slowness, and it scales with dashboards per run.
 *
 * Deriving the bound from `columns.length` is what keeps both correct when a column is
 * added: a hand-tuned constant silently moves closer to the cliff, this moves away from
 * it. Every caller passes its own `columns.length`, never a literal.
 */

/**
 * Postgres' hard cap on bind parameters in one extended-protocol statement.
 * Int16 in the wire format; not configurable.
 */
export const PG_MAX_BIND_PARAMS = 65535;

/**
 * Rows per statement for a bulk insert of `columnCount` columns.
 *
 * Returns the smaller of `preferredRows` and the hard parameter ceiling, so a caller
 * can express "I would like batches of about this size" without having to know the
 * limit — and cannot exceed it even if it asks to.
 *
 * `preferredRows` exists because the ceiling is not the optimum: a statement at the
 * cap builds a very large SQL string and holds every parameter in memory, and on a
 * compressed hypertable an enormous upsert is not obviously faster than several
 * medium ones. 1000 is the default because it is 5x the old hard-coded 200 while
 * staying under a third of the ceiling; it is a round number, not a measurement, and
 * the right way to change it is to measure the two callers under production volume.
 *
 * @param columnCount number of columns in the INSERT's column list (must be >= 1)
 * @param preferredRows desired batch size before the ceiling is applied
 */
export function maxRowsPerStatement(columnCount: number, preferredRows = 1000): number {
  if (!Number.isInteger(columnCount) || columnCount < 1) {
    throw new Error(`maxRowsPerStatement: columnCount must be a positive integer, got ${columnCount}`);
  }
  if (!Number.isInteger(preferredRows) || preferredRows < 1) {
    throw new Error(`maxRowsPerStatement: preferredRows must be a positive integer, got ${preferredRows}`);
  }

  // Floor, never round: one row over the cap fails the whole statement.
  const ceiling = Math.floor(PG_MAX_BIND_PARAMS / columnCount);

  // A column list wider than the cap itself cannot be inserted a row at a time
  // either; surface that rather than returning 0 and looping forever.
  if (ceiling < 1) {
    throw new Error(
      `maxRowsPerStatement: ${columnCount} columns exceeds the ${PG_MAX_BIND_PARAMS}-parameter cap for a single row`
    );
  }

  return Math.min(preferredRows, ceiling);
}
