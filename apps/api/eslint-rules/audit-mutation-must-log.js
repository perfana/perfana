const fs = require('fs');
const path = require('path');

let cache = null;

function findRepoRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(dir, 'apps/api/.audit-migration-allowlist.json');
    if (fs.existsSync(candidate)) return { allowlistPath: candidate, repoRoot: dir };
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function loadCache(cwd) {
  if (cache !== null) return cache;
  try {
    const found = findRepoRoot(cwd);
    if (!found) {
      cache = { allowlist: new Set(), repoRoot: cwd };
    } else {
      const entries = JSON.parse(fs.readFileSync(found.allowlistPath, 'utf8'));
      cache = { allowlist: new Set(entries), repoRoot: found.repoRoot };
    }
  } catch {
    cache = { allowlist: new Set(), repoRoot: cwd };
  }
  return cache;
}

// Audit infrastructure: these files are the audit-logging plumbing itself, plus
// the generic base repository / authorized service. They legitimately persist
// without "audit-shaped" semantics. Permanently exempt — never on the burndown.
const INFRASTRUCTURE_FILES = new Set([
  'apps/api/src/modules/audit/audit.service.ts',
  'apps/api/src/modules/audit/audit.module.ts',
  'apps/api/src/common/services/authorized-base.service.ts',
  'apps/api/src/common/repositories/typeorm-base.repository.ts',
]);

