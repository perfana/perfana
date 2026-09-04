# TODOS

Cross-PR follow-up work. Items here are real backlog — captured because
they came up during a planning or review session and shouldn't get lost,
but aren't tied to a single in-flight PR. Format: one entry per item with
priority (P0–P4), origin, and enough context that someone picking it up in
3 months can act without re-deriving the motivation.

When an item ships, move it to the `## Completed` section at the bottom
with the version it landed in.

---

## RBAC

### Schema changes reach new databases only, and the code assumes otherwise

**Priority:** P3 (was P0 — part 1 shipped in v0.2.75.0; what is left is the dead-code cleanup at the bottom)
**Origin:** the 0.2.68.7 incident — "deploying the last version deleted all application
dashboards" (2026-08-21). Nothing was deleted.
**Status:** parts 2 and 3 are built (v0.2.68.14) — `assertEntityColumns` at boot and
`scripts/check-entity-migrations.mjs` in preflight. v0.2.72.0 closed the known example:
`1796000000000-BackfillOwnedResourceOrgIds` backfills and constrains `organization_id` on
`check_results`, `ds_metric_collection_status` and `ds_compare_config` (state-blind, fail-loud),
and every writer now stamps organization_id + team_id. Part 1, the general constraint audit,
shipped in v0.2.75.0 as `scripts/check-schema-constraints.mjs` — see below. The outage itself is fixed by
`1795000000000-AddApplicationDashboardDeletionStatus.ts` (v0.2.68.12). An automatic
organization_id backfill shipped in 0.2.68.11 and was removed in .13 — it addressed a different,
unreported condition and would have rewritten millions of rows during start-up.
**Why:** Phase 4 declared `organization_id` NOT NULL on the owned-resource tables, but only
inside `1700000000000-ConsolidatedSchema.ts`, which runs on a FRESH database. No migration ever
carried the constraint or the backfill to an existing one. Code was then written against the
declaration — v0.2.68.7 deleted ~35 `OR organization_id IS NULL` escapes because "the column
cannot be null" — and every deployment older than the consolidated schema lost the rows from
every list. The premise was true in dev and false in production, which is the worst shape a
premise can have. Any future "this column cannot be null, delete the dead branch" cleanup
repeats it, and so does any other constraint that lives only in the consolidated schema.
**It has now caused a production outage, not just a theory.** `application_dashboards.deletion_status`
(v0.2.68.7) landed in the consolidated schema alone. The entity declares it, TypeORM names every
declared column in its SELECT, and an existing database does not have it — so the dashboard list
query failed on the first request after the upgrade, and `useDashboardManagement.ts` turned the
failure into `setDashboards([])`: an empty list, no error on screen, every SUT, plus the compare
card. Fixed by `1795000000000-AddApplicationDashboardDeletionStatus.ts`, but only after the
column had been missing in production for a full release.

**What:** three parts.

1. **DONE (v0.2.75.0) — audit the constraints.** `scripts/check-schema-constraints.mjs`
   (`npm run check:schema-constraints`) diffs any database against a freshly migrated one and
   reports every missing NOT NULL, CHECK, UNIQUE, PRIMARY KEY, FOREIGN KEY and unique index,
   emitting the `ALTER TABLE` for each — and, for a NOT NULL, how many rows in the target would
   violate it, which is the whole apply/backfill decision. Read-only against both databases.

   ```bash
   # 1. build the reference: every migration, on an empty database
   createdb perfana_ref
   DB_NAME=perfana_ref npm run migration:run
   # 2. diff your deployment against it
   npm run check:schema-constraints -- \
     --target postgres://user:pass@prod-host:5432/perfana \
     --reference postgres://user:pass@localhost:5432/perfana_ref
   ```

   **The enumeration this item asked for, measured 2026-08-23 against a fresh database:**
   76 FOREIGN KEY + 76 PRIMARY KEY + 29 UNIQUE + 3 CHECK constraints and 586 NOT NULL columns —
   770 constraint facts, of which exactly **one** incremental migration carries any to an existing
   database (`1796000000000-BackfillOwnedResourceOrgIds`, 3 NOT NULLs on 3 tables). So the honest
   answer is that essentially the entire constraint surface reaches new databases only, and the
   response cannot be "write 770 migrations" — it has to be a tool the operator runs against the
   database that actually has the history. That is what shipped.

   Validated by pointing it at a database built from `schema-sql.ts` alone: it independently
   reports exactly the three `organization_id` columns migration 1796 exists to fix, plus a
   deliberately dropped FK and unique index. A database and its own reference report nothing.

   Not wired into `preflight`: it needs two live databases, and the one it must see is the
   deployment's, which CI does not have.

2. **DONE (v0.2.68.14) — boot assertion.** `apps/api/src/common/db/assert-entity-columns.ts`
   compares TypeORM's entity metadata against `information_schema` on whatever database the
   service is pointed at, and reports what is missing. Warns by default; `SCHEMA_DRIFT_CHECK=strict`
   refuses the boot. Warn is the default because a false positive that takes the API down on a
   healthy database trades a silent bug for a self-inflicted outage — and the log line alone
   turns this incident's day into a minute.

3. **DONE (v0.2.68.14) — pre-ship gate.** `scripts/check-entity-migrations.mjs`, wired into
   `npm run preflight`: adding an `@Column` in a branch with no new migration file fails, naming
   the column.

   **The check this item originally proposed would NOT have caught the bug.** "Compare entity
   metadata against a database migrated from scratch" passes, because a database migrated from
   scratch is built from the consolidated schema and therefore HAS the new column. Only an
   existing database lacks it. That is the whole shape of this failure, and it is why the two
   checks that shipped are a diff gate and a check against the live database rather than against
   a fresh one. Verified by running the gate against `deeb3990`, the commit that caused the
   incident: it fails, naming `application-dashboard.entity.ts → deletion_status`.

**Left over from the backfill:** resolved for three of the four tables in v0.2.72.0 —
`ds_metric_collection_status` inherits via its `test_runs` FK, and `check_results` /
`ds_compare_config` / `ds_metric_collection_status` are NOT NULL on both greenfield (Phase 6)
and existing databases (1796).

`ds_change_points` — **the backfill question is moot** (checked 2026-08-23 against the running
deploy): the column is already `NOT NULL` there, and the table holds 0 rows, so there is nothing
to backfill and no owner call to make. What is actually left is dead code:

- `ControlGroupsPipeline.ts:375` `(cp.organization_id = $5 OR cp.organization_id IS NULL)` and
  `:449` (the same escape on `test_runs`) can never match — both columns are NOT NULL.
  `ControlGroupStatisticsPipeline.ts` carries 8 more of the same shape on `application_dashboards`
  (also NOT NULL) and the Dynatrace query table.
- The only writers of `ds_change_points` anywhere are two worker integration tests
  (`control-groups-pipeline`, `adapt-pipeline`), and their `INSERT` omits `organization_id`. Against
  a Phase 4-shaped database that INSERT violates the NOT NULL constraint, so those cases only pass
  where the test database is older than the constraint. Worth confirming before the next time
  someone trusts them.

P3 cleanup, no data risk either way.

---

### Run the cold-cache p99 benchmark for `/api/users/me/permissions`

**Priority:** P3
**Origin:** /plan-eng-review on `docs/superpowers/plans/2026-04-27-rbac-completion.md` (2026-04-28).
**Status:** the harness landed in v0.2.68.4 —
`apps/api/scripts/bench-me-permissions.mjs`, no dependencies, exits non-zero when it
misses the criterion. What is still owed is the **measurement**, which needs a fixture
the local dev DB does not have.
**Why:** the endpoint parallelises per-org capability lookups with `Promise.all` and uses
a versioned cache key (never `redis.keys()`). Both should keep p99 at one round trip
regardless of org count — reasoned, never measured. For a user with 20+ orgs (a realistic
admin or support account) a regression would quietly add hundreds of ms to session start,
on the path every page load waits for.
**What:** seed a user into 20 organizations, flush `auth:*` from Redis, then
`PERFANA_TOKEN=<bearer> node apps/api/scripts/bench-me-permissions.mjs`.
Pass criterion (already encoded in the script): cold p99 < 200ms, warm p99 < 30ms.

---

---

### Nothing at runtime can create a table, so anything time-shaped must ship with the schema

**Priority:** P3
**Origin:** the empty-audit-trail bug (v0.2.73.0, 2026-08-23).
**Status:** the instance is fixed — `audit_logs` has a DEFAULT partition and retention is a
DELETE. The general rule is not enforced anywhere.
**Why:** `AuditPartitionManager` was written when the worker connected as the database owner.
Phase 5b moved every worker connection to `perfana_system`, which holds `USAGE` but not `CREATE`
on schema `public` and owns no table, so both of its jobs — create next month's partition, drop
the expired one — had been failing since that deploy. Nobody noticed for months because the
failure surfaced as one ERROR line a day and an empty table, and an empty audit table looks
exactly like a quiet system. Any future design that assumes a background job can issue DDL has
the same shape.
**What:**
1. Two leftovers to sweep once their rows age out (or now, as owner): `audit_logs_2026_05..07`
   are empty ranges that exist only because the consolidated dump was taken while they did.
   `DROP TABLE` as `perfana` whenever convenient; nothing reads them, the consolidated schema
   no longer names them (it drives RLS off `pg_inherits`), and the coverage snapshot excludes
   `audit_logs_YYYY_MM` by design, so dropping them breaks no test.
