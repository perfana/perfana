/**
 * API-specific ESLint config. Extends the root config and adds the
 * RBAC migration guard rule (loaded from ./eslint-rules/ via --rulesdir).
 *
 * The rule is registered here so it only applies to the API package.
 * It is *not* in the root .eslintrc.js because --rulesdir is only passed
 * by this package's lint script and the rule file lives here.
 */
module.exports = {
  extends: ['../../.eslintrc.js'],
  rules: {
    // RBAC migration guard: blocks new direct authzService.isGlobalAdmin() calls
    // outside infrastructure files. Grandfathered files listed in
    // .rbac-migration-allowlist.json are exempt until migrated.
    // See: docs/superpowers/audits/2026-04-26-audit-decisions.md (burndown table)
    'no-direct-is-global-admin': 'error',
    // Phase 5a audit migration guard: every service mutation on an OwnedResource
    // must be paired with an auditService.log{Create,Update,Delete} call in the
    // same method body. Files listed in .audit-migration-allowlist.json are
    // grandfathered until migrated.
    // See: docs/superpowers/audits/2026-05-02-audit-phase5a-decisions.md
    'audit-mutation-must-log': 'error',
  },
  overrides: [
    {
      // Test files may call isGlobalAdmin / mutate without audit to test the
      // infrastructure services themselves — exempt from both migration guards.
      files: ['**/*.spec.ts', '**/*.test.ts', '**/__tests__/**/*.ts'],
      rules: {
        'no-direct-is-global-admin': 'off',
        'audit-mutation-must-log': 'off',
      },
    },
  ],
};
