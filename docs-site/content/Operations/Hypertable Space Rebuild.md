---
tags:
  - operations
  - timescaledb
  - maintenance
---

# Hypertable Space Rebuild

Procedure for retroactively applying the `by_hash('system_under_test', N)` space dimension to the request hypertables (`requests_raw`, `requests_error`, `transactions`) on an **existing** deployment.

> [!warning] When to run this
> Migration `AddSpaceDimensionToRequestHypertables1777300000000` applies the space dimension to **new chunks only**. Existing chunks keep their single-partition layout, and chunk pruning on a SUT filter won't skip them. Run this procedure only if you have measured evidence that old-chunk queries dominate your workload. For most deployments — especially ones with 1–2 dominant SUTs — the fresh-install migration alone is enough.

> [!note] Why the migration may have skipped a table
> On TimescaleDB versions older than 2.13, `add_dimension` is rejected on hypertables that have existing compressed chunks. The migration catches this, logs the failure, and points here. If you want to apply the dimension without a full rebuild, decompress the affected chunks first (`SELECT decompress_chunk(c) FROM show_chunks('requests_raw') c`) or upgrade TimescaleDB to 2.13+. The rebuild procedure below is the general-purpose fallback — it works on any version.

## Prerequisites

- **Maintenance window** — this is an offline procedure. Stop ingestion (`apps/worker`) and block external writers before starting.
- **Disk headroom** — the procedure temporarily holds two copies of each rebuilt hypertable. Verify `pg_size_pretty(hypertable_size('requests_raw'))` × 2 fits available disk.
- **Backup** — take a `pg_dump` of the three tables, or at minimum a TimescaleDB-aware logical backup, before starting.
- **Hash count decision** — pick `N` (default 4; scale toward 8/16 as the SUT count per deployment grows).

### Pre-flight: check SUT distribution before you commit to the rebuild

Space partitioning only helps when SUT load is spread across multiple SUTs. If one SUT dominates, its rows all hash into a single bucket and that SUT sees zero pruning benefit — the rebuild mostly helps the smaller tenants. Run this first:

```sql
SELECT
  system_under_test,
  COUNT(*) AS row_count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS pct_of_total
FROM requests_raw
WHERE time > NOW() - INTERVAL '30 days'
GROUP BY system_under_test
ORDER BY row_count DESC;
```

- If the top SUT holds **> 70%** of recent rows, the rebuild is a marginal win. The dominant SUT's queries see no chunk pruning (all rows in one bucket); only the long-tail SUT queries benefit. Consider whether the maintenance cost is worth it before proceeding.
- If load is spread across **3+ SUTs with none > 50%**, the rebuild is a clear win and the rest of this runbook is the right answer.

## Procedure (per table)

The example below uses `requests_raw`; repeat the same sequence for `requests_error` and `transactions`. Run inside `psql` as a user with table-owner privileges.

### 1. Stop writers

```bash
docker compose stop worker
# or the equivalent supervisor command for your deployment
```

Confirm no active inserts:

```sql
SELECT pid, state, query
FROM pg_stat_activity
WHERE query ILIKE '%requests_raw%'
  AND state = 'active';
```

### 2. Create the rebuilt hypertable

Copy the schema without indexes so step 5 controls index creation explicitly (using `INCLUDING ALL` would copy the old indexes under auto-generated names, leaving duplicates after step 5).

```sql
CREATE TABLE requests_raw_new (
  LIKE requests_raw
    INCLUDING DEFAULTS
    INCLUDING CONSTRAINTS
    INCLUDING STORAGE
    INCLUDING COMMENTS
);

SELECT create_hypertable(
  'requests_raw_new',
  'time',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists => TRUE
);

SELECT add_dimension(
  'requests_raw_new',
  by_hash('system_under_test', 4),  -- or your chosen N
  if_not_exists => TRUE
);
```

### 3. Copy data (batched — do NOT use a single INSERT on large tables)

**Default path: batched copy, one day at a time.** On hypertables bigger than ~10 GB, a single `INSERT ... SELECT` is a production hazard: it generates WAL proportional to the full table (can exhaust replication slots, blow `max_wal_size`, stall replicas, fill the archive), holds a snapshot that blocks autovacuum on every other table for the duration, and if it fails at 99%, everything rolls back.

Loop per-day and check in frequently:

```sql
-- Find the full time range to copy
SELECT MIN(time), MAX(time) FROM requests_raw;

-- Then loop (pseudo-code — run per-day or script the loop in bash/psql):
INSERT INTO requests_raw_new
SELECT * FROM requests_raw
WHERE time >= '2026-03-01' AND time < '2026-03-02';

INSERT INTO requests_raw_new
SELECT * FROM requests_raw
WHERE time >= '2026-03-02' AND time < '2026-03-03';

-- ... continue until the full range is covered ...
```

