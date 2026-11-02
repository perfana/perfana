# Series grouping: more than one aggregation per group

**Status:** proposed. Follow-up to the series grouping feature shipped in v0.2.97.43
(`2026-11-01-series-grouping-design.md`, `-plan.md`). Not part of PR #701.

**One line:** a grouping rule picks one of `avg` / `sum` / `max` today; let it emit several, with
the primary one keeping the name it has now.

---

## The problem

`series_grouping_rules.aggregation` is a single value, rendered as a `RadioGroup`
(`SeriesGroupingDialog.tsx:425`). The v1 design framed the three choices as *which question are you
asking*:

| Aggregation | The question |
|---|---|
| `avg` (default) | Does each pod use more than before? |
| `sum` | Does the service as a whole cost more? |
| `max` | Is one pod running hot? |

Framed that way one answer per rule looks right. In practice the first two are **complementary, not
alternative**, and reading them together is what distinguishes the two cases a Kubernetes panel most
needs to tell apart:

| | `avg` flat | `avg` up |
|---|---|---|
| **`sum` up** | scale-out — more pods, same cost each. Not a regression. | real regression, amplified by replica count |
| **`sum` flat** | scale-in with hotter pods | real regression on a fixed fleet |

With one aggregation per panel you see one row of that table and cannot place yourself in it.

**The v1 design already half-recognises this.** Its `sum` row says *"Pair it with the member count
series"* — and that pairing is available, because `track_member_count` is a separate boolean that
emits a second series. So the schema already supports "one group, several series"; it just does not
let the second one be another aggregation.

## What already works, so nobody over-builds this

`uq_series_grouping_rules_slot` is `(system_under_test_id, test_environment, workload,
application_dashboard_id, panel_id)` with `NULLS NOT DISTINCT`, and `buildMembership` gives a panel
rule precedence over the dashboard-wide rule of the same dashboard. So **different aggregations on
different panels of one dashboard are available today**, as a dashboard-wide rule plus per-panel
overrides: `avg` on *Pods CPU usage*, `max` on *CPU Throttling*.

The gap this spec closes is narrower than it first looks: **two aggregations on the same panel.**

## Decision: the primary keeps its name, extras are suffixed

A rule gains a set of **extra** aggregations beside its existing primary one.

- The primary aggregation is unchanged and still produces `afterburner-fe`.
- Each extra produces `afterburner-fe (sum)`, `afterburner-fe (max)`.
- The suffix shape matches `afterburner-fe (pod count)`, which `track_member_count` already emits,
  so the naming convention is not new.

**This is the whole safety argument, and it is the reason not to do the obvious thing.** Suffixing
*every* series — `afterburner-fe (avg)` — is cleaner to read and is wrong: `ds_metric_statistics`,
`ds_adapt_results`, `benchmarks` and `ds_compare_config` all key on `metric_name`, and nothing
migrates a stored name. The moment someone ticked a second box, every baseline, SLO and compare
config on that panel would stop matching and the panel would go `incomparable` — the exact failure
series grouping exists to fix, reintroduced by the feature's own follow-up. Keeping the primary
unsuffixed makes the change purely additive: ticking a box adds series and moves nothing.

Corollary: **changing which aggregation is primary still renames the unsuffixed series**, and that
is a real baseline break. The dialog has to say so (see UI, below). It is the same class of warning
the dialog already shows for a group name that collides with a raw baseline series.

## Schema (migration 1820)

Add one column to each of the two tables. Keep the existing `aggregation` column exactly as it is —
every current reader keeps working untouched.

```sql
ALTER TABLE series_grouping_rules
  ADD COLUMN extra_aggregations varchar(8)[] NOT NULL DEFAULT '{}';

ALTER TABLE ds_metric_series_groups
  ADD COLUMN extra_aggregations varchar(8)[] NOT NULL DEFAULT '{}';
```

With a CHECK on the rules table mirroring `ck_series_grouping_rules_aggregation`:

```sql
ALTER TABLE series_grouping_rules
  ADD CONSTRAINT ck_series_grouping_rules_extra_aggregations
  CHECK (extra_aggregations <@ ARRAY['avg','sum','max']::varchar(8)[]
         AND NOT (aggregation = ANY (extra_aggregations))
         AND array_length(extra_aggregations, 1) IS DISTINCT FROM 0);
```

