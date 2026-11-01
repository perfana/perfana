# Series grouping: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Design:** [`2026-11-01-series-grouping-design.md`](2026-11-01-series-grouping-design.md). Read it first; this plan does not repeat its reasoning.

**Goal:** Let a user declare that series whose names differ only by a Kubernetes pod segment are one series, so ADAPT, the Compare card, SLOs and charts compare the workload across deployments instead of reporting every pod as `incomparable`.

**Architecture:**
- A per-workload `series_grouping_rules` row rewrites raw series names to group names.
- `StatisticsPipeline` writes the raw → group membership of each run into `ds_metric_series_groups`. It aggregates grouped panels per timestamp (avg / sum / max) into `ds_metric_statistics` under the group name, in a **second** `INSERT` beside the existing one. Every comparison reader then sees group names unchanged.
- `ds_metrics` is never written.
- The API readers that read raw `ds_metrics` expand a group name back into its members. One shared function, `applySeriesGrouping`, is the only regex implementation; worker, API and web all call it.

**Tech stack:** TypeScript throughout. `packages/shared` (Jest), worker (BullMQ, Vitest), API (NestJS + TypeORM, Jest), web (Next.js + MUI, Jest + RTL), PostgreSQL 15 + TimescaleDB + Toolkit.

## Global constraints

- **`ds_metrics` is read-only for this feature.** No INSERT, UPDATE or DELETE on it, ever. Root `CLAUDE.md` #23 / #39 explains what a non-`test_run_id` predicate costs on a compressed hypertable.
- **Runs with no rule must be byte-identical.** The SQL `StatisticsPipeline` issues for a batch with no rules must not change at all. Pin it with a snapshot test **before** refactoring (Task 3, step 1). Grouped panels go through their own statement, never through a `UNION ALL` into the existing CTE: referencing `metrics_filtered` twice materialises the run's raw rows into a tuplestore (worker `CLAUDE.md`, panel 304, "Group once, then roll up").
- **One regex dialect.** Patterns are compiled with `validateRegexPattern` and applied with JavaScript `String.prototype.replace`. A pattern never reaches Postgres `regexp_replace` or `~`.
- **Grouping never fails a stage.** Rule loading happens **before** `withAnalyticsTransaction`; any error there logs a warning and the run is aggregated without rules. An error inside the transaction aborts it (25P02), and `statistics-calculation` is not `softFail`, so it fails the whole re-evaluate batch.
- **Pass canonical `test_run_id` strings** to pipelines and to `reevaluateBatch`, never entity UUIDs (worker `CLAUDE.md`, ADAPT baseline item 4).
- **RBAC shape for every new route** is root `CLAUDE.md` #48:
  - resolve `withOrgFilter` once per request and pass the result to every service method as a **required** parameter (`null` means global admin);
  - answer 404, not 403, outside it;
  - return `[]` early on an empty org list;
  - authorize a caller-supplied parent before inheriting its org;
  - in `repo.create`, use the camelCase `organizationId` / `teamId`.
- **Perf-test dashboards never get rules.** Reject an application dashboard whose `dashboard_uid` starts with `performance-test-metrics-` (API), and skip it defensively in the worker.
- **GitNexus:** before editing any existing function or method named in a task, run `gitnexus_impact({target, direction: "upstream"})` and record the blast radius in the PR. Run `gitnexus_detect_changes()` before every commit. Stop and flag HIGH / CRITICAL risk to the reviewer.

## Delivery: three PRs, inert first

| PR | Tasks | Behaviour change | Why this order |
|---|---|---|---|
| **A — engine** | 1, 2, 3, 4, 7, 8 | None. No rule can be created yet except by hand-written SQL. | The group-aware readers (Task 7) must be live before the first rule can exist, or the first saved preset holding a group name draws an empty chart. |
| **B — API** | 5, 6 | Rules can be created over the API and through MCP. | Builds on A's tables and readers. |
| **C — web** | 9, 10, 11 | Users see suggestions, the dialog and the picker badge. | Needs B's contract. |

Task 12 (verification and docs) runs at the end of each PR for the parts that PR ships.

Task dependencies:
- 1 and 2 are independent.
- 3, 4, 7 and 8 depend on 1 and 2.
- 5 depends on 1 and 2; 6 depends on 5.
- 9 depends on 1, 5 and 6; 10 depends on 9; 11 depends on 7.

Within a PR, tasks with no dependency between them can run in parallel.

---

## Task 1: Shared grouping function (`packages/shared`)

**Files:**
- Create: `packages/shared/src/utils/series-grouping.ts`
- Modify: `packages/shared/src/utils/index.ts` (add `export * from './series-grouping';` beside `./safe-regex` at :13)
- Test: `packages/shared/src/utils/__tests__/series-grouping.spec.ts`

**Interfaces (produces):**

```typescript
export type SeriesGroupingPreset = 'k8s-pod' | 'k8s-daemonset' | 'ip-port' | 'trailing-id' | 'custom';
export type SeriesGroupingAggregation = 'avg' | 'sum' | 'max';

export interface SeriesGroupingRuleSpec {
  preset: SeriesGroupingPreset;
  pattern?: string | null;      // required for 'custom', ignored otherwise
  replacement?: string | null;  // 'custom' only; presets carry their own
  aggregation: SeriesGroupingAggregation;
  trackMemberCount: boolean;
}

export const SERIES_GROUPING_PRESETS: Record<Exclude<SeriesGroupingPreset, 'custom'>,
  { label: string; pattern: string; replacement: string }>;
export const MEMBER_COUNT_SUFFIX = ' (pod count)';
export const SERIES_NAME_MAX_LENGTH = 255;            // ds_metric_statistics.metric_name is varchar(255)
export const SUGGEST_MAX_MATCHED_BEFORE = 0.5;        // Decision 5: tuned later from logs
export const SUGGEST_MIN_MATCHED_AFTER = 0.9;

export type CompiledSeriesGroupingRule =
  | { ok: true; regex: RegExp; replacement: string }
  | { ok: false; error: string };
export function compileSeriesGroupingRule(rule: SeriesGroupingRuleSpec): CompiledSeriesGroupingRule;

export interface SeriesGroupingResult {
  mapping: Map<string, string>;    // every input name -> its group name
  groups: Map<string, string[]>;   // group name -> sorted member names
  renamedCount: number;            // inputs whose group differs from their own name
  memberCountNames: Map<string, string>; // group -> member-count series name (only when tracked and renamed)
}
export function applySeriesGrouping(rule: SeriesGroupingRuleSpec, names: readonly string[]): SeriesGroupingResult;

export function seriesGroupingRuleHash(rule: SeriesGroupingRuleSpec): string;  // 8 hex chars, FNV-1a

export interface PresetEvaluation {
  preset: Exclude<SeriesGroupingPreset, 'custom'>;
  matchedBefore: number;  // fraction of current raw names present in baseline raw names
  matchedAfter: number;   // fraction of current groups present in baseline groups
  currentGroups: number;
}
export function evaluateGroupingPresets(current: readonly string[], baseline: readonly string[]): PresetEvaluation[];
```

**Preset patterns.** These were run through `validateRegexPattern` on 2026-11-01 and all pass.

```typescript
const K8S = '[bcdfghjklmnpqrstvwxz2456789]';  // Kubernetes generated-name alphabet: no vowels, no 0/1/3
const POD_END = '(?=$|[^a-z0-9-])';          // end of name, or a character a pod name cannot contain

export const SERIES_GROUPING_PRESETS = {
  'k8s-pod':       { label: 'Kubernetes pod (Deployment / ReplicaSet)', pattern: `-${K8S}{6,10}-${K8S}{5}${POD_END}`, replacement: '' },
  'k8s-daemonset': { label: 'Kubernetes pod (DaemonSet / Job)',          pattern: `-${K8S}{5}${POD_END}`,              replacement: '' },
  'ip-port':       { label: 'IP address and port',                       pattern: String.raw`\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d{1,5})?\b`, replacement: '*' },
  'trailing-id':   { label: 'Trailing ID',                               pattern: '[-_][a-z0-9]{4,}$',                  replacement: '' },
} as const;
```

Do **not** write the IP pattern as `\d{1,3}(?:\.\d{1,3}){3}`. `validateRegexPattern` rejects that quantified group as a ReDoS shape (verified); the flat form above passes and behaves the same.

**Behaviour rules** (each one gets a test):
1. **Compiling.** Compile with `validateRegexPattern(pattern, { flags: 'g' })`. A `custom` rule with no pattern, or one that fails the guard, returns `{ ok: false, error }` carrying the guard's message.
2. **Empty result.** A name the pattern reduces to `''`, or to whitespace only, keeps its raw name. A group name must never be empty.
3. **Truncation.** Group names are cut to `SERIES_NAME_MAX_LENGTH`. A member-count name is the group cut to `255 - MEMBER_COUNT_SUFFIX.length`, then the suffix.
4. **When member-count series exist.** Only when `trackMemberCount` is set **and** the group has at least one renamed member. A group of one unrenamed series gets none.
5. **Collisions.** If a member-count name equals any group name or input name, drop it for that group. Never emit two series under one name.
6. **Determinism.** `applySeriesGrouping` is pure. Members are sorted (`localeCompare`), and the same inputs always give the same output.
7. **Hashing.** `seriesGroupingRuleHash` hashes `preset`, `pattern ?? ''`, `replacement ?? ''`, `aggregation` and `trackMemberCount`, in that order, joined by `\u0000`. It uses no crypto, so web can import it.

