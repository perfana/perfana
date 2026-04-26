# Codebase Audit Follow-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the GitNexus structural audit (2026-04-26) into shipped cleanups: drop confirmed dead exports, consolidate the `isGlobalAdmin` global-admin-bypass pattern, and put the demoted leads (dashboard-uid `from`, `stopPropagation`) on the record so they're not re-flagged later.

**Architecture:** Investigation-led. Phase A (read-only) verifies each lead independently; Phase B is a written decision gate; Phase C executes only the confirmed cleanups, each on its own branch with a PR (per repo convention). All edits run through `gitnexus_impact` before being touched and `gitnexus_detect_changes` before commit (per `CLAUDE.md` GitNexus rules).

**Tech Stack:** TypeScript across the monorepo. `knip` for dead-export detection (already on the health stack: `npx knip`). GitNexus MCP for impact/rename. Jest for `apps/api` tests, Vitest for `apps/worker`. PRs via `gh pr create`.

---

## File Structure

**Phase A produces:**
- `docs/superpowers/audits/2026-04-26-audit-decisions.md` — decision log capturing what was verified, what was dropped, and what proceeds to Phase C. Lives next to the plan so the rationale survives.

**Phase C creates / modifies (conditional on Phase B outcomes):**
- Modify: `apps/web/lib/profiles.ts`, `apps/web/lib/socket.ts`, `apps/web/lib/trace-analysis-api.ts` — only the exports knip confirms are unreferenced. Tests in `apps/web/__tests__/` and any `*.test.ts` next to the files get updated alongside.
- If `isGlobalAdmin` consolidation is approved: create `apps/api/src/common/decorators/global-admin-bypass.decorator.ts` and modify the ~28 service call sites to use it. Pattern decision is locked in Phase B before any code is written.

**Out of scope (downgraded by Phase A or invalidated during plan-writing):**
- `dashboard-uid.util.ts:from` — verified during plan-writing as a legitimate UID generator, not a legacy prefix-detection path. No action; documented in the audit log.
- `GrafanaDashboardsTable.tsx:stopPropagation` — verified during plan-writing as a 2-line local helper used only inside its own component. No action; documented.

---

## Phase A — Verify the leads (read-only)

### Task A1: Confirm dashboard-uid `from` is benign

**Files:**
- Read only: `apps/grafana-sync/src/modules/auto-config/dashboard-uid.util.ts`
- Decision artifact: `docs/superpowers/audits/2026-04-26-audit-decisions.md`

- [ ] **Step 1: Pull the impact graph for `from` in this file**

```
mcp__gitnexus__impact({
  target: "from",
  direction: "upstream",
  file_path: "apps/grafana-sync/src/modules/auto-config/dashboard-uid.util.ts",
  kind: "Method",
  repo: "perfana"
})
```

Expected: a list of caller symbols. Most should be `createDashboardUid` (the wrapper at line 133), `legacyFrom`, and tests/specs around dashboard generation. Risk should be LOW–MEDIUM.

- [ ] **Step 2: Spot-check 5 callers via ripgrep**

```bash
rg -n "DashboardUid\.from\(" apps/grafana-sync apps/worker apps/api packages/shared --type ts
```

Expected: every hit calls `DashboardUid.from(testRun, autoConfigDashboard)` with the documented two-argument shape. No call site passes a raw UID string into a `from(uid)` overload.

- [ ] **Step 3: Write the decision entry**

Append to `docs/superpowers/audits/2026-04-26-audit-decisions.md`:

```markdown
## dashboard-uid.util.ts `from` (44 callers)

**Verdict:** No action. The function is a UID factory for new Grafana dashboards
(MD5 hash of `system+env+label+uid`); it is unrelated to the
"never use prefix detection" rule, which is about classifying metrics-source
type from the UID prefix. Fan-in is legitimate — every auto-config dashboard
flow goes through this method.

**Verified:** <date>
**Caller pattern uniformity:** OK (single signature, no overloaded paths).
```

### Task A2: Enumerate truly-dead exports with knip

