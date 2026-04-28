# RBAC Drift Check

**Cadence:** every 2 weeks.

**Trigger:** `/schedule "every 2 weeks: run docs/superpowers/scheduled-agents/rbac-drift-check.md"`.

**Job:** audit `apps/api/src` for direct `isGlobalAdmin` usage outside the AuthorizationService and the grandfathered allowlist. Catches drift the ESLint rule missed (new dependencies bringing the pattern in, merge conflicts that re-introduced a removed call, etc.).

**Steps:**

1. Read `apps/api/.rbac-migration-allowlist.json`.
2. Run:
   ```bash
   rg -l "this\.authzService\.isGlobalAdmin\(" apps/api/src --type ts -g '!*.spec.ts' \
     | grep -vFf <(jq -r '.[]' apps/api/.rbac-migration-allowlist.json)
   ```
3. If the output is non-empty, those are NEW sites that snuck past the lint rule. For each:
   - Open a PR migrating the site (use the existing `withOrgFilter` / `@RequiresCapability` patterns).
   - If the migration isn't trivial, add the file to the allowlist with a comment explaining why and open a follow-up issue.
4. Also report the burndown numbers: count remaining allowlist entries, compare to the previous run's count. If the prior 14 days show zero progress, raise it as a stalled-migration concern.

**Stop condition:** allowlist reaches empty AND audit log burndown shows 0/127 + 0/14. Disable the schedule.
