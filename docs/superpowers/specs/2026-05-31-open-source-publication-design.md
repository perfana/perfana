# Open-Sourcing Perfana — Design

**Date:** 2026-05-31
**Status:** Approved (brainstorming complete)
**Author:** Daniel Moll + Claude

## Goal

Take `perfana/perfana` from **private → public** as a project that AI coding
contributors (Claude Code / Cursor / Copilot) can clone, understand, build, and
contribute to with minimal friction — without leaking secrets, internal/customer
material, or personal workflow tooling.

## Primary audience

**AI coding contributors.** Every decision optimizes for an agent (or a human
using one) cloning the repo cold and becoming productive: accurate
`AGENTS.md`, working build/test/lint loops, navigable codebase, honest
quickstart, and seed data so the app is observably *working*, not an empty shell.

## Key decisions (locked during brainstorming)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Git history strategy | **A — scan-first, keep history** | 354 commits is exhaustively scannable; `.env*` was gitignored from early on (low historical risk); intact history/blame best serves coding contributors. Rotate all credentials regardless of findings. |
| `.claude/skills/` | **Strip all** (vendor gstack + `auth-audit` + `perfana-report`) | Vendor skills are third-party IP + personal workflow. `auth-audit` is stale (asserts the NULL-org escape hatch that Phase 4 closed) AND is an attacker's recon map (enumerates known weak spots + guard file paths). Keep all local. |
| `.claude/agents/` | **Keep tracked** | Generic NestJS/React/test/audit helpers — safe and reusable by contributors. |
| `docs/superpowers/` | **Strip all** (plans, specs, audits, scheduled-agents) | Internal architecture-decision history; keep local. |
| Untracked tooling on disk | **Preserve** | `git rm --cached` + gitignore removes from the public repo but keeps every file on disk — all local skills/specs keep working unchanged. |
| `CLAUDE.md` / `AGENTS.md` | **Strip personal-tooling sections** | GitNexus block, gstack `/browse` + skill-routing, and memory-path references point at the maintainer's local setup, not the project. |

### Why "keep local" works mechanically

Claude Code / gstack load skills from the **filesystem** (`.claude/skills/`), not
from git. `git rm --cached -r <path>` removes tracking only — files stay on disk.
Adding the paths to `.gitignore` prevents re-commit. Vendor gstack skills are
*also* installed via the plugin cache (`~/.claude/plugins/cache/...`), so they
remain available regardless. The maintainer's `~/.claude/` memory and personal
skills live outside the repo and are never touched.

## Current-state findings (from exploration)