- [ ] **Step 1: Write the failing spec** `series-grouping.spec.ts` with these blocks:
  - **Positive corpus, `k8s-pod`:**
    - `api-7d9f8c6b5-x2k4p` → `api`
    - `api-7d9f8c6b5-x2k4p / app` → `api / app`
    - `container_cpu{pod="api-7d9f8c6b5-x2k4p", container="app"}` → `container_cpu{pod="api", container="app"}`
    - `payment-service-5c4d9b7f8-m4nb6` → `payment-service`
  - **Positive corpus, other presets:**
    - `k8s-daemonset`: `node-exporter-h5k2l` → `node-exporter`
    - `ip-port`: `10.42.3.17:8080` → `*`; `cpu 10.42.3.17:8080 app` → `cpu * app`
  - **Negative corpus** (unchanged under `k8s-pod` and `k8s-daemonset`):
    - `db-0`, `heap-used`, `gc-pause-young`, `p95 response time`, `kafka-consumer-lag`, `http-requests`
    - `api-7d9f8c6b5-x2k4p-extra` (a suffix followed by `-` is not a pod name end)
    - `v1.2.3` under `ip-port`
  - **Documented edge:** `k8s-daemonset` applied to `api-7d9f8c6b5-x2k4p` gives `api-7d9f8c6b5`. Assert it, so nobody "fixes" it silently: the Deployment preset is the right one there, and `evaluateGroupingPresets` must rank it higher.
  - **Known false-positive shape:** a 5-character all-digit suffix made only of `2456789` (e.g. `jvm-45627`) *does* match `k8s-daemonset`. Assert it, so the behaviour is explicit.
  - Every preset passes `validateRegexPattern`.
  - Custom: valid pattern with `$1` replacement; missing pattern → error; `(a+)+` → guard error text.
  - Rules 2–7 above, one `it` each.
  - `evaluateGroupingPresets`:
    - current `[api-aaa…, api-bbb…]` against baseline `[api-ccc…]` → `k8s-pod` `matchedBefore` 0 and `matchedAfter` 1.
    - Results are sorted by `matchedAfter` desc, then by preset order.
- [ ] **Step 2:** `cd packages/shared && npx jest src/utils/__tests__/series-grouping.spec.ts` → fails (module missing).
- [ ] **Step 3:** Implement `series-grouping.ts` to the interfaces and rules above. Export it from `utils/index.ts`.
- [ ] **Step 4:** Re-run the spec → passes. Run `npm run check:workspace-exports` from the repo root → passes. `./utils` is already declared in `packages/shared/package.json`, so the web import `@perfana/shared/utils` is legal.
- [ ] **Step 5:** Commit: `feat(shared): series grouping presets and applySeriesGrouping`.

---

## Task 2: Entities and migration 1819

**Files:**
- Create: `packages/shared/src/entities/series-grouping-rule.entity.ts`, `packages/shared/src/entities/ds-metric-series-group.entity.ts`
- Modify: `packages/shared/src/entities/index.ts` (export both, beside `graph-preset.entity` at :46)
- Create: `packages/shared/src/database/migrations/1819000000000-AddSeriesGrouping.ts`. Use the next free number at implementation time; `1818000000000` is the latest today.
- Modify: `packages/shared/src/database/migrations/schema-sql.ts`. Mirror both tables into the baseline dump the way 1818's column was mirrored (`deletion_status` at :2950), which is why the migration must be idempotent.
- Create: `packages/shared/src/database/__tests__/1819-add-series-grouping.spec.ts`. Model it on `1814-ds-metric-statistics-dashboard-index.spec.ts`; specs live outside `migrations/` on purpose, see the comment at its top.
- Modify: `apps/api/eslint-rules/owned-resource-must-use-request-em.js`. Add `SeriesGroupingRule` to `OWNED_RESOURCE_ENTITIES` (:42).
- Update snapshot: `apps/api/src/test/rls/__snapshots__/rls-policy-coverage.snapshot.spec.ts.snap`. Both tables have `organization_id`; expect `series_grouping_rules` with RLS, and `ds_metric_series_groups` without, like `ds_metric_statistics`.

**Entity: `SeriesGroupingRule`** (`@Entity('series_grouping_rules')`):
- **Columns, camelCase properties with snake_case `name:`:** `systemUnderTestId`, `testEnvironment`, `workload`, `applicationDashboardId`, `panelId` (nullable int), `preset`, `pattern` (nullable text), `replacement`, `aggregation`, `trackMemberCount`, `enabled`, `origin`.
- **Ownership columns:** `organizationId`, `teamId`, `createdBy`, `updatedBy`, `createdAt`, `updatedAt`.
- **Audit fields:** `static auditableFields = ['system_under_test_id','test_environment','workload','application_dashboard_id','panel_id','preset','pattern','replacement','aggregation','track_member_count','enabled','origin'] as const`. Copy the form at `graph-preset.entity.ts:34`.
- `ManyToOne` to `ApplicationDashboard` and `SystemUnderTest`, both `onDelete: 'CASCADE'`.

**Entity: `DsMetricSeriesGroup`** (`@Entity('ds_metric_series_groups')`):
- Snake_case properties, as on `DsMetricStatistics`.
- Primary key `(test_run_id, application_dashboard_id, panel_id, metric_name)`.
- Columns: `group_name`, `dashboard_label`, `panel_title`, `aggregation`, `avg_members` (real, nullable), `rule_id` (nullable uuid), `rule_hash`, `organization_id` (nullable), `team_id`, `created_at`.
- `dashboard_label` / `panel_title` exist because `getMetricTimeSeries` and the reports address a panel by label and title, not by id (Task 7).
- `avg_members` is the timestamp-alignment signal from Decision 4: the average number of members reporting per timestamp, written by Task 3.

**Migration `up`.** Every statement is idempotent. The two `REFERENCES` clauses take `SHARE ROW EXCLUSIVE` on `application_dashboards` and `systems_under_test`, so copy 1814's bounded-wait loop (`set_config('lock_timeout','3s',true)`, `EXCEPTION WHEN lock_not_available`, `pg_sleep(3)`, give up at 10 attempts). The SUT deletion queue can hold `ROW EXCLUSIVE` on those tables for minutes.

```sql
CREATE TABLE IF NOT EXISTS public.series_grouping_rules (
  id uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
  system_under_test_id uuid NOT NULL REFERENCES public.systems_under_test(id) ON DELETE CASCADE,
  test_environment varchar(255) NOT NULL,
  workload varchar(255) NOT NULL,
  application_dashboard_id uuid NOT NULL REFERENCES public.application_dashboards(id) ON DELETE CASCADE,
  panel_id integer,
  preset varchar(32) NOT NULL
    CONSTRAINT ck_series_grouping_rules_preset CHECK (preset IN ('k8s-pod','k8s-daemonset','ip-port','trailing-id','custom')),
  pattern text,
  replacement text NOT NULL DEFAULT '',
  aggregation varchar(8) NOT NULL DEFAULT 'avg'
    CONSTRAINT ck_series_grouping_rules_aggregation CHECK (aggregation IN ('avg','sum','max')),
  track_member_count boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  origin varchar(16) NOT NULL DEFAULT 'manual'
    CONSTRAINT ck_series_grouping_rules_origin CHECK (origin IN ('manual','suggestion','copy')),
  organization_id uuid NOT NULL,
  team_id uuid,
  created_by varchar(255),
  updated_by varchar(255),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT ck_series_grouping_rules_custom_pattern CHECK ((preset = 'custom') = (pattern IS NOT NULL)),
  CONSTRAINT uq_series_grouping_rules_slot UNIQUE NULLS NOT DISTINCT
    (system_under_test_id, test_environment, workload, application_dashboard_id, panel_id)
);
-- The unique index leads on system_under_test_id, so it already serves that FK's parent-side probe
-- and the worker's per-workload lookup. The dashboard FK needs its own (root CLAUDE.md #57).
CREATE INDEX IF NOT EXISTS idx_series_grouping_rules_app_dashboard
  ON public.series_grouping_rules (application_dashboard_id);

ALTER TABLE public.series_grouping_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.series_grouping_rules FORCE ROW LEVEL SECURITY;
-- Four policies, copied verbatim from 1783409734007-AddProxyServer.ts:15-21 with the table renamed:
-- rls_series_grouping_rules_{select,insert,update,delete}, DROP POLICY IF EXISTS before each CREATE.

CREATE TABLE IF NOT EXISTS public.ds_metric_series_groups (
  test_run_id varchar(255) NOT NULL,
  application_dashboard_id uuid NOT NULL REFERENCES public.application_dashboards(id) ON DELETE CASCADE,
  panel_id integer NOT NULL,
  metric_name varchar(255) NOT NULL,
  group_name varchar(255) NOT NULL,
  dashboard_label varchar(255),
  panel_title varchar(255),
  aggregation varchar(8) NOT NULL,
  avg_members real,
  rule_id uuid REFERENCES public.series_grouping_rules(id) ON DELETE SET NULL,
  rule_hash varchar(16) NOT NULL,
  organization_id uuid,
  team_id uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (test_run_id, application_dashboard_id, panel_id, metric_name)
);
CREATE INDEX IF NOT EXISTS idx_ds_metric_series_groups_group
  ON public.ds_metric_series_groups (test_run_id, application_dashboard_id, panel_id, group_name);
CREATE INDEX IF NOT EXISTS idx_ds_metric_series_groups_label
  ON public.ds_metric_series_groups (test_run_id, dashboard_label, panel_title, panel_id);
CREATE INDEX IF NOT EXISTS idx_ds_metric_series_groups_app_dashboard
  ON public.ds_metric_series_groups (application_dashboard_id);
CREATE INDEX IF NOT EXISTS idx_ds_metric_series_groups_rule
  ON public.ds_metric_series_groups (rule_id);   -- ON DELETE SET NULL probes it on every rule delete
```

