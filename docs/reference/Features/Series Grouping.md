---
aliases:
  - Series grouping rules
  - Kubernetes pod grouping
tags:
  - feature
---

# Series Grouping

Kubernetes resource dashboards name their series after pods (`api-7d9f8c6b5-x2k4p`), and a pod name
changes on every deployment. Two runs of one build then share no series name, so ADAPT reads every
pod as `incomparable` and the Compare card has no baseline for any of them: a CPU or memory
regression on those panels is never reported. A **series grouping rule** tells Perfana that series
whose names differ only by a generated part are one series, so the workload is compared across
deployments.

Shipped in three releases: the engine (v0.2.97.41), the rules API (v0.2.97.42) and the web UI
(v0.2.97.43). Design: `docs/design/2026-11-01-series-grouping-design.md`.

## What a rule is

A rule belongs to one **workload** of a system and environment (like the analysis window), one
application dashboard, and one panel or every panel on the dashboard. A panel rule overrides a
dashboard-wide one.

| Field | Meaning |
|---|---|
| Pattern | A built-in preset, or a custom JavaScript regex with a replacement (`$1` allowed). Every match is replaced; a rewrite that leaves nothing keeps the raw name. |
| Combine | How the members of a group combine per timestamp: **Average per pod** (default), **Total** or **Highest pod**. |
| Also add | The other two aggregations, each as a second series named `<group> (sum)` / `<group> (max)`. |
| Track the number of pods | Also writes a `<group> (pod count)` series, so a changed replica count is visible next to an average. |

### Reading the average and the total together

**Average per pod** and **Total** answer different questions, and reading them side by side is what
tells a scale-out apart from a regression:

| | **Average per pod** flat | **Average per pod** up |
|---|---|---|
| **Total** up | scale-out — more pods, same cost each. Not a regression. | a real regression, amplified by the replica count |
| **Total** flat | scale-in with hotter pods | a real regression on a fixed fleet |

The one you pick under **Combine** keeps the plain group name (`api`), and each box you tick under
**Also add** adds a series beside it (`api (sum)`). That order matters: the plain name is what every
baseline, SLO and comparison setting on the panel already refers to, so ticking a box only ever
**adds** series and leaves everything matching.

**Changing which one is under Combine is the one move that is not additive.** The group keeps its
name and the numbers under it change, so a baseline, an SLO or a comparison setting on that name
goes on matching while judging a different measurement than the history it was built on. Nothing
is renamed — that is exactly why it is easy to miss. The dialog warns when you do it to a saved
rule.

**Unticking a box is not free either.** The series disappears on the next recalculation. Anomaly
detection drops its own results, but an SLO, a saved graph preset or a report section pointing at
`api (sum)` will stop matching it — and an SLO that matches nothing records no verdict rather than
failing. The dialog warns about that too.

Each box multiplies the number of series on the panel, so a dashboard-wide rule with both extras
and a pod count is four series per group. The dialog prints how many extra series it adds before you save.

**The extra series and the pod count are reported, not judged.** Both are pod-count dependent by
construction: scale a Deployment from two replicas to four and the total doubles, which is a
scale-out and not a regression. So Perfana gives each derived series an *unclassified* comparison
setting, which means anomaly detection reports a change in it as a difference and never as a
regression — it cannot turn a run red on its own. The plain group series keeps whatever
classification the panel has. If you do want a derived series judged, set a comparison
classification on it explicitly and Perfana will leave your setting alone.

Built-in presets:

| Preset | Removes | Example |
|---|---|---|
| Kubernetes pod (Deployment / ReplicaSet) | `-<hash>-<suffix>` | `api-7d9f8c6b5-x2k4p` → `api` |
| Kubernetes pod (DaemonSet / Job) | `-<suffix>` | `fluentd-x2k4p` → `fluentd` |
| IP address and port | the address | `10.0.3.17:8080 requests` → `* requests` |
| Trailing ID | a trailing `-id` / `_id` | `worker_a1b2c3` → `worker` |