Already in good shape:
- **Apache 2.0** `LICENSE`, plus `README.md` (with quickstart + badges),
  `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `AGENTS.md`.
- **`.env*` files are NOT git-tracked** — `.gitignore` handles them well
  (`.env`, `.env.*`, `!.env.example`, `secrets/`). Working-tree secret risk is low.
- **`.gstack/` and `.superpowers/` are NOT tracked** — personal tools won't leak.
- `package.json` is `"private": true` (must flip / confirm intent before publish).

Needs work:
- **354 commits, never audited** for historical secrets — the publication gate.
- **`.claude/` has 60 tracked files** — mostly vendor skills; includes an
  accidentally-tracked worktree artifact (`.claude/worktrees/naughty-shamir-284b5e`).
- **`docs/superpowers/` (internal specs/plans/audits)** tracked — strip.
- **`CHANGELOG.md` is 264 KB** — largest surface for hidden customer/internal refs.
- `docs-site/` (318 files) and `docs/readmes/` are legit public docs — keep.

## Phased plan

### Phase 1 — Secret & sensitive-data audit (the publication gate)

- Run `gitleaks detect` across **all 354 commits** + `trufflehog git` (entropy +
  verified secrets).
- Manual sweep of high-risk areas: `CHANGELOG.md`, `infra/`, `keycloak/`,
  `provisioning/`, `.github/workflows/`, and any historical `.env` committed
  before the gitignore rule existed.
- Grep history for customer/internal markers: known customer names
  (e.g. `BeeldEnGeluid`, `TVOH`), internal domains, real hostnames/IPs, JWTs,
  `Authorization:` headers, MCP API keys.
- Confirm dev-default creds (`admin/admin`, `perfana@example.com/perfana`,
  Keycloak realm) are *only* dev defaults; document them as such.
- **Decision matrix:**
  - Clean → keep history as-is.
  - Secrets found → excise with `git-filter-repo`, then force-push cleaned history.
- **Mandatory regardless of findings:** rotate Keycloak client secret, any DB
  passwords, and any API keys that ever lived in the repo.
- Output: short audit report committed under `docs/`.

### Phase 2 — Repo curation (strip vendor/internal, keep curated subset)

Use `git rm --cached -r <path>` (keeps files on disk) + add to `.gitignore`:

- **Untrack + gitignore:**
  - All of `.claude/skills/` (vendor gstack, `auth-audit`, `perfana-report`).
  - `.claude/worktrees/` (remove the tracked `naughty-shamir-284b5e` artifact).
  - All of `docs/superpowers/` (plans, specs, audits, scheduled-agents).
  - Verify `.gitnexus/` is gitignored; untrack if currently tracked (local index).
- **Keep tracked:** `.claude/agents/` only (generic helpers).
- **`CLAUDE.md` / `AGENTS.md`:** strip personal-tooling sections — the **GitNexus**
  block, **gstack `/browse` + skill-routing**, and **memory-path** references.
  Make `AGENTS.md` the vendor-neutral canonical agent guide; reduce `CLAUDE.md`
  to a pointer or keep the two in sync.
- **`CHANGELOG.md`:** scrub customer/internal references.
- Review `TODOS.md` for internal/sensitive content; strip or sanitize.

### Phase 3 — Agent-friendliness for coding contributors (the core goal)

- **Validate the documented quickstart from a clean clone** — the #1
  agent-friendliness signal. `./scripts/setup.sh` + `npm run dev` must come up
  with no private registry, no secrets, no manual fixups.
- Ensure `AGENTS.md` is accurate post-strip: project index, build/test/lint
  loops, where things live, per-app `CODING_RULES.md` links, and the
  health/preflight gates — all working from a fresh clone.
- Provide **seed/demo data** so an agent sees the app actually working (a test
  run with metrics), not an empty shell.
- `CONTRIBUTING.md`: confirm it covers run/test/lint, PR conventions, and the
  local pre-push gate.
- Add an architecture onboarding path + a few `good first issue`s.

### Phase 4 — Open-source governance polish

- `NOTICE` file + optional copyright-header policy (Apache 2.0 already present).
- Verify `SECURITY.md` points to a **real, monitored** reporting address.
- Add `.github/ISSUE_TEMPLATE/` + `PULL_REQUEST_TEMPLATE.md` if missing.
- Decide contribution sign-off: **DCO** (`Signed-off-by`) recommended over CLA.
- Audit `.github/workflows/` (`pr-quality-gate`): must run on public PRs
  **without** privileged secrets, or gate secret-requiring jobs behind GitHub
  environment protection / fork-PR restrictions.

### Phase 5 — Clean-clone validation (dogfood the claim)

- Fresh clone into a temp dir; follow the README verbatim; confirm dev env +
  tests + lint pass with zero local-only assumptions.
- Bonus: have an AI agent do a cold onboarding pass to prove the
  "agent-friendly" claim end-to-end.

### Phase 6 — Publication & launch

- Final credential-rotation confirmation.
- Flip `package.json` `"private"` intent as appropriate.
- Push scrubbed history (if Phase 1 required it) → flip repo visibility to **public**.
- Enable repo security: Dependabot, secret scanning + push protection, branch
  protection on `main`.
- Release notes / announcement.

## Out of scope

- Unrelated refactoring of application code.
- Changing the application's runtime architecture or feature set.
- Migrating to a different license.

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| A missed historical secret persists after publish | Mandatory credential rotation (Phase 1) makes any leaked secret useless. |
| Force-push rewrites SHAs, breaks local clones/forks | Only if scrub is needed; communicate before flipping public (no external forks exist yet — repo is private). |
| Stripping skills breaks local workflow | `git rm --cached` + gitignore keeps all files on disk; plugin cache provides vendor skills independently. |
| Public CI exposes secrets via fork PRs | Phase 4 gates secret-requiring jobs behind environment protection. |
| `auth-audit` recon leaks if accidentally kept | Explicitly stripped in Phase 2; verify absence in Phase 5 clean-clone check. |
