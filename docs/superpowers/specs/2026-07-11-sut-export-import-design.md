# SUT Export/Import — Design

**Date:** 2026-07-11
**Status:** Approved, pending implementation plan
**Audience:** perfana-admin (debugging tool)

## Goal

Let a `perfana-admin` export a System Under Test (SUT) plus one or more selected
test runs, and all data needed to do **standalone analysis in a dev
environment**, as a portable file. A separate import flow loads that file into a
dev database. This is a debugging/support tool, not a general migration feature.

## Decisions (locked)

- **Transport:** portable file — export produces a downloadable bundle; import
  is a separate admin page that accepts the uploaded file. No cross-DB
  networking, no dev credentials in prod.
- **Raw sample tables** (`requests_raw`, `requests_error`, `transactions`,
  `virtual_users`): optional, **off by default**. `ds_metrics` (the aggregated
  time-series that drives dashboards + ADAPT) is always included.
- **RBAC remap on import:** importer picks a target organization; all imported
  owned rows get `organization_id` = that org, `team_id` = null.
- **Access:** perfana-admin only, and gated behind an env flag
  (`SUT_TRANSFER_ENABLED`, default `false`) because it exports production data
  to a file.

## Core idea: reuse the delete cascade as the resource graph

`apps/api/src/modules/systems-under-test/handlers/delete-system-under-test.handler.ts`
already enumerates every table keyed to a SUT, its filter, and its dependency
order (7 ordered delete phases). That enumeration IS the export/import
dependency graph.

Extract it into **one canonical descriptor**, a new file
`apps/api/src/modules/sut-transfer/sut-resource-graph.ts`. Each entry:

```ts
interface SutResource {
  table: string;
  filter: 'byTestRun' | 'bySut' | 'byAppDashboard' | 'byReference';
  keyType: 'uuid' | 'varchar';   // test-run key flavor (dual-key split)
  group: 'core' | 'optional' | 'raw' | 'shared';
  hasOrgColumn: boolean;         // true → org_id/team_id rewritten on import
}
```

- **Export** walks the descriptor forward, filtered by SUT id + selected test
  run ids.
- **Import** walks it in **reverse** (dependency order): parents before
  children, e.g. `metrics_sources` and `test_runs` before `ds_metrics`.
- The delete handler is **not** rewired now (avoids destabilizing the delete
  path). A comment in both files notes they must stay in sync; adopting the
  descriptor in the delete handler is a future follow-up.

### Test-run key split

Analysis/metric tables key off the varchar business key
`test_runs.test_run_id`; newer tables key off the uuid `test_runs.id`;
`test_run_configs` carries both. The `keyType` field captures which. Because we
**preserve original ids** (below), no key remapping is needed — both flavors
are copied verbatim.

## ID strategy: preserve everything except org/team

Preserve all original UUIDs and business keys on import. Only rewrite
`organization_id` (→ target org) and `team_id` (→ null) on rows where
`hasOrgColumn` is true.

- **Why:** avoids remapping foreign keys across ~30 tables — the single biggest
  simplification. FKs stay internally consistent because every key is copied
  verbatim.
- **Consequence:** import **fails fast** if the SUT id already exists in the dev
  DB, with a clear message ("SUT already exists — delete it first"). No merge
  logic. Re-import = delete in dev, then import.

The large data tables (`ds_metrics`, `requests_*`, `transactions`,
`virtual_users`) have **no org column** (`hasOrgColumn: false`) — they key only
by `test_run_id` and are copied verbatim. Only the small owned/config tables
carry an org column and get rewritten. This resolves the RLS-remap tension: the
high-volume path needs no transformation.

## Bundle format

A single **gzipped NDJSON stream**: `sut-<name>-<YYYY-MM-DD>.ndjson.gz`. No tar,
no new dependencies — `zlib` from Node stdlib.

```
{"__manifest__": {schemaVersion, appVersion, sourceSutId, sutName, exportedAt, testRunIds, groups, counts}}
{"__table__": "systems_under_test"}
{ ...row... }
{"__table__": "metrics_sources"}
{ ...row... }
{"__table__": "ds_metrics"}
{ ...row... }
...
```

- First line is the manifest. `{"__table__": "..."}` marker lines switch the
  current table; subsequent lines are rows for that table.
- **Reads:** server-side cursor (pg cursor / TypeORM stream) — memory-bounded
  regardless of `ds_metrics` size.
- **Writes:** batched inserts (~1000 rows/batch) per table.
- No `pg-copy-streams`. `// ponytail: NDJSON+cursor; swap to Postgres COPY if
  ds_metrics export is measurably too slow`.

## Group toggles (the "check/uncheck non-required resources" UI)