2. Do NOT re-create monthly partitions casually. A new partition does not inherit the parent's
   RLS — it comes out readable by any role holding the schema-wide grant — and ATTACH has to
   full-scan `audit_logs_default` under ACCESS EXCLUSIVE now that it holds every row.
3. If another partitioned table appears, it needs a DEFAULT partition in the consolidated schema
   and RLS on every partition. `rls-policy-coverage.snapshot.spec.ts` asserts both for
   `audit_logs` by shape (every partition RLS+FORCE with no policies of its own, and at least
   one DEFAULT); a new partitioned table needs its own equivalent.
4. Consider a boot-time assertion in the worker: if the connection's role cannot `CREATE` in
   `public`, say so once at startup rather than once per scheduled DDL attempt. Same family as
   "Fail fast when the API's DB role cannot bypass RLS" in Completed.

---

## Grafana dashboards

### A 412 on a referenced dashboard is a second, untouched restore loop

**Priority:** P2
**Origin:** Adversarial review during /ship on
`fix/grafana-dashboard-restore-loop-and-delete-conflict` (2026-08-30), which fixed the
placeholder restore loop but not this one.
**Why:** `RestoreDashboardService.restoreDashboard` treats a 412 from Grafana as "this
dashboard cannot come back" and drops the row with
`this.grafanaDashboardRepo.remove(dashboard)`. But
`application_dashboards.grafana_dashboard_id` is `ON DELETE NO ACTION`, so for any
dashboard that is actually referenced that remove raises 23503. The error is caught and
logged, the row survives, it is still missing from Grafana, and the next cycle tries
again — the same every-30-seconds loop v0.2.89.0 closed for placeholders, reached by a
different door. The API half of that release grew a 23503 guard; grafana-sync did not.
**Why it is P2 and not P1:** it needs Grafana to answer 412, which the placeholder rows
never reached (they were refused earlier, for missing JSON). No occurrence has been
observed in a live log. It is latent, not active.
**What to do:** decide what "cannot restore and cannot drop" should mean. Deleting the
referencing `application_dashboards` is wrong for the same reason the API refuses to
cascade — Grafana dashboards are shared. Most likely: catch 23503 around the remove, mark
the row so the sweep stops reconsidering it, and surface it once rather than every cycle.

### `concurrency: 1` deletion queues are per-process, not per-cluster

**Priority:** P3
**Origin:** Adversarial review during /ship on `fix/queue-grafana-dashboard-batch-delete` (2026-08-15).
Re-examined during /ship on `fix/queue-and-socket` (2026-08-20) and deliberately left open.
**Why:** Both deletion processors run their BullMQ `Worker` inside the API process with
`concurrency: 1`, which is what stops the hypertable cascades from deadlocking each other. That
guarantee holds only while exactly one API process exists — scale to N replicas and effective
concurrency becomes N, silently restoring the deadlocks the queue was built to prevent.
**Current state:** no replica count is configured anywhere in the repo (`docker-compose*.yml` sets
`deploy:` only on infra services), so the assumption holds today. That is what makes it a P3 and
not a P2 — and also what makes it easy to break without noticing.
**What:** Two real options, and one false one.
- Move both workers into the worker app, which is one replica by design. Largest change,
  smallest ongoing risk.
- Take a Redis `SET NX PX` lock around the delete, so concurrency stays 1 cluster-wide.
  Small diff, but it is deadlock-sensitive code and needs a multi-process test to be worth
  trusting — do not land it on a green unit suite alone.
- **Not** a heartbeat/registry that merely *detects* multiple workers: `redis.keys()` is banned
  here for good reason, a TTL-based set is more moving parts than the lock it replaces, and
  detection after the fact still leaves the deadlock.
**Where:** `apps/api/src/modules/grafana/processors/application-dashboard-deletion.processor.ts`
(~line 112), `apps/api/src/modules/test-runs/processors/test-run-deletion.processor.ts` (~line 155).

---

## Worker pipeline

### Four reevaluate stages render as raw ids in the progress UI

**Priority:** P3
**Origin:** red-team review during /ship on `fix/analyze-unknown-stage` (2026-08-23).
**Why:** `simple-orchestrate-reevaluate-batch.ts:279` pushes `gap-analysis`, `gap-filling`,
`force-refetch` and `statistics-recalculation` into its progress list and none of the four is in
`PIPELINE_STAGES` (`packages/shared/src/types/job-progress.types.ts`). `getStageName` falls
through to the raw id, so the UI reads "Stage 2 of 5: gap-filling". Same registry-mismatch class
as the data-sanity-check bug fixed in v0.2.74.0, one layer up.
**What:** add the four ids with human names, and type both workers' progress lists against the
registry so an unregistered id is a compile error rather than an ugly label.

---

### The data sanity check still runs after the pipeline aborts

**Priority:** P3
**Origin:** adversarial + red-team review during /ship on `fix/analyze-unknown-stage` (2026-08-23).
**Why:** under `errorHandling: 'abort'` a failure at, say, `metrics-collection` breaks the stage
loop, and `analyze.ts` then runs `DataSanityCheckPipeline` over a half-collected run and writes
its verdict unconditionally. Re-running an analysis during a Grafana outage can downgrade a
previously-good run to `valid=false` with reasons that blame data quality for an infrastructure
abort.
**What:** skip the check when `result.success` is false, or record the verdict with a qualifier
saying the pipeline did not finish.

---

### The worker has no RLS context and relies on its DB role holding BYPASSRLS

**Priority:** P3
**Origin:** the v0.2.93.1 investigation into a `control-group-statistics` statement timeout
(2026-09-02). The Postgres error context was
`where: 'PL/pgSQL function can_access_resource(uuid,uuid,text) line 4 at RETURN'` — proof that
RLS policies were being evaluated on a worker connection.
**Why:** unlike the API, the worker never runs `SET LOCAL ROLE perfana_app` and never sets the
four `app.current_*` GUCs — it has no `RlsTransactionInterceptor` equivalent. Its queries touch
`test_runs`, `application_dashboards` and `dynatrace_queries`, all of which are
`FORCE ROW LEVEL SECURITY`, so being the table owner is not enough: only a superuser or a role
with `BYPASSRLS` escapes them. Locally `DB_USERNAME=perfana` is `rolsuper=t rolbypassrls=t`, so
nothing surfaces. Deploy the worker under a least-privilege role — the normal shape on managed
Postgres, where the application user owns the tables but is not superuser — and
`can_access_resource` returns FALSE for every row, because with no GUCs set
`is_global_admin()` is false and `current_user_organizations()` is empty.
**Symptom if it happens:** not an error. `ds_control_group_statistics` comes out empty and ADAPT
reports INSUFFICIENT_DATA against a baseline that is fine — the same misleading message the
missing-`pct_agg` cause produces, so it will be misdiagnosed. Metrics collection would degrade
the same silent way.
**What to do:** either assert at worker boot that the connection can read a known
`application_dashboards` row (fail loud, the way `assertEntityColumns` does), or give the worker
a real RLS context under `perfana_system`. This is the worker-side twin of the API-key
deployment constraint already documented in CLAUDE.md; nothing enforces either yet.

### `all_missing` / `pct_missing` are structurally unreachable

**Priority:** P4
**Origin:** adversarial review during /ship on `fix/statistics-lateral-last-value` (2026-09-02).
**Why:** in `StatisticsPipeline`, `metrics_filtered` already applies `AND m.value IS NOT NULL`, so
`n_missing` (`COUNT(CASE WHEN value IS NULL THEN 1 END)`) is always 0. Everything derived from it
is therefore constant: `all_missing` (`sa.count = sa.n_missing`) is always false, and
`pct_missing` / `missing_percentage` are always 0.0. Confirmed across all 58,319 rows currently in
`ds_metric_statistics`.
**Why it matters:** CLAUDE.md and the pipeline's own docblock describe `all_missing` as "every
observation in the group is NULL … ADAPT labels these incomparable", which is behaviour that
cannot occur. Anyone reasoning about missing-data handling from those docs is reasoning about a
dead branch.
**What to do:** decide which is true — either the columns are vestigial and should be dropped from
the INSERT along with their docs, or missing-data really should be counted, in which case the
count has to happen before the NULL filter rather than after it.

### The stale-`ramp_up` pre-check scans every `ds_metrics` chunk ever created

**Priority:** P3
**Origin:** performance specialist during /ship on `perf/statistics-aggregation-timeouts` (2026-09-02).
**Why:** `findRunsWithStaleRampUpFlags` joins `ds_metrics` with no predicate on `time`, so the
planner gets no chunk exclusion and considers every chunk of the hypertable for the run. On a
deploy with years of retention that is thousands of chunk-planning steps before a row is read, and
v0.2.93.3 made it worse by replacing the early-exit `EXISTS` with an unconditional `MIN/MAX`
aggregate that runs on every statistics job.
**What to do:** bound it with `AND m.time >= tr.start_time - <margin> AND m.time <= tr.end_time +
<margin>`. Confirm first that no collected sample legitimately lands outside the run window — a
trailing scrape excluded by the bound would keep its stale flag forever — and take the margin from
the collector's step, not zero.

### `StatisticsPipeline.test.ts` repeats the same four-line mock chain 35 times

**Priority:** P4
**Origin:** maintainability specialist during /ship on `perf/statistics-aggregation-timeouts` (2026-09-02).
**Why:** every test builds the aggregation mock chain inline, so adding or removing one query in
the pipeline is a 35-site hand edit — paid twice already in v0.2.93.3 (dropping the expected-rows
count, then adding `set_config`). The file already has the right abstraction: `aggregationMocks()`,
used by only the handful of tests in the `ramp_up refresh` describe block.
**What to do:** hoist `aggregationMocks()` to the top-level describe, parameterised on the deleted
and actual counts, and replace the inline copies. Pure test refactor, no behaviour change.

