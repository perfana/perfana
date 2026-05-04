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

const MUTATION_METHODS = new Set(['save', 'delete', 'remove', 'update', 'insert']);
const AUDIT_LOG_METHODS = new Set(['logCreate', 'logUpdate', 'logDelete']);

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Service mutations on OwnedResource entities must call auditService.log{Create,Update,Delete} in the same method body. Grandfathered files (from the Phase 5a seed) are allowed via apps/api/.audit-migration-allowlist.json. Audit infrastructure (AuditService, AuditModule, AuthorizedBaseService, TypeOrmBaseRepository) is permanently exempt. A method may opt out of the check with a leading `// audit-skip: <rationale>` comment — the rationale is mandatory and surfaces the deliberate non-audit decision in PR review.",
    },
    schema: [],
    messages: {
      missing:
        "Service mutation '{{call}}' requires an auditService.log{Create,Update,Delete} call in the same method body, or the file must be on .audit-migration-allowlist.json. See docs/superpowers/specs/2026-05-02-rbac-phase5a-audit-completion-design.md.",
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
