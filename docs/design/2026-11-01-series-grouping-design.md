# Series grouping: compare Kubernetes metrics whose names change every deployment

**Date:** 2026-11-01
**Status:** Design agreed. All five open questions were decided on 2026-11-01 (see Decisions at the
end). Implementation plan: [`2026-11-01-series-grouping-plan.md`](2026-11-01-series-grouping-plan.md).
Corrections found while planning are applied below.
**Scope:** worker (`StatisticsPipeline`), API (rules, preview, group-aware `ds_metrics` reads), web
(anomaly-detection card, Compare card, system config, series picker), `packages/shared` (one
grouping function).

## Problem

Perfana compares series by exact name. Kubernetes resource dashboards name their series after pods
(`api-7d9f8c6b5-x2k4p`), and the pod name changes on every deployment, and on every restart for the
last segment. Two runs of the same build therefore share no series names, so neither ADAPT nor the
Compare card has anything to compare.

How the name gets there and where it is matched:

- **Naming.** A series' `metric_name` is the name Grafana displays for it: `displayNameFromDS`, else
  `field.name` (`packages/shared/src/services/grafana/formatter.ts:244`). The structured labels on each
  frame field (`pod`, `container`, `namespace`) are discarded. A `{{pod}}` legend therefore produces a
  new name per deployment.
- **Matching.** Every comparison matches that name with `=`:
  - ADAPT's control-group join (`apps/worker/src/pipelines/helpers/adapt/results/sql-builder.ts:207`,
    `ControlGroupStatisticsPipeline.ts:576`)
  - the compare-config hierarchy (`sql-builder.ts:229`)
  - the Compare table: `useCompareData.ts:244`, a `===` over `/metrics/ds-metric-statistics`
  - the Compare chart: `/metrics/ds-metrics-comparison` → `findDSMetricsForPanel`, `metric_name = $n`
  - SLOs (`DataAggregator` reads `ds_metric_statistics`)
  - `sparse_metric_exclusions`, `ds_compare_config.metric_name`, tracked regressions

**What the user sees is worse than an error.** A series with no control row is labelled `incomparable`
(`sql-builder.ts:300`), and `incomparable` never produces a `regression`. A real CPU or memory
regression on a Kubernetes dashboard is therefore not reported at all: the anomaly card shows a
list of greyed-out series and an overall verdict that does not account for them. An SLO on a pod
series also stops matching after the next deployment, so it stops being evaluated.

## Premises

1. **Nobody wants to compare pod `x2k4p` against pod `q8r2m`.** The question is whether the service
   used more CPU, memory or restarts than in the baseline. The unit of comparison is the workload
   (Deployment, StatefulSet, container), not the pod. The fix is to choose what gets compared, not to
   match names more loosely.
2. **Fuzzy 1:1 pairing is the trap to avoid.** With three pods on each side, any pairing is
   arbitrary and the comparison measures noise. When the replica count differs (HPA), there is no
   pairing at all. The model that holds is **group, then combine**: map many series to one group name
   and combine them per timestamp with an explicit aggregation.
3. **Fixing it in Grafana is valid, but not sufficient.** `sum by (container) (...)` with a
   `{{container}}` legend solves it with no Perfana change. Many teams use shared kube-prometheus
   dashboards they cannot edit, though, and the per-pod view is still useful for drill-down. Perfana
   should offer grouping and keep the raw per-pod series.

## Goal

A user can declare, per panel or per dashboard of a workload, that series whose names differ only by
a pod-name segment are one series combined by average, total or maximum. Once declared:

- ADAPT, the Compare table, SLOs, tracked regressions and Trends compare the group across runs.
- Charts can draw the group, or the individual pods behind it.
- Baseline runs are brought onto the same grouping without re-fetching anything from Grafana.
- The user is offered the rule where the problem shows (incomparable series in the anomaly card),
  with a preview built from this run's and the baseline's real names before anything is saved.

## Approach (recommended): group at the statistics layer, keep `ds_metrics` raw

`StatisticsPipeline` writes grouped rows into `ds_metric_statistics` under the group name, computed
from the raw per-pod rows in `ds_metrics`. `ds_metrics` is never modified.

Why this layer:

- **Every comparison already reads `ds_metric_statistics`**, or tables derived from it. That covers
  ADAPT (`ds_control_group_statistics` pools it via `rollup(pct_agg)`), the Compare table, SLO checks
  and the sparse-metric sanity check. All of them pick up a group name with no change, because a group
  name is just a `metric_name`.
- **It works on old runs without Grafana.** Recalculating statistics reads only `ds_metrics` (worker
  `CLAUDE.md`, "Recalculating fetches nothing"). Baselines whose Prometheus retention has expired can
  still be regrouped.