Neither table needs a `GRANT`: the consolidated migration's `ALTER DEFAULT PRIVILEGES` (`1700000000000-ConsolidatedSchema.ts:350-352`) covers new tables created by the migration role for both `perfana_app` and `perfana_system`.

`down` drops `ds_metric_series_groups`, then `series_grouping_rules`.

- [ ] **Step 1: Write the failing migration spec** (query-capture runner, as in 1814's spec). Assert:
  - `CREATE TABLE IF NOT EXISTS` for both tables;
  - `UNIQUE NULLS NOT DISTINCT` on the slot (a plain `UNIQUE` lets two dashboard-wide rules coexist, root `CLAUDE.md` #36);
  - the custom-pattern `CHECK`;
  - all five indexes;
  - `ENABLE` and `FORCE ROW LEVEL SECURITY` plus four policies on the rules table, and none on the derived table;
  - the bounded lock wait (`lock_timeout`, `lock_not_available`, the attempt cap);
  - `down` drops in dependency order.
- [ ] **Step 2:** `cd packages/shared && npx jest src/database/__tests__/1819-add-series-grouping.spec.ts` → fails.
- [ ] **Step 3:** Write the migration, the two entities, the barrel exports and the `schema-sql.ts` mirror.
- [ ] **Step 4:** Re-run the spec → passes.
- [ ] **Step 5: Migrate a local database and check it.** `npm run migration:run` against the local database, then:
  - `\d+ series_grouping_rules` shows the five-column unique constraint with `NULLS NOT DISTINCT`;
  - inserting two rows with `panel_id` NULL on the same slot fails with 23505.
- [ ] **Step 6:** `npm run check:entity-migrations` → passes. `npm run test:rls --workspace=@perfana/api -- -u` updates the coverage snapshot; review that the diff adds exactly the two tables.
- [ ] **Step 7:** Commit: `feat(shared): series_grouping_rules and ds_metric_series_groups (migration 1819)`.

---

## Task 3: Worker — grouping in `StatisticsPipeline`

**Files:**
- Create: `apps/worker/src/pipelines/helpers/series-grouping-plan.ts`. This holds the rule loading, the grouping plan, the membership rows and the grouped-statistics SQL builder.
- Modify: `apps/worker/src/pipelines/StatisticsPipeline.ts`: `execute` (113–217) and `aggregateMetricStatistics` (378–767).
- Test (new): `apps/worker/src/test/unit/pipelines/statistics-series-grouping.test.ts`
- Test (modify): `apps/worker/src/test/unit/pipelines/StatisticsPipeline.test.ts`. Its transaction mock (:91–138) chains `mockResolvedValueOnce` as DELETE → INSERT → COUNT. A batch with no rules must keep exactly that chain; that is what the test proves.
- Test (modify): `apps/worker/src/test/integration/statistics-pipeline.integration.test.ts`. It creates its own simplified tables (`CREATE TABLE IF NOT EXISTS`) and does not run migrations, so add the two new tables there.

**Interfaces:**

```typescript
// series-grouping-plan.ts
export interface LoadedRule {
  testRunId: string; ruleId: string; applicationDashboardId: string; panelId: number | null;
  spec: SeriesGroupingRuleSpec; hash: string;
}
/** Reads through the pooled db, OUTSIDE any transaction. Never throws. */
export async function loadSeriesGroupingRules(
  db: { query: (sql: string, params?: unknown[]) => Promise<unknown[]> },
  testRunIds: string[], logger: Logger,
): Promise<{ tablesPresent: boolean; rules: LoadedRule[] }>;

export interface MembershipRow {
  test_run_id: string; application_dashboard_id: string; panel_id: number; metric_name: string;
  group_name: string; dashboard_label: string | null; panel_title: string | null;
  aggregation: SeriesGroupingAggregation; track_member_count: boolean;
  member_count_name: string | null; rule_id: string; rule_hash: string;
}
/** Panel rule beats dashboard rule; invalid rules are skipped with a warning. Pure. */
export function buildMembership(rules: LoadedRule[], series: SeriesRow[], logger: Logger): MembershipRow[];
export function buildGroupedStatisticsSQL(firstParam: number): string;  // see SQL below
```

**Rule-loading SQL** (pooled `this.db.query`, before the transaction). Probe first, so a worker rolled out before migration 1819 runs degrades instead of failing:

```sql
SELECT to_regclass('public.series_grouping_rules') IS NOT NULL AS present;
-- when present:
SELECT tr.test_run_id, r.id, r.application_dashboard_id, r.panel_id, r.preset, r.pattern,
       r.replacement, r.aggregation, r.track_member_count
FROM test_runs tr
JOIN series_grouping_rules r
  ON r.system_under_test_id = tr.system_under_test_id
 AND r.test_environment = tr.test_environment
 AND r.workload = tr.workload
 AND r.enabled
JOIN application_dashboards ad ON ad.id = r.application_dashboard_id
WHERE tr.test_run_id = ANY($1::text[])
  AND COALESCE(ad.dashboard_uid, '') NOT LIKE 'performance-test-metrics-%';
```

Rules are loaded **per run**. A batch can span workloads; `processAdaptResults` taking row `[0]` is not a precedent to copy. On any error: `this.logger.warn({ err }, 'series-grouping: rules unavailable, aggregating without grouping')` (object first; worker `CLAUDE.md` notes the reversed order as a past bug), then return `{ tablesPresent: false, rules: [] }`.

**Inside the transaction**, after `refreshRampUpFlags` and before the existing DELETE (728):

1. When `tablesPresent`: `DELETE FROM ds_metric_series_groups WHERE test_run_id IN (<placeholders>)`. This runs even when there are no rules, so removing a rule removes the old membership on the next recalculation. When the table is absent, skip it; that is the only way this path can be reached without the table.
2. When there are rules: for each run, read the series of the dashboards its rules touch:

   ```sql
   SELECT application_dashboard_id, panel_id, metric_name,
          MIN(dashboard_label) AS dashboard_label, MIN(panel_title) AS panel_title
   FROM ds_metrics
   WHERE test_run_id = $1 AND application_dashboard_id = ANY($2::uuid[])
   GROUP BY 1, 2, 3
   ```

   This reads the touched dashboards' rows once. On a compressed chunk it decompresses the run's segment transiently (a read, not DML), the same order of cost as the aggregation that follows. **Measure it in Task 12.** If it shows up, switch to per-panel `SELECT DISTINCT metric_name … AND panel_id = $3` probes, which TimescaleDB SkipScans when the leading index columns are fixed (worker `CLAUDE.md` item 7).
3. Call `buildMembership` and insert the rows with one `INSERT … SELECT * FROM unnest($1::text[], $2::uuid[], …)`. Arrays, not multi-VALUES, so the bind limit never applies.
4. Change the existing statistics `INSERT` only when there are grouped panels: add one predicate to `metrics_filtered` that excludes grouped `(run, dashboard, panel)` triples. The triples are passed as three arrays starting at `$N+1`, because `placeholders` already uses `$1..$N` twice (402, 444):

   ```sql
   AND NOT EXISTS (
     SELECT 1 FROM unnest($A::text[], $B::uuid[], $C::int[]) g(test_run_id, application_dashboard_id, panel_id)
     WHERE g.test_run_id = m.test_run_id AND g.application_dashboard_id = m.application_dashboard_id
       AND g.panel_id = m.panel_id)
   ```

   With no grouped panels the SQL string is untouched; build it conditionally, not as an always-present `OR $flag`.
5. Run the **grouped statement**, `buildGroupedStatisticsSQL`. It is a second `INSERT INTO ds_metric_statistics … SELECT` over the same column list as `final_statistics`. Its input is per-timestamp combined points of the grouped panels only, never `metrics_filtered`:

   ```sql
   WITH members AS MATERIALIZED (
     SELECT * FROM unnest($1::text[], $2::uuid[], $3::int[], $4::text[], $5::text[], $6::text[], $7::boolean[], $8::text[])
       AS s(test_run_id, application_dashboard_id, panel_id, metric_name, group_name, aggregation, track_member_count, member_count_name)
   ),
   run_orgs AS MATERIALIZED (…same as the existing statement…),
   allowed_dashboards AS MATERIALIZED (…same…),
   grouped_points AS (
     SELECT m.test_run_id, m.application_dashboard_id, m.panel_id, s.group_name, m.time,
            CASE MIN(s.aggregation) WHEN 'sum' THEN SUM(m.value) WHEN 'max' THEN MAX(m.value) ELSE AVG(m.value) END AS value,
            COUNT(*) AS member_count,
            bool_or(s.track_member_count) AS track_member_count, MIN(s.member_count_name) AS member_count_name,
            MIN(m.dashboard_uid) AS dashboard_uid, MIN(m.panel_title) AS panel_title, MIN(m.dashboard_label) AS dashboard_label,
            MIN(m.benchmark_ids[1]::text)::uuid AS first_benchmark_id, MIN(m.unit) AS unit,
            MIN(m.metrics_source_id::text)::uuid AS metrics_source_id
     FROM ds_metrics m
     JOIN members s USING (test_run_id, application_dashboard_id, panel_id, metric_name)
     WHERE m.test_run_id = ANY(<run ids>) AND m.ramp_up = false AND m.value IS NOT NULL
       AND m.application_dashboard_id IN (SELECT id FROM allowed_dashboards)
     GROUP BY 1, 2, 3, 4, 5
   ),
   points AS (
     SELECT test_run_id, application_dashboard_id, panel_id, group_name AS metric_name, time, value, … FROM grouped_points
     UNION ALL
     SELECT test_run_id, application_dashboard_id, panel_id, member_count_name, time, member_count::double precision, …
     FROM grouped_points WHERE track_member_count AND member_count_name IS NOT NULL
   )
   -- then the SAME statistics_aggregated / final_statistics / INSERT chain, reading `points`
   ```

   - **Do not copy the chain by hand.** Extract it from the existing statement into `buildStatisticsChain(inputRelation: string)` and call it twice: once with `metrics_filtered` (the existing statement), once with `points`. The snapshot from step 1 proves the first call reproduces today's SQL exactly.
   - `COUNT(*)` is members per timestamp. Each raw series has at most one row per `time` (`uniq_ds_metrics_upsert`).
   - Organization and team come from `run_orgs` exactly as in the existing chain.
   - Data loaded in this transaction is invisible to the planner (worker `CLAUDE.md`, "`ds_adapt_results` is written by an upsert", item 3). That is why `members` is built from bound arrays, not read back from `ds_metric_series_groups`.
6. **Alignment.** Make the grouped statement report how many members it combined per timestamp:
   - Wrap its `INSERT` as a data-modifying CTE (`ins AS (INSERT INTO ds_metric_statistics … SELECT … RETURNING 1)`).
   - End the statement with `SELECT test_run_id, application_dashboard_id, panel_id, group_name, AVG(member_count) AS avg_members FROM grouped_points GROUP BY 1, 2, 3, 4`.
   - Postgres executes a data-modifying CTE whether or not it is referenced, so the statistics are written and the alignment rows come back in one round trip.
   - `grouped_points` is then referenced twice and materialised, but it holds groups × timestamps (thousands of rows), not raw rows.
   - Write the result with one `UPDATE ds_metric_series_groups g SET avg_members = a.avg_members FROM unnest($1::text[], $2::uuid[], $3::int[], $4::text[], $5::real[]) a(…) WHERE …` (matching on run, dashboard, panel, group).
   - Warn when a group has ≥ 2 members and `avg_members < 1.2`: `series-grouping: <dashboard>/<panel> group "<g>" has <n> members but <x> per timestamp; timestamps are not aligned, so values are not combined`.
7. **Log one summary line per batch:** `series-grouping: runs=<n> rules=<n> panels=<n> rawSeries=<n> groups=<n> memberCountSeries=<n> in <ms>ms`.
8. **The existing `COUNT(*)` re-read** (744–750) already counts both statements' rows. Leave it.

- [ ] **Step 1: Pin today's SQL.** Before touching `StatisticsPipeline.ts`, add a test to `StatisticsPipeline.test.ts` that captures the exact SQL strings and params of a no-rule batch, as an inline snapshot. Commit it on its own (`test(worker): pin StatisticsPipeline SQL for a batch with no grouping rules`).
- [ ] **Step 2:** `gitnexus_impact` on `aggregateMetricStatistics`, `execute` and `StatisticsPipeline`. Note that `ControlGroupStatisticsPipeline.backfillMissingSketches` (:244) also calls `execute`, which is correct: backfilled baselines get grouped too.
- [ ] **Step 3: Write the failing unit tests** in `statistics-series-grouping.test.ts`:
  - **Rule loading:**
    - With the table absent (`to_regclass` NULL), no membership DELETE is issued and the SQL equals the step 1 snapshot.
    - When rule loading throws, the batch still succeeds with the step 1 SQL and a warning is logged.
    - A batch with the table present and no rules issues the membership DELETE and otherwise the step 1 SQL.
  - **`buildMembership`:**
    - A panel rule wins over a dashboard rule.
    - An invalid custom rule is skipped with a warning.
    - A perf-test dashboard is never grouped.
    - Unrenamed series on a grouped panel become groups of one.
  - **SQL shape with one grouped panel:**
    - The grouped triples are excluded from the first INSERT.
    - The grouped INSERT receives arrays aligned element-for-element.
    - Member-count rows appear only when tracked.
  - **Alignment:** an `avg_members` of 1.0 on a 3-member group logs the warning.
- [ ] **Step 4:** `cd apps/worker && npx vitest run src/test/unit/pipelines/statistics-series-grouping.test.ts src/test/unit/pipelines/StatisticsPipeline.test.ts` → the new tests fail and the snapshot test passes.
- [ ] **Step 5:** Implement `series-grouping-plan.ts`, extract `buildStatisticsChain`, and wire steps 1–8 into the pipeline. Re-run → all pass, snapshot unchanged.
- [ ] **Step 6: Integration test.** Extend `statistics-pipeline.integration.test.ts`, which needs TimescaleDB + Toolkit for `percentile_agg` (local only; CI runs `test:coverage` and never runs integration tests, see Task 12):
  - two runs, three pod series each with different pod names, aligned timestamps, a rule with `avg` and member count;
  - assert:
    - one `ds_metric_statistics` row per group plus the member-count row;
    - `mean` equals a hand-computed mean of the per-timestamp averages;
    - `count` equals the number of timestamps;
    - `pct_agg` is non-NULL;
    - **no** row carries a raw pod name;
    - an ungrouped panel in the same run is byte-identical to a run with no rule. Diff with a FULL JOIN, and include a NULL-unit row explicitly (worker `CLAUDE.md` item 7: a diff over real data alone is a false pass).
- [ ] **Step 7:** Commit: `feat(worker): group series at the statistics layer`.

---

## Task 4: Worker — downstream guards

**Files:**
- Modify: `apps/worker/src/pipelines/ControlGroupStatisticsPipeline.ts`: the legacy-path branch (360–367, raw scan 466–493)
- Test: `apps/worker/src/test/unit/pipelines/ControlGroupStatisticsPipeline.test.ts`, `apps/worker/src/test/unit/pipelines/checks/DataAggregator.test.ts`, `apps/worker/src/test/unit/pipelines/adapt-orphaned-results.test.ts`

**Why:** the legacy path (any control run with `pct_agg IS NULL`) re-reads raw `ds_metrics` grouped by raw `metric_name` and inner-joins that to `ds_metric_statistics` names. Group names have no raw counterpart there, so groups silently drop out of that baseline. Grouped rows are always written with `pct_agg`, and `backfillMissingSketches` reruns `StatisticsPipeline` (and therefore the grouping) first, so this only bites when the backfill fails. The degraded result is `incomparable`, not a wrong verdict. Make it loud instead of duplicating the grouping SQL into the legacy path.

- [ ] **Step 1: Write the failing tests.**
  - `ControlGroupStatisticsPipeline`: when the legacy path is chosen and any control run has `ds_metric_series_groups` rows, it logs `series-grouping: control group <id> took the legacy path; grouped series are left out of this baseline and will read incomparable until the baseline statistics are recalculated`. The probe is guarded by `to_regclass` and costs one `EXISTS`.
  - `adapt-orphaned-results`: a run whose per-pod statistics rows were replaced by a group row has its per-pod `ds_adapt_results` deleted (`deleteOrphanedResults`, `results-processor.ts:193–270`). This is the behaviour the feature relies on; pin it.
  - `DataAggregator`: a grouped panel that collapses to a single constant group becomes the artificial `default` target (`DataAggregator.ts:271`), exactly like any single-constant-series panel. Pin it, so the interaction is documented rather than discovered.
- [ ] **Step 2:** Run them → the first fails, the other two pass (they pin existing behaviour).
- [ ] **Step 3:** Add the guarded `EXISTS` probe and the warning. Re-run → pass.
- [ ] **Step 4:** Commit: `feat(worker): warn when a grouped baseline takes the legacy control-group path`.

---

## Task 5: API — rules module (CRUD, copy, audit, 409)

**Files:**
- Create the module `apps/api/src/modules/series-grouping/`. Model every file on `apps/api/src/modules/graph-presets/`:
  - `series-grouping.module.ts`: `TypeOrmModule.forFeature([SeriesGroupingRule, ApplicationDashboard, TestRun])`, `CommonModule`, `AuditModule`, and `this.auditRegistry.register('series-grouping-rules', SeriesGroupingRule)` in `onModuleInit`.
  - `series-grouping.controller.ts`
  - `series-grouping.service.ts`
  - `dto/create-series-grouping-rule.dto.ts`, `dto/update-series-grouping-rule.dto.ts`, `dto/series-grouping-rule-response.dto.ts`, `dto/copy-target.dto.ts`
  - `duplicate-rule.ts`: the 23505 recogniser. Only the API writes this table, so it stays local. CODING_RULES says to move it to shared only when two apps write the table.
- Modify: `apps/api/src/app.module.ts`: import and register `SeriesGroupingModule` beside `GraphPresetsModule` (:24, :110).
- Test: `series-grouping.service.spec.ts`, `series-grouping.controller.spec.ts`, `apps/api/src/test/rls/series-grouping-rules-scope.spec.ts` (model: `graph-presets-sut-scope.spec.ts`)

**Routes** (`@Controller('series-grouping-rules')`, `@UserCtx() ctx: UserContext` from `common/decorators/user-context.decorator.ts`, `resolveOrgScope` = `withOrgFilter(ctx.userId, ctx.roles, this.authzService)` from `common/utils/with-org-filter.ts`):

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/` | `systemId`, `environment`, `workload`, optional `applicationDashboardId` | `SeriesGroupingRuleResponse[]` |
| GET | `/:id` | | `SeriesGroupingRuleResponse` |
| POST | `/` | `CreateSeriesGroupingRuleDto` | `{ rule, copies: { created: SeriesGroupingRuleResponse[]; skipped: CopySkip[] } }` |
| PATCH | `/:id` | `UpdateSeriesGroupingRuleDto` | `SeriesGroupingRuleResponse` |
| DELETE | `/:id` | | 204 |

```typescript
class CreateSeriesGroupingRuleDto {
  @IsUUID() systemUnderTestId!: string;
  @IsString() @IsNotEmpty() testEnvironment!: string;
  @IsString() @IsNotEmpty() workload!: string;
  @IsUUID() applicationDashboardId!: string;
  @IsOptional() @IsInt() @Min(0) panelId?: number | null;      // null/absent = whole dashboard
  @IsIn(['k8s-pod','k8s-daemonset','ip-port','trailing-id','custom']) preset!: SeriesGroupingPreset;
  @IsOptional() @IsString() @MaxLength(500) pattern?: string;
  @IsOptional() @IsString() @MaxLength(255) replacement?: string;
  @IsIn(['avg','sum','max']) aggregation!: SeriesGroupingAggregation;
  @IsBoolean() trackMemberCount!: boolean;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsIn(['manual','suggestion']) origin?: 'manual' | 'suggestion';  // 'copy' is server-only
  @IsOptional() @ValidateNested({ each: true }) @Type(() => CopyTargetDto) copyTo?: CopyTargetDto[];
}
class CopyTargetDto { @IsString() testEnvironment!: string; @IsString() workload!: string; }
// Update = PartialType(OmitType(Create, ['systemUnderTestId','testEnvironment','workload',
//          'applicationDashboardId','panelId','origin','copyTo'])) — the slot is immutable.
type CopySkip = { testEnvironment: string; workload: string;
  reason: 'exists' | 'no-dashboard' | 'ambiguous-dashboard' | 'unknown-workload' | 'not-writable' };
```

**Service rules:**
1. **Authorize the parent first.** Load the application dashboard with `withRequestEm(this.appDashRepo)`. Require that it belongs to `systemUnderTestId` + `testEnvironment` and that `accessibleOrgIds === null || accessibleOrgIds.includes(appDash.organizationId)`; otherwise answer **404** with the same message as a missing dashboard. Reject a dashboard whose `dashboardUid` starts with `performance-test-metrics-` with 400.
2. **Validate the rule.** Normalise `pattern` / `replacement` to `null` / `''` for presets. Run `compileSeriesGroupingRule`; `{ ok: false }` → 400 with the guard's `error`.
3. **Create.** `this.repo.create({ ...fields, organizationId: appDash.organizationId, teamId: appDash.teamId, createdBy: ctx.userId, updatedBy: ctx.userId, origin: dto.origin ?? 'manual' })`, then `save`, then `auditService.logCreate`. The audit lint rule `audit-mutation-must-log` requires a `log*` call in every method that calls `save` / `delete` / `update`.
4. **409 on the slot.** A 23505 on `uq_series_grouping_rules_slot` for the **primary** rule → `ConflictException` with no body. Recognise it once in `duplicate-rule.ts`, reading `error.code ?? error.driverError?.code` and the constraint name. The controller catch must start `if (error instanceof HttpException) throw error;` (CODING_RULES.md:181–204; model `benchmarks.controller.ts:126-131`).
5. **`copyTo`, after the primary rule is saved**, for each target:
   - **Workload check:** it must have at least one test run for `(system, environment, workload)`, else skip `unknown-workload`.
   - **Same environment:** keep `applicationDashboardId` and `panelId`.
   - **Different environment:** find `application_dashboards` with the same `system_under_test_id`, the target `test_environment`, the same `dashboard_uid`, and `grafana_instance_id IS NOT DISTINCT FROM` the source's. Zero rows → `no-dashboard`; more than one (different labels) → `ambiguous-dashboard`.
   - **Org check:** the target dashboard's org must be in `accessibleOrgIds`, else `not-writable`.
   - **Save:** `origin: 'copy'`, inside a `SAVEPOINT` gated on `getRequestEm() !== null`. A 23505 rolls back to it and records `exists`; copy `saveSkippingDuplicateTarget` (`benchmark-mutation.service.ts:398`). Each created copy is audited.
6. **Not found.** `findOne`, `update` and `remove` load by id and call an `assertTenantAccess`-style 404 (`graph-presets.service.ts:47`). `findAll` returns `[]` early on `accessibleOrgIds?.length === 0`.
7. **Audit references.** Audit `ref` objects must be entity instances (`repo.create` or `Object.assign(new SeriesGroupingRule(), …)`), or the audit row loses its field diff (`audit.service.ts:107`).

- [ ] **Step 1:** `gitnexus_impact` on nothing existing; this task only adds files, plus one line in `app.module.ts`.
- [ ] **Step 2: Write the failing specs:**
  - **Create:**
    - inherits org and team from the application dashboard (camelCase);
    - 404 for a dashboard in another org, and for one in another system or environment;
    - 400 for a perf-test dashboard and for an unsafe custom regex;
    - 409 on a duplicate slot, including two dashboard-wide rules (`panelId` null);
    - audit `logCreate` called with an entity instance.
  - **Copy:**
    - same environment keeps the dashboard id;
    - another environment resolves by uid + instance;
    - `no-dashboard`, `ambiguous-dashboard`, `exists` (via 23505 + savepoint), `not-writable` and `unknown-workload` each reported;
    - copies stored with `origin: 'copy'`.
  - **Read / update / delete:**
    - `findAll` returns `[]` on an empty org list;
    - `findOne`, `update` and `remove` return 404 across orgs;
    - update cannot change the slot.
  - **RLS spec:** under `DB_ENABLE_RLS_ROLE=true`, a rule of org A is invisible to org B.
- [ ] **Step 3:** `cd apps/api && npx jest src/modules/series-grouping` → fails.
- [ ] **Step 4:** Implement it. Re-run → passes. `npm run lint --workspace=@perfana/api` passes the audit and owned-resource rules.
- [ ] **Step 5:** Commit: `feat(api): series grouping rules CRUD with copy to other workloads`.

---

## Task 6: API — preview, suggestions, apply, status

**Files:**
- Modify: `series-grouping.controller.ts` and `series-grouping.service.ts`
- Create: `series-grouping-test-run.controller.ts` (`@Controller('test-runs')`) for the suggestions and status routes, registered in the same module. Nest allows several controllers on one prefix.
- Create: `apps/api/src/modules/series-grouping/run-scope.ts` (baseline-run resolution and the recalculation partition)
- Modify: `apps/api/src/modules/test-runs/handlers/update-analysis-time-range.handler.ts`. Extract the `not-writable` / `running` checks out of `partitionAnalysisTimeRangeScope` (:119) into an exported `partitionWritableCompletedRuns`, and call it from both places so the two cannot drift. **Run `gitnexus_impact` on `partitionAnalysisTimeRangeScope` first**; its existing specs must pass unchanged.
- Test: `series-grouping.preview.spec.ts`, `series-grouping.suggestions.spec.ts`, `series-grouping.apply.spec.ts`, plus the existing analysis-time-range specs.

**Baseline runs.** `details.controlRuns` is **not** a general source: it is written only for an INSUFFICIENT_DATA conclusion with cause `baseline-aggregation-failed` (`adapt-validator.ts:484`). Read instead: the latest `ds_adapt_conclusion` row for the run → `control_group_id` → `ds_control_groups.test_runs` (`text[]`). The SQL to copy is `report-data-fetcher.service.ts:2245`. When the run has no conclusion yet, fall back to the five most recent **completed** runs of the same workload that started before it. Access-check the run with the shape of `AdaptService.validateTestRunAccess(testRunId, orgIds)` (`adapt.service.ts:108`).

**Names, cheaply.** The raw names of a run's panel are:
- the membership table's `metric_name` for grouped panels;
- `ds_metric_statistics.metric_name` for ungrouped ones.

Both are small tables; nothing here reads `ds_metrics`. Baseline group names for suggestions come from `ds_control_group_statistics`.

**Routes:**

| Method | Path | Notes |
|---|---|---|
| POST | `/series-grouping-rules/preview` | Body: `{ testRunId?, systemId?, environment?, workload?, applicationDashboardId, panelId?, rule: SeriesGroupingRuleSpec }`. Without `testRunId`, it uses the workload's most recent completed run; this is the system-config entry point. Returns `{ testRunId, baselineRunIds, panels: [{ panelId, panelTitle, currentNames, baselineNames }], sloWarnings: [{ benchmarkId, name, matchPattern }], rawNameCollisions: string[], alignment: [{ panelId, group, members, avgMembers }] }`. **The client computes the groups** with `applySeriesGrouping`, so the preview is fetched once per dialog, not per keystroke. `alignment` comes only from `ds_metric_series_groups.avg_members` of runs already grouped by an earlier rule; a first-time preview cannot know it (design doc, Decision 4). |
| GET | `/test-runs/:id/series-grouping-suggestions` | One entry per panel with ≥ 2 non-ignored `incomparable` `ds_adapt_results` and no enabled rule covering it, where some preset gives `matchedBefore < SUGGEST_MAX_MATCHED_BEFORE` and `matchedAfter >= SUGGEST_MIN_MATCHED_AFTER` (`evaluateGroupingPresets`). Returns `[{ applicationDashboardId, dashboardLabel, panelId, panelTitle, incomparableCount, preset, matchedBefore, matchedAfter }]`. Logs each one at info: `series-grouping suggestion <testRunId> <dashboardId>/<panelId> preset=<p> matched <b>% -> <a>% incomparable=<n>` (Decision 5). |
| POST | `/series-grouping-rules/apply` | Body: `{ testRunId, scope: 'baseline' \| 'recent' }`. `baseline` means the run plus its baseline runs; `recent` means the workload's most recent completed runs, up to `MAX_BULK_ANALYSIS_TIME_RANGE_RUNS` (100). Truncation is fine here; the design explains why. Partitions with `partitionWritableCompletedRuns` and enqueues `bullmqClientService.reevaluateBatch(ids, { checks: true, adapt: true, recalculateStatistics: true })` (`bullmq-client.service.ts:313`) inside `runAfterRequestCommit`, whose callback logs and swallows every error (`common/db/request-em.ts:93`). Returns `{ enqueued: string[], skipped: AnalysisTimeRangeScopeEntry[] }`. |
| GET | `/test-runs/:id/series-grouping-status` | `{ stale: [{ applicationDashboardId, panelId, reason: 'not-applied' \| 'rule-changed' \| 'rule-removed' }], misaligned: [{ applicationDashboardId, panelId, group, members, avgMembers }] }`. Compares the enabled rules covering the run's workload against its membership rows (`rule_hash`; rows with `rule_id` NULL mean the rule was removed). |

**SLO warnings.** Benchmarks on the panel (`application_dashboard_id`, `panel_id`, plus the workload's system and environment) whose `match_pattern` column, or `configuration.matchPattern`, matches at least one current raw name and no group name. Compile it with `validateRegexPattern`; skip benchmarks whose stored pattern is invalid.

- [ ] **Step 1:** `gitnexus_impact` on `partitionAnalysisTimeRangeScope`. Extract `partitionWritableCompletedRuns`; the existing analysis-window specs stay green.
- [ ] **Step 2: Write the failing specs:**
  - **Preview:**
    - baseline from the control group, falling back to recent runs with no conclusion;
    - names from statistics plus membership, never `ds_metrics` (assert on the SQL);
    - an SLO warning for `^api-`;
    - a raw-name collision;
    - 404 across orgs.
  - **Suggestions:**
    - the thresholds;
    - panels with a rule excluded;
    - ignored results excluded;
    - the log line is written.
  - **Apply:**
    - `running` and `not-writable` reported;
    - the cap honoured;
    - `reevaluateBatch` called with canonical `test_run_id` strings **after commit** (assert the hook, not a direct call).
  - **Status:** each of the three stale reasons, and the misaligned output.
- [ ] **Step 3:** Run → fails. Implement → passes.
- [ ] **Step 4:** Commit: `feat(api): series grouping preview, suggestions, apply and status`.

---

## Task 7: API — group-aware `ds_metrics` readers

**Files:**
- Create: `apps/api/src/modules/metrics/series-group-resolver.ts`
- Modify: `apps/api/src/modules/metrics/metrics.service.ts`, `metrics.controller.ts`
- Modify: `apps/api/src/modules/reports/services/report-data-fetcher.service.ts`
- Test: `metrics.service.spec.ts`, `series-group-resolver.spec.ts`, `report-data-fetcher.service.spec.ts`

**MCP needs no change.** `apps/mcp` reads metrics over the API (`perfana-client.ts:247`): `get_available_metrics` → `/metrics/ds-metrics/available/:id` and `get_metric_trends` → `/metrics/ds-metrics/time-series/:id`. Both become group-aware here.

**Resolver.** It has no RLS of its own: `ds_metrics` and `ds_metric_series_groups` carry none, so the caller has already authorized the run (service comment at :1200).

```typescript
export interface PanelRef { testRunId: string; applicationDashboardId?: string; dashboardLabel?: string; panelTitle?: string; panelId: number; }
export interface SeriesGroup { group: string; members: string[]; aggregation: SeriesGroupingAggregation; }
export class SeriesGroupResolver {
  /** Groups for a panel of a run: membership rows when present; for a run with none (live, or not yet
   *  recalculated) applies the CURRENT rule to `rawNames` with applySeriesGrouping. */
  async groupsForPanel(em: EntityManager, ref: PanelRef, rawNames?: string[]): Promise<SeriesGroup[]>;
  /** Expands requested names: a group name becomes its members, anything else passes through. */
  async expand(em: EntityManager, ref: PanelRef, names: string[]): Promise<{ raw: string[]; groups: SeriesGroup[] }>;
}
```

The live-run fallback needs the run's workload → rule. Look it up with one indexed query on `series_grouping_rules`, keyed by the run's `(system, environment, workload)` and the panel's application dashboard. For label-addressed panels, take the dashboard id from `ds_metric_series_groups` when present, else from the existing panel query.

**Aggregated read.** One SQL fragment, used by every reader that receives a group, combines members per timestamp exactly as Task 3 does:

```sql
SELECT time, '<group>'::text AS metric_name,
       CASE $agg WHEN 'sum' THEN SUM(value) WHEN 'max' THEN MAX(value) ELSE AVG(value) END AS value,
       MIN(unit) AS unit, bool_and(ramp_up) AS ramp_up
FROM ds_metrics
WHERE test_run_id = $1 AND <panel predicate> AND metric_name = ANY($members::text[])
GROUP BY time
```

Pass the group name as a bound parameter; the `'<group>'` above is notation only, never interpolate it.

**Readers.** Run `gitnexus_impact` on each method before editing.

| Route → method | Change |
|---|---|
| `GET ds-metrics/available/:testRunId` → `getAvailableDashboards` (:1282) | After the existing query, replace each grouped panel's `metric_names` with group names (sorted), set `metric_count` to that length (still a bigint string), and add `series_groups: { group, members }[]`. That field is additive; existing clients ignore it. `?members=true` skips all of this and returns raw names. |
| `GET ds-metrics/distinct-names` → `getDistinctMetricNames` (:1191) | Return group names for a grouped panel. `?members=true` returns raw names. The response stays `string[]`. |
| `GET ds-metrics/time-series/:testRunId` → `getMetricTimeSeries` (:1323) | When `metricName` is a group (`expand`), answer from the aggregated fragment. Its current QueryBuilder path (`m.metric_name = :metricName`, :1347) stays for raw names. |
| `GET ds-metrics/:testRunId/:panelId` → `findDSMetricsForPanel` (:207) | Three places carry the name: the existence probe (:255), `executeRegularQuery` (:297, :312) and `executeLTTBQuery` (:348, :377, :390, :411). With a group name, all three read the aggregated fragment as a subquery source instead of `ds_metrics`. With **no** `metricName` on a grouped panel, return one aggregated series per group. `?members=true` returns the raw series. |
| `GET ds-metrics-comparison` (:217) | No change of its own: it calls `findDSMetricsForPanel` once per run, and membership is per run, so the two runs expand independently, as they must. Add a test that proves it. |
| Reports: `getMetricsTimeSeries` (:2480, `dm.metric_name = $n` at :2519) | Same expansion. Callers: `graphs-renderer.ts:163,292`, `comparisons-renderer.ts:153,158`. |
| Reports: `getAvailableMetricsPanels` (:3511) | Group names for grouped panels, so the report configuration cascade offers groups. |
| Reports: `getMetricTrends` (:2731), `getBaselineRunComparisonFromStatistics` (:3060) | No change: they read `ds_metric_statistics`, which already holds group names. Add one test each that a group name round-trips. |

- [ ] **Step 1: Write the failing specs:**
  - **Resolver:** membership rows win; the live fallback applies the current rule; a non-group name passes through.
  - **Readers:**
    - `getAvailableDashboards` returns group names plus `series_groups`, and raw with `members=true`;
    - `getMetricTimeSeries` and `findDSMetricsForPanel` (regular and LTTB) aggregate members with the stored aggregation;
    - `ds-metrics-comparison` expands each run with its own members;
    - the report `getMetricsTimeSeries` expands too;
    - a panel with no rule produces byte-identical SQL to today (snapshot each method's SQL before editing, as in Task 3 step 1).
- [ ] **Step 2:** Run → fails. Implement → passes.
- [ ] **Step 3:** Commit: `feat(api): expand series groups in ds_metrics readers`.

---

## Task 8: API — SUT transfer and deletion

**Files:**
- Modify: `apps/api/src/modules/sut-transfer/sut-resource-graph.ts`. Add `{ table: 'series_grouping_rules', filter: 'bySut', group: <same as ds_compare_config> }` after `application_dashboards`, and `{ table: 'ds_metric_series_groups', filter: 'byTestRunVarchar', group: 'core' }` after both `ds_metric_statistics` (:131) and `series_grouping_rules`. The array is in insert order, and `rule_id` references the rules table.
- Modify: `sut-resource-graph.spec.ts:11` (the hard-coded expected list)
- Modify: `apps/api/src/modules/systems-under-test/handlers/delete-system-under-test.handler.ts`:
  - `ds_metric_series_groups` in phase 1 (run-keyed, list :273–280);
  - `series_grouping_rules` in phase 6 (`deletePhase6_OtherSutTables`, :399);
  - both counted in `getDeletePreview` (:46).
  
  The handler deletes every table explicitly even where a CASCADE exists, so follow it.
- Modify: `apps/api/src/modules/test-runs/handlers/delete-test-run.handler.ts`: add `ds_metric_series_groups` to `deleteDependentData` (:210).
- No change to `ApplicationDashboardsService.delete`'s `dependentTables` (`application-dashboards.service.ts:893`): both FKs are `ON DELETE CASCADE`, and that list is for `NO ACTION` children.
- Tests: the specs beside each file.

- [ ] **Step 1:** `gitnexus_impact` on `DeleteSystemUnderTestHandler.execute`, `getDeletePreview` and `DeleteTestRunHandler.deleteDependentData`.
- [ ] **Step 2: Write the failing specs:**
  - the resource-graph order;
  - the SUT delete issues both deletes in the right phases and the preview counts them;
  - the test-run delete removes membership rows;
  - an export → import round trip keeps rules and membership. Neither table has a serial id, so `SERIAL_ID_TABLES` (`sut-import.service.ts:62`) is unchanged.
- [ ] **Step 3:** Run → fails. Implement → passes.
- [ ] **Step 4:** Commit: `feat(api): series grouping in SUT transfer and deletion`.

---

## Task 9: Web — client and dialog

**Files:**
- Create: `apps/web/lib/api/series-grouping.ts`, a typed client modelled on `lib/api/sparse-metric-exclusions.ts`: `authenticatedFetch` from `@/lib/api`; throw `serverErrorMessage(response, fallback)` (`lib/errors.ts:112`) on `!ok`.
- Create: `apps/web/components/series-grouping/SeriesGroupingDialog.tsx`, `useSeriesGroupingPreview.ts`
- Create: `apps/web/lib/safe-storage.ts`. Copy the SSR-guarded, try/catch `readFromStorage` / `writeToStorage` from `hooks/usePinnedSystems.ts`; leave that hook alone, and file a follow-up to switch it over.
- Test: `apps/web/components/series-grouping/__tests__/SeriesGroupingDialog.test.tsx`. Model it on `__tests__/app/test-runs/performance-analysis/ApdexSloDialog.test.tsx`: it mocks `@/lib/api`, routes fetches by prefix, and uses `findBodyFor(url, method)` and userEvent.

**Client functions:** `listRules`, `createRule`, `updateRule`, `deleteRule`, `previewRule`, `fetchSuggestions`, `applyRules`, `fetchStatus`, one per route in Tasks 5–6, typed to those shapes.

**Dialog props:**

```typescript
interface SeriesGroupingDialogProps {
  open: boolean; onClose: () => void;
  context: { systemId: string; environment: string; workload: string;
             applicationDashboardId: string; dashboardLabel: string;
             panelId: number | null; panelTitle?: string; testRunId?: string };
  existingRule?: SeriesGroupingRuleResponse;   // edit mode
  initialPreset?: SeriesGroupingPreset;        // from a suggestion
  origin: 'manual' | 'suggestion';
  copyTargets: { testEnvironment: string; workload: string }[]; // the system's other workloads
  onSaved: (result: { rule: SeriesGroupingRuleResponse; enqueued: number }) => void;
  showToast?: (message: string) => void;       // the test-run page passes one; the config page shows an inline Alert
}
```

**Behaviour.** The layout follows the design's mock-up.
1. **Opening.** On open, call `previewRule` once with the initial spec. Hold `currentNames` and `baselineNames` in state.
2. **Live preview.** On every change, run `applySeriesGrouping` on both name lists client-side and recompute the table and the "before / after" line. Never refetch per keystroke.
3. **Preselection.** Choose the preset from `evaluateGroupingPresets` when neither `initialPreset` nor `existingRule` is given, and label it "(detected)".
4. **Custom regex.** `compileSeriesGroupingRule` errors show inline under the field and disable Save.
5. **Warnings.** `sloWarnings`, `rawNameCollisions` and `alignment` render as warning lines under the table.
6. **Copy targets.** A checkbox, off by default, plus a multi-select of `copyTargets`. Copy results are reported after save: "Created for 2 workloads; skipped Acc / Peak (no such dashboard)".
7. **Recalculate.** The checkbox is on by default, and only when `testRunId` is set. Save then calls `applyRules({ testRunId, scope: 'baseline' })` and reports "Recalculating 6 runs". With it off, the button reads **Save**.
8. **Mode.** MUI `Dialog maxWidth="md" fullWidth`, like `EditDashboardDialog.tsx:149`.

- [ ] **Step 1: Write the failing dialog tests:**
  - preview fetched once, and the table updates when the preset changes without another fetch;
  - the detected preset is preselected;
  - an unsafe custom regex disables Save and shows the guard message;
  - the POST body carries `origin` and `copyTo`;
  - with recalculation on, apply is POSTed after create;
  - edit mode PATCHes and never sends the slot fields.
- [ ] **Step 2:** `cd apps/web && npx jest components/series-grouping` → fails. Implement → passes.
- [ ] **Step 3:** Commit: `feat(web): series grouping dialog with live preview`.

---

## Task 10: Web — entry points

**Files:**
- Create: `apps/web/app/test-runs/[id]/components/anomaly-detection/components/SeriesGroupingNotices.tsx`
- Modify: `apps/web/app/test-runs/[id]/components/anomaly-detection/components/expanded-card/components/AnomalyTabContent.tsx`: render the notices between `FeedbackBanner` (:111–118) and `AnomalyDetectionTable` (:120). `testRun`, `showToast` and `handlePanelFilterChange` are already props there.
- Modify: `apps/web/app/systems/[id]/config/components/EditDashboardDialog.tsx`: add a "Series grouping" section after the Variables block (:247).
- Modify: `apps/web/app/systems/[id]/config/components/ConfigDialogs.tsx` (:109–117): pass `systemId` and `selectedWorkload` (already ConfigDialogs props at :46–49) to `EditDashboardDialog`.
- Test: `__tests__/app/test-runs/anomaly-detection/SeriesGroupingNotices.test.tsx`, `apps/web/app/systems/[id]/config/components/__tests__/EditDashboardDialog.seriesGrouping.test.tsx`

**`SeriesGroupingNotices` (anomaly card):**
- **Fetching.** Fetch suggestions and status when the expanded card mounts. `useAnomalyDetection` fetches only on expand (:271), so follow the same lifecycle. It re-fetches after `onRefreshAnomalyData`.
- **Suggestions.** An MUI `Alert severity="info"` per suggestion, styled like `FeedbackBanner.tsx:75-80`. Show at most three, then "and N more panels". Actions:
  - **Group series…** opens the dialog with `origin: 'suggestion'` and `initialPreset`;
  - **Show rows** calls `handlePanelFilterChange` for that panel;
  - **Dismiss** writes `perfana.seriesGrouping.dismissed.<systemId>.<env>.<workload>.<dashboardId>.<panelId>` through `safe-storage`.
- **Stale.** One `Alert severity="warning"`: "Grouping rules changed since this run's statistics were calculated" with **Recalculate N runs** → `applyRules({ scope: 'baseline' })` → `showToast`.
- **Misaligned.** One warning per group, with the text from the design.

**`EditDashboardDialog` section:**
- Gate it on a selected workload, because rules are per workload while the dashboard list is per environment. With `selectedWorkload === ''`, show "Select a workload to configure series grouping."
- List the rules of `(systemId, environment, workload, dashboard.id)` with preset, aggregation, panel ("All panels" for null) and enabled.
- Add / Edit open `SeriesGroupingDialog` without `testRunId`; the preview then uses the workload's latest completed run. Delete asks for confirmation.
- Errors render as an inline `Alert`; this page has no toast (`DashboardSection.tsx:284-288`).

- [ ] **Step 1: Write the failing tests:**
  - **Notices:**
    - the suggestion renders and opens the dialog with the preset;
    - dismiss persists, so a remount does not show it again;
    - the stale notice posts apply and toasts;
    - nothing renders when both endpoints return empty.
  - **Config section:**
    - gated on a workload;
    - lists rules;
    - delete confirms then calls `deleteRule`.
- [ ] **Step 2:** Run → fails. Implement → passes.
- [ ] **Step 3:** Commit: `feat(web): series grouping suggestions, stale notice and dashboard settings`.

---

## Task 11: Web — series picker

**Files:**
- Modify: `apps/web/app/test-runs/[id]/components/shared/metric-options.ts`:
  - `AvailablePanelRow` (:189–196) gains `series_groups?: { group: string; members: string[] }[]`;
  - `SeriesOption` (:70–73) gains `members?: string[]`;
  - `seriesFromAvailableRows` (:265–282) maps the field;
  - `fetchSeriesForPanel` (:374) takes a `members` flag that bypasses the `panel.metricNames` short-circuit (:399–401) and calls `distinct-names?members=true`.
- Modify: `apps/web/app/test-runs/[id]/components/shared/MetricSeriesCascade.tsx`:
  - a `N pods` badge in `CascadeRow`'s `trailing` slot (:591–599), with an MUI `Tooltip` listing the members;
  - a per-panel **Show individual pods** toggle through a new optional `action` prop on `CascadeGroup`;
  - toggle state keyed per panel, and that key joins `panelsKey` in the series effect (:182–196).
- Modify: `apps/web/components/charts/CascadeColumns.tsx`: an optional `action?: ReactNode` on `CascadeGroup` (:241–268), rendered beside the label.
- Test: `apps/web/app/test-runs/[id]/components/shared/__tests__/MetricSeriesCascade.seriesGroups.test.tsx`. It mocks `../metric-options` like the existing cascade tests (:13–20).

**Call sites inherit the change:** `graphs/components/GraphsExpandedContent.tsx:179`, `trends/TrendsCard.tsx:183`, `compare/components/CompareSelectionPanel.tsx:142`. The reports cascade (`components/reports/report-generation/MetricSelectionCascade.tsx`) gets group names from `getAvailableMetricsPanels` (Task 7) with no badge in v1.

- [ ] **Step 1: Write the failing tests:**
  - a grouped panel shows group names with a badge and a tooltip of members;
  - toggling shows the raw names (fetched with `members=true`) and back;
  - the "added" hint still works for a group name;
  - an ungrouped panel renders exactly as before.
- [ ] **Step 2:** Run → fails. Implement → passes.
- [ ] **Step 3:** Commit: `feat(web): show series groups in the series picker`.

---

## Task 12: Verification and documentation (per PR)

- [ ] **Unit suites:**
  - `cd packages/shared && npx jest`
  - `cd apps/worker && npm run test:unit`
  - `cd apps/api && npx jest src/modules/series-grouping src/modules/metrics src/modules/reports src/modules/sut-transfer src/modules/systems-under-test src/modules/test-runs`
  - `cd apps/web && npx jest`
- [ ] **`npm run preflight`** from the root: lint, type-check, `check:entity-migrations`, `check:workspace-exports`, the RLS suite and chart tokens. It needs the local dev database with migrations applied.
- [ ] **Worker integration tests, locally.** `cd apps/worker && DATABASE_URL=… npm run test:integration` against a TimescaleDB + Toolkit database. **CI never runs these** (`pr-quality-gate.yml:181-184` runs `test:coverage` only), so paste the output into the PR.
- [ ] **Plan check on a production-sized run** (PR A). Capture `EXPLAIN (ANALYZE, BUFFERS)` of:
  1. the statistics INSERT for a run with no rule, against `main`. The plan must be identical and the timing within noise;
  2. the same run with one grouped dashboard, for both statements and the series read from Task 3, step 2. There must be no `Sort Method: external merge Disk:`, and `statistics_aggregated` must stay a HashAggregate (root `CLAUDE.md` #13).

  Record the numbers in the PR. If the series read costs more than ~10% of the aggregation, switch to per-panel SkipScan probes.
- [ ] **End-to-end on the local stack** (PR C). Either use a Grafana Kubernetes dashboard with a `{{pod}}` legend, or insert `ds_metrics` rows for three completed runs with different pod names. Then:
  1. analyze → the anomaly card shows `incomparable` rows and the suggestion banner;
  2. **Group series…** → the preview shows matched 0 → 100%;
  3. save and recalculate → after the re-evaluate, ADAPT compares `api` and `worker` and the per-pod results are gone;
  4. the Compare table shows baseline values for the groups;
  5. the Graphs picker shows the badge and the toggle; a graph preset saved with a group name draws a line after reload;
  6. a report section built from that preset renders;
  7. SUT export → import into a second system keeps the rule;
  8. SUT delete removes both tables' rows;
  9. copy the rule to another workload and check the `origin` and skipped reasons.
- [ ] **Docs:**
  - **CHANGELOG** entry per the repo's version convention.
  - **New gotcha sections:**
    - `apps/worker/CLAUDE.md`: "Series grouping happens at the statistics layer, in its own INSERT". Cover the byte-identical rule, why there is no `UNION ALL` into `metrics_filtered`, the fail-open rule loading, and the legacy-path warning.
    - `apps/api/CLAUDE.md`: "A group name is not a `ds_metrics` series". Every raw reader goes through `SeriesGroupResolver`; the empty-chart symptom is what happens when one does not.
    - `apps/web/CLAUDE.md`: the picker badge and toggle.
  - **Root `CLAUDE.md`:** one Common Issues entry ("A grouped series draws an empty chart") pointing at the API section.
  - **Reference:** `docs/reference/Features/Series Grouping.md`.
  - **Design doc:** set its status to "Implemented in vX".

## Follow-ups (not in this plan)

- Compare card inline hint (design v1.1).
- grafana-sync auto-config suggesting a rule for `{{pod}}` legends or a `pod` template variable.
- Rules in profiles and provisioning.
- Node-name preset.
- `usePinnedSystems` onto `lib/safe-storage.ts`.
- v2: label capture and *Compare by labels*; time bucketing for unaligned sources.

## Self-review

- **Every design requirement maps to a task:**
  - presets and custom regex → 1
  - tables → 2
  - grouping and membership → 3
  - downstream behaviour → 4
  - CRUD and copy → 5
  - preview, suggestions, apply and stale → 6
  - raw readers and MCP → 7
  - transfer and deletion → 8
  - dialog → 9
  - suggestion banner, stale notice and settings → 10
  - picker → 11
- **The four corrections from code reading are applied here and in the design doc:**
  1. Baseline runs come from `ds_control_groups`, not `details.controlRuns`.
  2. MCP needs no change.
  3. Grouped statistics use a second INSERT rather than a `UNION ALL`.
  4. Application dashboards are per environment.
- **Inert first.** PR A changes nothing until a rule row exists. The no-rule SQL is pinned by snapshots in both the worker (Task 3) and the API readers (Task 7).
- **Open risk:** the cost of the series read in Task 3, step 2, on compressed chunks. It is measured in Task 12, and the fallback is named.