### `StatisticsPipeline` reads 34 GB per run — estimate half done, scan half open

**Priority:** P3 (was P2 — the estimate half shipped in v0.2.94.6)
**Origin:** performance investigation following /ship on `perf/adapt-disable-jit` (2026-09-04).
**Why:** recalculating statistics for one 20,598-metric run measured 157 s, reading 4,171,222 blocks
(~34 GB) and spilling 5.2 GB of temp. Two independent causes:

1. **A 408x group-count misestimate forces a disk sort.** 8,404,581 estimated groups against 20,598
   actual. The planner sizes the hash table off that, picks a sort, and spills. `work_mem` cannot
   fix it — the choice is made on the estimate.
2. **A 33 GB seq scan of the uncompressed chunk.** `_hyper_1_113_chunk` held 82.5 M rows over 7 days;
   the run's 20.65 M are 25% of it and scattered (`correlation` on `test_run_id` -0.027, because
   concurrent runs interleave). At that selectivity a seq scan is correct and no index helps.

**DONE in v0.2.94.6** for cause 1 (`1801000000000-AddDsMetricsGroupKeyStatistics`): one
`CREATE STATISTICS (ndistinct)` on the `ds_metrics` **parent** plus a daily `ANALYZE` job. Measured
on the real join-bearing query: estimate 741,991 -> 21,372 against 17,882 actual. An earlier draft
put the objects on chunks and was provably inert on that query — the joins block chunkwise
aggregation, so the estimate is made at the parent. See CLAUDE.md.

**Still to verify on production:** that the `external merge Disk:` sort actually disappears. The
estimate is fixed and measured, but the resulting plan switch was only ever inferred, and a dev
database reproduces the estimate and not the spill.

**Still open — the 33 GB scan (cause 2).** No code fix; it self-heals when the chunk compresses
(`compress_after` 7 days). Only runs 0-14 days old are affected, since `chunk_time_interval` is also
7 days so two chunks are uncompressed at any time.

**Explicitly ruled out:** adding a time bound (`m.time BETWEEN tr.start_time AND tr.end_time`).
Measured — identical `Rows Removed by Filter` (61,890,539) and 9 s *slower*. `test_run_id = X`
already selects exactly the run's rows. NOTE: that measurement was taken under 7-day chunks, where
the run sits inside one chunk and exclusion buys nothing. If the chunk interval is ever reduced,
re-measure — the conclusion does not carry over.

**Scope:** the pipeline runs only in `force` / `missing-data` refresh modes, gated on
`testRunsWithNewData > 0` (`simple-orchestrate-reevaluate-batch.ts:516,719`). A plain re-evaluate
never pays it.

### Decide whether to reduce `ds_metrics` chunk_time_interval from 7 days

**Priority:** P3
**Origin:** split out of the v0.2.94.6 work after adversarial review (2026-09-04).
**Why:** the active chunk was 79 GB / 82.5 M rows against `shared_buffers` of 4 GB, giving a 4.4%
buffer hit ratio (194,290 hits vs 4,171,222 reads) on the aggregation scan. Smaller chunks are the
only lever that reduces how much has to be read, since the run's rows are scattered and no index
helps. 1 day would give ~11 GB chunks at the measured ~11.3 GB/day, a ~7x smaller scan.

**Why it was NOT shipped with the statistics fix:**
- **Unbounded growth.** There is no retention policy on `ds_metrics` (the only `add_retention_policy`
  calls are 90 days on the 15 CAGGs). 7 days -> 1 day takes ~52 chunks/year to ~365, each with its
  indexes and compressed counterpart. `max_locks_per_transaction` is at the default 64.
- **No query can exclude chunks.** The hot `ds_metrics` paths all filter on `test_run_id` with no
  time predicate (`StatisticsPipeline`, `metrics.service.ts` panel render,
  `DataSanityCheckPipeline`, `PerformanceTestMetricsPipeline` DELETE, the reevaluate orchestrator,
  the SUT delete handler), so every one plans and locks every chunk. Planning cost was never
  measured.
- **Background workers are already starved.** ~36 TimescaleDB jobs against a default
  `timescaledb.max_background_workers` of 16, and the compression policy already logs 21
  `failed to start job`. 1-day chunks multiply compression-policy invocations 7x.
- **It is a one-way ratchet.** A revert restores the setting, not the chunks it created.

**What to do:** measure planning time on the panel-render path across a few hundred chunks before
changing anything, and pair any reduction with a retention policy and a `max_background_workers`
raise. The genuine win on the other side: `decompressChunksForRange` and the per-run bounded ramp-up
`UPDATE` both get *better* with narrower chunks (less collateral decompression).

### The 2.5M ADAPT plan cost that triggers JIT may be an ANALYZE artifact

**Priority:** P3
**Origin:** adversarial review during /ship on `perf/adapt-disable-jit` (2026-09-04).
**Why:** `jit=off` in `AdaptPipeline` treats the symptom. The reason JIT fired at all is the
estimated plan cost of 2,561,177, and that estimate may be manufactured: `createTempConfigCache`
(`apps/worker/src/pipelines/helpers/adapt/compare-config-cache.ts`) creates and populates
`temp_config_cache` with no index and no `ANALYZE`, and `buildAdaptResultsSQL`
(`helpers/adapt/results/sql-builder.ts`) LEFT JOINs it four times. A table with no statistics
joined four ways is a standard way to inflate a cost estimate.
**What to do:** add `ANALYZE temp_config_cache` after the populate and re-`EXPLAIN`. If the cost
drops below `jit_above_cost` (100,000 on the deploy measured), the `jit=off` line becomes a
no-op belt-and-braces rather than the fix. Note what is ALREADY known: indexing + ANALYZE does
*not* speed up the join itself — measured 150 ms vs 176 ms on a standalone repro, the planner
hash-joins it fine either way. The open question is only whether it changes the COST ESTIMATE,
which was never tested. Three of the four joins are also dead on current data (metric-level and
dashboard-level configs are 0 rows, and `cfg_global` can never match because
`createTempConfigCache` skips the `global` and `default` keys) — worth deleting regardless.

### The ADAPT upsert rewrites every result row even when nothing changed

**Priority:** P3
**Origin:** performance investigation during /ship on `perf/adapt-disable-jit` (2026-09-04).
**Why:** with JIT disabled the `ds_adapt_results` upsert is still ~8s of the ~13s ADAPT statement.
`EXPLAIN (ANALYZE, BUFFERS)` on a 20,598-metric run reports `Tuples Inserted: 0`,
`Conflicting Tuples: 20598`, `width=4080` — every re-evaluate rewrites the whole result set as
UPDATEs, ~84 MB of wide jsonb, at ~94 buffers per row. `ds_adapt_results` is 975 MB for 161,661
rows (6.3 KB/row), so the jsonb columns are TOASTed and each row update touches several pages plus
three index updates. Re-evaluating a run whose inputs are unchanged does the same work as the first
evaluation.
**What to do:** measure first — how many rows actually change value on a typical re-evaluate. If it
is a small fraction, add a `WHERE` clause to the `DO UPDATE` (`ds_adapt_results.conclusion IS
DISTINCT FROM EXCLUDED.conclusion OR ...`) so unchanged rows are skipped. Note that `checks`,
`thresholds` and `conditions` are regenerated jsonb and may not compare equal even when
semantically identical; compare the fields that matter, not the whole row. Also worth pricing:
several of the stored jsonb columns are derivable and may not need storing at all.

### The ADAPT trigger fires twice per upserted row

**Priority:** P4
**Origin:** performance investigation during /ship on `perf/adapt-disable-jit` (2026-09-04).
**Why:** `auto_mark_fresh_on_analysis` is `BEFORE INSERT OR UPDATE ... FOR EACH ROW` on
`ds_adapt_results`. `ON CONFLICT DO UPDATE` runs the BEFORE INSERT trigger, then the BEFORE UPDATE
trigger, so a 20,598-row upsert fires it 41,196 times — measured at 676 ms with JIT off (3,245 ms
with JIT on, since its expressions were being compiled too). Small next to the upsert itself, but
it scales with the same row count and is pure overhead on the insert half, whose `NEW.is_stale =
false` assignment the update half immediately redoes.
**What to do:** low value on its own; fold into the upsert work above, since skipping unchanged
rows removes most of these calls for free.

### A rollup job stuck in BullMQ's failed set silences the read-path repair

**Priority:** P3
**Origin:** /ship review on `fix/sampler-rollup-empty-repair` (v0.2.94.2, 2026-09-03).
**Why:** `repairEmptySamplerRollup` re-enqueues `transaction-stats-rollup` under a fixed jobId so
repeated row expands coalesce into one job. If that job exhausts its retries it stays in the failed
set under the same id, and every later `add` is a silent no-op — the run keeps serving row expands
from the CAGG path (95 ms warm / 737 ms cold against 0.95 ms) with nothing in the log saying the
repair stopped firing. The `statistics-calculation` escape hatch has the same shape and solved it by
not retaining the job record after it settles.
**What to do:** either drop the failed job record when the repair re-enqueues (matching
`enqueueStatisticsCalculation`), or log at warn when the probe says repairable and `queue.getJob`
finds an existing failed job, so the state is visible instead of silent.
**Where:** `apps/api/src/modules/test-runs/services/test-runs-performance-query.service.ts`
(`repairEmptySamplerRollup`) and `apps/api/src/modules/data-science/services/bullmq-client.service.ts`
(`enqueueTransactionStatsRollup`).