- **It never writes to the compressed hypertable.** `ds_metrics` is `compress_segmentby = test_run_id`.
  Writing grouped rows into it, or deleting them again when a rule changes, would be DML on a predicate
  other than `test_run_id`: the decompression / WAL trap in root `CLAUDE.md` #23 and #39.
- **The raw per-pod rows stay**, so drill-down keeps working and a rule can be changed or removed at
  any time.

### Rejected alternatives

| Alternative | Why not |
|---|---|
| **Group at collection** (formatter writes combined rows to `ds_metrics`) | Every reader works unchanged, but a rule only applies to runs collected after it exists. Baselines would need a force re-fetch from Grafana, which fails once Prometheus retention has passed, and the per-pod data is lost. Changing a rule later would mean deleting rows by `metric_name` on a compressed hypertable. |
| **Fuzzy pairing at compare time** (edit distance, longest common prefix) | Arbitrary when there are several pods per side, impossible when replica counts differ (premise 2). |
| **Read-time grouping in every comparison reader** (`regexp_replace` inside ADAPT, Compare and SLO SQL) | Every reader would have to agree on the same regex. Postgres ARE and JavaScript regex are different dialects, a lesson already paid for by the perf-test profile SLO regex (worker `CLAUDE.md`: "`\b` is a backspace in ARE"). `pct_agg` would also have to be rebuilt per read. |
| **Fix it only in Grafana** | Recorded as documentation, not as the feature (premise 3). |
| **Group by label** (capture `field.labels`) | The best long-term UX ("compare by `container`, `namespace`; ignore `pod`"), but it needs labels stored, which today are discarded, and it only works for datasources that return labels. Planned as v2 on top of this design (see Phasing); the statistics-layer grouping below stays the engine. |

## Concepts

- **Rule.** Belongs to a workload's application dashboard, either for one panel or for every panel on
  that dashboard. Fields: a **pattern** that rewrites a series name to its group name, an
  **aggregation** (`avg` | `sum` | `max`), and **track member count** (boolean). A panel rule
  overrides a dashboard rule; there is no merging between the two.
- **Group.** All series on a panel whose rewritten names are equal. A name the pattern does not change
  is a group of one. A group of one aggregates to its own values, so applying a rule to a panel never
  changes the numbers of series it does not match.
- **Member.** A raw series in a group, in one run. Membership is per run, so a group can have 3 pods
  in the baseline and 5 in the current run.
- **Member count series.** An optional extra series per group, `<group> (pod count)`: the number of
  members reporting at each timestamp. ADAPT then shows "6 pods vs 3 in the baseline" as its own
  difference instead of hiding it inside a usage change. With the default compare config
  (`higherIsBetter: null`) this is an `increase`/`decrease`, never a `regression` (`buildConclusionLogic`
  emits `regression` only for an explicit `true`/`false`), which is the right default.

### Aggregation semantics

Members are combined **per timestamp first**. The statistics (mean, percentiles, `pct_agg`, trend)
are then computed over that combined series across time, exactly as for any other series.

| Aggregation | Use it for | Behaviour when the replica count changes |
|---|---|---|
| `avg` (**default**) | "Does each pod use more than before?" (CPU / memory per pod) | Unaffected by replica count, so an HPA scale-out does not read as a regression. |
| `sum` | "Does the service as a whole cost more?" (footprint, capacity) | Moves with replica count. Pair it with the member count series. |
| `max` | "Is one pod running hot?" (skew, a leaking pod) | Unaffected by replica count; sensitive to a single outlier. |

`count` in `ds_metric_statistics` becomes the number of **timestamps** in the group, not the number
of pod samples. That keeps `ADAPT_MIN_SAMPLE_COUNT` meaning what it means today: per-run density of the
series being compared.

A rolling deploy in the middle of a test means old and new pods overlap for a while. During that time
`avg` dips (a terminating pod at low usage), `sum` spikes, and the member count series shows the
overlap. This is documented behaviour, not a bug to smooth over.

### Patterns

Presets cover the common Kubernetes cases. A custom regex covers everything else. Each preset is a
regex plus replacement, applied with JavaScript `String.prototype.replace` and validated with
`validateRegexPattern` (`packages/shared/src/utils/safe-regex.ts:99`, the same ReDoS guard the SLO
`matchPattern` uses).