**Files:**
- Read only: `apps/web/lib/profiles.ts`, `apps/web/lib/socket.ts`, `apps/web/lib/trace-analysis-api.ts`
- Decision artifact: `docs/superpowers/audits/2026-04-26-audit-decisions.md`

- [ ] **Step 1: Run knip scoped to the workspace**

```bash
npx knip --include exports,types,enumMembers --reporter json > /tmp/knip-report.json
```

Expected: JSON with `files`, `exports`, `types` arrays. The run takes ~30s on this monorepo.

- [ ] **Step 2: Filter for the candidate files**

```bash
jq '.issues | map(select(.file | test("apps/web/lib/(profiles|socket|trace-analysis-api)\\.ts"))) | .[] | {file, exports: (.exports // []), types: (.types // [])}' /tmp/knip-report.json
```

Expected: zero or more entries naming specific exports knip considers unreferenced. GitNexus flagged `fetchProfile`, `fetchProfileDashboards`, `createProfileDashboard`, `updateProfile`, `wrappedListener`, `subscribeTestRuns`, `emit`, `checkTempoHealth` — knip is the source of truth on whether they're actually unused.

- [ ] **Step 3: Cross-check each knip "dead" export with ripgrep**

For each export `<name>` knip flags:

```bash
rg -n "(\\b<name>\\b)" --type ts --type tsx -g '!**/dist/**' -g '!**/node_modules/**'
```

Expected: only the export site itself, plus test imports (if any). Anything else means knip's analysis missed a usage — drop that export from the cleanup list.

- [ ] **Step 4: Append the deletion candidate list to the decision log**

```markdown
## Dead exports (knip-confirmed, ripgrep-confirmed)

| File | Export | Lines | Has tests? |
| --- | --- | --- | --- |
| apps/web/lib/profiles.ts | fetchProfile | 12-30 | no |
| ... | ... | ... | ... |
```

Only entries that pass both knip AND ripgrep go into Phase C.

### Task A3: Classify the `isGlobalAdmin` call sites

**Files:**
- Read only: `apps/api/src/common/services/authorization.service.ts`
- Read only: every file returned by the grep below
- Decision artifact: `docs/superpowers/audits/2026-04-26-audit-decisions.md`

- [ ] **Step 1: Read the implementation**

Read `apps/api/src/common/services/authorization.service.ts` and locate `isGlobalAdmin`. Note the signature (`roles: string[] => boolean`) and what roles short-circuit it (`super-admin`, `system-admin` per `apps/api/src/constants/roles.constants.ts`).

- [ ] **Step 2: Enumerate every call site**

```bash
rg -n "isGlobalAdmin\(" apps/api/src --type ts -g '!*.spec.ts'
```

Expected: ~28 hits across services. Capture the list.

- [ ] **Step 3: Classify each call site into one of three buckets**

For each hit, read 5 lines of surrounding context and tag it:

- **Bucket A — bypass filter:** `if (this.authzService.isGlobalAdmin(roles)) { /* skip org/team filter */ }` followed by a normal-user code path. Easy to extract: this is the dominant use case.
- **Bucket B — bypass guard:** uses `isGlobalAdmin` in place of throwing `ForbiddenException`. A method-level decorator could replace these.
- **Bucket C — mixed:** the check is interleaved with other business logic that depends on `roles` for non-admin reasons. Leaves these alone.

Append a bucket count to the decision log:

```markdown
## isGlobalAdmin call sites

| Bucket | Count | Files |
| --- | --- | --- |
| A — bypass filter | N | … |
| B — bypass guard | N | … |
| C — mixed | N | … |
```

- [ ] **Step 4: Decision rule**

If Bucket A has ≥15 sites with the *same* shape (load-then-filter pattern), proceed to Task C2 (extract a helper). Otherwise document "not a clean win" and stop — the existing pattern is fine when call-site shapes diverge.

---

## Phase B — Decision gate (no code yet)

- [ ] **Step 1: Read the decision log end-to-end**

Open `docs/superpowers/audits/2026-04-26-audit-decisions.md` and confirm A1, A2, A3 each have a verdict. No verdict = blocker; go finish the verification.

