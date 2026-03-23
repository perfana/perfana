# TODOS

## ~~Pre-Phase 3: Capture ADAPT golden-file test fixtures~~ ✅ DONE

Completed in Phase 3.3.5. Golden-file tests exist at `apps/worker/src/test/golden-files/` with 47 SQL snapshot tests and 891 real data result comparisons.

---

## ~~Fix 2 broken worker unit tests (Phase 3 regression)~~ ✅ DONE

Already fixed. Worker test suite passes: 904 passed, 0 failures (verified 2026-03-23).

---

## Enable branch protection on main (after repo goes public)

**What:** Set branch protection rules on `main` via GitHub API once the repo is public.

**Why:** Prevents direct pushes to main, enforces PR reviews and CI checks. Standard open source best practice.

**Pros:** Protects main from accidental force-pushes or unreviewed changes. Required for credible open source projects.

**Cons:** None — only blocks the free tier while repo is private.

**Context:** GitHub requires repo to be public (or Pro/Team plan) for branch protection on free tier. Run this after making repo public:

```bash
gh api repos/perfana/perfana/branches/main/protection -X PUT --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["quality-gate"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1
  },
  "restrictions": null
}
EOF
```

This enforces: PR required, 1 review required, CI must pass, branch must be up to date.

**Depends on:** Repo made public on GitHub.

**Blocked by:** Repo is currently private (GitHub free tier limitation).

---

## Phase 6: CI check for generated API client drift

**What:** Add a CI pipeline step that regenerates the typed API client from the OpenAPI spec and fails if the committed client differs from the freshly generated one.

**Why:** The plan uses a generated typed client (from NestJS Swagger → OpenAPI → codegen) to keep frontend and backend in sync. Without a CI check, developers will change API endpoints and forget to regenerate the client, causing type errors only discovered at runtime.

**Pros:** Catches API/client drift at PR time. Enforces the "single source of truth" pattern for API types.

**Cons:** Adds a CI step (~30s). Developers must run `pnpm generate:api-client` after API changes.

**Context:** The original perfana-next-gen used hand-written Axios wrappers that frequently drifted from the actual API. The generated client eliminates this class of bug, but only if regeneration is enforced.

**Depends on:** Phase 2 (API with Swagger) and Phase 5 (frontend with generated client).

**Blocked by:** Nothing — natural addition during Phase 6 CI setup.

---

## Publish MCP server to npm as `@perfana/mcp`

**What:** Publish the MCP server package to npm so users can run `npx @perfana/mcp` instead of cloning the repo and building from source.

**Why:** Lowers the barrier to entry for AI-powered performance analysis. Users of Claude Desktop, Cursor, or any MCP client can add Perfana in one line of config instead of dealing with git clone + npm install + build.

**Pros:** Better adoption, standard distribution channel, version pinning via semver.

**Cons:** Requires npm org setup, CI publish pipeline, and keeping published version in sync with repo.

**Context:** The MCP server at `apps/mcp/` is already a standalone package with its own `package.json`. Main work is adding a prepublish build step, setting `"bin"` in package.json, and configuring CI to publish on release tags.

**Depends on:** Phase 2A MCP expansion (want to publish with the full tool set, not the current 14-tool subset).

**Blocked by:** Nothing technical — just timing.
