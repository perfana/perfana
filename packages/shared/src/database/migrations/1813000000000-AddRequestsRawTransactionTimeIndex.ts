import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Give `requests_raw` an index on (test_run_id, transaction_name, time), and drop
 * `idx_requests_raw_test_run_id_time`, which is an exact duplicate of
 * `idx_requests_raw_test_run_time` — same two columns, opposite sort direction, and
 * btree scans either way.
 *
 * WHY: expanding a transaction row in Performance Analysis took 49 s, all of it in
 * the chain decoration's bounded scan over `requests_raw`. The `LIMIT 5000` bounds
 * nothing, because a transaction can hold 680 rows in a 4 M-row run, so the scan
 * walked every chunk of the hypertable. 19,270 ms / 3.9 M buffers -> 9.6 ms / 601
 * buffers. The full measurement, the plan, and why neither dropping
 * `requests_raw_time_idx` nor `idx_requests_raw_grouping` can serve this live in
 * "The chain decoration on a transaction expand is bounded by an index, not by its
 * LIMIT" in apps/api/CLAUDE.md. Read that before changing the index shape here.
 *
 * Column order is (test_run_id, transaction_name, time): `test_run_id` is also the
 * `compress_segmentby` key, and every query in the repo that filters
 * `transaction_name` filters `test_run_id` too, so the reverse order would help
 * nothing.
 *
 * Net index COUNT on the ingest path is unchanged — but not net index WIDTH. The new
 * index carries a third column averaging ~19 bytes, so its leaf entries are roughly
 * 35-40% larger than those of the 2-column index being dropped, and WAL per insert
 * on this one index rises accordingly. That is the price of the fix, not a free lunch.
 *
 * ── HOW THIS LOCKS, AND WHY IT IS SHAPED LIKE NEITHER 1791 NOR 1807 ──────────────
 * `requests_raw` is the hottest write table in the deployment (~4 M rows for one run,
 * continuous ingest during every test), so 1807's "plain CREATE INDEX, the table is
 * small enough" does not transfer: a plain build SHARE-locks every chunk for the
 * whole build and stalls ingestion for minutes. There is a second, independent reason
 * a single-transaction build is wrong here — see the `max_locks_per_transaction` note
 * in `docker-compose.infra.yml`: this table's 1-day chunks have no retention policy,
 * one statement locks every chunk PLUS its compressed twin, and the lock table is
 * `max_locks_per_transaction x max_connections`. The local stack raises that to 256;
 * a deploy on the Postgres default of 64 hits `out of shared memory` once a few
 * hundred chunks exist.
 *
 * 1791's answer (`COMMIT` then `CREATE INDEX CONCURRENTLY`) is not available either.
 * All four constraints were probed against TimescaleDB 2.28.3, the version production
 * runs:
 *
 *   CREATE INDEX CONCURRENTLY         -> ERROR: hypertables do not support concurrent
 *                                        index creation
 *   WITH (transaction_per_chunk)      -> works, including on compressed chunks
 *   ... inside a transaction block    -> ERROR: cannot run inside a transaction block
 *   DROP INDEX CONCURRENTLY <parent>  -> ERROR: does not support dropping multiple
 *                                        objects (it cascades to every chunk copy)
 *
 * So: `COMMIT` out of TypeORM's transaction, then a per-chunk build, then a plain
 * DROP. Each chunk is locked for its own build only.
 *
 * ── THE PARTIAL BUILD IS SILENT AND SELF-MASKING, WHICH IS WHY assertFullCoverage EXISTS ──
 * This is the trap this migration most needs you to know about, and it is REPRODUCED,
 * not theorised. Holding a conflicting `ROW EXCLUSIVE` lock on the live chunk with
 * `lock_timeout` below the hold time:
 *
 *   1. the statement builds the parent index and 5 of 6 chunks, then fails on the
 *      live chunk with `canceling statement due to lock timeout`;
 *   2. re-running the IDENTICAL statement — the natural response to a failed
 *      migration — prints `NOTICE: relation "..." already exists, skipping` and then
 *      `CREATE INDEX`, i.e. it REPORTS SUCCESS;
 *   3. coverage is unchanged. The live chunk stays permanently uncovered.
 *
 * `IF NOT EXISTS` matches on the parent, so it cannot see that chunks are missing.
 * The uncovered chunk is the live one, which is precisely the chunk the 49 s report
 * was about, so the symptom is that the fix appears to deploy and the slow plan
 * quietly survives for the newest data. `assertFullCoverage` closes this: it compares
 * chunk-level copies against `timescaledb_information.chunks` and throws, naming the
 * uncovered chunks, so a partial build is a hard migration failure instead of a
 * success message. Without it the statement's own exit status is the only signal, and
 * on the retry that signal is a lie.
 *
 * Recovery, which the thrown message states: `DROP INDEX <name>` to remove the parent,
 * then re-run. Not `REINDEX` — there is nothing to reindex on a chunk that has no copy.
 *
 * `lock_timeout` is deliberately session-scoped rather than `SET LOCAL`: this file
 * `COMMIT`s, and `SET LOCAL` dies with that commit, which would leave the build
 * waiting indefinitely behind a long-running read. It is reset in a `finally` because
 * the migration image runs `runMigrations()` with TypeORM's default `transaction:
 * "all"` — see 1796's docblock — so a session `SET` left behind leaks into every later
 * migration in the same deploy batch. (It never reaches an application pool:
 * `migrationsRun` is false everywhere and `perfana-migration` exits when done.)
 *
 * ── THE DROP LOOKS LIKE THE RISKIEST STATEMENT HERE, AND MEASURES OTHERWISE ──────
 * `DROP INDEX` needs ACCESS EXCLUSIVE on `requests_raw` and on every chunk index it
 * cascades to, a mode that conflicts with plain `SELECT`. On paper that makes it the
 * riskiest statement here, because the worker's heavy aggregations budget 540 s and
 * the SUT export streams for GB, and either would block it outright.
 *
 * Measured, it is not the problem it looks like: a probe taking that exact lock on
 * production **while a test was running** reported ACQUIRED after 0.45 ms
 * (2026-10-01). Write transactions on this table are short — a JDBC INSERT was caught
 * `idle in transaction` at 28 ms — so the conflicting windows are brief and the 5 s
 * budget has three orders of magnitude of headroom under live ingest. Do not read the
 * paragraphs below as "expect this to fail"; expect it to succeed, and know what
 * happens if it does not.
 *
 * Three reasons a failure would be acceptable anyway, and why the DROP is LAST:
 *
 *   1. **The user-facing fix is already live** the moment `CREATE INDEX` commits.
 *      A failing DROP delays the removal of a redundant index; it does not delay the
 *      49 s -> 9.6 ms improvement, which `assertFullCoverage` has already verified by
 *      the time the DROP is attempted.
 *   2. **Retry is free and self-healing.** `CREATE INDEX IF NOT EXISTS` skips
 *      instantly, `assertFullCoverage` is a cheap SELECT, and only the DROP is
 *      genuinely retried. A thrown error is never recorded as applied — TypeORM's
 *      `insertExecutedMigration` sits in the `.then()` of `up()`, so a rejection skips
 *      it — which is what makes every later deploy retry this for free.
 *   3. **Raising `lock_timeout` for the DROP would be worse, not better.** Postgres'
 *      lock queue is FIFO, so an ACCESS EXCLUSIVE request that is *waiting* blocks
 *      every new reader behind it. A 30 s timeout here does not buy a 30 s grace
 *      period; it buys a 30 s stall of the hottest table in the deployment. Failing
 *      fast and retrying is strictly cheaper than making the API wait.
 *
 * Not atomic, deliberately: the `COMMIT` means the build lands before the DROP, so a
 * failure between them leaves the new index present and the duplicate still there.
 * Both statements are `IF [NOT] EXISTS` and the coverage assert runs first, so
 * re-running finishes the job. 1791 accepts the same trade.
 *
 * One systemic cost of the `COMMIT` that applies to 1791 as much as to this file, and
 * is written down here because nothing else in the repo says it: under `transaction:
 * "all"` the executor opens ONE transaction for the whole batch, and this statement
 * commits it. From here on every migration later in the same batch runs outside any
 * shared transaction, so the batch loses its all-or-nothing property from this point.
 * TypeORM does not notice — its `isTransactionActive` flag is only moved by the
 * driver's own commit/rollback, never by inspecting raw SQL — so its later bare
 * `COMMIT`/`ROLLBACK` are `WARNING: there is no transaction in progress`, not errors.
 * Nothing breaks, but a migration numbered above this one cannot assume the batch will
 * roll back for it.
 */
const INDEX = 'idx_requests_raw_run_tx_time';
const OLD_INDEX = 'idx_requests_raw_test_run_id_time';

/**
 * Throw unless every chunk of `requests_raw` carries `indexName`.
 *
 * A per-chunk build that dies partway leaves the parent index in place, which makes
 * `IF NOT EXISTS` on a retry a silent no-op — so the statement's own success is not
 * evidence the index is complete. This is the check that is.
 */
async function assertFullCoverage(queryRunner: QueryRunner, indexName: string): Promise<void> {
  const missing: Array<{ chunk_name: string }> = await queryRunner.query(
    `SELECT c.chunk_name
       FROM timescaledb_information.chunks c
      WHERE c.hypertable_name = 'requests_raw'
        AND NOT EXISTS (
              SELECT 1 FROM pg_indexes i
               WHERE i.schemaname = c.chunk_schema
                 AND i.tablename  = c.chunk_name
                 AND i.indexname LIKE '%' || $1
            )
      ORDER BY c.chunk_name`,
    [indexName]
  );
  if (missing.length > 0) {
    const names = missing.map((r) => r.chunk_name).join(', ');
    throw new Error(
      `${indexName} is missing on ${missing.length} chunk(s) of requests_raw: ${names}. ` +
        `The per-chunk build did not finish — most likely it timed out acquiring the lock ` +
        `on a chunk that was being written to. Re-running this migration as-is will NOT ` +
        `repair it: the parent index exists, so CREATE INDEX IF NOT EXISTS reports success ` +
        `and skips. Run "DROP INDEX ${indexName};" and then re-run the migration, ideally ` +
        `outside a test window. Do not REINDEX — a chunk with no copy has nothing to reindex.`
    );
  }
}

export class AddRequestsRawTransactionTimeIndex1813000000000 implements MigrationInterface {
  name = 'AddRequestsRawTransactionTimeIndex1813000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Leave TypeORM's transaction: a per-chunk build cannot run inside one.
    await queryRunner.query(`COMMIT`);
    await queryRunner.query(`SET lock_timeout = '5s'`);
    try {
      await queryRunner.query(
        `CREATE INDEX IF NOT EXISTS ${INDEX}
           ON requests_raw USING btree (test_run_id, transaction_name, "time")
           WITH (timescaledb.transaction_per_chunk)`
      );
      // The statement above can report success on a retry while chunks are still
      // missing. This is what actually proves the index is complete.
      await assertFullCoverage(queryRunner, INDEX);
      // Exact duplicate of idx_requests_raw_test_run_time, which stays. Plain DROP:
      // CONCURRENTLY cannot drop a hypertable's parent index.
      await queryRunner.query(`DROP INDEX IF EXISTS ${OLD_INDEX}`);
    } finally {
      await queryRunner.query(`SET lock_timeout = DEFAULT`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`COMMIT`);
    await queryRunner.query(`SET lock_timeout = '5s'`);
    try {
      await queryRunner.query(
        `CREATE INDEX IF NOT EXISTS ${OLD_INDEX}
           ON requests_raw USING btree (test_run_id, "time" DESC)
           WITH (timescaledb.transaction_per_chunk)`
      );
      // Same silent-partial-build risk on the way back.
      await assertFullCoverage(queryRunner, OLD_INDEX);
      await queryRunner.query(`DROP INDEX IF EXISTS ${INDEX}`);
    } finally {
      await queryRunner.query(`SET lock_timeout = DEFAULT`);
    }
  }
}