- [ ] **Step 2: Decide which Phase C tasks run**

For each finding with a verdict:

- A1 → No action. Skip C-tasks for it.
- A2 → If the candidate-deletions table is non-empty, run **Task C1**. If empty, skip and document.
- A3 → If Bucket A ≥15, run **Task C2**. Otherwise skip and document.

Write the decision into the log:

```markdown
## Phase C scope (locked YYYY-MM-DD)

- [x] C1: dead-export removal — N exports across M files
- [ ] C2: isGlobalAdmin consolidation — skipped (Bucket A had N sites, threshold 15)
```

- [ ] **Step 3: Commit the decision log**

```bash
git checkout -b audit/2026-04-26-decisions
git add docs/superpowers/audits/2026-04-26-audit-decisions.md
git commit -m "docs: 2026-04-26 codebase audit decisions"
git push -u origin audit/2026-04-26-decisions
gh pr create --title "docs: 2026-04-26 codebase audit decisions" --body "Decision log from the GitNexus audit. No code changes — verifications only."
```

The decision log lands as its own PR before any cleanup ships, so reviewers can push back on scope before changes appear.

---

## Phase C — Cleanups (only what Phase B greenlit)

### Task C1: Remove confirmed-dead exports

**Files:**
- Modify per Phase B's table: `apps/web/lib/profiles.ts`, `apps/web/lib/socket.ts`, `apps/web/lib/trace-analysis-api.ts` (only the entries listed)
- Modify any test file that imports them (located via Step 2)

- [ ] **Step 1: Branch off main**

```bash
git checkout main && git pull
git checkout -b chore/remove-dead-lib-exports
```

- [ ] **Step 2: For each export in the table, run impact analysis**

```
mcp__gitnexus__impact({
  target: "<exportName>",
  direction: "upstream",
  file_path: "<path>",
  repo: "perfana"
})
```

Expected: zero direct callers in non-test files. If there are any, GitNexus and knip disagree — re-investigate before deleting.

- [ ] **Step 3: Delete the export and its imports**

For each entry, delete:
1. The function/const definition
2. Any re-exports from `index.ts` barrels (search: `rg -n "export.*<name>"`)
3. Test files that exclusively test the deleted export (if a test file covers multiple exports, just remove the relevant test cases)

Use `Edit` per file. Show one example:

```typescript
// apps/web/lib/profiles.ts — BEFORE
export async function fetchProfile(id: string): Promise<Profile> {
  const res = await authenticatedFetch(`/profiles/${id}`);
  return res.json();
}

// AFTER: deleted
```

- [ ] **Step 4: Run type-check and lint**

```bash
npm run type-check && npm run lint
```

Expected: clean. A type error means a usage was missed — restore the export and re-investigate that caller.

- [ ] **Step 5: Run web tests**

```bash
cd apps/web && npx jest
```

Expected: all green.

- [ ] **Step 6: Run change detection before commit**

```
mcp__gitnexus__detect_changes({ repo: "perfana" })
```

Expected: only the files in the Phase B table are flagged. Any extra file = scope creep, investigate.

- [ ] **Step 7: Commit and PR**

```bash
git add apps/web/lib
git commit -m "chore(web): remove unused lib exports flagged by 2026-04-26 audit"
git push -u origin chore/remove-dead-lib-exports
gh pr create --title "chore(web): remove unused lib exports" --body "$(cat <<'EOF'
## Summary
- Deletes N unreferenced exports across profiles.ts / socket.ts / trace-analysis-api.ts
- Confirmed dead by knip + ripgrep + gitnexus_impact (see 2026-04-26-audit-decisions.md)

## Test plan
- [x] npm run type-check
- [x] npm run lint
- [x] cd apps/web && npx jest
EOF
)"
```

### Task C2: Pilot `withOrgFilter` on `dynatrace.service.ts` (25 sites)

> Scope locked at 2026-04-26 after Phase A3 found 127 Bucket A sites (vs the original ~28 estimate). Option A from the scope discussion: pilot only — prove the pattern on the highest-density file (`dynatrace.service.ts` has 25 of the 127 Bucket A sites), then let other modules adopt later. Do NOT touch the other 102 Bucket A sites in this PR.