For partial-day granularity on very large tables, halve the interval until each batch runs in under ~5 minutes. Between batches, watch replication lag (`SELECT * FROM pg_stat_replication`) and disk headroom; pause if either drifts.

**Small-table shortcut (< 10 GB):** a single `INSERT INTO requests_raw_new SELECT * FROM requests_raw` is acceptable. Confirm the size first with `SELECT pg_size_pretty(hypertable_size('requests_raw'))`.

Verify row counts match after the copy completes:

```sql
SELECT
  (SELECT COUNT(*) FROM requests_raw) AS old_count,
  (SELECT COUNT(*) FROM requests_raw_new) AS new_count;
```

### 4. Recreate compression policy

The compression settings on `requests_raw_new` start empty even though the table schema was copied — hypertable-level settings are not inherited by the new hypertable.

```sql
ALTER TABLE requests_raw_new SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'test_run_id, transaction_name',
  timescaledb.compress_orderby = '"time" DESC'
);

SELECT add_compression_policy('requests_raw_new',
  compress_after => INTERVAL '7 days',
  if_not_exists => TRUE
);
```

### 5. Recreate indexes

Hypertable-level indexes also need to be recreated on the new hypertable. Check what exists on the old one:

```sql
SELECT indexdef
FROM pg_indexes
WHERE tablename = 'requests_raw';
```

Re-run each `CREATE INDEX` against `requests_raw_new`. For the composite from migration `1777000000000`:

```sql
CREATE INDEX IF NOT EXISTS idx_requests_raw_new_sut_env_scen_time
ON requests_raw_new (system_under_test, test_environment, scenario_name, "time" DESC);
```

### 6. Swap

Both renames take `AccessExclusiveLock`. If any reader (Grafana dashboard, a stray `psql` session, a metrics-sync job, an accidentally-still-running worker) holds even an `AccessShareLock`, the rename blocks — and once the rename is *queued*, every subsequent reader also blocks behind it. That turns into a cascading outage fast.

**Before running the swap,** check for active readers and terminate them if they're not the app:

```sql
SELECT pid, usename, application_name, state, query_start, left(query, 100) AS query
FROM pg_stat_activity
WHERE query ILIKE '%requests_raw%'
  AND pid <> pg_backend_pid()
  AND state <> 'idle';

-- If non-app connections show up (e.g. Grafana, psql):
-- SELECT pg_terminate_backend(<pid>);
```

Then run the swap with a tight lock timeout so a surprise reader can't hang the whole transaction:

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE requests_raw RENAME TO requests_raw_old;
ALTER TABLE requests_raw_new RENAME TO requests_raw;

-- Rename the composite index to match the post-swap table name
ALTER INDEX idx_requests_raw_new_sut_env_scen_time
  RENAME TO idx_requests_raw_sut_env_scen_time;

COMMIT;
```

If the transaction times out waiting for a lock, it rolls back cleanly — find the blocker in `pg_stat_activity`, terminate it, and retry.

### 7. Verify chunk pruning

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT COUNT(*)
FROM requests_raw
WHERE system_under_test = 'Schatkamer'
  AND time BETWEEN NOW() - INTERVAL '1 hour' AND NOW();
```

In the plan output, look for `Chunks excluded during startup: N` or confirm that only chunks in one hash bucket appear under the `Append` node. If all hash buckets are scanned, the dimension isn't being used — re-check that the `add_dimension` call in step 2 succeeded.

### 8. Drop the old hypertable

Only after the application has been writing to the rebuilt hypertable for long enough to be confident nothing broke (an hour or a day depending on your risk tolerance):

```sql
DROP TABLE requests_raw_old;
```

### 9. Restart writers

```bash
docker compose start worker
```

## Rollback

Before step 8 (`DROP TABLE requests_raw_old`), the rollback is a second rename:

```sql
BEGIN;
ALTER TABLE requests_raw RENAME TO requests_raw_new;
ALTER TABLE requests_raw_old RENAME TO requests_raw;
ALTER INDEX idx_requests_raw_sut_env_scen_time
  RENAME TO idx_requests_raw_new_sut_env_scen_time;
COMMIT;
```

After step 8, recovery is restore-from-backup.

## Adjusting the partition count later

To change `N` after the rebuild without another full rebuild:

```sql
SELECT set_number_partitions('requests_raw', 8, 'system_under_test');
```

`set_number_partitions` affects new chunks only — same trade-off as the original migration.

## Related

- Migration: `packages/shared/src/database/migrations/1777300000000-AddSpaceDimensionToRequestHypertables.ts`
- [[TimescaleDB]] — hypertable overview
- GitHub issue: [perfana#145](https://github.com/perfana/perfana/issues/145)
