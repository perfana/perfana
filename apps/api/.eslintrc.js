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
  },
  overrides: [
    {
      // Test files may call isGlobalAdmin to test the infrastructure services
      // themselves — exempt from the migration guard.
      files: ['**/*.spec.ts', '**/*.test.ts', '**/__tests__/**/*.ts'],
      rules: {
        'no-direct-is-global-admin': 'off',
      },
    },
  ],
};