The second clause is what stops a rule emitting `afterburner-fe` and `afterburner-fe (avg)` as two
copies of one series. Uniqueness *within* the array is not expressible in a cheap CHECK and is
enforced in the DTO instead; a duplicate would produce two identical extra series rather than
anything unsafe.

Three notes on the table choices:

1. **`ds_metric_series_groups` needs the column too**, not just the rules table. Its row is the
   record of what the run's statistics were actually computed with — that is the whole reason
   `aggregation` is already duplicated onto it — and `SeriesGroupResolver` reads membership in
   preference to the live rule so a chart agrees with the numbers beside it after the rule changes.
2. **Its primary key does not move.** `pk_ds_metric_series_groups` is `(test_run_id,
   application_dashboard_id, panel_id, metric_name)` — one row per *raw* series. Extras are a
   property of the group that raw series belongs to, so they ride on the existing row as an array.
   Emitting one membership row per (raw series x aggregation) would require changing the PK and is
   not worth it.
3. **Follow 1809's lock discipline, not 1807's.** Both tables are written inside the analytics
   transaction, which runs for up to `AGGREGATION_STATEMENT_TIMEOUT_MS` (540 s), and `ALTER TABLE`
   needs ACCESS EXCLUSIVE. Use the plpgsql retry with a 3 s `lock_timeout`, on `up()` and `down()`.
   Nothing declares `depends_on: perfana-migration`, so the worker is live during the migration.

Also add the column to `ConsolidatedSchema.ts` — a column that reaches only the migration exists on
upgraded databases and not on new installs (root CLAUDE.md, `SCHEMA_DRIFT_CHECK`).

## The grouped statement

`buildGroupedStatisticsSQL` (`apps/worker/src/pipelines/helpers/series-grouping-plan.ts`) needs one
more arm on the `points` CTE. The shape already exists — the member-count arm at line ~366 is
exactly it:

```sql
points AS (
    SELECT …, group_name AS metric_name, value, …            FROM grouped_points
    UNION ALL
    SELECT …, member_count_name AS metric_name, member_count::double precision, …
      FROM grouped_points WHERE track_member_count AND member_count_name IS NOT NULL
    UNION ALL                                                 -- NEW
    SELECT …, group_name || ' (' || x.agg || ')' AS metric_name, x.value, …
      FROM grouped_points gp
      CROSS JOIN LATERAL unnest(gp.extra_aggregations) AS x(agg)   -- see below
)
```

`grouped_points` currently computes one value per group per timestamp with
`CASE MIN(s.aggregation) …`. For extras it has to compute all three and pick per arm. The cheapest
form is to keep the primary `CASE` as-is and add three more aggregate expressions to
`grouped_points` (`AVG(m.value) AS v_avg, SUM(m.value) AS v_sum, MAX(m.value) AS v_max`), then have
the new arm select among them. Postgres computes the three in the same `GROUP BY` pass, so the extra
cost is three aggregate states per group rather than a second scan.

**Measure before assuming it is free.** The grouped statement was 3.0 s on 1.87 M compressed rows
with merge joins off, and it reads the run's whole segment because it filters on `test_run_id` only.
Worst case here is 3x the rows entering `buildStatisticsCtes`, each carrying a `percentile_agg`
sketch — which is the thing `AGGREGATION_WORK_MEM` (128MB) is sized for. A dashboard-wide rule with
all three aggregations on a 20 M-row run is the case to measure, and it is the same measurement
already owed in TODOS.md under "Re-measure the grouped statistics at production scale".

`groupedStatementParams` gains a ninth bound array (`rows.map((r) => r.extra_aggregations)`), and
the `$n` arithmetic in `buildGroupedStatisticsSQL` moves with it. That arithmetic is pinned by the
SQL snapshot test, which will need updating — deliberately, not by regenerating blindly.

`enable_mergejoin = off` still applies to the whole statement; nothing here changes that.

## The resolver

**This is the smallest part, and the member-count precedent does all the work.**
`expandSeriesNames` (`apps/api/src/modules/metrics/series-group-resolver.ts`) already synthesises a
derived group for the member-count name with its own aggregation:

```ts
if (g.memberCountName && !byName.has(g.memberCountName)) {
  byName.set(g.memberCountName, { group: g.memberCountName, members: g.members,
                                  aggregation: 'count', memberCountName: null });
}
```

The extras are the same four lines:

```ts
for (const extra of g.extraAggregations ?? []) {
  const name = `${g.group} (${extra})`;
  if (!byName.has(name)) {
    byName.set(name, { group: name, members: g.members, aggregation: extra, memberCountName: null });
  }
}
```

