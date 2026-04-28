const { RuleTester } = require('eslint');
const rule = require('./no-direct-is-global-admin');

const ruleTester = new RuleTester({
  parser: require.resolve('@typescript-eslint/parser'),
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

ruleTester.run('no-direct-is-global-admin', rule, {
  valid: [
    // The AuthorizationService itself is allowed to define and use isGlobalAdmin.
    {
      filename: 'apps/api/src/common/services/authorization.service.ts',
      code: `class A { isGlobalAdmin(roles) { return roles.includes('admin'); } }`,
    },
    // Authz infrastructure: AuthorizedBaseService legitimately calls isGlobalAdmin
    // in its applyOrgFilter / getAccessibleOrgIds / verifyOrganizationAccess methods.
    {
      filename: 'apps/api/src/common/services/authorized-base.service.ts',
      code: `class A2 { x(roles) { return this.authzService.isGlobalAdmin(roles); } }`,
    },
    // Authz infrastructure: withOrgFilter helper from PR #175 — encapsulates the
    // admin-bypass check so callers don't have to.
    {
      filename: 'apps/api/src/common/utils/with-org-filter.ts',
      code: `function f(authz, roles) { return authz.isGlobalAdmin(roles) ? null : authz.getAccessibleOrganizations(); }`,
    },
    // Authz infrastructure: CapabilityGuard reads capabilities, not direct
    // isGlobalAdmin, but is on the exemption list for forward-compat.
    {
      filename: 'apps/api/src/common/guards/capability.guard.ts',
      code: `class G { x() {} }`,
    },
    // Capabilities-based check is the new pattern, never flagged.
    {
      filename: 'apps/api/src/modules/foo/foo.service.ts',
      code: `class B { check(caps) { return caps.includes('foo:bar'); } }`,
    },
    // Grandfathered file (from .rbac-migration-allowlist.json) — flagged but tolerated.
    {
      filename: 'apps/api/src/modules/dynatrace/dynatrace.service.ts',
      code: `class C { x(roles) { return this.authzService.isGlobalAdmin(roles); } }`,
    },
  ],
  invalid: [
    // New file (not on allowlist) using the old pattern → fail.
    {
      filename: 'apps/api/src/modules/newfeature/newfeature.service.ts',
      code: `class D { x(roles) { return this.authzService.isGlobalAdmin(roles); } }`,
      errors: [
        {
          messageId: 'noDirectIsGlobalAdmin',
        },
      ],
    },
    // Multiple isGlobalAdmin calls in a non-allowlisted file → all flagged.
    {
      filename: 'apps/api/src/modules/newfeature2/newfeature2.service.ts',
      code: `
        class E {
          a(r) { return this.authzService.isGlobalAdmin(r); }
          b(r) { if (this.authzService.isGlobalAdmin(r)) return; }
        }
      `,
      errors: [
        { messageId: 'noDirectIsGlobalAdmin' },
        { messageId: 'noDirectIsGlobalAdmin' },
      ],
    },
    // Non-allowlisted file that happens to not be in infrastructure either.
    {
      filename: 'apps/api/src/modules/some/some.service.ts',
      code: `class F { x(r) { return this.authzService.isGlobalAdmin(r); } }`,
      errors: [{ messageId: 'noDirectIsGlobalAdmin' }],
    },
  ],
});