## Dynatrace

### The host details "Open in Dynatrace" link uses a SaaS route on a Managed cluster

**Priority:** P3
**Origin:** Adversarial and API-contract review during /ship on
`feat/dynatrace-client-url` (2026-09-01).
**Why:** `HostPropertiesSection.handleOpenInDynatrace` builds
`${base}/ui/apps/dynatrace.classic.hosts/ui/entity/${hostId}` for every config. That
`/ui/apps/...` path is a Dynatrace **platform** route; a Managed cluster does not serve
it. Before v0.2.92.0 the base was also mangled — `createPlatformUrl` grafted
`.apps.dynatrace.com` onto the managed host, so the link failed at DNS. That release
added the `dynatraceType === 'saas'` branch the other builders already had, so the link
now reaches the real managed host and 404s there instead. Closer, still wrong.
**Why it is P3:** it only affects Managed deployments, only the host-details button (the
service deep links in `buildDeepLinkUrl` branch correctly), and it has been broken since
the button was added — nobody has reported it.
**What to do:** supply the correct Managed host-entity route (the classic
`#newhosts/hostdetails;id=HOST-…` hash form is the likely shape, but it needs confirming
against a real Managed cluster rather than guessing), then move this link into
`dynatrace-formatters.ts` so it shares the `isSaaS` branch and the test suite instead of
carrying its own copy.

## Test run detail tables

### Redo the long-table virtualisation that was reverted in v0.2.86.0

**Priority:** P2
**Origin:** shipped in v0.2.85.0, reverted in v0.2.86.0 after a four-specialist review
(performance / testing / maintainability / design) found 9 CRITICAL issues, and a live
reproduction showed 208 of 218 Environment Configuration rows unreachable.
**Why:** `unmountOnExit` (kept) fixed the reported card-open freeze and cut page-load DOM from
~20,000 nodes to ~1,300. What it does not fix is the cost of opening a card containing a very long
table: Environment Configuration ~293ms on a 218-row run, and a large Apdex SLO row is worse.
Virtualisation is still the right answer; the implementation was wrong.

**The unexplained fault - start here.** The config table's virtualiser held its scroll element
(`hasScrollEl: true`) and the correct `scrollMargin` (810), yet reported ~10 items
(`first: 0, last: 9`) and did not change after scrolling 6,000px. Ten items is roughly
`overscan(8) + 2`, which is what virtual-core yields when the viewport measures zero. The Apdex
table used the same hook on the same page and tracked scroll correctly, so it is specific to that
call site. Ruled out by isolation builds: the ResizeObserver (stubbed, no change) and `padBottom`
(fixed, scroll height grew 810px, no change).

**Defects already found and fixed on the reverted branch - re-apply, do not rediscover:**

1. **`padBottom` mixed coordinate systems.** An item's `start`/`end` INCLUDE `scrollMargin`
   (`runningStart = paddingStart + scrollMargin`), but `getTotalSize()` SUBTRACTS it
   (`end - scrollMargin + paddingEnd`), so `getTotalSize() - last.end` is short by exactly
   `scrollMargin`. Correct: `getTotalSize() - (last.end - scrollMargin)`.
   `padTop = first.start - scrollMargin` is already right.
2. **A measured element must not carry a margin.** `measureElement` reads the border box, which
   excludes margins, so `sx={{ mb: 3 }}` on the measured Box recorded every Apdex group 24px short
   (~400px over 17 groups). Use padding inside the measured box, or the virtualiser's `gap` option.
3. **`useWindowVirtualizer` is wrong here and fails silently.** The window never scrolls;
   `main.content-area` owns the overflow, so window `scrollY` stays 0 and the list appears to end
   after a dozen rows.
4. **`scrollMargin` is not stable.** A card expanding above the list slides it down without
   re-rendering it - measured 12,260px of drift - so it must be re-measured, not measured once.
5. **`measureRef` has an undocumented `data-index` requirement.** virtual-core reads
   `node.getAttribute('data-index')`; without it measurement silently no-ops and rows keep the
   estimate. Return a spreadable props bag rather than a bare ref.
6. **A row needs a box to be measured.** `display: contents` generates none - the config rows had
   to become subgrid. `content-visibility` on a measured row is also wrong: off-screen rows report
   the `contain-intrinsic-size` placeholder and poison `measureElement`.
7. **Gate on the right count.** The Apdex table virtualises 17 scenario groups but pays for the
   ~292 rows inside them; gating on its own item count switched virtualisation off exactly where it
   was needed.

**Testing, which is the part that actually failed.** The reverted branch had 4109 green tests and
they caught none of this. A mutation run against the new hook showed all 6 mutations surviving -
zeroing `padTop`, zeroing `padBottom`, inverting the scroll-parent predicate, gutting the
ResizeObserver. Reverting both `unmountOnExit` props also left 238 tests green. jsdom performs no
layout, so the virtualised path is structurally untestable there, and there is a hard cliff at the
threshold: 59 rows render fully under jsdom, 60 render zero. A redo needs a browser runner
(Playwright) for the windowing, plus jsdom tests asserting a collapsed card's children are absent
from the DOM.

**Also outstanding from the same review, independent of virtualisation:** with `unmountOnExit` on
the SLO row Collapse, collapsing and re-expanding a *metric* SLO now refetches its chart -
`useSLOMetricsChart` holds `useState` + an uncached `authenticatedFetch` with no dedupe. Apdex SLOs
are unaffected. Either scope `unmountOnExit` to the Apdex branch or give the chart a cache.

---

## Compare card


### The series dropdown is not virtualised, so a whole-system selection renders every option

**Priority:** P3
**Origin:** Adversarial review during /ship on `fix/compare-and-report-metric-pickers` (2026-08-21),
where the picker became multi-select at all three levels.
**Why:** With select-all on dashboards and panels, the series list is the product of both — on a
system with tens of dashboards it can reach several thousand options. MUI's `Autocomplete` renders
every option matching the current filter with no virtualisation, so the popup gets slow to open and
to type in. Nothing breaks; it degrades, and only for a selection the user opted into. The request
fan-out behind those levels is already bounded (`OPTION_FETCH_CONCURRENCY` in
`apps/web/app/test-runs/[id]/components/compare/utils/metric-options.ts`) — this is rendering, not
fetching.
**What:** Either a `ListboxComponent` backed by a virtualiser (the pattern MUI documents for large
option sets), or a cheaper cap: stop rendering past N options and tell the user to type to narrow.
Measure before choosing — the threshold where it actually hurts has not been established.
**Where:** `apps/web/app/test-runs/[id]/components/compare/components/CompareSelectionPanel.tsx`,
the Series `Autocomplete`.

**Update (v0.2.85.0):** `@tanstack/react-virtual` is now a dependency and
`apps/web/hooks/useScrollParentVirtualizer.ts` exists, so the virtualising half of this is no longer
a from-scratch job. Two cautions that cost real time on the SLO and config tables, both of which
apply here: `useWindowVirtualizer` is wrong for this app (the window never scrolls,
`main.content-area` does), and a virtualiser's `scrollMargin` has to be re-measured — anything above
the list that expands slides it down without re-rendering it. An `Autocomplete` popup is its own
scroll container, which may make the shared hook unnecessary; check before reaching for it.

---


## Reports

### Prose `{perfana-previous-*}` and a `previous-successful` comparison name different runs

**Priority:** P2
**Origin:** adversarial review during /ship on `chore/misc-improvements` (2026-08-30), finding F3.
**Why:** the four Comparison variables are resolved ONCE per report by
`ReportHtmlCompilerService.lookupVariableValues`, which always takes the immediately preceding
run. A comparisons section set to `previous-successful` resolves its own, potentially older,
SLO-passing baseline through `getPreviousTestRun(testRun, { sloPassedOnly: true })`. So prose
reading "Compared against {perfana-previous-test-run-id} ({perfana-previous-start-datetime})"
names one run while the table under it compares against another. Before this release only the
run id was exposed and the mismatch was one token; the release adds start time, end time and
release, which makes the sentence read as a full and confident provenance claim that is wrong.
**Why it was not just fixed:** the variables are document-scoped and the baseline is
section-scoped, and one report may hold several comparison sections with different baselines —
so there is no single "the previous run" for the document to resolve. That is a design question,
not a bug to patch.
**What:** either (a) document the variables explicitly as "the run before this one", never "this
section's baseline", and say so in the picker hint, or (b) add a second set of section-scoped
variables that resolve against the section's own baseline. (a) is cheap and honest; (b) is what
an author actually wants when writing a sentence about a comparison.
**Where:** `apps/api/src/modules/reports/services/report-html-compiler.service.ts`
(`lookupVariableValues`), `packages/shared/src/utils/report-variables.ts` (the Comparison group
hints), `apps/api/src/modules/reports/renderers/comparisons-renderer.ts` (`resolveBaseline`).

### The minimum-absolute-change gate compares raw values against a scaled display