`SeriesGroup.aggregation` is already wider than `SeriesGroupingAggregation` (it carries `'count'`),
so no type widens. `groupsFromMembership` and `groupsFromRule` each gain one field. `isRealGroup`
is unaffected: an extra series inherits the members of a group that already passed it.

The `!byName.has(name)` guard matters for the same reason it does for the member count — a raw
series literally named `afterburner-fe (sum)` wins, and the extra is dropped rather than shadowing
real data.

## The UI

`SeriesGroupingDialog.tsx`: keep the `RadioGroup` as the **primary** aggregation and add a
checkbox group beneath it, "Also add", offering the two aggregations that are not primary. Both
feed `ruleFields` alongside the existing `trackMemberCount`.

Three things the dialog must do:

1. **Preview the extra series.** The preview table lists each group with its members; an extra
   aggregation adds a row per group. The counts in *"After: 2 of 2 groups match"* should keep
   counting **groups**, not series, or ticking a box inflates a number that is about baseline
   matching.
2. **Warn when the primary changes on an existing rule**, because that renames the unsuffixed
   series and breaks its baselines, SLOs and compare configs. Same treatment as the existing
   raw-name-collision warning. Ticking or unticking an extra needs no warning — unticking removes
   a series, which `deleteOrphanedResults` already handles.
3. **Badge the extras in the picker.** A `(sum)` series is a group; it should carry the same
   `N pods` badge, which it will, because the resolver returns it as a `SeriesGroup` with the
   group's members.

The series-count warning is worth taking seriously: a dashboard-wide rule over 6 panels, 2
deployments, 3 aggregations and a pod count is 48 series where the current picker shows 8 for 2
panels. Consider defaulting extras off and offering them per panel rather than dashboard-wide — or
at least say the resulting count in the dialog before Save.

## What must not change

- The **no-rule SQL path stays byte-identical.** The existing snapshot covers it; this change must
  not touch `statistics-sql.ts`.
- A rule with an empty `extra_aggregations` must emit exactly what it emits today, so an existing
  run recalculated after the migration produces the same series names and the same values. This is
  the regression test that matters most.
- `count` in `ds_metric_statistics` stays the number of timestamps in the group, for every arm, so
  `ADAPT_MIN_SAMPLE_COUNT` keeps meaning per-run density.

## Rollout

A rule's extras take effect on the next **statistics recalculation**, like every other rule change —
a plain re-evaluate does not run `StatisticsPipeline`. The dialog's *Save and recalculate* covers it.

A worker rolled out before migration 1820 reads no `extra_aggregations` column and fails
`statistics-calculation` with 42703; the worker has no boot-time column probe (already an open
TODOS.md item from v0.2.96.4's migration 1809, same shape). Order the migration before the worker,
or accept the window.

## Test plan

- `applySeriesGrouping` is untouched — assert that explicitly, so a future reader does not go
  looking for grouping-logic changes.
- Snapshot: a rule with no extras emits the v0.2.97.43 grouped SQL and parameters.
- A rule with `avg` primary + `sum` extra emits `afterburner-fe` and `afterburner-fe (sum)`, and the
  values equal a hand-computed per-timestamp `AVG` and `SUM` over the members.
- `expandSeriesNames` resolves `afterburner-fe (sum)` to the group's members with `aggregation:
  'sum'`, and a raw series of that exact name wins over the synthesised one.
- The CHECK refuses `aggregation = 'avg'` with `extra_aggregations = '{avg}'`.
- A run analysed before the migration, recalculated after it with an unchanged rule, produces
  byte-identical `ds_metric_statistics` rows.

## Open questions

1. **Per-panel or dashboard-wide?** Extras multiply series count by panel. Restricting them to
   panel rules keeps the blast radius small at the cost of making the common case (one CPU panel)
   take two rules.
2. **Should `sum` imply the member count?** The v1 design recommends the pairing in prose and the
   dialog does not enforce it. If extras ship, auto-ticking the member count when `sum` is selected
   is a one-line nudge that makes the scale-out-vs-regression read work by default.
3. **Is `max` worth including in extras at all,** or is it always the primary question when you ask
   it? No data either way; ship all three and look at what `origin` and the rule rows say after a
   few weeks, the same way `SUGGEST_MAX_MATCHED_BEFORE` is meant to be tuned.
