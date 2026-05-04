const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { RuleTester } = require('eslint');
const rule = require('./audit-mutation-must-log');

const ruleTester = new RuleTester({
  parser: require.resolve('@typescript-eslint/parser'),
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

ruleTester.run('audit-mutation-must-log', rule, {
  valid: [
    // Method body has both a mutation and an audit call (update).
    {
      filename: 'apps/api/src/modules/foo/foo.service.ts',
      code: `class S { async update() { const x = await this.repo.save(e); this.auditService.logUpdate(b, x); } }`,
    },
    // Method body has both a mutation and an audit call (delete).
    {
      filename: 'apps/api/src/modules/foo/foo.service.ts',
      code: `class S { async delete() { this.auditService.logDelete(e); await this.repo.remove(e); } }`,
    },
    // Audit infrastructure: AuditService itself persists audit_logs without logging itself.
    {
      filename: 'apps/api/src/modules/audit/audit.service.ts',
      code: `class A { async update() { await this.repo.save(e); } }`,
    },
    // Audit infrastructure: AuthorizedBaseService — base class for authz-aware services.
    {
      filename: 'apps/api/src/common/services/authorized-base.service.ts',
      code: `class B { async update() { await this.repo.save(e); } }`,
    },
    // Audit infrastructure: generic base repository.
    {
      filename: 'apps/api/src/common/repositories/typeorm-base.repository.ts',
      code: `class R { async upsert(e) { return this.repository.save(e); } }`,
    },
    // Spec files exempt.
    {
      filename: 'apps/api/src/modules/foo/foo.service.spec.ts',
      code: `class S { async update() { await this.repo.save(e); } }`,
    },
    // Test files exempt.
    {
      filename: 'apps/api/src/modules/foo/foo.service.test.ts',
      code: `class S { async update() { await this.repo.save(e); } }`,
    },
    // Receiver name doesn't match repo|Repository|manager → not flagged.
    {
      filename: 'apps/api/src/modules/foo/foo.service.ts',
      code: `class S { async update() { await this.cache.save(e); } }`,
    },
    // Mutation method on something other than a repo-shaped name → not flagged.
    {
      filename: 'apps/api/src/modules/foo/foo.service.ts',
      code: `class S { async sync() { await this.queue.update(e); } }`,
    },
    // PR17 — controllers that delegate to *Report*Service must NOT be flagged.
    // The regex used to match "Repo" inside "Report" via the substring `repo`,
    // which fired on `this.reportTemplateService.delete(id)`. Tightening the
    // regex to require word/camelCase boundaries fixes the false positive.
    {
      filename: 'apps/api/src/modules/reports/controllers/report-template.controller.ts',
      code: `class C { async delete(id) { return this.reportTemplateService.delete(id); } }`,
    },
    {
      filename: 'apps/api/src/modules/reports/controllers/report-generation.controller.ts',
      code: `class C { async delete(id) { return this.reportGenerationService.delete(id); } }`,
    },
    // EntityManager-style call counts as audit-needed but the body has the audit call.
    {
      filename: 'apps/api/src/modules/foo/foo.service.ts',
      code: `class S { async create() { await this.entityManager.insert(E, e); this.auditService.logCreate(e); } }`,
    },
    // Method opted out via leading `// audit-skip:` comment with rationale.
    {
      filename: 'apps/api/src/modules/foo/foo.service.ts',
      code: `class S {
        // audit-skip: per-test-run write, high-churn ingestion path
        async update() { await this.repo.save(e); }
      }`,
    },
    // audit-skip in a block comment also accepted.
    {
      filename: 'apps/api/src/modules/foo/foo.service.ts',
      code: `class S {
        /* audit-skip: cascade delete from parent */
        async wipe() { await this.repo.delete({}); }
      }`,
    },
    // PR20 — POLICY_EXEMPT bucket-2 system-derived writes (one representative).
    // ADAPT is worker-driven on test-run completion; auditing would generate
    // ingestion-rate noise without compliance value.
    {
      filename: 'apps/api/src/modules/adapt/adapt.service.ts',
      code: `class A { async persist() { await this.repo.save(e); } }`,
    },
    // PR20 — POLICY_EXEMPT NO-decision admin config (one representative).
    // Notification channel CRUD is admin-config with low compliance demand.
    {
      filename: 'apps/api/src/modules/notifications/notifications.service.ts',
      code: `class N { async update() { await this.repo.update({}, e); } }`,
    },
    // PR20 — POLICY_EXEMPT repository-layer audit deferred (one representative).
    // The parallel service-layer path (api-keys.service.ts) is audited in PR5;
    // repository-layer audit migration is its own workstream.
    {
      filename: 'apps/api/src/repositories/api-key.repository.ts',
      code: `class R { async upsert(e) { await this.repository.save(e); } }`,
    },
  ],
  invalid: [
    // Bare repo.save in a non-allowlisted file.
    {
      filename: 'apps/api/src/modules/newfeature/newfeature.service.ts',
      code: `class S { async update() { await this.repo.save(e); } }`,
      errors: [{ messageId: 'missing' }],
    },
    // Bare repo.insert.
    {
      filename: 'apps/api/src/modules/newfeature/newfeature.service.ts',
      code: `class S { async create() { await this.repo.insert(e); } }`,
      errors: [{ messageId: 'missing' }],
    },
    // Multiple mutations without audit → all flagged.
    {
      filename: 'apps/api/src/modules/newfeature/newfeature.service.ts',
      code: `
        class T {
          async a() { await this.repo.save(x); }
          async b() { await this.repo.remove(y); }
        }
      `,
      errors: [{ messageId: 'missing' }, { messageId: 'missing' }],
    },
    // EntityManager-style call without audit.
    {
      filename: 'apps/api/src/modules/newfeature/newfeature.service.ts',
      code: `class S { async create() { await this.entityManager.insert(E, e); } }`,
      errors: [{ messageId: 'missing' }],
    },
    // Repository name variant (case insensitive on the receiver token).
    {
      filename: 'apps/api/src/modules/newfeature/newfeature.service.ts',
      code: `class S { async update() { await this.userRepository.update({}, e); } }`,
      errors: [{ messageId: 'missing' }],
    },
    // PR17 — camelCase Repo suffix on a repo property still gets flagged
    // (the tightened regex must keep `templateRepo`-style names matching).
    {
      filename: 'apps/api/src/modules/newfeature/newfeature.service.ts',
      code: `class S { async update() { await this.templateRepo.save(e); } }`,
      errors: [{ messageId: 'missing' }],
    },
    // Audit call on the wrong method (logFoo, not logCreate/Update/Delete) → still flagged.
    {
      filename: 'apps/api/src/modules/newfeature/newfeature.service.ts',
      code: `class S { async update() { await this.repo.save(e); this.auditService.logFoo(e); } }`,
      errors: [{ messageId: 'missing' }],
    },
    // `audit-skip` without a rationale (just the bare token) is rejected.
    {
      filename: 'apps/api/src/modules/newfeature/newfeature.service.ts',
      code: `class S {
        // audit-skip:
        async update() { await this.repo.save(e); }
      }`,
      errors: [{ messageId: 'missing' }],
    },
    // PR20 — a non-listed file outside the POLICY_EXEMPT set still trips,
    // even when its path looks similar to an exempt entry.
    {
      filename: 'apps/api/src/modules/notifications/notifications-aux.service.ts',
      code: `class N { async update() { await this.repo.save(e); } }`,
      errors: [{ messageId: 'missing' }],
    },
  ],
});

// PR20 — Structural assertions on the POLICY_EXEMPT set.
// Promoted from .audit-migration-allowlist.json with per-file rationale; closes
// the Phase 5a audit migration burndown. These checks lock the set against
// accidental drift (e.g. a future refactor that drops rationale strings or
// duplicates an entry across both sets).
{
  const { POLICY_EXEMPT_FILES, INFRASTRUCTURE_FILES } = rule;

  assert.ok(
    POLICY_EXEMPT_FILES instanceof Map,
    'POLICY_EXEMPT_FILES must be exported as a Map (path → rationale)',
  );
  assert.ok(
    POLICY_EXEMPT_FILES.size >= 27,
    `POLICY_EXEMPT_FILES must contain the 27 entries promoted by PR20 (got ${POLICY_EXEMPT_FILES.size})`,
  );
  for (const [filePath, rationale] of POLICY_EXEMPT_FILES) {
    assert.ok(
      typeof filePath === 'string' && filePath.startsWith('apps/api/src/'),
      `POLICY_EXEMPT key must be an apps/api/src/ relative path: ${filePath}`,
    );
    assert.ok(
      typeof rationale === 'string' && rationale.length >= 20,
      `POLICY_EXEMPT rationale must be a non-trivial string: ${filePath} → ${rationale}`,
    );
    assert.ok(
      !INFRASTRUCTURE_FILES.has(filePath),
      `POLICY_EXEMPT entry must not also be in INFRASTRUCTURE_FILES: ${filePath}`,
    );
  }

  // Every POLICY_EXEMPT entry must resolve to an existing file on disk —
  // mirrors the smoke test the spec doc requires for .rbac-migration-allowlist.json.
  // findRepoRoot equivalent: walk up from this file until we find apps/api/.
  const repoRoot = (() => {
    let dir = __dirname;
    for (let i = 0; i < 6; i++) {
      if (fs.existsSync(path.join(dir, 'apps/api/.audit-migration-allowlist.json'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  })();
  if (repoRoot) {
    for (const filePath of POLICY_EXEMPT_FILES.keys()) {
      assert.ok(
        fs.existsSync(path.join(repoRoot, filePath)),
        `POLICY_EXEMPT entry references missing file: ${filePath}`,
      );
    }
  }
}