**Priority:** P3
**Origin:** adversarial review during /ship on `chore/misc-improvements` (2026-08-30), finding F8.
Pre-existing — not introduced by that release, but it became easier to see once the unit was
printed next to the number.
**Why:** `comparison-bands.ts` documents `minAbsolute` as "minimum absolute change (in the
metric's own units)", and `gatedDiffPercent` compares `|current - baseline|` on the RAW stored
values. For a `percentunit` metric the cell shows `42% vs 40%` — a change of 2 in the units the
reader sees — while the gate tests `0.02` against the number the user typed. Every percentunit
row is therefore gated out unless `minAbsolute` is below 0.01, and the user has no way to tell
from the UI. Same divergence in the web compare table, which gates on `c.current_value` while
`fmt` shows the scaled value.
**What:** scale both sides of the comparison with `toUnitScale` before the gate, so the threshold
means what its label says. Changing it moves rows in and out of view for anyone already using
`minAbsolute` on a percentunit panel, so it wants a CHANGELOG line rather than a silent fix.
**Where:** `apps/api/src/modules/reports/renderers/comparison-bands.ts` (`gatedDiffPercent`),
`apps/web/app/test-runs/[id]/components/compare/utils/compare-bands.ts`,
`apps/web/app/test-runs/[id]/components/compare/components/MetricsComparisonTable.tsx`.

### The comparison delta is computed from raw values the reader never sees

**Priority:** P2
**Origin:** pre-landing review during /ship on `chore/misc-improvements` (2026-08-30). Introduced
by that release; shipped knowingly.
**Why:** `baselineUnit` lets the two sides of a pairing carry different unit codes, and the
renderer's `scaled()` helper formats each side with its OWN unit. `diffPercent`, though, is still
`percentDiff(cv, bv)` over the raw pair. For a `percent` row (current 42) paired against a
`percentunit` one (baseline 0.4) the cell reads `42 vs 40` beside a `+10400%` chip, and because
that same `diffPercent` feeds the band, the row is ranked a severe regression. The two numbers
the reader sees and the delta printed next to them are computed from different scales. Sibling
of the `minAbsolute` divergence above (F8) — same root cause, different call site.
**What:** scale both sides with `toUnitScale` before `percentDiff`, at all three
`diffPercent: percentDiff(cv, bv)` sites. Add a renderer test that asserts the chip agrees with
the pair it sits beside — the current cross-unit fixture hard-codes `diffPercent: 5`, a value the
producer would never emit, which is why no test caught this.
**Where:** `apps/api/src/modules/reports/services/report-data-fetcher.service.ts` (lines ~955,
~2812, ~2913, ~3041), `apps/api/src/modules/reports/renderers/comparisons-renderer.spec.ts`.

### A Comparisons section reads another organization's run through the statistics path

**Priority:** P1
**Origin:** pre-landing review during /ship on `chore/misc-improvements` (2026-08-30).
Pre-existing — present on `main` at two sites before that release, which only added a comment in
the function.
**Why:** `getBaselineRunComparisonFromStatistics` issues `this.dataSource.query` on the plain
pooled connection. That is neither org-filtered nor under RLS — the API's login role is
`rolbypassrls`, so the policies do not apply to it — and `opts.userId` / `opts.roles` are never
consulted on this branch. `config.baselineTestRunId` is arbitrary caller-supplied JSON, and only
the CURRENT run id is access-checked. A member of org A can preview or generate a Comparisons
section with `source: 'grafana'` and a guessed `test_run_id` from org B and read back that run's
dashboard labels, panel titles, metric names and mean/q90/q95/q99 values. The sibling
performance-metrics branch ~100 lines above is the model for how it should look: it resolves an
org filter and runs through `withRequestEm`.
**What:** mirror the transactions branch — `resolveOrgFilter(opts.userId ?? '', opts.roles ?? [],
params.length + 1, 'tr')`, join `test_runs tr ON tr.test_run_id = s.test_run_id`, append
`orgFilter.clause`, and issue it via `withRequestEm(this.testRunRepo).query(...)` so RLS is in
force too. Wants its own branch and its own review: it is auth-sensitive query construction, and
the empty-userId system-call convention has to keep working for background report generation.
**Where:** `apps/api/src/modules/reports/services/report-data-fetcher.service.ts` (the two
`ds_metric_statistics` reads, ~line 2595 and ~line 2972).

### An SLO-passing predecessor lookup scans the whole scope when nothing ever passed

**Priority:** P4
**Origin:** performance + adversarial review during /ship on `chore/misc-improvements`
(2026-08-30), findings F11 and the performance specialist's index note. Both judged it acceptable
as shipped; recorded so the shape is known rather than surprising.
**Why:** `consolidated_result ->> 'meetsRequirement' = 'true'` is not indexable, so it becomes a
per-row heap filter. `idx_test_runs_system_env_workload_start` still carries the three equality
columns and the `ORDER BY start_time DESC`, so the planner walks that index backwards and stops
at the first passing row — cheap in the normal case. The pathological case is the one the feature
exists for: a system/environment/workload where nothing ever passed walks the entire history for
that scope and returns nothing, on every report render and every section preview.
**What:** if a deploy is seen spending time here, add the partial index
`CREATE INDEX CONCURRENTLY idx_test_runs_sew_start_slo_ok ON public.test_runs
(system_under_test_id, test_environment, workload, start_time) WHERE completed AND
(consolidated_result ->> 'meetsRequirement') = 'true';` — or put a start_time floor on the
lookup. Measure first; run counts per scope are in the hundreds today.
**Where:** `apps/api/src/modules/reports/services/report-data-fetcher.service.ts`
(`getPreviousTestRun`, `previousRunSloMiss`).

### Report values can still be restyled by a CI-supplied config value

