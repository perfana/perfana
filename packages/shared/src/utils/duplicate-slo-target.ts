/**
 * `uq_benchmarks_active_metric_target` (migration 1812) refuses a second **enabled** SLO that
 * targets the same panel, series and aggregation as one that already exists — two of those
 * produce check results a reader cannot tell apart.
 *
 * This lives in `@perfana/shared` because `benchmarks` has more than one writer and they have
 * to agree about what a 23505 on this index means:
 *
 * - **apps/api** (`BenchmarkMutationService`) turns it into a 409 on create/update and counts
 *   it as `skipped` in a bulk copy.
 * - **apps/grafana-sync** (`AutoConfigUpdatesService`) provisions profile-derived SLOs, and
 *   its existence probe keys on `generic_check_id`, which a manually-created SLO never has.
 *   So a profile SLO landing on a panel that already carries an enabled manual SLO is
 *   invisible to that probe and arrives here instead. Without this guard the sweep throws and
 *   one collision aborts provisioning for the whole dashboard — the same shape as the
 *   v0.2.89.0 "one rejected dashboard aborts the sweep" bug.
 *
 * Keep the name in one place: a copy that drifts silently stops matching and the guard
 * degrades to an opaque failure at whichever call site went stale.
 */
export const DUPLICATE_TARGET_INDEX = 'uq_benchmarks_active_metric_target';

/**
 * Whether a caught error is Postgres refusing a duplicate SLO target.
 *
 * TypeORM's `QueryFailedError` copies the driver's own properties onto itself, so `code` and
 * `constraint` are normally own properties — but a raw driver error can surface nested under
 * `driverError`, and a repository that rethrows can hand back either shape. Reading both
 * costs two `??` and removes a class of silent misses.
 */
export function isDuplicateSloTargetError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as {
    code?: string;
    constraint?: string;
    driverError?: { code?: string; constraint?: string };
  };
  const code = e.code ?? e.driverError?.code;
  const constraint = e.constraint ?? e.driverError?.constraint;
  return code === '23505' && constraint === DUPLICATE_TARGET_INDEX;
}

/** What the API tells a user whose SLO was refused. */
export const DUPLICATE_TARGET_MESSAGE =
  'An enabled SLO for this panel already evaluates the same series with the same aggregation. ' +
  'Change its match pattern, its aggregation, or disable the existing one.';