// Permanent policy exemption: files mutating OwnedResource entities that
// deliberately do not call auditService.log{Create,Update,Delete}, each with
// a per-file rationale. Promoted from .audit-migration-allowlist.json by
// PR20 (Phase 5a) — see docs/superpowers/audits/2026-05-02-audit-phase5a-decisions.md.
//
// Three rationale categories:
//   1. Bucket-2 system-derived writes — worker / scheduler / ingestion paths
//      that fire on every test-run cycle. Auditing would generate ingestion-rate
//      noise without compliance value (cascade / re-evaluation / cache writes).
//   2. NO-decision admin config — per the 2026-05-04 brainstorm: low compliance
//      demand, sensitive credentials already redacted via the auditableFields
//      design, or composes already-audited primitives (would double-count).
//   3. Repository-layer audit deferred — repo-class mutations that parallel
//      already-audited service-layer paths. Repository-layer audit migration
//      is its own workstream, mirroring the api-keys / dynatrace / tracing
//      precedents established in PRs 5, 9, 11.
const POLICY_EXEMPT_FILES = new Map([
  // === 1. Bucket-2: system-derived writes ===
  [
    'apps/api/src/modules/adapt/adapt.service.ts',
    'Bucket 2: ADAPT regression-detection writer; worker-driven on test-run completion, not a user action.',
  ],
  [
    'apps/api/src/modules/events/events.service.ts',
    'Bucket 2: system-derived event ingestion; high-churn writes per test-run cycle.',
  ],
  [
    'apps/api/src/modules/test-runs/services/test-run-lookup.service.ts',
    'Bucket 2: auto-team-create on ingestion (resolution path is to delete the auto-create entirely; out of Phase 5a scope per 2026-05-04 brainstorm).',
  ],
  [
    'apps/api/src/modules/test-runs/services/test-runs-anomaly.service.ts',
    'Bucket 2: bulk anomaly-result delete during re-evaluation; cascade noise per PR8 Notes.',
  ],
  [
    'apps/api/src/modules/test-runs/services/test-runs-changepoint.service.ts',
    'Bucket 2: changepoint compute / re-compute (DsChangePoints save / delete on re-evaluation); ingestion-rate volume.',
  ],
  [
    'apps/api/src/modules/test-runs/services/test-runs-dashboard-query.service.ts',
    'Bucket 2: dashboard query result cache (createQueryBuilder().insert()); per-render write volume.',
  ],
  [
    'apps/api/src/modules/test-runs/services/test-runs-stale-detection.service.ts',
    'Bucket 2: scheduler-driven isStale / staleDetectedAt flips; system-derived state.',
  ],
  // === 2. NO-decision admin config (2026-05-04 brainstorm — Skip) ===
  [
    'apps/api/src/modules/alerts/alert-tag-filters.service.ts',
    'NO-decision: alert tag filters — admin-config event with low compliance demand (filters affect which alerts fire, not the alert config itself).',
  ],
  [
    'apps/api/src/modules/alerts/alerts.service.ts',
    'NO-decision: alerts — admin-config event group; mirrors the notification-channel skip.',
  ],
  [
    'apps/api/src/modules/awr/controllers/awr-reports.controller.ts',
    'NO-decision: AWR is analytics output, not configuration; out of scope per 2026-05-04 brainstorm.',
  ],
  [
    'apps/api/src/modules/awr/services/awr-analysis.service.ts',
    'NO-decision: AWR analytics output, not configuration.',
  ],
  [
    'apps/api/src/modules/awr/services/awr-parser.service.ts',
    'NO-decision: AWR analytics output, not configuration.',
  ],
  [
    'apps/api/src/modules/awr/services/awr-reports.service.ts',
    'NO-decision: AWR analytics output, not configuration.',
  ],
  [
    'apps/api/src/modules/awr/services/comparison/comparison-result-persister.service.ts',
    'NO-decision: AWR comparison results — analytics output persistence, not configuration.',
  ],
  [
    'apps/api/src/modules/metrics-sources/metrics-sources.service.ts',
    'NO-decision: datasource credentials already redacted by the auditableFields design; user-facing CRUD is admin-config with low compliance demand.',
  ],
  [
    'apps/api/src/modules/notifications/notifications.service.ts',
    'NO-decision: notification channels — admin-config event with low compliance demand (per-channel mutations).',
  ],
  [
    'apps/api/src/modules/provisioning/provisioning.service.ts',
    'NO-decision: provisioning composes already-audited SUT / environment / workload creates; a separate provisioning-level event would duplicate or contradict the per-resource events.',
  ],
  // === 3. Repository-layer audit deferred (separate workstream) ===
  [
    'apps/api/src/modules/deep-links/deep-links.repository.ts',
    'Repo-layer deferred: parallel to deep-links.service.ts (PR16); repository-layer audit migration is its own workstream.',
  ],
  [
    'apps/api/src/modules/dynatrace/dynatrace.repository.ts',
    'Repo-layer deferred: parallel to dynatrace.service.ts (PR9, audited at the service layer).',
  ],
  [
    'apps/api/src/repositories/api-key.repository.ts',
    'Repo-layer deferred: parallel to api-keys.service.ts (PR5, audited at the service layer); precedent set in PR5.',
  ],
  [
    'apps/api/src/repositories/application-dashboard.repository.ts',
    'Repo-layer deferred: parallel to application-dashboards.service.ts (PR10, audited at the service layer).',
  ],
  [
    'apps/api/src/repositories/compare-filter-preset.repository.ts',
    'Repo-layer deferred: parallel to compare-presets.service.ts (PR12, audited at the service layer).',
  ],
  [
    'apps/api/src/repositories/expected-config-change.repository.ts',
    'Repo-layer deferred: zero production callers (verified PR19); parallel to TestRunsConfigService (PR13, audited at the service layer).',
  ],
  [
    'apps/api/src/repositories/test-run-configuration.repository.ts',
    'Repo-layer deferred: TestRunConfiguration CRUD; service-layer audit pass not yet scheduled (Phase 5a closure decision per 2026-05-04 brainstorm).',
  ],
  [
    'apps/api/src/repositories/test-run.repository.ts',
    'Repo-layer deferred: TestRun soft-delete + worker-driven deletionStatus column (mark-for-deletion flag, not user-visible). Service-layer mutations are audited via PR8 handlers.',
  ],
  [
    'apps/api/src/repositories/tracing-service.repository.ts',
    'Repo-layer deferred: parallel to tracing-services.service.ts (PR11, audited at the service layer).',
  ],
  [
    'apps/api/src/repositories/trends-filter-preset.repository.ts',
    'Repo-layer deferred: parallel to trends-presets.service.ts (PR12, audited at the service layer).',
  ],
]);