**Priority:** P3
**Origin:** the escaping work during /ship on `chore/misc-improvements` (2026-08-30).
**Why:** `renderMarkdown` does not consume backslash escapes — it HTML-escapes and then
pattern-matches — so a backslash inserted by `escapeMarkdownValue` survives verbatim into the
published HTML. That forced the escaper to be narrowed to the constructs a backslash genuinely
breaks (the `](` link join, line-leading heading and list markers); escaping every CommonMark
character printed `Release 1\.2\.3` into reports, and escaping `` ` `` and `*` never neutralised
anything because the inline patterns do not look at the preceding character. What remains is that
emphasis and code spans inside a test-run configuration value can restyle a phrase in a report
served unauthenticated over a share link. No href, no HTML — defacement, not injection.
**What:** teach `renderMarkdown` to consume backslash escapes. That closes the gap and lets the
escaper go back to being broad without printing artifacts.
**Where:** `packages/shared/src/utils/markdown.ts` (the `INLINE` pattern in `inline()`),
`packages/shared/src/utils/report-variables.ts` (`escapeMarkdownValue`).

---


## Quality gates

### The worker integration suite is dead code, not dormant coverage

**Priority:** P3
**Origin:** the v0.2.93.2 testing-specialist review (2026-09-02). The specialist flagged
`apps/worker/src/test/integration/` as excluded from the default run; running it showed it is
worse than that.
**Why:** `apps/worker/vitest.config.ts` excludes `src/test/integration/**` and `src/test/e2e/**`,
so neither `npm run test` nor `npm run preflight` touches them, and no CI workflow calls
`test:integration`. Nothing has noticed that the suite stopped working. `clearTestData`
(`apps/worker/src/test/helpers/database.ts:265`) issues `DELETE FROM ds_panel_metrics` and
`DELETE FROM ds_panels` — tables that no longer exist in the schema — so every one of the 33
tests in `statistics-pipeline.integration.test.ts` errors in `beforeEach` before reaching an
assertion. Verified against a freshly created `perfana_test` with timescaledb + toolkit
installed: `error: relation "ds_panel_metrics" does not exist`, 33 failed.
**What it costs:** this is where the only *behavioural* coverage of `StatisticsPipeline` lives —
`last_value` (line 611), `is_constant` / `constant_value` (lines 869, 899), benchmark id
extraction, dashboard metadata. The unit suite only asserts on the SQL *string* against a mocked
EntityManager, so it can prove the query says what we meant and never that Postgres agrees. The
v0.2.93.2 `last()` / `MIN=MAX` change had to be verified by hand against a live database instead.
**What to do:** repair `clearTestData` against the current schema, run the suite once to find the
rest of the rot, then wire it into a gated job so it fails instead of silently never running.
Until then do not count it as coverage.

### Three gates report success for code they never examine

**Priority:** P3
**Origin:** discovered while building the report index + anchors feature (v0.2.76.0). Each was
found the hard way, by a defect the gate did not catch.
**Why:** three of this repo's own checks are structurally blind to part of the codebase, and each
one reports green for files it never looked at:

1. **`packages/shared` jest runs ts-jest in transpile-only mode**, so it cannot see type errors.
   A spec file with a genuine TS2345 sat green through a full task review; `npm run preflight`
   would have blocked on it, but the suite said 15/15 passing the whole time.
2. **`apps/web/tsconfig.json` excludes every test file** — `__tests__/**/*`, `*.test.ts(x)`,
   `*.spec.ts(x)` — so `tsc --noEmit` type-checks no test code at all. A required prop can be
   added and every test that omits it still compiles, then throws at runtime.
3. **`apps/web`'s lint script is `eslint app lib`**, so the entire `components/` tree is unlinted.
   Three pre-existing errors live there today, invisible to `npm run lint`.

The shared thread is worse than any single gap: a green check is read as "this was verified", and
in each case it means "this was not looked at". The knip entry below is the same family — a
dead-code check whose entry globs exempt most of the frontend.

**What:** each is its own piece of work and none should be bundled with a feature branch.
For (1), either type-check specs in `packages/shared`'s own gate or drop transpile-only. For (2),
add a second tsconfig that includes tests and run it in preflight. For (3), widen the lint script
to `components/` and burn down whatever it surfaces. Doing (3) first is cheapest and will produce
the smallest backlog.

### `npm run test` and `npm run preflight` disagree about the RLS database

**Priority:** P3
**Origin:** /ship on `feat/report-dynamic-values-and-top10-impact` (2026-08-25). Ten API suites
failed on a clean machine and nobody had noticed.
**Why:** the jest setup points the RLS and sut-transfer suites at a `perfana_test` database, but
nothing creates it and no doc mentions it, so `npm run test` fails 10 suites out of the box with
`database "perfana_test" does not exist`. `npm run preflight` runs the same RLS suite against the
dev database (`perfana`) instead, so the pre-push gate stayed green the whole time. Two commands
that both claim to run the RLS suite disagree about what they run it against, and the one wired to
the git hook is the one that never sees the failure. Same family as the three gates above: green
means "not looked at".

**What:** pick one database for the RLS suite and make both entry points use it. Then either add a
bootstrap script (`create database` + `npm run migration:run` with `DB_NAME`) or document it in
CLAUDE.md's Quick Start, so a fresh clone can run `npm run test` to green. Recovery for now:
`docker exec perfana-postgres psql -U perfana -d postgres -c 'CREATE DATABASE perfana_test'` then
`DB_NAME=perfana_test npm run migration:run`.

---

## TimescaleDB continuous aggregates

### The consolidated schema's policy loops swallow errors that have already killed the transaction

**Priority:** P2
**Origin:** found while fixing the CAGG refresh windows in v0.2.84.0 — the new migration had the
identical bug, caught by review before it shipped.
**Why:** `ConsolidatedSchema1700000000000.up()` wraps each `add_continuous_aggregate_policy` and
each `add_retention_policy` in a bare `try`/`catch` that logs `Warning: Could not add ... policy`
and continues. Migrations run under `runMigrations({ transaction: 'each' })`, so that does not
work: the first failing statement aborts the transaction, and every statement after it — the
remaining 14 policies, all 15 retention policies, and TypeORM's own `INSERT` into the migrations
table — fails with `25P02 current transaction is aborted, commands ignored until end of
transaction block`. The catch turns one recoverable failure into a greenfield install that
cannot bootstrap, while printing warnings that read like it degraded gracefully. Verified
against Postgres directly:

```
BEGIN;
SELECT remove_continuous_aggregate_policy('does_not_exist_5s', if_not_exists => TRUE);
-- ERROR: relation "does_not_exist_5s" does not exist
SELECT 1;
-- ERROR: current transaction is aborted, commands ignored until end of transaction block
```

Not reachable in practice today, because on a greenfield install the CAGGs were created a few
statements earlier in the same migration, so the policy calls do not fail. It becomes reachable
the moment any of those calls can fail independently.

**What:** wrap each iteration of the CAGG-creation, refresh-policy and retention-policy loops in
`SAVEPOINT` / `RELEASE SAVEPOINT` / `ROLLBACK TO SAVEPOINT`, the way
`1799000000000-WidenCaggRefreshWindows.ts` now does. Deliberately not bundled into that fix: it
touches three more loops in a 900-line migration that only greenfield installs run, and it wants
its own branch. Note that mock-based unit tests cannot catch this class of bug at all — the mock
query runner happily continues after a throw — so any test must either drive a real transaction
or assert the savepoint statements.

### Runs older than the refresh window are never materialised

**Priority:** P3
**Origin:** v0.2.84.0, the same investigation.
**Why:** widening `start_offset` to 7 days fixes every run from here on, and the first policy pass
after the migration backfills anything ingested in the last week. A run older than that stays
unmaterialised, so opening its details page still falls back to scanning the raw hypertable —
2766 ms vs 521 ms on the run this was measured against. The data is all still there; nothing is
lost, it is just slow, and slow with no error is exactly why this went unnoticed for so long.

**What:** decide whether to backfill history once per deployment, with
`CALL refresh_continuous_aggregate('<view>', NULL, now() - interval '1 minute');` for each of the
15 views. It cannot go in a migration: `refresh_continuous_aggregate` cannot run inside a
transaction, and the full-history form takes minutes to hours. Either an operator runbook step or
a worker job that walks the views one at a time. Worth measuring the real cost on a production-
sized database before committing to either.

---

## SUT transfer

### The SUT export has no completion signal, and leaves an empty file behind on cancel

**Priority:** P4
**Origin:** /ship on `fix/sut-export-stream-to-disk` (v0.2.94.3, 2026-09-04). Three gaps the
review surfaced and the fix deliberately left out of scope.
**Why:** the fix made a large export possible; these are the rough edges around it. None of them
lose data, which is why they were deferred rather than fixed.

1. **No completion confirmation on the disk-stream path.** Chrome shows no download UI for a
   File System Access write, so a multi-minute export ends with the dialog simply closing. The
   buffered fallback gets the browser's own download shelf for free, so the two paths give
   different feedback for the same action. Blocked on there being no toast/snackbar system in
   `apps/web` — a terminal "Export complete, <size>" state in the dialog is the cheaper fix.

2. **Cancelling leaves a 0-byte file at the chosen location.** `showSaveFilePicker()` creates
   the entry before the first byte arrives, and `FileSystemWritableFileStream.abort()` discards
   the swap file, not the entry. Reads as a successful-but-empty export. `handle.remove()` would
   clear it, but that means holding the handle rather than only the writable.

3. **`Content-Disposition` and the filename the client writes have never agreed.** The server
   sends `sut-<SUT uuid>-<date>.ndjson.gz`; the dialog writes `sut-<system name>-<date>.ndjson.gz`
   for both `a.download` and the picker's `suggestedName`. A scripted client honouring the header
   and a browser client get different names for the same bundle, and each computes its own date,
   so a request straddling UTC midnight disagrees with itself. Fixing it properly means the
   client reading the header, which needs `Access-Control-Expose-Headers`.

**What:** (1) is the only one a user would notice. Do it first, or decide the dialog state is
enough. (2) and (3) are correctness tidiness, not bugs.

---

## Dead code detection

### knip treats every file under `apps/web/app/**` as an entry point, so nothing there is ever unused

**Priority:** P3
**Origin:** deleting `trends-chart-utils.ts` for v0.2.70.0 (2026-08-22). That file was 387 lines
of dead code that knip had never reported.
**Why:** `knip.json` sets `apps/web.entry` to `["app/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"]`. An
entry point is a root of the reachability graph, so declaring the whole App Router tree as entries
means no file or export under `app/` can ever be reported unused — the largest part of the
frontend is exempt from the dead-code check that `npm run knip` implies is covering it. The
blanket glob also disables the benefit of knip's built-in Next.js plugin, which already knows the
real entry conventions (`page`/`layout`/`route`/`loading`/`error`/`not-found`/`template`/`default`,
plus `middleware.ts` and `instrumentation.ts`).
**Evidence:** a probe run with those conventions as the entry set reports **323 unused exports**
under `app/`, including all eight exports of the file deleted in v0.2.70.0. The default config
reports 12 findings for the whole monorepo and none of them.
**What:** replace the blanket entry glob with the Next.js conventions, then triage the backlog.
It cannot land as one change — 323 findings is a release of its own, and per
`docs/` history much of it is the known false-positive classes: barrel files that re-export a
component both named and default (removing the named export breaks runtime rendering and `tsc`
does not catch it — that is why `"exclude": ["duplicates"]` is already set), and type vocabularies
consumed only by feature code. Suggested order: land the config change with the current backlog
captured in a baseline/ignore list, then burn the list down by directory so each PR stays
reviewable.

## Completed

### Job locks are renewed for as long as the job runs

Landed in v0.2.75.0 (2026-08-23).

`JOB_DEFAULTS.LOCK_TTL_SECONDS` is 300 while every orchestrator stage races a 600s timeout and a
pipeline runs ten of them, and `analyze.ts` never called `JobLockService.extendLock`. A slow run
dropped its lock five minutes in and a second analyze for the same system/environment/workload
could start while the first was still writing `ds_*` rows for the same test run.

`JobLockService.startLockRenewal()` now heartbeats `extendLock` at a third of the TTL and returns
a stop function the worker calls in its `finally`, before `releaseLock`. Both `acquireLock`
callers use it — `analyze.ts` and `simple-orchestrate-reevaluate-batch.ts`, the batch being the
longer-running of the two. Renewing rather than raising the TTL on purpose: a TTL long enough to
cover a ten-stage pipeline is also how long a crashed worker would block the scope. A failed
renewal logs at ERROR but does not abort — the pipeline has no cancellation path and killing a
run mid-write is worse than the overlap. The class comment claiming a 30-minute TTL is fixed.

### Graphs card analysis markers, chart-export rejections, section-type registries, shared card header

Landed in v0.2.75.0 (2026-08-23).

**Graphs card: analysis time range markers.** The Graphs chart shaded only the leading
ramp-up with a flat grey rect and ignored `analysis_end_offset` entirely, so the ADAPT
window it drew disagreed with the Compare and SLO charts. `calculateRampUpEndIndex` is
now `calculateAnalysisWindowIndices` (start *and* end, in sample-index space) and
`buildChartLayout` renders the same overlay `ComparisonPlot` does: dimmed excluded
regions at both ends with an amber (`#f59e0b`) dashed boundary line at each edge.

**Chart export: the copy-to-clipboard handler no longer leaks a rejection.**
`buildChartConfig`'s clipboard fallback called `.then()` on the *same already-rejected*
`blobPromise`, so a failed export surfaced as an unhandled rejection and a button that
did nothing. The fallback now carries its own `.catch`, the download path's Plotly
fallback is chained rather than fire-and-forget, both end at a `console.warn`, and
`renderExportPng` defers its `window.Plotly` access so a missing Plotly rejects instead
of throwing out of the modebar handler. `ClipboardItem` is feature-detected alongside
`navigator.clipboard.write` — Firefox has the latter without the former, and the
`ReferenceError` used to take the whole handler down. Covered by three tests that assert
no `unhandledRejection` fires.

**Reports: the section-type registry is down from six copies to two.**
`SECTION_TYPE_LABELS` in `@perfana/shared` is now the single source — it is a
`Record<ReportSectionType, string>`, so a new union member that misses it is a compile
error, and `REPORT_SECTION_TYPES` / `SECTION_TYPES_WITH_TEXT` are derived from its keys.
`create-report.dto.ts` re-exports the shared list instead of keeping a third copy behind
`@IsEnum`. The web keeps its own copy on purpose — apps/web has no dependency on
`@perfana/shared` and adding one would pull TypeORM into the browser bundle — but
`apps/web/__tests__/lib/report-section-types.test.ts` now imports the shared *source*
(test-only, never bundled) and fails the moment the two lists diverge.

**Compare/Trends/Graphs: one sticky header, one presets accordion.**
`shared/ExpandableCardHeader.tsx` (plus the exported `kickPlotlyResize` handler) and
`shared/PresetsAccordion.tsx` replace the three byte-identical copies. Trends and Graphs
picked up Compare's `unmountOnExit` on the accordion for free — their preset rows were
rendering into a hidden `height:0` subtree on every card render. The orphaned
`shared/CardHeader.tsx` and its 366-line test are deleted: they had no production
importer, and knip could not see that because every file under `apps/web/app/**` is an
entry point.


### Compare card: parallelised aggregate fetch, aggregate-row marker, legacy preset restore

**Parallelise and dedupe the aggregated-series fetch loop.** One request per *distinct
metric* now, issued with `Promise.all`. `stat` stopped changing the SQL when the aggregate
moved onto the merged sketch, so two series sharing a metric were issuing byte-identical
requests one after the other — panels 105 and 205 both map to `error_percentage`, so it was
reachable without a legacy preset. Applied to the twin in `useTrendsData.ts` as well.
`spec.stat` stays on the series side; `buildAggregatedComparisons` still needs it for the
value-only fallback.

**Distinguish the aggregate row.** An outlined `aggregate` chip next to the metric name, and
the row is excluded from the panel-header `reg`/`warn`/`ok` tallies and from the band-chip
filter (it is always rendered). Counting the roll-up alongside its own constituents meant "3
regressions" could be two transactions plus their own aggregate.

**Normalise legacy per-percentile aggregated series on preset restore.**
`normaliseLegacyAggregatedSeries` rewrites 102/103/104 → 101 and 202/203/204 → 201, rebuilding
the name from the keeper title, and preset restore runs every series through it. Returns the
input untouched for the keepers, the error-rate panels, non-aggregated series (panel ids are
not unique across sources — a Grafana panel 202 is not an RT panel) and unknown panels; all
six cases are tested.

Web: 3957 passing (12 new), lint and tsc clean.
**Completed:** v0.2.68.8 (2026-08-20)

### Surface failed background dashboard deletions in the UI

`application_dashboards` gains `deletion_status`, mirroring `test_runs`: null when idle,
`'queued'` set before the jobs are enqueued, `'deleting'` when the worker picks one up, and
`'failed'` from the `failed` handler once retries are exhausted. The API returns it on the list
DTO, and `DashboardTable` renders a badge. The UI no longer drops the rows optimistically — that
was the actual defect: it told the user "queued for deletion" and then nothing ever contradicted
it, so a permanently failed job surfaced only as the dashboard reappearing after a reload with
the reason buried in the API log.

**Also fixed here: twelve more dead null-org escapes that the previous sweep missed.** That
sweep grepped `organization_id IS NULL` — the SQL-column form — and TypeORM query builders spell
it `ad.organizationId IS NULL`, against the entity *property*. Those did not match.
`application-dashboards` (4), `grafana-dashboards` (2), `metrics-sources` (6) are now clear, and
`grep -rn "organizationId IS NULL" apps/api/src` returns nothing.
**Completed:** v0.2.68.7 (2026-08-20)

### Consider clearing `persistedListeners` on manual `disconnect()`

Yes — it clears them. The investigation settled the open question: **nothing in the app calls
`disconnect()`**, and reconnection does not go through it (that path is `scheduleReconnect` →
`connect` → `reapplyPersistedListeners`, which builds a fresh socket). So the method is a full
teardown by definition and there is no manual-vs-reconnect distinction to build — which would
have been machinery for a case that does not exist. Clearing the map also removes the state leak
that made one suite's socket `on()` test grab another's stale handler, which had been worked
around in the test rather than the source.
**Completed:** v0.2.68.7 (2026-08-20)

### Reports: SLO all-clear card, prose measure, table scrolling, builder floor, section accents

Five items from the Reports section, in one pass over the same files.

**SLO section rendered a green "all clear" card when the query failed** (P2). Two separate
faults, both fixed. `getSloCheckResults` now returns `null` on failure instead of `[]`, and
the renderer draws an explicit amber "Section incomplete" card for it — an empty array still
means the run genuinely has no checks. And the `(requirement->>'value')::numeric` cast is
guarded by a regex, so one uncastable row yields NULL for that row rather than throwing and
collapsing *every* SLO into the green card. The guard admits scientific notation, verified
against the live database (`1e5` → 100000, `abc` → NULL, no error).

**Prose measure and body size.** `max-width: 75ch` on `.section-text` and section `<p>`, and
a screen-only `body { font-size: 16px }`. Tables keep the 340mm measure; print keeps 11pt.

**Wide tables scroll in their own container.** All twelve `<table>` emitters across the nine
renderers are wrapped in `<div class="table-scroll">` and the `overflow-x` rule moved off
`section` onto it. On the section the scrollbar sat at the bottom of the whole 30px-padded
card, the card's right padding collapsed at the end of the scroll, and per spec `overflow-y`
computed from `visible` to `auto`.

**Report builder ~662px floor.** The palette now auto-collapses below 900px, and
`DialogContent` scrolls instead of clipping — the clipping is what made the overflow
unreachable rather than merely off-screen.

**Section accents and icons are all distinct.** Eleven distinct accents, contrast-checked for
dark-mode paper (the brown and blue-grey are gone), and the four duplicated icons resolved:
`text_block` → Notes, `slo` → Rule (was AssignmentIcon rotated 180°), `transaction_response_times`
→ Timeline (was TrendingUp, same as `trends`). Kept as literals rather than theme tokens: it is
a closed set of eleven that does not vary by theme, and a palette extension for them would be
indirection for its own sake.

API 733 report tests passing, web 3945, lint and tsc clean in both.
**Completed:** v0.2.68.6 (2026-08-20)

### Turn on `strict` in apps/web

`"strict": true` in `apps/web/tsconfig.json`; all 81 errors cleared. `tsc --noEmit` 0,
lint clean, 3945 tests passing.

Most were real nullability the types had been hiding. The one **behaviour** bug it caught:
`GraphsChart` built its Plotly traces with `allSeries.map(... => null)` for series with no
data and passed the array — nulls included — straight to `<Plot data=...>`. Now filtered.

Judgement calls worth knowing about:

- **Plotly props stay `unknown` at the hook boundary**, narrowed with a cast at each
  `<Plot>` call site. Typing the trace builders through `@types/plotly.js` is a real job
  (its `Layout` is structurally strict about things like `xanchor`) and buys no
  null-safety, so it is not this change.
- **The anomaly config payload stays `unknown` through the component tree** and is
  narrowed once at `AnomalyDetectionSection`. Its six declarations genuinely disagree on
  which threshold fields are nullable; unifying them is a separate refactor. The first
  attempt propagated `ConfigFormData` downward and cascaded — reverted.
- **`DrawerData | null` was propagated**, because the fetch really does store `null` on
  failure and every consumer was claiming otherwise.
- **The zod `.default('saas')` was NOT removed.** Dropping it made the types line up and
  the tests immediately failed on `should default to "saas" when not provided` — it is
  load-bearing. Fixed properly with `useForm<Input, unknown, Output>` plus an exported
  `CreateDynatraceConfigFormInput`.
- A leftover `console.log('UnresolvedRegressionTable Debug:', ...)` block was the source
  of four of the 81 errors and is gone.

Not turned on: `noUncheckedIndexedAccess`, `noImplicitReturns`, `noUnusedLocals`,
`noUnusedParameters`, `strictPropertyInitialization`. Each is its own error budget and the
item asked for `strict`.
**Completed:** v0.2.68.5 (2026-08-20)

### Fail fast when the API's DB role cannot bypass RLS

`assertRlsBypass` runs in `bootstrap()` before the app listens: it queries `pg_roles` for
`current_user` and refuses to start unless the role is `rolsuper` or `rolbypassrls`, with an
error naming `api_keys`, the FORCE ROW LEVEL SECURITY dependency, and the fix. Postgres does
not inherit role attributes through membership, so the current role's own attributes are the
thing that matters. Unit-tested for superuser, bypassrls, the least-privilege deploy the item
describes, and the unresolvable-role case (which also refuses, rather than assuming).
**Completed:** v0.2.68.4 (2026-08-20)

### Live-DB RLS regression test for API-key organization resolution

`apps/api/src/test/rls/rls-api-key-org-resolution.spec.ts`, 7 cases. It pins the *policy
outcome* the unit guards cannot show: an RLS-scoped read of `api_keys` returns nothing for the
key itself (the circularity that forces the carve-out), the unscoped read the production code
actually uses returns the row, and `api_keys` really is FORCE ROW LEVEL SECURITY.

The test corrected the item's premise. An unresolved organization is **partial** blindness, not
total: `can_access_resource` has a creator branch, so a key keeps reading the runs it uploaded
itself and silently stops seeing everything else in its own org. That is why the failure reads
as a confusing bug in the field rather than an outage — and it is now asserted in both
directions. RLS suite: 142 passing, up from 135.

### Extend `_permissions` enrichment to Dynatrace sub-resources

`findAllQuery`, `findQueryBySystemAndEnvironment`, `findQueryById` and `getEntityMappings` now
attach `_permissions`, batched one capability lookup per unique org rather than per row. The
flags read the same `IntegrationDynatraceUpdate`/`Delete` capabilities `updateQuery` /
`deleteQuery` / `deleteEntityMapping` enforce, so the button state and the eventual 403 cannot
disagree. There is no `getEntityMappingById` on the service (the item listed it; it exists only
on the repository), and no update endpoint for mappings — delete only.

No `isGlobalAdmin` short-circuit: `getCapabilities` already returns the full admin set
regardless of org scope, which is both less code and what the `no-direct-is-global-admin` lint
rule requires.

Frontend: `QueriesTable` (edit + delete) and `EntityMappingsTable` (delete) wrap their buttons
in `<RequiresPermission>`. The button is the *direct* child in both — a MUI `Tooltip` in between
would have received the injected `disabled` prop instead of the button. `organizationId` and
`_permissions` are carried through `DynatraceQueryLocal` and the `useDynatraceQueries` mapper,
and `mapEntityMappingToDtoFieldsWithLabel` now emits `organizationId` (it did not).
**Completed:** v0.2.68.4 (2026-08-20)

### Add Grafana panel for `auth_capability_denied_total` — closed, not built

The counter never shipped, and the item assumed an observability stack this repo does not have:
no `prom-client`, no `/metrics` endpoint, no scrape config, and `infra/grafana/dashboards/` holds
only Perfana's own product dashboard templates. Standing up a metrics pipeline to serve one
denial counter is disproportionate for a P3.

The ops signal already exists: `CapabilityGuard` emits a structured WARN on every denial with
capability, userId, orgId and route, and the admin log viewer (`LOG_VIEWER_ENABLED`) reads it.
Reopen this only alongside a decision to add Prometheus metrics to the API generally — at which
point the counter is a few lines and the panel follows.
**Completed:** v0.2.68.4 (2026-08-20)

### Twenty-three more dead `organization_id IS NULL` branches

All gone, across 13 files. Two shapes:

- `... IN (:...orgIds) OR ... IS NULL` — the null half only ever matched a LEFT JOIN
  miss, so it was deleted outright. Where the surrounding code passed a possibly-empty
  array straight into `IN (:...orgIds)`, it now uses the same all-zeroes sentinel the
  other services already used (`profiles.service.ts`, `report-generation.service.ts`).
- `orgIds.length === 0 → organization_id IS NULL` as the *entire* filter — the no-access
  case spelled as a filter. Now `AND FALSE` / `1 = 0` / an empty CTE. The outcome was
  already "see nothing" (the column is NOT NULL), so this is a correctness-of-intent fix,
  not a behavior change: it stops reading as a legacy-data allowance that someone would
  later "restore".

`resolveOrgFilter` in `report-data-fetcher.service.ts` was checked first — system calls
(no userId) and global admins return an empty clause *before* reaching the filter builder,
so an empty org list there genuinely means a user with zero memberships.
`apps/api/src/modules/grafana/README.md` documented the null-org allowance as intended
behavior and was corrected. Five specs that asserted the old contract now assert the new
one. API suite green at 5203 passing.
**Completed:** v0.2.68.3 (2026-08-20)

### Test-run mutations have no write-permission check

`TestRunsMutationService` now gates every mutation of an existing run on
`Capability.TestRunUpdate`, which `org-viewer` does not hold. Covers the five endpoints the
item named plus three it did not — `deleteTestRun`, `abortTestRun`, `updateAdaptConfig` — and
the update branch of `updateRunningTest`; all four stale "Permission check will be added here"
NOTEs are gone. RLS is not this gate and cannot be: `rls_test_runs_update` calls
`can_modify_resource`, whose final branch grants modify to any org member and whose own comment
defers precision to the service layer. Delete is gated on `TestRunUpdate`, not `TestRunDelete`,
so org-members keep the delete they have today; viewers lose it either way. API-key principals
are exempt and the exemption is asserted in a test — a key has no `organization_members` row,
so `getCapabilities` returns an empty set for every key and gating on it would deny all CI
writes; issuing one requires `api-key:create`, which only org-admins hold.
**Completed:** v0.2.68.2 (2026-08-20)

### Five test-run handlers write outside the RLS transaction

All five now use `withRequestQuery(this.dataSource)`. `init-test.handler.ts` turned out to be a
`SELECT MAX(...)` rather than a write; it was scoped anyway, and the comment records why that is
safe (every row it can see belongs to the caller's own org, and `test_run_id` is UNIQUE, so a
hypothetically hidden row fails loudly rather than reusing a counter). `rls-write-routing.spec.ts`
pins all five with *distinct* spies for `dataSource.query` and `dataSource.manager.query` — the
obvious shared-spy mock passes either way and pins nothing.
**Completed:** v0.2.68.2 (2026-08-20)

### Delete the dead `sut.organization_id IS NULL` branch in filter-options access filter

Both sites in `test-runs-crud-query.service.ts` deleted (the item named one; the sibling audit it
asked for found a second, in the system-name lookup at ~line 759). Verified against the local DB
first: zero dangling `test_runs.system_under_test_id`, and `systems_under_test.organization_id` is
NOT NULL, so the branch could only ever match a LEFT JOIN miss. The wider sweep — 23 more sites
across 13 files — is filed as its own item rather than smuggled into a security PR.
**Completed:** v0.2.68.2 (2026-08-20)

### Move `--fix` out of the lint check scripts

`lint` in `apps/api`, `apps/grafana-sync` and `apps/perfana-report` now reports
instead of repairing; the repair pass moved to a new `lint:fix` script in each.
All three still pass clean, so nothing was being silently auto-fixed.
**Completed:** v0.2.68.1 (2026-08-20)

### Three more places still say 50

All four leftovers now key off `MAX_REPORT_SECTIONS` (20): the `createAdHocReport`
backstop, `ReportSectionConfigDto.order`'s `@Max`, and the three `create-template.dto.ts`
caps. A fourth site the item did not list — `report-template.service.ts`
`validateSections` — was aligned too. Decision taken on the open question: **templates
share the report cap**, since a template holding more sections than a report can render
can never be generated.
**Completed:** v0.2.68.1 (2026-08-20)

### `apps/api/.test-db-config.json` is tracked but machine-generated

`git rm --cached` plus a `.gitignore` entry. No `.example.json`: both readers
(`setup-database.ts`, `phase5-migration-validation.test.ts`) guard with `existsSync`
and fall back to defaults, so the shape needs no separate documentation.
**Completed:** v0.2.68.1 (2026-08-20)

### Fix pre-existing DynatraceCard test failures (23 tests)

Root cause was not label/markup drift but the expanded card's primary tab order: Hosts rendered at index 0 (default) and Services at index 1, contradicting the component's own "Services | Hosts" comment. Since Hosts is disabled with zero host entities, a services-only run opened to a disabled empty tab and all Services content (service sub-tabs, request filtering, analysis, comparison) stayed hidden. Swapped Services to index 0. DynatraceCard suite back to 47/47.
**Completed:** v0.2.61.61 (2026-07-15)

### Regenerate ADAPT golden-file snapshot

Resolved by gating instead of regenerating. The failure was environmental: the guard ran the strict comparison against *any* PerfanaWebshop data, so dev DBs with a different row count (771/1,041 vs the fixture's 950) produced false failures. `dbAvailable` now requires `storedCount === goldenFile.resultCount`, so the test runs only against the exact golden snapshot and skips (with a reseed warning) everywhere else. The golden file (950) is left intact as the regression baseline — exactly what the old Note asked for.
**Completed:** v0.2.61.61 (2026-07-15)

### Fix pre-existing web test failures (socket + TestRunDetailsCard)

Updated stale test assertions to match intentional source changes: socket transport order (polling-first, #377), socket `on()` listener registration (state-leak workaround + rename), and abort UI (`<Chip label="Aborted">` instead of removed text). Full web suite back to 3963/3963.
**Completed:** v0.2.61.2 (2026-05-31)

### Cap the `testRunIds` query param on the aggregate endpoint

**Priority:** P4
**Origin:** /ship performance specialist on `feat/aggregated-percentiles` (2026-08-14).
**Why:** `testRunIds` is parsed from an unbounded comma-separated param straight
into `= ANY($1::text[])`. Materially de-risked now that each id costs an indexed
rollup read instead of a raw-table scan, but Trends passes every run in the
selected range, so a wide range on a busy SUT still fans one request into an
arbitrarily large aggregate.
**Where:** `apps/api/src/modules/test-runs/controllers/test-runs-aggregated-timeseries.controller.ts`
— alongside the existing metric/stat validation (~line 124).
**Completed:** v0.2.63.4 (2026-08-18)
