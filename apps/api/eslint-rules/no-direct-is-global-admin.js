const fs = require('fs');
const path = require('path');

// Cache: { allowlist: Set<string>, repoRoot: string } | null
let cache = null;

/**
 * Find the repo root by searching cwd and walking up until we find the
 * apps/api/.rbac-migration-allowlist.json file. Returns { allowlistPath, repoRoot }
 * or null if not found.
 *
 * This handles both:
 *   - ESLint running from the repo root  → finds apps/api/.rbac-migration-allowlist.json
 *   - ESLint running from apps/api/      → walks up one level, finds it there
 *   - RuleTester in tests (cwd varies)   → same walk-up logic
 */
function findRepoRoot(startDir) {
  let dir = startDir;
  // Walk up at most 4 levels to avoid traversing the entire filesystem.
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(dir, 'apps/api/.rbac-migration-allowlist.json');
    if (fs.existsSync(candidate)) return { allowlistPath: candidate, repoRoot: dir };
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
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

// Authz infrastructure: these files legitimately call authzService.isGlobalAdmin
// because that IS their job (encapsulating the admin-bypass check so that callers
// don't have to). Permanently exempt — never on the burndown.
const INFRASTRUCTURE_FILES = new Set([
  'apps/api/src/common/services/authorization.service.ts',   // defines isGlobalAdmin
  'apps/api/src/common/services/authorized-base.service.ts', // applyOrgFilter, getAccessibleOrgIds, verifyOrganizationAccess
  'apps/api/src/common/utils/with-org-filter.ts',            // shipped in PR #175 — the helper the migration uses
  'apps/api/src/common/guards/capability.guard.ts',          // CapabilityGuard reads getCapabilities (added in Phase 3c)
]);

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid new direct calls to authzService.isGlobalAdmin(). Use AuthorizationService.getCapabilities() or the @RequiresCapability decorator. Grandfathered files (from the 2026-04-26 audit) are allowed via apps/api/.rbac-migration-allowlist.json. Authz infrastructure files (AuthorizationService, AuthorizedBaseService, withOrgFilter, CapabilityGuard) are permanently exempt — they implement the helpers the migration uses.',
    },
    messages: {
      noDirectIsGlobalAdmin:
        'Direct authzService.isGlobalAdmin() is deprecated. Use getCapabilities() or @RequiresCapability. See docs/superpowers/audits/2026-04-26-audit-decisions.md. To migrate this file, remove it from .rbac-migration-allowlist.json.',
    },
    schema: [],
  },
  create(context) {
    const filename = context.getFilename();
    const cwd = context.getCwd ? context.getCwd() : process.cwd();

    // Normalize filename to a repo-root-relative path so the lookup keys
    // always match the format stored in the allowlist and INFRASTRUCTURE_FILES
    // (i.e. apps/api/src/...) regardless of whether ESLint is invoked from
    // the repo root, from apps/api/, or from a RuleTester with relative filenames.
    const { allowlist, repoRoot } = loadCache(cwd);

    let relPath;
    if (path.isAbsolute(filename)) {
      // Real ESLint run: filename is absolute.
      relPath = path.relative(repoRoot, filename);
    } else if (filename.startsWith('apps/api/') || filename.startsWith('apps/web/')) {
      // RuleTester (or ESLint flat config): filename is already repo-root-relative.
      relPath = filename;
    } else {
      // Other relative filename: resolve against cwd, then make repo-root-relative.
      relPath = path.relative(repoRoot, path.resolve(cwd, filename));
    }

    // Authz infrastructure: permanent exemption.
    if (INFRASTRUCTURE_FILES.has(relPath)) return {};

    // Grandfathered files: tolerate (they're on the burndown list).
    if (allowlist.has(relPath)) return {};

    return {
      // Match `<anything>.isGlobalAdmin(...)` calls.
      "CallExpression[callee.property.name='isGlobalAdmin']"(node) {
        context.report({ node, messageId: 'noDirectIsGlobalAdmin' });
      },
    };
  },
};
