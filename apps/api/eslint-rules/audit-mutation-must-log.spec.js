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
  ],
});