The Kubernetes presets use Kubernetes' own generated-name alphabet (no vowels, no `0`/`1`/`3`), so
ordinary names such as `heap-used` or `gc-pause-young` are left alone. A StatefulSet pod
(`db-0`, `db-1`) keeps its name, which is correct: it is stable across deployments. A custom regex
is checked by the same ReDoS guard the worker uses, and the dialog refuses an unsafe one.

## Where you meet it

- **Anomaly detection card.** A banner per panel where a preset would line the run's series up with
  its baseline: *"6 series on "CPU usage per pod" have no baseline, because their names changed
  between runs."* **Group series…** opens the dialog with that preset, **Show rows** filters the
  table to the panel, **Dismiss** hides it in this browser. A second notice appears when the run
  was analysed under different rules than the ones now in force, with a button to recalculate the
  run and its baseline, and a warning per group whose members never report at the same timestamps.
- **System configuration → Grafana dashboards → Edit.** A *Series grouping* section lists the
  dashboard's rules for the selected workload, with add, edit, enable/disable and delete. There is
  no run here, so the preview uses the workload's most recent completed run.
- **The series picker** (Graphs, Trends, Compare). A grouped series carries an `N pods` badge whose
  tooltip lists the pods it combines in this run, and **show pods** switches the panel to the raw
  per-pod series and back.

## The dialog

The dialog shows the run's real series before anything is saved: each group, its members in this
run and in the baseline, whether the group is in the baseline, each extra series the group will add,
and a *Before / After* line (*"0 of 6 series match the baseline · 2 of 2 groups match · 2 extra
series added"*). The *After* figure counts **groups**, because that is what baseline matching is
about; the extras are counted separately as series. The preview is computed in the browser with the
same function the worker uses, so it cannot disagree with what the analysis will do. The preset
that matches the most names is preselected and marked *(detected)*.

It warns about five things:

- **changing Combine on a saved rule**, which keeps the group's name and changes what it measures,
  so its baselines, SLOs and comparison settings go on matching while describing a different
  measurement;
- **unticking an Also add box on a saved rule**, which deletes that series on the next
  recalculation, so anything referencing it by name stops matching;
- an **SLO** whose match pattern selects pods by name and would match nothing after grouping;
- a **group name that is also a raw series name** in a baseline run that has not been recalculated —
  that run's series of that name is pooled into the group until it is;
- a group whose members report at **different timestamps**, so its average is mostly single pods
  (grouping assumes a source that aligns its samples, as Prometheus range queries do).

**Also create for other workloads of this system** creates the same rule elsewhere in one step; a
copy never overwrites an existing rule, and the result says which workloads were skipped and why.

## When a rule takes effect

A rule changes how **statistics** are computed, not the stored data: `ds_metrics` is never
rewritten. It applies to a run the next time its statistics are calculated — on the next analysis,
or when you choose **Save and recalculate** (the run and its baseline runs) or **Recalculate** on
the stale notice. Until baseline runs are recalculated, a group has no baseline in them. Charts,
saved graph presets and reports holding a group name draw it by combining its members.

## Permissions

Reading and previewing follow the system's organization like any other resource. Creating, editing
or deleting a rule needs the SLO capability (`benchmark:manage`, org admins and members), because a
rule changes ADAPT verdicts the way an SLO does. Recalculating needs `test-run:update` on the run.
Every write is audited.

## For developers

- Worker: "Series grouping happens at the statistics layer, in its own INSERT" in
  `apps/worker/CLAUDE.md`.
- API: "A series group is not a `ds_metrics` series, so every raw reader expands it" and "Series
  grouping rules: who may write them, and what apply does" in `apps/api/CLAUDE.md`.
- Web: "Series grouping in the web" in `apps/web/CLAUDE.md`.
- Routes: `/series-grouping-rules` (CRUD, `preview`, `apply`),
  `/test-runs/:id/series-grouping-suggestions`, `/test-runs/:id/series-grouping-status`, and
  `?members=true` / `/metrics/ds-metrics/distinct-series` on the metric routes. All in Swagger.
