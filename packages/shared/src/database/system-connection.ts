/**
 * Phase 5b: SQL preamble that switches a Postgres connection to the
 * `perfana_system` role and populates the four GUCs that
 * `is_global_admin()` reads. Used by every non-API process (worker,
 * grafana-sync, perfana-report) on every pool checkout.
 *
 * The preamble uses session-scope `set_config(..., false)` (NOT LOCAL)
 * so the GUCs persist for the connection's lifetime — system processes
 * don't transaction-wrap every job. When the connection returns to the
 * pool, the next checkout re-runs the preamble (idempotent).
 *
 * `app.current_user_roles = '["super-admin"]'` causes `is_global_admin()`
 * to return TRUE inside RLS policies, short-circuiting all `can_access`
 * and `can_modify` checks. The role identity (`system:<actor>`) flows
 * into audit rows via 5a's `actorOverride` plumbing.
 */
export type SystemActor =
  | 'worker'
  | 'grafana-sync'
  | 'perfana-report'
  | 'audit-partition-manager';

export function buildSystemConnectionPreamble(actor: SystemActor): string[] {
  return [
    `SET ROLE perfana_system`,
    `SELECT set_config('app.current_user_id', 'system:${actor}', false)`,
    `SELECT set_config('app.current_user_roles', '["super-admin"]', false)`,
    `SELECT set_config('app.current_user_organizations', '[]', false)`,
    `SELECT set_config('app.current_user_teams', '[]', false)`,
  ];
}