const MUTATION_METHODS = new Set(['save', 'delete', 'remove', 'update', 'insert']);
const AUDIT_LOG_METHODS = new Set(['logCreate', 'logUpdate', 'logDelete']);

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Service mutations on OwnedResource entities must call auditService.log{Create,Update,Delete} in the same method body. Grandfathered files (from the Phase 5a seed) are allowed via apps/api/.audit-migration-allowlist.json. Audit infrastructure (AuditService, AuditModule, AuthorizedBaseService, TypeOrmBaseRepository) is permanently exempt; a separate POLICY_EXEMPT set carries the bucket-2 / NO-decision / repo-layer-deferred files closed by PR20 with per-file rationale. A method may opt out of the check with a leading `// audit-skip: <rationale>` comment — the rationale is mandatory and surfaces the deliberate non-audit decision in PR review.",
    },
    schema: [],
    messages: {
      missing:
        "Service mutation '{{call}}' requires an auditService.log{Create,Update,Delete} call in the same method body. Bypass options: an `// audit-skip: <rationale>` comment on the method, the file on .audit-migration-allowlist.json, or a permanent POLICY_EXEMPT entry. See docs/superpowers/specs/2026-05-02-rbac-phase5a-audit-completion-design.md.",
    },
  },
  create(context) {
    const cwd = context.getCwd ? context.getCwd() : process.cwd();
    const { allowlist, repoRoot } = loadCache(cwd);
    const filename = context.getFilename();

    let relPath;
    if (path.isAbsolute(filename)) {
      relPath = path.relative(repoRoot, filename).replace(/\\/g, '/');
    } else if (filename.startsWith('apps/api/') || filename.startsWith('apps/web/')) {
      relPath = filename.replace(/\\/g, '/');
    } else {
      relPath = path.relative(repoRoot, path.resolve(cwd, filename)).replace(/\\/g, '/');
    }

    if (INFRASTRUCTURE_FILES.has(relPath)) return {};
    if (POLICY_EXEMPT_FILES.has(relPath)) return {};
    if (allowlist.has(relPath)) return {};
    if (relPath.endsWith('.spec.ts') || relPath.endsWith('.test.ts')) return {};

    const sourceCode = context.getSourceCode();
    return {
      MethodDefinition(node) {
        const body = node.value && node.value.body;
        if (!body) return;
        // Per-method opt-out: a leading `// audit-skip: <rationale>` comment
        // documents a deliberate non-audit decision (e.g. high-churn ingestion
        // writes). Reviewer enforces that the rationale is meaningful.
        const leading = sourceCode.getCommentsBefore(node);
        if (leading.some((c) => /audit-skip:\s*\S/.test(c.value))) return;
        const mutationCalls = [];
        let sawAuditCall = false;
        const visit = (n) => {
          if (!n || typeof n !== 'object') return;
          if (n.type === 'CallExpression') {
            const callee = n.callee;
            if (
              callee &&
              callee.type === 'MemberExpression' &&
              callee.property &&
              callee.property.type === 'Identifier'
            ) {
              const propName = callee.property.name;
              const objText = context.getSourceCode().getText(callee.object);
              // Match `repo`, `repository`, or `manager` as a complete token —
              // either word-boundary-delimited (`this.repo`, `this.entityManager`)
              // or as a camelCase suffix (`templateRepo`, `userRepository`).
              // The trailing `[A-Z]|\W|$` lookahead prevents false positives like
              // `Report*Service` where "Repo" is just a substring of a longer
              // lowercase identifier. The /i flag is deliberately NOT used —
              // it would make `[A-Z]` match lowercase letters too, defeating the
              // boundary check (PR17 bugfix — was: /repo|Repository|manager/i
              // which flagged controllers that delegate to *Report*Service).
              if (
                MUTATION_METHODS.has(propName) &&
                /(?:\b|[a-z])(?:[Rr]epository|[Rr]epo|[Mm]anager)(?=$|\W|[A-Z])/.test(objText)
              ) {
                mutationCalls.push({ node: n, call: `${objText}.${propName}` });
              }
              if (AUDIT_LOG_METHODS.has(propName) && /audit/i.test(objText)) {
                sawAuditCall = true;
              }
            }
          }
          for (const k of Object.keys(n)) {
            if (k === 'parent') continue;
            const v = n[k];
            if (Array.isArray(v)) v.forEach(visit);
            else if (v && typeof v === 'object' && v.type) visit(v);
          }
        };
        visit(body);
        if (mutationCalls.length > 0 && !sawAuditCall) {
          for (const m of mutationCalls) {
            context.report({ node: m.node, messageId: 'missing', data: { call: m.call } });
          }
        }
      },
    };
  },
};

// Exposed for the spec file to assert membership without re-declaring the list.
module.exports.POLICY_EXEMPT_FILES = POLICY_EXEMPT_FILES;
module.exports.INFRASTRUCTURE_FILES = INFRASTRUCTURE_FILES;
