# RLS Burndown Drift Check

**Cadence:** every 2 weeks.

**Trigger:** `/schedule "every 2 weeks: run docs/superpowers/scheduled-agents/rls-burndown-drift.md"`.

**Job:** detect drift in the Phase 5b RLS migration (companion to `audit-burndown-drift.md`). Catches three classes of regression that the ESLint rule alone might miss:

1. **Allowlist regressions** — files that were removed from `apps/api/.rls-em-migration-allowlist.json` (i.e., previously migrated) but later re-introduced direct `this.<repo>.<method>(...)` calls without `withRequestEm()`. Lint will catch these on the offending PR; this check catches the case where a merge-conflict resolution silently re-added the file to the allowlist or where a follow-up commit reverted the wrapping.
2. **New violations in allowlisted files** — files still in the allowlist that grew NEW owned-resource repo calls. The lint rule grandfathers these files entirely, so a new un-wrapped call sneaks in unnoticed; this check counts call sites per file and flags growth.
3. **New owned entities without lint coverage** — any entity class with an `organization_id` column that isn't in the rule's `OWNED_RESOURCE_ENTITIES` set (or any new import alias for an existing owned entity).

**Steps:**

1. Read `apps/api/.rls-em-migration-allowlist.json`. Note the entry count.
2. **Allowlist size sanity:** compare to the prior run's count (cached in the burndown table below). If the count *grew* since the last run, that's an allowlist regression. Identify which file(s) were re-added and report.
3. **Per-file call-site growth:** for each allowlisted file, run:
   ```bash
   cd apps/api && grep -nE "this\.[a-zA-Z_]+(Repo|Repository)\.[a-zA-Z_]+\(" <file> | wc -l
   ```
   Compare to the prior run's count (table below). Report files where the count grew. Each growth is a new un-wrapped call that landed in a grandfathered file.
4. **New owned entities:**
   ```bash
   grep -lE "name: 'organization_id'" packages/shared/src/entities/*.entity.ts | sort
   ```
   Diff against the canonical class names tracked in `OWNED_RESOURCE_ENTITIES` (in `apps/api/eslint-rules/owned-resource-must-use-request-em.js`). Report any entity in the column scan but not in the rule's set.
5. **New aliases:** scan for new import-alias forms:
   ```bash
   grep -rhE "import \{[^}]*\b(ApiKey|ApplicationDashboard|Benchmark|CompareFilterPreset|DeepLink|DynatraceConfig|DynatraceEntityMapping|DynatraceQuery|ExpectedConfigChange|GenericDeepLink|GrafanaDashboard|GrafanaInstance|GraphPreset|MetricsSource|NotificationChannel|Profile|ProfileBenchmark|ProfileGrafanaDashboard|PyroscopeInstance|ReportTemplate|SparseMetricExclusion|TestRun|TracingInstance|TracingService|TrendsFilterPreset|AlertTagFilter)\s+as\s+[A-Z][A-Za-z]+" apps/api/src --include="*.ts" \
     | sed -E 's/.*\bas\s+([A-Z][A-Za-z]+).*/\1/' | sort -u
   ```
   Diff against the alias list in `OWNED_RESOURCE_ENTITIES`. Report any alias not yet covered.
6. **Burndown progress:** if the prior 14 days show zero allowlist removals AND PR4–PR18 work is still open, raise it as a stalled-migration concern in the report.
7. Append findings to the burndown trace below with a date stamp and update `docs/superpowers/audits/2026-05-04-rls-decisions.md` if the burndown table needs adjusting.

**Stop condition:** `apps/api/.rls-em-migration-allowlist.json` is `[]` AND no new owned entities / aliases / regressions detected for two consecutive runs. At that point, retire this agent and disable the schedule (PR9 of the plan covers this cleanup).

## Burndown trace

| Date | Allowlist size | Files growing | New entities | New aliases | Notes |
|------|----------------|---------------|--------------|-------------|-------|
| 2026-05-05 (PR3 baseline) | 58 | — | — | — | Drift agent online. Initial baseline established. |