| Preset | Matches | Replacement | Example |
|---|---|---|---|
| **Kubernetes pod (Deployment / ReplicaSet)** (default) | `-<hash>-<suffix>` where both use Kubernetes' generated-name alphabet: no vowels, no `0`, `1` or `3` (`[bcdfghjklmnpqrstvwxz2456789]`), hash 6–10 characters, suffix exactly 5, followed by end of name or a character that cannot be part of a pod name | removed | `api-7d9f8c6b5-x2k4p` → `api` |
| **Kubernetes pod (DaemonSet / Job)** | `-<suffix>` with the same alphabet, exactly 5 characters, same boundary | removed | `node-exporter-h5k2l` → `node-exporter` |
| **IP address and port** | `\d{1,3}(\.\d{1,3}){3}(:\d+)?` | `*` | `10.42.3.17:8080` → `*` |
| **Trailing ID** | `[-_][a-z0-9]{4,}$` | removed | for non-Kubernetes generated names |
| **Custom** | user regex | user replacement (`$1` allowed) | |

Notes on the presets:

- The pattern is applied **anywhere in the name**, not only at the end, because the pod name is often
  one part of a longer legend, e.g. `{{pod}} / {{container}}`, or the raw `metric{pod="…"}` string
  Grafana falls back to when a panel has no legend.
- Restricting the alphabet is what keeps false positives rare: ordinary words (`-heap-used`,
  `-response-time`) contain vowels. The 6-character minimum on the hash gives up an astronomically rare
  short hash in exchange for fewer accidental matches. The test corpus (see Testing) is where that
  trade gets checked.
- StatefulSet pods (`db-0`, `db-1`) are stable across deployments and need no rule. Merging them is a
  deliberate choice for a custom rule (`-\d+$`), not a preset default.
- Node names change too on autoscaled node pools (`aks-nodepool1-…-vmss000003`,
  `ip-10-0-1-23.ec2.internal`). They are left to custom rules in v1; a preset is a v1.1 candidate once
  real names have been collected.

**One implementation, three callers.** `applySeriesGrouping(rule, names)` lives in
`packages/shared/src/utils/series-grouping.ts` and is exported through the existing `./utils` entry in
`packages/shared/package.json` (`npm run check:workspace-exports` must stay green). The worker uses it
to build the mapping, the API uses it for previews and suggestions, and the web uses it for the
instant preview in the dialog. The regex never reaches Postgres, so the preview cannot disagree with
what the worker does.

## Data model

