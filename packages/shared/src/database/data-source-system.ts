import { DataSource, DataSourceOptions } from 'typeorm';
import { Logger } from '@nestjs/common';
import { SystemActor } from './system-connection';

/**
 * Phase 5b: Initializes a TypeORM DataSource where every connection enters
 * the pool already switched to `perfana_system` and carrying the four GUCs
 * that `is_global_admin()` reads — applied via the libpq `options` startup
 * parameter. Postgres processes these from the StartupMessage BEFORE the
 * connection is handed to the client, so the very first query on every
 * connection sees the correct session state.
 *
 * Asserts post-init that the role switch succeeded — fails loud if the
 * `perfana_system` role doesn't exist (created by ConsolidatedSchema Phase 2).
 *
 * History: this used to install a `pool.on('connect', cb)` listener that
 * issued the same statements via `client.query()`. pg-pool emits 'connect'
 * synchronously and does NOT await async listeners, so the listener's
 * `SET ROLE` would queue, the caller's first query would queue next, and
 * the `set_config` calls would queue last — leaving a window where a SELECT
 * ran as `perfana_system` (no BYPASSRLS) without any super-admin GUC, so
 * RLS filtered every row. Moving the setup to startup options eliminates
 * the race entirely.
 */
export async function createSystemDataSource(
  actor: SystemActor,
  opts: DataSourceOptions,
): Promise<DataSource> {
  const logger = new Logger(`SystemDataSource:${actor}`);

  const startupOptions = [
    `-c role=perfana_system`,
    `-c app.current_user_id=system:${actor}`,
    `-c app.current_user_roles=["super-admin"]`,
    `-c app.current_user_organizations=[]`,
    `-c app.current_user_teams=[]`,
  ].join(' ');

  const optsWithStartup: DataSourceOptions = {
    ...opts,
    extra: {
      ...((opts as { extra?: Record<string, unknown> }).extra ?? {}),
      options: startupOptions,
    },
  };

  const ds = new DataSource(optsWithStartup);
  await ds.initialize();

  const result = (await ds.query(`SELECT current_user`)) as Array<{ current_user: string }>;
  const currentUser = result[0]?.current_user;
  if (currentUser !== 'perfana_system') {
    await ds.destroy();
    throw new Error(
      `createSystemDataSource: expected role 'perfana_system' at session start, got '${currentUser}'. ` +
      `Is the ConsolidatedSchema migration applied? It creates the perfana_system role in Phase 2.`,
    );
  }
  logger.log(`system data source initialized as perfana_system for actor=${actor}`);
  return ds;
}
