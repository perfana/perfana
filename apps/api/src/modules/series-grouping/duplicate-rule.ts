/** The unique index on a rule's slot (migration 1819). */
export const SERIES_GROUPING_SLOT_INDEX = 'uq_series_grouping_rules_slot';

/**
 * Whether a caught error is Postgres refusing a second rule on the same slot.
 *
 * Reads `code`/`constraint` both off the error and off a nested `driverError`, because TypeORM's
 * `QueryFailedError` and a rethrown driver error carry them in different places (same reasoning
 * as `isDuplicateSloTargetError` in `@perfana/shared/utils`). Only the API writes this table, so
 * the helper stays here (apps/api/CODING_RULES.md, "Turning a constraint violation into a 409").
 */
export function isDuplicateSeriesGroupingSlot(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; constraint?: string; driverError?: { code?: string; constraint?: string } };
  const code = e.code ?? e.driverError?.code;
  const constraint = e.constraint ?? e.driverError?.constraint;
  return code === '23505' && constraint === SERIES_GROUPING_SLOT_INDEX;
}

export const DUPLICATE_SLOT_MESSAGE =
  'A series grouping rule already exists for this panel in this workload. Edit or delete it instead.';