### `series_grouping_rules` (new, owned resource)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `system_under_test_id` | uuid FK → `systems_under_test` ON DELETE CASCADE | |
| `test_environment` | varchar(255) | |
| `workload` | varchar(255) | Scoped to the workload, the same way `ds_compare_config` and the analysis window are. |
| `application_dashboard_id` | uuid FK → `application_dashboards` ON DELETE CASCADE | Needs an index leading on it (root `CLAUDE.md` #57: an unindexed child turns every parent delete into a scan). |
| `panel_id` | integer NULL | NULL means every panel on the dashboard. |
| `preset` | varchar(32) | `k8s-pod`, `k8s-daemonset`, `ip-port`, `trailing-id`, `custom` |
| `pattern` | text NULL | Required for `custom`, NULL for presets (preset regexes live in code so they can be fixed in one place). |
| `replacement` | text NOT NULL DEFAULT `''` | |
| `aggregation` | varchar(8) CHECK in (`avg`,`sum`,`max`) | |
| `track_member_count` | boolean NOT NULL DEFAULT false | |
| `enabled` | boolean NOT NULL DEFAULT true | |
| `origin` | varchar(16) NOT NULL DEFAULT `'manual'` CHECK in (`manual`,`suggestion`,`copy`) | How the rule was created. Lets the suggestion thresholds be tuned from real acceptance data (Decision 5). |
| `organization_id` | uuid NOT NULL | Pattern A in root `CLAUDE.md`: inherit from the application dashboard, using the camelCase `organizationId` in `repo.create`. |
| `team_id`, `created_by`, `updated_by`, `created_at`, `updated_at` | | Standard ownership columns. |

- **Uniqueness:** `UNIQUE NULLS NOT DISTINCT (system_under_test_id, test_environment, workload,
  application_dashboard_id, panel_id)` (PG15+, which the image is). A plain unique index lets two
  dashboard-wide rules coexist because NULLs never collide, the same trap as `uq_benchmarks_unique` in
  root `CLAUDE.md` #36.
- **Audit:** `static auditableFields` lists every column above except the ownership columns and
  timestamps. A rule changes ADAPT verdicts, so it must appear in the audit log like
  `DsCompareConfig`.
- **RLS:** a policy like the other owned-resource tables, plus grants for `perfana_app` (API) and
  `perfana_system` (worker reads only).
- **SUT transfer:** add the table to `apps/api/src/modules/sut-transfer/sut-resource-graph.ts`.
  Mind the `json_populate_recordset` trap from worker `CLAUDE.md` ("An Apdex SLO has a sample floor",
  item 3): a column added later with `NOT NULL DEFAULT x` rejects every older bundle. The defaults
  above are fine on day one; the trap applies to columns added later.

### `ds_metric_series_groups` (new, derived)

The membership a run's statistics were computed with: one row per raw series of a grouped panel.

| Column | Notes |
|---|---|
| `test_run_id`, `application_dashboard_id`, `panel_id` | |
| `metric_name` | the raw series name |
| `group_name` | |
| `rule_id` | FK → `series_grouping_rules` ON DELETE SET NULL |
| `rule_hash` | Hash of the rule fields at the time it was applied; used for stale detection. |
| `aggregation` | Copied from the rule, so a chart can redraw the group without the rule. |
| `dashboard_label`, `panel_title` | Copied from `ds_metrics`. Some readers (`getMetricTimeSeries`, the reports) address a panel by label and title rather than by id. |
| `avg_members` | Average members reporting per timestamp, from the grouped aggregation; the alignment signal. |
| `organization_id`, `team_id` | |

- A plain table, not a hypertable. Size is the number of raw series on grouped panels, per run:
  hundreds of rows, not millions.
- Written by `StatisticsPipeline` inside the same transaction as `ds_metric_statistics`, using the
  same delete-then-insert per run. Statistics and membership can therefore never disagree.
- Indexed on `(test_run_id, application_dashboard_id, panel_id, group_name)` for chart expansion, and
  leading on `application_dashboard_id` for the FK (#57).
- Included in the SUT transfer bundle alongside `ds_metric_statistics`, which it explains.
- Also covered by the SUT deletion queue (root `CLAUDE.md` #57, `deletion_status`).

## Worker changes

### `StatisticsPipeline.aggregateMetricStatistics`

1. **Load the rules** for each run's `(system_under_test, environment, workload)` **before**
   `withAnalyticsTransaction`, through the pooled connection, after a `to_regclass` probe for the
   table. This lookup **fails open**: if the table does not exist yet (a worker rolled out before the
   migration) or the read throws, log a warning and aggregate with no rules. Without that, a
   rollout-order mistake fails every `statistics-calculation`; the worker has no boot-time schema probe
   (worker `CLAUDE.md`, Trend SLO item 3). It must run outside the transaction because an error inside
   one aborts it (25P02), and `statistics-calculation` is not `softFail`, so it would fail the whole
   re-evaluate batch.
2. **Read the raw names** of the dashboards the rules touch, once per run: `SELECT
   application_dashboard_id, panel_id, metric_name … FROM ds_metrics WHERE test_run_id = $1 AND
   application_dashboard_id = ANY($2) GROUP BY 1, 2, 3`. This reads those dashboards' rows once, the
   same order of cost as the aggregation itself. If measurement shows it matters, fall back to
   per-panel `SELECT DISTINCT metric_name … AND panel_id = $3` probes, which TimescaleDB SkipScans
   when the leading index columns are fixed (worker `CLAUDE.md` item 7).
3. **Build the mapping** with `applySeriesGrouping` and insert it into `ds_metric_series_groups`.
4. **Aggregate grouped panels in a second statement, never inside the existing one:**
   - The existing `INSERT` gains one predicate that excludes the grouped `(run, dashboard, panel)`
     triples, and only when there are any. With no rules its SQL is byte-identical to today's.
   - A second `INSERT INTO ds_metric_statistics` reads only the grouped panels' rows, combines them per
     timestamp (`avg` / `sum` / `max`, plus the member count series when tracked), and feeds the result
     into the same statistics chain, extracted into a builder both statements share.
   - A `UNION ALL` into the existing CTE was rejected: it references `metrics_filtered` twice, and a
     CTE referenced twice is materialised, which would push the whole run's raw rows through a
     tuplestore (worker `CLAUDE.md`, panel 304, "Group once, then roll up").
5. Everything downstream is unchanged: `pct_agg`, `sum_value` / `sum_sq_value`, `last_value`, trend,
   and the `INSERT INTO ds_metric_statistics`.

Three planner cautions, each a lesson already written down in worker `CLAUDE.md`:

- **The ungrouped statement must keep its current plan.** The `ds_metrics_groupkey` statistics object
  (#13) is what stops `statistics_aggregated` spilling an `external merge` sort. Pin today's SQL with a
  snapshot test before refactoring. Prove with `EXPLAIN (ANALYZE, BUFFERS)` on a production-sized run
  that the plan is unchanged, and that output for runs with no rules is byte-identical before and after
  (a `FULL JOIN` of old against new, as the v0.2.93.1 fix did).
- **Rows inserted in the same transaction are invisible to the planner.** The mapping is written
  moments before the aggregation reads it, the same shape that made `deleteOrphanedResults` go
  quadratic (worker `CLAUDE.md`, "`ds_adapt_results` is written by an upsert", item 3). Pass the
  mapping as `unnest($raw::text[], $group::text[])` arrays, or `ANALYZE` it, rather than trusting a
  join against a table the planner believes is empty.
- **The grouped step adds a `GROUP BY` over raw rows**, but only for grouped panels. Budget it under
  the existing `AGGREGATION_WORK_MEM`, and measure on a run with a large grouped panel (hundreds of
  pods) before raising anything.

**Timestamp alignment (v1):** members are combined on exact `time`. Prometheus range queries are
aligned to the step, so pods share timestamps. A source that does not align them would produce
"groups" whose timestamps each have one member. v1 detects this (average members per timestamp ≈ 1
while the group has more than one member, stored as `avg_members`) and warns in the worker log, in the
anomaly card's status notice, and in the dialog preview of a panel that has been grouped before,
instead of silently storing a meaningless average. A first-time preview cannot know it without reading
raw series, which the preview never does. Bucketing on `timestep` for unaligned sources is deferred to
v2.

- **Baselines that take the legacy control-group path lose their groups.** When any control run has
  `pct_agg IS NULL`, `ControlGroupStatisticsPipeline` re-reads raw `ds_metrics` by raw name, and a
  group name has no raw counterpart there. `backfillMissingSketches` reruns `StatisticsPipeline`, and
  so the grouping, first, so this bites only when that best-effort backfill fails. The result is
  `incomparable`, not a wrong verdict, and v1 logs a warning rather than duplicating the grouping SQL
  into the legacy path.

### Unchanged, and why that is correct

- **`ControlGroupStatisticsPipeline`** pools `ds_metric_statistics` rows by name. Once the baseline
  runs are recalculated, it pools the group. If a baseline run has not been recalculated, it lacks the
  group row and simply contributes nothing; the pipeline already pools "whichever control runs have the
  row" (worker `CLAUDE.md`, Concurrency panels).
- **`AdaptPipeline`.** The per-pod `ds_adapt_results` rows lose their statistics rows and are removed
  by `deleteOrphanedResults` in the same stage.
- **`ChecksPipeline` / `DataAggregator`** read `ds_metric_statistics`, so SLOs match group names. A
  `matchPattern` written against pod names, e.g. `^api-`, may stop matching the group name `api`. The
  preview lists the SLOs on the panel and whether their pattern still matches (see UI).
- **`DataSanityCheckPipeline`** sums `ds_metric_statistics.count`, so a group is one metric with its
  timestamp count, not N sparse pods.
- **Collection, `ds_metrics` and the incremental ticks** are untouched. The perf-test dashboards are
  out of scope and never get rules (their series names are stable).

## API changes

### Rules

`/series-grouping-rules`: CRUD scoped by `(systemId, environment, workload)`. Follow the RBAC shape in
root `CLAUDE.md` #48:

- resolve `accessibleOrgIds` once per request with `withOrgFilter` and pass it to every route as a
  **required** parameter;
- answer **404, not 403**, for a rule outside the caller's organizations;
- return `[]` early on an empty org list;
- authorize the `application_dashboard_id` the caller supplies **before** inheriting its
  organization.

Creating the second rule on a slot that already has one is a constraint violation the user must act
on: a 409 with no body. See "Turning a constraint violation into a 409" in
`apps/api/CODING_RULES.md`.

**Copying to other workloads (Decision 2).** `POST` accepts an optional `copyTo: [{ environment,
workload }]` listing other workloads of the **same system**:

- Each entry becomes its own rule row with `origin = 'copy'`, so the copies can diverge later.
- Each target is authorized on its own, exactly like the primary rule.
- Application dashboards are per **system and environment**, shared by every workload of that
  environment (`uq_application_dashboards_unique` has no workload column). A copy to another workload
  of the **same environment** therefore keeps the same `application_dashboard_id` and `panel_id`. A
  copy to a **different environment** resolves that environment's application dashboard for the same
  Grafana dashboard, matching on `dashboard_uid` **and** `grafana_instance_id`, since a uid is unique
  only within one Grafana instance (root `CLAUDE.md`, "`grafana_dashboards` is a mixed table", trap
  3). A target environment without that dashboard is skipped.
- A target slot that already has a rule is skipped, never overwritten.
- The response lists created and skipped targets with the reason for each.
- Recalculation runs only for the current workload. The copied workloads show the stale notice until
  someone recalculates them, because one save must not fan out into re-evaluating several workloads.

### Preview

`POST /series-grouping-rules/preview` with `{ testRunId, applicationDashboardId, panelId?, rule }`.
Read-only. It covers the run and each run of its current control group. The control group comes from
the latest `ds_adapt_conclusion` row's `control_group_id` → `ds_control_groups.test_runs`.
(`details.controlRuns`, which the **Recalculate baseline statistics** button reads, is written only
for an INSUFFICIENT_DATA conclusion caused by a failed baseline aggregation, so it is not a general
source.) A run with no conclusion yet falls back to the workload's most recent completed runs. It
returns:

- each run's raw names per panel; the client computes groups with `applySeriesGrouping`, so the
  preview is fetched once per dialog, not per keystroke;
- the SLOs on the panel whose `matchPattern` would match nothing after grouping;
- raw baseline names that equal a new group name (see "Applying a rule");
- the timestamp-alignment signal, for panels a previous rule already grouped.

Names come from `ds_metric_statistics` and, for grouped panels, `ds_metric_series_groups`. Both are
small tables; the preview never reads `ds_metrics`.

### Suggestions

`GET /test-runs/:id/series-grouping-suggestions` returns panels where:

- at least 2 ADAPT results are `incomparable`;
- the run shares few names with its control group;
- applying a preset raises the matched fraction substantially (thresholds tuned against real data;
  start at "under 50% matched before, over 90% after").

It reads only small tables: `ds_adapt_results` labels, `ds_metric_statistics` names and
`ds_control_group_statistics` names. Panels that already have a rule are excluded. Computing this on
request keeps detection out of the worker entirely.

**Measuring the thresholds (Decision 5).** v1 ships with the 50% / 90% defaults as named constants and
collects the data to tune them:

- Every suggestion served is logged at info as `series-grouping suggestion <testRunId>
  <dashboardId>/<panelId> preset=<p> matched <before>% -> <after>% incomparable=<n>`.
- A rule saved from a suggestion is stored with `origin = 'suggestion'`.

The acceptance rate per preset and per threshold band then comes from joining the two. Dismissals are
per viewer (in `localStorage`) and are not measured server-side; a suggestion that is ignored and a
suggestion that is dismissed look the same in this data.

### Applying a rule to runs that already exist

Saving a rule changes nothing until statistics are recalculated. The save response therefore offers,
and the dialog defaults to, re-evaluating with `recalculateStatistics` over:

- **this run plus its current baseline runs** (default), or
- **the most recent runs of the workload, up to 100**.

Both reuse the bulk re-evaluate path the analysis-window apply already uses: one function partitions
the runs for both the preview and the write, `MAX_BULK_ANALYSIS_TIME_RANGE_RUNS` sets the cap, and
`running` and `not-writable` runs are reported as skipped.

**Unlike the analysis window, a partial application is safe**, so truncating to the most recent runs
is acceptable here. An unrecalculated run does not contribute *wrong* numbers to a group; it
contributes *no* row, so the baseline is smaller rather than mixed. (The analysis-window cap refuses
instead of truncating because there an untrimmed run would pool mismatched data; see worker
`CLAUDE.md`, "An analysis window belongs to a workload".) There is one exception: an old run with an
ungrouped series whose raw name happens to equal a group name, e.g. a legend that was already
`{{container}}`. That run pools its raw value into the group. The preview flags exact name equality
between raw baseline names and new group names.

### Stale detection

A run is stale for grouping when, for a grouped panel, the `rule_hash` in its `ds_metric_series_groups`
rows does not match the current rule, or the rule exists and the run has no membership rows. Expose
this alongside the existing ADAPT staleness so the anomaly card can say *"Grouping rule changed —
recalculate N runs"*.

### `ds_metrics` readers must become group-aware

These read raw series names and values, not statistics. Two kinds of failure are possible:

- **Showing per-pod lines** where a group exists. Harmless; this is the degraded mode.
- **Being handed a group name and finding nothing in `ds_metrics`**, which draws an empty chart. This
  is the same silent-empty symptom as root `CLAUDE.md` #18, #20 and #49. It happens wherever a group
  name chosen from statistics comes back to a raw reader: a saved graph preset, a report section, a
  Compare chart, a deep link.

One shared API helper, `resolveSeriesMembers(testRunId, applicationDashboardId, panelId, names)`, maps
group names to their members using `ds_metric_series_groups`. While a run is live, before any
membership exists, it falls back to applying the current rule with `applySeriesGrouping`. Readers then
fetch the members and combine them per timestamp with the stored aggregation.

| Route / reader | Change |
|---|---|
| `GET /metrics/ds-metrics/available/:testRunId`, `GET /metrics/ds-metrics/distinct-names` (series picker) | For grouped panels, return group names, each with its members and a member count. |
| `GET /metrics/ds-metrics/:testRunId/:panelId`, `GET /metrics/ds-metrics/time-series/:testRunId` (Graphs, Trends, Compare charts) | Expand a group name and aggregate. `?members=true` returns the per-pod series for drill-down. |
| `GET /metrics/ds-metrics-comparison` (Compare chart) | Expand per run independently: the two runs have different members. |
| `report-data-fetcher.service.ts` | Same helper, so a report section built from a preset that holds a group name renders. |
| MCP tools (`get_available_metrics`, `get_metric_trends`) | No change of their own: `apps/mcp` reads over the API routes above, so it gets group names with them. |

These must ship no later than the first way to create a rule, or the first saved preset that holds a
group name draws an empty chart. The implementation plan ships them in the first, inert PR.

## UI

### Where the user meets it

Surface the suggestion where the problem appears, not only in settings.

1. **Anomaly-detection card.** A banner per affected panel, driven by the suggestions endpoint:

   > **6 series on "CPU usage per pod" have no baseline, because their names changed between runs.**
   > They look like Kubernetes pod names. **[Group series…]** · [Dismiss]

   Dismissing it is remembered for the panel in `localStorage` (a per-viewer convenience only).
2. **Compare card.** When the baseline column of a panel reads N/A for most of its rows, show the same
   hint inline under the panel header.
3. **System config → Dashboards.** `EditDashboardDialog` gains a **Series grouping** section listing
   the dashboard's rules, with add / edit / delete opening the same dialog without a run context. Its
   preview uses the most recent completed run of the workload.
4. **Series picker** (`MetricSeriesCascade`). A grouped series shows a `3 pods` badge and a tooltip
   listing the members for this run. A **Show individual pods** toggle switches the panel to the raw
   series.
5. **Tables** (anomaly, Compare, SLO). A grouped name carries a small "avg of 3 pods · baseline 5"
   affordance, so the membership difference is never hidden.

### The dialog

The dialog is what makes the feature understandable, because it shows the user's real names before
anything is saved:

```
Group series on "CPU usage per pod"                                    [x]

How should Perfana match these series across test runs?
Pattern   (•) Kubernetes pod name   (detected)
          ( ) Kubernetes DaemonSet / Job pod
          ( ) IP address and port
          ( ) Custom regex  [______________]  →  [____]
Combine   (•) Average per pod   ( ) Total   ( ) Highest pod
          [x] Also track the number of pods
Applies   (•) This panel   ( ) All panels on this dashboard
          [ ] Also create for other workloads of this system   [Test / Peak, Acc / Peak ▾]

  This run                    Baseline (5 runs)             Group
  api-7d9f8c6b5-x2k4p         api-5c4d9b7f8-q8r2m           api     ✓ in baseline
  api-7d9f8c6b5-z9w2t         api-5c4d9b7f8-m4nb6           api
  worker-6b8f7d9c4-h5k2l      worker-8d7c6b5f9-p2r4s        worker  ✓ in baseline

  Before: 0 of 6 series match the baseline   After: 2 of 2 groups match
  ⚠ SLO "API pod CPU < 80%" matches ^api- and will match nothing after grouping

[x] Recalculate this run and its 5 baseline runs now
    (otherwise anomaly detection has no baseline for this group until 5 new runs exist)

                                                    [Cancel]  [Save and recalculate]
```

Behaviour:

- The preset that matches the most names is preselected; "(detected)" marks it.
- The preview updates on every keystroke, client-side, using the shared function. The server preview
  is only fetched for the baseline names and the SLO check.
- An invalid or unsafe custom regex shows `validateRegexPattern`'s error inline and disables Save.
- With **Recalculate** off, the button reads **Save** and the card shows the stale notice afterwards.
- The whole dialog states its consequence in the workload's terms: *"Applies to every run of
  Production / Peak load"*. A rule is per workload, like the analysis window.

## Testing

- **Preset corpus** (`packages/shared`): Deployment, DaemonSet, Job and CronJob pod names, plus
  StatefulSet names (which must stay unchanged); names embedded in longer legends; the raw
  `metric{pod="…"}` fallback; IP:port. A **negative corpus** of ordinary series names (`p95 response
  time`, `heap-used`, `gc-pause-young`, `kafka-consumer-lag`, transaction names from the dev database)
  that must stay unchanged. Every preset passes `validateRegexPattern`.
- **Worker integration:**
  - A fixture with renamed pods across two runs goes from `incomparable` to compared.
  - Grouped `mean` / percentiles equal a hand computation of `avg` / `sum` / `max` per timestamp.
  - The member count series is correct while replica counts differ.
  - `rollup(pct_agg)` pools a group across control runs.
  - Per-pod `ds_adapt_results` are deleted as orphans.
  - **Runs with no rule produce byte-identical `ds_metric_statistics`** before and after the change.
    Construct a NULL-unit and a NULL-value row explicitly; worker `CLAUDE.md` item 7 shows why a diff
    over real data alone is a false pass.
  - The rules lookup fails open when the table is missing.
- **Plan check:** `EXPLAIN (ANALYZE, BUFFERS)` on a production-sized run with and without a grouped
  panel. No `Sort Method: external merge Disk:`; timing within noise for the ungrouped case.
- **API:**
  - RBAC: another organization's rule is a 404 on read, update and delete; an empty org list returns
    `[]`.
  - Preview and suggestions against fixtures.
  - `copyTo`: keeps the application dashboard within one environment and resolves it by uid **and**
    instance across environments; skips a target without the dashboard and a slot that already has a
    rule; rejects a target the caller cannot write; stores `origin = 'copy'`.
  - Group-aware readers return the aggregated series and `?members=true`.
- **Web:** dialog preview and validation; the picker badge and the toggle; a saved preset holding a
  group name draws a line (the regression this design exists to prevent).

## Rollout

- **One migration:** both tables, indexes, the RLS policy and grants. `npm run check:entity-migrations`
  must pass, because a column that reaches only `ConsolidatedSchema.ts` exists on new installs and
  nowhere else.
- **No backfill and no behaviour change** until a user saves a rule. Existing deployments see only the
  suggestion banner.
- **Roll out the API before or with the worker.** The worker tolerates a missing table (fails open).
  The API's group-aware readers return raw names when no membership exists.
- **CHANGELOG entry**, plus a `docs/reference/Features` page once v1 ships.

## Phasing

- **v1:**
  - rules table, presets and custom regex;
  - statistics-layer grouping, membership table, member count series;
  - group-aware picker, time-series, Compare-chart and report reads;
  - suggestions banner in the anomaly card;
  - the dialog with preview, and copying a rule to other workloads;
  - apply to this run plus its baseline;
  - stale notice;
  - suggestion logging and `origin` tracking for threshold tuning.
- **v1.1:**
  - Compare card hint;
  - grafana-sync auto-config suggesting a rule when a legend contains `{{pod}}` or the dashboard has a
    `pod` template variable;
  - rules in profiles, so provisioning creates them;
  - node-name preset.
- **v2:**
  - capture `field.labels` per series (one row per series per run in a side table, never per point);
  - offer **Compare by labels** (`container` ✓, `namespace` ✓, `pod` ✗) as a second way to define a
    rule, compiled to the same grouping;
  - time bucketing for sources whose timestamps do not align.

## Non-goals

- Pairing individual pods across runs.
- Changing how Grafana data is collected or how `ds_metrics` is written.
- Grouping perf-test (JMeter / Gatling) series.
- Grouping across panels or dashboards.

## Decisions (2026-11-01)

1. **Default aggregation is `avg`** (average per pod). It is unaffected by replica count, so an
   autoscaler scale-out does not read as a regression. `sum` and `max` stay one click away in the
   dialog. Pairing `sum` with the member count series remains the documented way to judge total
   footprint.
2. **Rules are per workload, with an opt-in copy.** The dialog has *"Also create for other workloads
   of this system"*, off by default. It writes one independent rule per selected workload
   (`origin = 'copy'`) and recalculates only the current one. A single system-wide rule was rejected:
   editing it would silently regroup every workload at once. See "Copying to other workloads" under
   API changes.
3. **Label-based grouping is v2.** v1 ships regex presets and custom regex. v2 adds label capture and
   *Compare by labels* as a second way to define the same rule, compiled to the same grouping engine,
   so nothing built in v1 is thrown away.
4. **Datasource alignment: warn in v1, bucket in v2.** It is not known whether any users' Kubernetes
   dashboards use non-Prometheus datasources. v1 combines on exact timestamps and warns when a group
   averages about one member per timestamp. If that warning appears in practice, time bucketing moves
   up from v2.
5. **Suggestion thresholds ship as defaults and are tuned from usage.** v1 uses 50% / 90% as named
   constants, logs every suggestion served, and records `origin = 'suggestion'` on rules created from
   one. No deployment with representative Kubernetes dashboards is available to calibrate against
   beforehand. See "Measuring the thresholds" under API changes.
