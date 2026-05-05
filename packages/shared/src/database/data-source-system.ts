import { DataSource, DataSourceOptions } from 'typeorm';
import { Logger } from '@nestjs/common';
import { buildSystemConnectionPreamble, SystemActor } from './system-connection';

/**
 * Phase 5b: Initializes a TypeORM DataSource and attaches a `connect` hook
 * to the underlying node-postgres pool that runs the system preamble on
 * every new connection.
 *
 * Asserts post-init that the role switch succeeded — fails loud if the
 * `perfana_system` role doesn't exist (e.g., migration 1778000000000 hasn't
 * been run).
 */
export async function createSystemDataSource(
  actor: SystemActor,
  opts: DataSourceOptions,
): Promise<DataSource> {
  const logger = new Logger(`SystemDataSource:${actor}`);
  const ds = new DataSource(opts);
  await ds.initialize();

  // node-postgres pool exposed via the driver. Property name is `master` for
  // the main pool (replicas live under `slaves`).
  const driver = ds.driver as unknown as {
    master?: {
      on: (e: string, cb: (c: unknown) => void) => void;
      idleCount?: number;
      end?: () => Promise<void>;
    };
  };
  const pool = driver.master;
  if (!pool || typeof pool.on !== 'function') {
    throw new Error(
      `createSystemDataSource: TypeORM driver does not expose a pg-pool 'on' method. ` +
      `Verify @nestjs/typeorm is using node-postgres (type: 'postgres').`,
    );
  }
  const preamble = buildSystemConnectionPreamble(actor);

  // Hook for future connections — fires when the pool creates a new client.
  pool.on('connect', async (client: unknown) => {
    const c = client as { query: (sql: string) => Promise<unknown>; release: (force?: boolean) => void };
    try {
      for (const stmt of preamble) {
        await c.query(stmt);
      }
    } catch (err) {
      logger.error(
        `system preamble failed for actor=${actor}; destroying connection`,
        err,
      );
      // Force-destroy so the half-configured connection doesn't return to pool.
      c.release(true);
      throw err;
    }
  });

  // Drain any pre-warmed connections — `ds.initialize()` creates `min` pool
  // clients BEFORE the `on('connect')` hook is registered, so those bypass
  // the preamble. We pull each one through a QueryRunner, apply the preamble
  // manually, release. The first checkout also doubles as the role-switch
  // sanity check.
  const preWarmed = pool.idleCount ?? 0;
  const drainCount = Math.max(preWarmed, 1); // always do at least one for the sanity check
  let firstCurrentUser: string | undefined;
  for (let i = 0; i < drainCount; i++) {
    const qr = ds.createQueryRunner();
    await qr.connect();
    try {
      for (const stmt of preamble) {
        await qr.query(stmt);
      }
      if (i === 0) {
        const result = await qr.query(`SELECT current_user`) as Array<{ current_user: string }>;
        firstCurrentUser = result[0]?.current_user;
      }
    } finally {
      await qr.release();
    }
  }
  if (firstCurrentUser !== 'perfana_system') {
    await ds.destroy();
    throw new Error(
      `createSystemDataSource: expected role 'perfana_system' after preamble, got '${firstCurrentUser}'. ` +
      `Did the perfana_system role migration run? See packages/shared/src/database/migrations/1778000000000-CreatePerfanaSystemRole.ts.`,
    );
  }
  logger.log(
    `system data source initialized as perfana_system for actor=${actor} ` +
    `(drained ${drainCount} pre-warmed connection${drainCount === 1 ? '' : 's'})`,
  );
  return ds;
}