- **core** — always included, shown greyed/disabled:
  `systems_under_test`, `metrics_sources`, selected `test_runs`,
  `test_run_configs`, `benchmarks`, `application_dashboards`, referenced
  `grafana_dashboards` / `grafana_instances` / `dynatrace_configs` /
  `pyroscope_instances` (to satisfy FKs), `ds_metrics`, `check_results`,
  `ds_adapt_results` / `ds_adapt_conclusion` / `ds_adapt_tracked_results`,
  `ds_metric_statistics`, `ds_metric_collection_status`, `ds_panels`,
  `ds_change_points`, `ds_control_groups` (+ `ds_control_group_statistics`),
  `ds_compare_config`, `provisioned_template_ds_compare_configs`,
  `ds_query_executions`, `ds_tracked_differences`.
- **optional** — checkbox, default on:
  `events`, `deep_links`, `notification_channels`, `tracing_services`,
  `dynatrace_queries`, `dynatrace_entity_mappings`, `scaling_sessions`,
  `expected_config_changes`, `alert_tag_filters`, `graph_presets`,
  `trends_filter_presets`, `compare_filter_presets`, `generated_reports`,
  `awr_reports`, `workload_apdex_thresholds`,
  `workload_transaction_apdex_thresholds`,
  `system_under_test_test_environments`, `system_under_test_workloads`,
  `sparse_metric_exclusions`.
- **raw** — checkbox, default **off**:
  `requests_raw`, `requests_error`, `transactions`, `virtual_users`.
- **shared** — the referenced grafana/dynatrace/pyroscope rows above; upserted
  by id on import (`ON CONFLICT DO NOTHING`) with org rewritten, since a dev DB
  may not have them. **Profiles are NOT exported** (global config, re-derivable,
  not FK'd from SUT resources) — add later if a debug case needs them.

## API — new module `apps/api/src/modules/sut-transfer/`

- `POST /systems-under-test/:id/export`
  body `{ testRunIds: string[], includeOptional: boolean, includeRaw: boolean }`
  → streams `application/gzip` with `Content-Disposition: attachment`.
- `POST /systems-under-test/import` (multipart)
  fields: file + `{ targetOrganizationId: string }`
  → runs inside a single transaction; returns
  `{ sutId, sutName, tablesInserted, rowCounts }`.

Both endpoints:
- Guarded perfana-admin only (mirror the log-viewer admin guard).
- Return 404/disabled when `SUT_TRANSFER_ENABLED` is false.
- Import validates `manifest.schemaVersion` and rejects on mismatch.

## Frontend — `apps/web`

- **Export dialog**, launched from the SUT settings page: test-run checklist
  (reuse the existing test-runs-by-SUT list), optional + raw group toggles,
  Export button → browser download via authenticated fetch → blob.
- **Import page** (small admin route): file picker + target-org dropdown +
  Import button → shows the returned summary.
- Both UI entry points gated by `NEXT_PUBLIC_SUT_TRANSFER_ENABLED` (mirrors
  backend flag, same pattern as the log viewer).

## Import execution order and RLS (Phase 5b)

Import runs in one transaction, inserting in reverse-delete (dependency) order:

1. shared referenced rows (grafana/dynatrace/pyroscope) — upsert, org rewritten
2. `systems_under_test` (org rewritten) — abort if id already exists
3. `metrics_sources` (org rewritten; NO-ACTION FK, must precede dependents)
4. `test_runs` (org rewritten)
5. `application_dashboards`, `benchmarks`, other owned SUT children (org
   rewritten)
6. DS/metric/raw tables keyed by test run (no org column, verbatim)

Owned rows are inserted with `organization_id` = target org, so RLS insert
policies pass for an admin with access to that org. Big data tables rely on
their parent `test_runs` row (target org) already being present for
join-based visibility — the order above guarantees it.

## Risks to validate during implementation (not skipped)

- **RLS enforcement:** confirm import inserts pass under the target-org context;
  run the `apps/api/src/test/rls/` suite with `DB_ENABLE_RLS_ROLE=true`.
- **ds_metrics compression:** export a compressed SUT and confirm the streaming
  SELECT does not hit the decompression-limit landmine (per prior incident on
  force-refetch selective DELETE).
- **Precondition:** dev DB must already have current schema + Timescale
  hypertables (migrations applied). Documented, not enforced.
- **Secrets:** the shared grafana/dynatrace rows may contain connection
  credentials. Env-flag gating + admin-only is the mitigation; called out in
  docs.

## Testing

- One integration test: seed a SUT + one test run + metrics → export → import
  into a clean schema → assert per-table row counts match and the SUT is
  queryable via the normal API.
- One unit test: the resource-graph descriptor's import order is exactly the
  reverse of the delete handler's phase order (guards drift).

## Explicitly out of scope (with "add when")

- Direct DB-to-DB transport — add if file round-trips become a bottleneck.
- Postgres COPY streaming — add if NDJSON export of `ds_metrics` is measurably
  too slow.
- tar bundle — add if the single-stream format proves awkward.
- ID remapping / merge-on-import — add if re-importing without delete-first is
  needed.
- Rewiring the delete handler onto the shared descriptor — follow-up once the
  descriptor is proven.
- Profiles export — add if a debug case needs profile config in dev.