**Pre-work — pick the helper landing spot:**

Phase A3 surfaced that `apps/api/src/common/services/authorized-base.service.ts` already has partial helpers: `applyOrgFilter()` at :87 (queryBuilder transform) and `getAccessibleOrgIds()` at :147 (returns `undefined` for admin, else org IDs). Before introducing a new helper, decide:

- **Option 1 — extend AuthorizedBaseService:** if `dynatrace.service.ts` can extend `AuthorizedBaseService` cleanly, use `getAccessibleOrgIds()` (already returns `undefined` for admin, semantically equivalent to the proposed `null`). Skip helper creation.
- **Option 2 — add a sibling utility:** if extending `AuthorizedBaseService` is awkward (constructor arity, DI shape, existing class hierarchy), create `apps/api/src/common/utils/with-org-filter.ts` with the documented `Promise<string[] | null>` signature and a Jest spec.

The pilot decides this in Step 2 below by inspecting `dynatrace.service.ts`'s class shape.

**Files:**
- (Conditional on Step 2) Create: `apps/api/src/common/utils/with-org-filter.ts` — only if Option 2 wins.
- (Conditional on Step 2) Create: `apps/api/src/common/utils/with-org-filter.spec.ts` — only if Option 2 wins.
- Modify: `apps/api/src/modules/dynatrace/dynatrace.service.ts` — the 25 Bucket A sites listed in `2026-04-26-audit-decisions.md`.
- (If `dynatrace.service.ts` had a local `private isGlobalAdmin()` wrapper, it gets removed in this task.)

- [ ] **Step 1: Branch off main**

```bash
git checkout main && git pull
git checkout -b refactor/consolidate-global-admin-bypass
```

- [ ] **Step 2: Pick the helper landing spot**

Read `apps/api/src/modules/dynatrace/dynatrace.service.ts` and check:
- Does it extend `AuthorizedBaseService`?
- If yes → **Option 1**. Skip Steps 3–5; proceed to Step 6 with `this.getAccessibleOrgIds(userId, roles)` as the call shape (treat `undefined` as the admin path).
- If no → **Option 2**. Continue with Step 3 to create the standalone `withOrgFilter` utility.

Append the chosen option to `docs/superpowers/audits/2026-04-26-audit-decisions.md` under a new "Phase C2 helper landing" sub-section so reviewers see the rationale.

- [ ] **Step 3: Write the failing test (Option 2 only)**

Create `apps/api/src/common/utils/with-org-filter.spec.ts`:

```typescript
import { withOrgFilter } from './with-org-filter';

describe('withOrgFilter', () => {
  const fetchOrgs = jest.fn();

  beforeEach(() => fetchOrgs.mockReset());

  it('returns null for super-admin (skip filter)', async () => {
    const result = await withOrgFilter('user-1', ['super-admin'], fetchOrgs);
    expect(result).toBeNull();
    expect(fetchOrgs).not.toHaveBeenCalled();
  });

  it('returns null for system-admin (skip filter)', async () => {
    const result = await withOrgFilter('user-1', ['system-admin'], fetchOrgs);
    expect(result).toBeNull();
  });

  it('returns accessible orgs for a regular user', async () => {
    fetchOrgs.mockResolvedValue(['org-a', 'org-b']);
    const result = await withOrgFilter('user-1', ['user'], fetchOrgs);
    expect(result).toEqual(['org-a', 'org-b']);
    expect(fetchOrgs).toHaveBeenCalledWith('user-1');
  });

  it('returns empty array if user has no accessible orgs', async () => {
    fetchOrgs.mockResolvedValue([]);
    const result = await withOrgFilter('user-1', ['user'], fetchOrgs);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test to verify failure**

```bash
cd apps/api && npx jest src/common/utils/with-org-filter.spec.ts
```

Expected: FAIL — `Cannot find module './with-org-filter'`.

- [ ] **Step 4: Implement the helper**

Create `apps/api/src/common/utils/with-org-filter.ts`:

```typescript
import { GLOBAL_ADMIN_ROLES } from '../../constants/roles.constants';

