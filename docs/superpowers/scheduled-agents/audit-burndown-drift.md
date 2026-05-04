# Audit Burndown Drift Check

**Cadence:** every 2 weeks.

**Trigger:** `/schedule "every 2 weeks: run docs/superpowers/scheduled-agents/audit-burndown-drift.md"`.

**Job:** audit `apps/api/src` for un-audited mutations on `OwnedResource` entities outside the migration allowlist. Catches drift the ESLint rule missed — for example a query-builder mutation pattern the rule's MemberExpression visitor didn't recognize, a method body that the rule's per-method scan walked into but exited before the audit call, or merge conflicts that re-introduced a removed mutation.

**Steps:**

1. Read `apps/api/.audit-migration-allowlist.json`.
2. Run:
   ```bash
   rg -l "(?i)\b(\w*repo\w*|\w*manager\w*)\.(save|delete|remove|update|insert)\(" apps/api/src --type ts -g '!*.spec.ts' \
     | xargs grep -L "auditService\.\(logCreate\|logUpdate\|logDelete\)" 2>/dev/null \
     | grep -vFf <(jq -r '.[]' apps/api/.audit-migration-allowlist.json)
   ```
   Also surface query-builder mutations the simple receiver-name regex misses:
   ```bash
   rg -l "createQueryBuilder\(\)[^;]*\.(insert|update|delete)\(" apps/api/src --type ts -g '!*.spec.ts' \
     | xargs grep -L "auditService\.\(logCreate\|logUpdate\|logDelete\)" 2>/dev/null \
     | grep -vFf <(jq -r '.[]' apps/api/.audit-migration-allowlist.json)
   ```
3. If either output is non-empty, those are NEW sites that snuck past the lint rule. For each:
   - Open a PR adding the audit calls (the standard pattern: pair `auditService.log{Create,Update,Delete}` calls with the mutation in the same method body, register the resource type → entity class mapping with `AuditResourceRegistry`).
   - If the migration isn't trivial, add the file to the allowlist with an explanation in `docs/superpowers/audits/2026-05-02-audit-phase5a-decisions.md` and open a follow-up issue.
4. Report burndown: count remaining allowlist entries, compare to the previous run's count. If the prior 14 days show zero progress, raise it as a stalled-migration concern. Update the burndown table in `docs/superpowers/audits/2026-05-02-audit-phase5a-decisions.md`.

**Stop condition:** `apps/api/.audit-migration-allowlist.json` is `[]` AND no new sites detected for two consecutive runs. Disable the schedule.

**Closed:** 2026-05-04 — Phase 5a audit migration complete. Allowlist closed in PR20 (#258); the lint rule (`audit-mutation-must-log` + `POLICY_EXEMPT_FILES`) now provides continuous drift coverage on every preflight / CI run, replacing the bi-weekly drift sweep. No remote `/schedule` routine was active at closure (verified via `RemoteTrigger list` → empty).
