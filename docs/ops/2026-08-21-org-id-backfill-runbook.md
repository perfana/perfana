# Applying the organization_id backfill runbook

Companion to `2026-08-21-org-id-backfill-runbook.sql`. Read this first; run that.

> **Most deployments do not need this file.** Migration
> `1794000000000-BackfillOrganizationId` performs the same repair automatically at
> service startup: it backfills from each row's parent and sets `NOT NULL` per
> table where the result is clean. Upgrade and read the API's startup log.
>
> Use this runbook when you want to inspect before changing anything, when you
> need a snapshot you can revert to precisely, or when the migration logged a
> warning it could not resolve on its own — a row whose parent has no
> organization either. That last case is a decision about who owns the data, and
> no migration should make it for you.

## When you need this

After upgrading past **v0.2.68.6**, lists come back empty even though the data is there:

- SUT configuration view shows no Grafana dashboards, for every SUT
- Compare card's dashboard dropdown is missing performance-metrics dashboards
- Profiles, benchmarks or events look emptier than they should

**Nothing has been deleted.** v0.2.68.7 removed the `OR organization_id IS NULL`
escape from roughly 35 org filters, on the premise that Phase 4 made the column
`NOT NULL`. That is true of a database created *from*
`1700000000000-ConsolidatedSchema.ts`. There is no `ALTER TABLE … SET NOT NULL`
migration, so a database older than that schema still has nullable
`organization_id` and rows where it is `NULL`. Those rows were only ever visible
through the escape. Removing it hid them.

Confirm with phase 0 before doing anything else. If `invisible` is 0 everywhere,
this runbook is not your problem — stop and look elsewhere.

## Decide first: patch or roll back

| | Restores UI | Touches data | Good for |
|---|---|---|---|
| Roll back to 0.2.68.6 | immediately | no | you need the app working *now* |
| This runbook | after phase 2 | yes | the permanent fix |

They compose: roll back to stop the bleeding, then run this at your leisure and
upgrade again. A rollback alone leaves the null rows in place, so the next
upgrade past 0.2.68.6 hides them again.

## Prerequisites

- `psql` against the production database.
- A role that **bypasses RLS** (`rolsuper` or `rolbypassrls`). These tables are
  `FORCE ROW LEVEL SECURITY`; without bypass, every `UPDATE` reports `0` and
  looks like a no-op you already did. Phase 0.1 checks this.
- `pg_dump` on the same host, and somewhere with room for the dump.
- Whoever can answer "which organization owns this SUT" if phase 0.5 finds
  orphans whose parent is also null-org. On a multi-org install that is not a
  guess you may make.

No maintenance window is strictly required — phase 2 takes brief row locks on
config tables, not on the timeseries hypertables. Do it during quiet hours
anyway, so a rollback is boring if you need one.

## Connecting

```bash
# docker compose
docker exec -it <postgres-container> psql -U <user> -d <db>

# kubernetes
kubectl exec -it <postgres-pod> -- psql -U <user> -d <db>

# direct
psql -h <host> -p 5432 -U <user> -d <db>
```

Run interactively, phase by phase, reading the output between phases. Do not
pipe the whole file into psql — phases 2 and 3 are deliberately left
uncommitted and two steps only *generate* SQL for you to review.

## Running it

### Phase 0 — status

Paste each numbered query. Three of them are decision points:

- **0.1** — if `is_superuser` and `can_bypass_rls` are both `false`, **stop**.
  Get a role that bypasses RLS, or every later step silently does nothing.
- **0.2** — any rows listed = this database never got the constraint. Expected;
  it is why you are here.
- **0.5** — `parent_also_null > 0` means some SUTs have no organization either.
  Those must be assigned an owner *before* anything can inherit from them.

**0.4 generates a query rather than running one.** In `psql`, execute the
generated text directly by ending the statement with `\gexec` instead of `;`:

```sql
SELECT string_agg(...)          -- the 0.4 query, without its trailing semicolon
  FROM information_schema.columns
 WHERE ...
\gexec
```

You get one row per table with `total` and `invisible`. Keep this output — it is
your before/after comparison.

### Phase 1 — backup

Both parts, in order.

**1.1** is a shell command, not SQL. Run it outside psql and verify the dump
is readable before continuing. This is the only step that saves you from a
mistake this runbook does not anticipate.

**1.2** creates `org_backfill_backup.<table>` holding `(id, organization_id)`
for exactly the rows about to change. It makes phase 5 an instant, surgical
revert instead of a full restore.

**1.3** must show non-zero `rows_snapshotted` for the tables phase 0.4 said were
affected. If it shows zeroes where 0.4 showed thousands, you are probably
connected as a role without RLS bypass — go back to 0.1.

### Phase 2 — backfill

Opens a transaction and leaves it open. Deliberate.

**2.1 generates the UPDATE statements.** Read them before running. They are all
the same shape — inherit `organization_id` from the row's parent SUT — and the
list of tables should look like configuration data, never `ds_metrics`,
`transactions`, `virtual_users`, `requests_raw` or `requests_error`. If a
hypertable appears, stop and tell whoever maintains this runbook: the exclusion
has broken and a bulk `UPDATE` there rewrites compressed chunks across millions
of rows.

You can `\gexec` these too, but review them first — this step writes.

**2.3** re-runs 0.4's count query *inside the open transaction*. Every
`invisible` must be 0.

```sql
COMMIT;     -- all zero
ROLLBACK;   -- anything left; fix the parent rows and start again
```

Nothing is written until you type `COMMIT`.

### Phase 3 — the constraint

Only after a clean commit. Uncomment one `ALTER TABLE … SET NOT NULL` per table
that phase 0.2 listed, minus `audit_logs*` and the hypertables. Each fails loudly
if a `NULL` survives, which is the point.

Skipping this leaves production disagreeing with what the application asserts,
and the next "this column cannot be null, delete the dead check" cleanup repeats
the incident.

### Phase 4 — verify in the app

- SUT configuration view lists Grafana dashboards again
- Compare card dropdown offers performance-metrics dashboards again
- Spot-check profiles, benchmarks and events — same escape, same effect

### Phase 5 — revert

If the app looks worse rather than better. Restores exactly the `NULL`s that
were there, nothing else. Drop phase 3's constraints first or it fails.

Clean up when satisfied:

```sql
DROP SCHEMA org_backfill_backup CASCADE;
```

## Out of scope, on purpose

**Hypertables.** `ds_metrics`, `transactions`, `virtual_users`, `requests_raw`
and `requests_error` carry `organization_id` too, and are excluded everywhere in
this runbook. They are compressed timeseries of millions of rows, `ds_metrics`
has no `id` column to snapshot, and the dashboard lists do not read them. If a
metrics query is proven to hide rows for the same reason, that is a separate
piece of work with a chunk-aware plan.

**Other deployments.** This repairs one database by hand. Any other install on a
pre-consolidated schema breaks identically on upgrade. The durable fix is a real
migration that backfills and then sets `NOT NULL`, so existing databases converge
with new ones.