export async function withOrgFilter(
  userId: string,
  roles: string[],
  fetchAccessibleOrgs: (userId: string) => Promise<string[]>,
): Promise<string[] | null> {
  if (roles.some((r) => GLOBAL_ADMIN_ROLES.includes(r))) {
    return null;
  }
  return fetchAccessibleOrgs(userId);
}
```

If `GLOBAL_ADMIN_ROLES` is not already exported from `roles.constants.ts`, export it (a `const` array of `['super-admin', 'system-admin']`). Verify the existing `isGlobalAdmin` reads from the same source — there must be one canonical list, not two.

- [ ] **Step 5: Run the test to verify passes**

```bash
cd apps/api && npx jest src/common/utils/with-org-filter.spec.ts
```

Expected: 4 passing.

- [ ] **Step 6: Migrate one Bucket A call site as a pilot**

Pick the smallest service from the Bucket A list. Example shape (the actual code lives at the path Phase A3 captured):

```typescript
// BEFORE
async findAll(userId: string, roles: string[]) {
  if (this.authzService.isGlobalAdmin(roles)) {
    return this.repo.find();
  }
  const orgIds = await this.authzService.getAccessibleOrganizations(userId);
  return this.repo.find({ where: { organizationId: In(orgIds) } });
}

// AFTER
async findAll(userId: string, roles: string[]) {
  const orgIds = await withOrgFilter(userId, roles, (uid) =>
    this.authzService.getAccessibleOrganizations(uid),
  );
  return orgIds === null
    ? this.repo.find()
    : this.repo.find({ where: { organizationId: In(orgIds) } });
}
```

- [ ] **Step 7: Run the pilot service's existing tests**

```bash
cd apps/api && npx jest <pilot-service>.spec.ts
```

Expected: all green. If a test fails, the migration changed observable behavior — fix before continuing.

- [ ] **Step 8: Run impact analysis on `isGlobalAdmin`**

```
mcp__gitnexus__impact({
  target: "isGlobalAdmin",
  direction: "upstream",
  file_path: "apps/api/src/common/services/authorization.service.ts",
  repo: "perfana"
})
```

Use this list to drive the next step. Compare against Phase A3's Bucket A — they should match.

- [ ] **Step 9: Migrate the remaining Bucket A sites**

For each remaining file in Bucket A, apply the same pattern (Step 6's shape). Bucket B and C sites are NOT touched.

- [ ] **Step 10: Run the full API test suite**

```bash
cd apps/api && npx jest
```

Expected: all green. If something fails, revert the latest site, run the full suite again, and bisect.

- [ ] **Step 11: Run change detection before commit**

```
mcp__gitnexus__detect_changes({ repo: "perfana" })
```

Expected: scope is the helper + spec + Bucket A files only. Anything else = unintended.

- [ ] **Step 12: Commit and PR**

```bash
git add apps/api/src
git commit -m "refactor(api): extract withOrgFilter for global-admin bypass pattern"
git push -u origin refactor/consolidate-global-admin-bypass
gh pr create --title "refactor(api): extract withOrgFilter helper" --body "$(cat <<'EOF'
## Summary
- Extracts the recurring "if global-admin skip filter, else load accessible orgs" pattern into `withOrgFilter`
- Migrates N Bucket A call sites identified in 2026-04-26-audit-decisions.md
- No behavior change — covered by existing service tests + new helper tests

## Test plan
- [x] cd apps/api && npx jest src/common/utils/with-org-filter.spec.ts
- [x] cd apps/api && npx jest (full)
- [x] gitnexus_detect_changes confirms scope
EOF
)"
```

---

## Done criteria

- `docs/superpowers/audits/2026-04-26-audit-decisions.md` exists, committed, with a verdict per finding.
- Each greenlit Phase C task has a merged PR.
- The four original audit findings are accounted for: 2 dropped (with documented rationale), 1 verified-benign, 1+ shipped.
