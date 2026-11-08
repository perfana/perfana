---
aliases:
  - Golden-path templates
  - template_ds_compare_configs.yaml
tags:
  - feature
---

# Compare Config Templates

A **compare-config template** sets ADAPT's comparison settings (classification, direction, thresholds)
for a panel on every workload that has it, so a new workload is judged correctly from its first run.
Templates live in `provisioned_template_ds_compare_configs` and are applied to each workload's
`ds_compare_config` rows when a test run completes, before ADAPT runs.

Since v0.2.97.54 a template keeps the rows it seeded in step with it: edit a template in git, restart
the API, and the next completed run of every workload it reaches picks the change up. Rows someone
saved by hand in the anomaly card are never touched. Design:
`docs/design/2026-11-08-compare-config-templates-design.md`.

Since v0.2.97.55 templates can also be created, edited and deleted in the UI, and exported back to
this file ([Managing templates in the UI](#managing-templates-in-the-ui)).

## The file

The API reads `template_ds_compare_configs.yaml` from `PROVISIONING_DIR` (default
`/data/provisioning`) at boot, when `PROVISIONING_ENABLED` is `true` (the default). There is one file per install,
and it is the complete declared state for provisioned templates: a template missing from it is
deleted (see [Prune](#prune)).

```yaml
organizationId: 3f1c…          # optional; omit for install-wide templates
items:
  - dashboardUid: ^performance-test-metrics-   # every perf-test scenario dashboard
    regex: true
    panelId: 201
    metricClassification: RED_rate
    higherIsBetter: false
  - dashboardUid: ^dynatrace-     # regex, because regex: true
    regex: true
    panelTitle: CPU Usage         # title instead of id, resolved per dashboard
    metricClassification: USE_utilization
    absThreshold: 5
  - dashboardUid: jvm-overview
    panelId: 7
    metricName: heap used         # a metric-level template
    metricClassification: USE_saturation
    aggregation: q95
    minSampleCount: 3
```

A panel id is unique only within one dashboard. A template with a `panelId` and no `dashboardUid`
writes a row for that id on **every** dashboard of the workload, whether or not the panel exists
there, so an unrelated Grafana panel that happens to carry the same id gets the classification too.
Scope id templates with a `dashboardUid`; use a `panelTitle` for "this panel wherever it appears".

### Identity

A template is identified by five things, and two items with the same five are refused:

| Field | Meaning |
|---|---|
| `organizationId` | a uuid; the item's own, else the file's; `null` means install-wide |
| `dashboardUid` | omit for every dashboard; a regular expression when `regex: true` |
| `regex` | `true` makes `dashboardUid` and `panelTitle` regular expressions |
| `panelId`, or `panelTitle` when there is no `panelId` | beside a `panelId`, `panelTitle` is only a label |
| `metricName` | omit for a panel-level template |

`dashboardLabel` is a label too. Changing a label updates the template; changing an identity field
makes it a different template (the old one is pruned, the new one created).

To reach every dashboard, leave `dashboardUid` out. Written with no value (`dashboardUid:`) it is
an error rather than a wildcard, so a value deleted by accident cannot turn an exact template into
one that applies everywhere; the same holds for `panelId`, `panelTitle` and `metricName`. The
exception is `organizationId`: written with no value it means install-wide, so an accidentally
emptied `organizationId:` widens the template to every organization.

**A metric-level template replaces the panel's config for that series, it does not add to it.** ADAPT
picks one whole row per series (metric before panel), and a metric-level row the applier inserts
starts from the defaults (mean, 15 %, IQR 2, no `minSampleCount`), not from the panel's own config.
Repeat every field the series needs, including `minSampleCount: 1` on the one-point perf-test panels.

### Fields a template forces

Each is applied only when the item names it. An explicit `null` counts as naming it, and a value equal
to the default still counts. Leaving a field out leaves the row's own value alone.

| Field | Type | Written to `config_data` |
|---|---|---|
| `metricClassification` | text, required | `metricClassification.classification` |
| `higherIsBetter` | `true`, `false` or `null` | `metricClassification.higherIsBetter` |
| `absThreshold` | number of at least 0, or `null` | `thresholds.absoluteThreshold` |
| `percentageThreshold` | a fraction from 0 to 1 (0.15 = 15 %) | `thresholds.percentageThreshold` |
| `iqrThreshold` | number of at least 0 | `thresholds.iqrThreshold` |
| `aggregation` | `mean`, `median`, `min`, `max`, `last`, `q10`, `q25`, `q75`, `q90`, `q95`, `q99` | `thresholds.aggregation` |
| `minSampleCount` | number; floored, at least 1 | `thresholds.minSampleCount` |
| `ignore` | `true` or `false` | `ignore` |
| `ignoreMeanDiffSmallerThan` | number of at least 0 | `ignoreMeanDiffSmallerThan` (stored, but ADAPT does not read it yet) |
| `defaultValueIfControlGroupMissing` | number | `defaultValueIfControlGroupMissing` (stored, but ADAPT does not read it yet) |

`higherIsBetter: null` is how a template forces "no direction", which ADAPT can never report as a
regression. Leaving `higherIsBetter` out keeps whatever direction the row already had.

An item is skipped with an error in the API log, and its stored template stays as it was, when it
has a wrong type, a non-finite or out-of-range number, an unknown aggregation, or (with
`regex: true`) a pattern that does not compile or could backtrack catastrophically. A non-numeric
`minSampleCount` is ignored with a warning, the way the worker reads it. A key the format does not
know is ignored with a warning naming it (`absoluteThreshold`, the spelling a stored row uses, is
reported with a pointer to `absThreshold`).

## When the file is read

At API boot. The log line reports what changed:

```
Metric classifications: 1 created, 2 updated, 40 unchanged, 0 taken over, 1 pruned, 0 errors
```

Replicas booting together take turns on a Postgres advisory lock, so the second one finds everything
unchanged. A replica that cannot get the lock within 30 s (its holder's host died and Postgres has not
noticed yet) skips template provisioning for that boot with an error rather than hang its startup.

### Prune

After writing, provisioning deletes every provisioned template the file no longer declares, and logs
each one. Templates created in the UI are never pruned. Nothing is pruned when:

- the file is missing, or does not parse;
- `items` is not a list (`items:` with nothing after it reads as null);
- any item's identity cannot be read (for example, it has neither `panelId` nor `panelTitle`, or its
  `organizationId` is not a uuid);
- any template failed to write this boot.

An explicit `items: []` is a declared empty state and prunes every provisioned template.

### Takeover

If the file declares a template that a UI-created template already holds, the file takes it over: the
row becomes read-only and gets the file's values. It is counted as `taken over`, not `updated`.

## Managing templates in the UI

**Settings → Profiles** has two pinned entries above the profiles:

- **All runs in &lt;organization&gt;**: the selected organization's templates. They apply to every run in
  that organization. Members can read them; changing them needs `benchmark:manage` there (org admins
  and members, not viewers).
- **All runs on this install**: install-wide templates. They apply to every run in every organization.
  Anyone signed in can read them; only a global admin can change them.

Each opens `/settings/profiles/adapt-templates` for that scope: a table of its templates in the order
the export writes them, with what each one forces. The edit dialog asks which panels the template
reaches (dashboard UID, regex, panel id or title, metric), the classification, and then each field it
forces, ticked one by one. A field left unticked is left out of the template and keeps each panel's own
value, exactly as an item that omits the key in the file. Direction has a third choice, **No direction**,
which is `higherIsBetter: null`; **None** beside the absolute threshold is `absThreshold: null`. The
percentage is typed as a percent and stored as the file's fraction (15 becomes `0.15`).

A template created in the UI follows the same rules as a file item, because the API validates it with
the same parser. It applies on the next completed run of matching workloads, to panels nobody has
hand-edited.

**Provisioned templates are locked.** They show a lock, can be viewed but not edited or deleted (the API
answers 409), and are changed in the file. **Copy to another scope** makes an editable copy elsewhere;
the copy cannot go into the same scope, where it would have the same identity as the provisioned one.
Once a file declares a template a UI copy holds, the next boot takes the copy over and it becomes
locked too.

Deleting a UI template hands the panels it configured to the next matching template, or rebuilds them
from their own base configuration, on each workload's next completed run.

### The API

| Route | Who |
|---|---|
| `GET /api/compare-templates?organizationId=<uuid>` | members of the organization |
| `GET /api/compare-templates?scope=install` | anyone signed in |
| `POST` the same two | `benchmark:manage` in the organization; a global admin for `scope=install` |
| `GET`, `PUT`, `DELETE /api/compare-templates/:id` | as above for the template's own scope |
| `GET /api/provisioning/compare-templates/export` | global admin |

A list or create names exactly one scope. The body of `POST` and `PUT` is one item of the file, without
`organizationId`: the scope comes from the collection and never changes, so moving a template means
copying it. `PUT` replaces the whole definition, so a field left out stops being forced. A template or
organization outside the caller's organizations answers 404. A second template with the same identity
in the same scope answers 409 with a message naming the scope and the identity, and whether the holder
is provisioned. The list carries `canWrite`, whether the caller may change that scope.

The API refuses what the file only warns about: an unknown field (with the same hint the file's
warning gives, `absoluteThreshold` pointing at `absThreshold`), and a `minSampleCount` that is not a whole
number of at least 1 (the file floors and clamps it). A body that names `organizationId` is refused
too. Writes are audit-logged as `provisioned-template-ds-compare-configs`.

### Exporting the file

**Export YAML** on the install-wide page (global admins) shows and downloads
`template_ds_compare_configs.yaml`, generated from the database. It is the whole file: every template,
provisioned or created in the UI, in every organization. Commit it in place of the installed file; a
partial file would make the next boot prune the provisioned templates it leaves out. When every
template shares one scope the file carries it once at the top, otherwise each item names its own
(`null` for install-wide).

The round trip, verified on a local stack:

1. Create templates in the UI and export.
2. Commit the file and restart the API: `0 created, 0 updated, 0 unchanged, N taken over, 0 pruned`. The
   templates are now locked.
3. Restart again: `N unchanged`, and exporting again gives the same bytes.

The first export of a hand-written file drops its comments and reorders its keys, so commit that first
export once; from then on export, provision, export is byte-identical.

## When templates are applied

On every completed test run, inside the completion request and before ADAPT is queued, so the
completing run is the first one judged on the result. A run closed by stale detection, because its
client never posted completion, skips the applier (filed in TODOS.md). For each panel and metric a
template can reach, the most specific template wins:

1. Dashboard match: exact `dashboardUid`, then regex, then no `dashboardUid`.
2. Scope: organization, then install-wide.
3. Panel match: `panelId`, then a literal `panelTitle`, then a regex `panelTitle`.
4. Template id. Two templates still level here (overlapping regexes such as `^jvm-.*` and
   `^jvm-prod.*`) are reported once in the run's summary line.

What happens to the row depends on who last wrote it:

| Row | What the template does |
|---|---|
| none yet | inserts one from the defaults plus the template |
| seeded by the worker or the Dynatrace host mapping, untouched | merges into it once; from then on it is template-owned |
| template-owned | rebuilds it from its base config plus the current winner; with no winner, from the base alone |
| template-owned, written before v0.2.97.54 | adopts it (its config becomes its base) only if the winner would not change it; otherwise leaves it alone |
| saved by a user | nothing, ever |

A row is written only when its effective configuration changed, so earlier ADAPT results are marked
stale only on workloads whose configuration actually moved. Each write is conditional on the author
the applier read, so a user save that lands while it runs wins and the row is skipped that time. A row
a title template owns whose panel is missing from the recently collected panel list is left alone, so
one gap in collection does not make its configuration flap. A template whose stored pattern is invalid
or fails the same backtracking check the file gets is skipped, and its rows are left alone too.

The summary line:

```
Golden-path applied for SUT <id>/<env>/<workload>: 3 compare configs created (1 inserted, 2 merged), 4 rebuilt, rewrote=6 in 85ms
```

It is logged at warn when the applier takes over 5000 ms.

## Upgrading to v0.2.97.54

- **Migration 1822 refuses to start on template rows the new key rejects**, naming them: two rows
  with the same key (two API replicas that booted together under the old code could write them), or a
  row with neither a panel id nor a panel title. Check before deploying:

  ```sql
  SELECT array_agg(id ORDER BY created_at) AS ids
    FROM provisioned_template_ds_compare_configs
   WHERE system_under_test_id IS NULL
   GROUP BY COALESCE(organization_id::text, 'install'), COALESCE(dashboard_uid, ''), regex,
            COALESCE(panel_id::text, 'title:' || panel_title), COALESCE(metric_name, '')
  HAVING count(*) > 1;
  ```

  Delete all but the oldest row of each group, then deploy again; the migration is safe to re-run.
- **Restart the API once after the migration if it started first.** Nothing orders the API behind the
  migration container, and template provisioning only runs at boot, so an API that booted before 1822
  ran logs a provisioning error and skips this boot's provisioning and prune.
- **The first boot prunes provisioned templates no longer in your file.** Before this version a
  template removed from the file stayed in the database. Every template provisioning ever created is
  now marked read-only and pruned if the file no longer declares it.
- **A file that already sets `organizationId` now scopes its templates to that organization.** Before,
  the value was only stamped on the row and the template reached every organization's dashboards. On a
  single-organization install nothing changes. On one with several, remove `organizationId` (or write
  `organizationId: null` on an item) to keep a template install-wide.
- **A template that omits `higherIsBetter` no longer clears a row's direction.** Before, merging such a
  template into a worker- or Dynatrace-seeded row set its direction to `null`; now the row keeps the
  direction it was seeded with, and a row with a direction can fail a run on a regression. To keep the
  old behaviour, write `higherIsBetter: null` on that item.
- **Rows the golden path wrote before the upgrade start following their template, if it agrees with
  them.** Before v0.2.95.42 saving a compare config did not record who saved it, so such a row can hold
  a hand edit under the template's name. On the first completed run after the upgrade, a row whose
  template would not change it takes its current configuration as its base and follows the template
  from there. A row the template would change is left alone, as before, and counted in the summary
  line (`pre-v0.2.97.54 row(s) left alone`). To hand such a row to its template, delete it; the next
  completed run inserts a fresh one. Because an adopted row's base already holds the old template's
  values, removing the template later does not strip them from it.
- **Adding `organizationId` to a file changes every key.** The next boot creates organization-scoped
  templates and prunes the install-wide ones; on an install with more than one organization, rows in
  the other organizations lose the template's fields on their next completed run.
- **Until 1822 has run, compare-config reads fail.** The new columns are part of the entity, so an API
  of this version that takes traffic before the migration lands answers the anomaly card's config read
  and save with an error. It recovers by itself once the columns exist.
- **Rolling back.** An older API running against a database that has 1822 keeps working, but the
  template rows it writes are not marked read-only; the next boot of this version marks them again and
  prunes what the file does not declare. Do not roll back with a file that uses `metricName` or a
  per-item `organizationId`: the older API ignores both, matches templates by dashboard and panel only,
  and can write a metric-level item's values over the panel-level template.
