# Manual Sensitive-Data Sweep — 2026-05-31

Full-history audit prior to open-source publication. Strategy: scan-first, keep
history (Approach A). Repo: 354 commits.

## Scanner results

- **gitleaks** (all commits, `--log-opts=--all`): **47 findings** — all triaged
  benign (see below). Report: `2026-05-31-gitleaks-report.json`.
- **trufflehog** (`git file://.`, `--only-verified`): **0 verified secrets**.
  trufflehog live-validates candidates against provider APIs, so 0 verified is
  strong evidence none of the 47 are live credentials.

## 1. Committed .env files (non-example)

Searched: `git log --all --diff-filter=A` for any added `.env*` not matching
`example`/`template`.
Result: none. `.env*` has been gitignored since early history.
Verdict: **clean**.

## 2. gitleaks 47 findings — triage

Breakdown by rule: 36 generic-api-key, 6 curl-auth-header, 4 jwt, 1 dynatrace-api-token.

By category, all 47 are non-secrets:

| Category | Files | Nature |
|----------|-------|--------|
| Test mocks | `*.spec.ts`, `*.test.ts(x)`, `__tests__/`, `test/`, `*.test.ts.disabled` | Hard-coded fake tokens/keys used as test fixtures (e.g. `apiKey: '...'`, `jwtToken = '...'`, `api-key:...`) |
| Doc examples | `REALTIME_QUICKSTART.md`, `PDF_DOWNLOAD_FLOW.md`, `TEST_RUN_CREATION_FLOW_WITH_API_KEY.md`, `DYNATRACE_INTEGRATION.md`, `DEPLOYMENT_CHECKLIST.md`, `KEYCLOAK_MIGRATION_PLAN.md`, `PHASE6_KEYCLOAK_AUTH_MIGRATION.md` | Example `curl -H "Authorization: Bearer ..."`, `api-key:...`, localhost demo creds |
| Audit-report examples | `apps/api/CODE_AUDIT_REPORT.md` (deleted from tree; in history at `cb6c7630`) | Explicitly truncated examples: `SERVICE_ROLE_KEY=eyJhbGc... (truncated example)`, `DYNATRACE_API_TOKEN=dt0c01.ABC123... (example)` — not real values |
| Vendor gstack config | `.claude/skills/gstack/supabase/config.sh` (gitignored now; in history) | `GSTACK_SUPABASE_ANON_KEY="sb_publishable_..."` — a **publishable** anon key; file header states "These are PUBLIC keys — safe to commit … RLS denies all access". Third-party gstack infra, not Perfana's. |

Highest-risk-sounding match independently inspected in history
(`git show cb6c7630:apps/api/CODE_AUDIT_REPORT.md`): all values are truncated
`(example)` placeholders.

Verdict: **clean** — no real Perfana credential values committed at any point.

## 3. Customer / internal markers

Searched history for known customer names (BeeldEnGeluid, TVOH), internal
domains (`*.perfana.io|cloud`), and IPv4 literals (excluding localhost/example).
Result: no real customer names, no internal hostnames, no real public IPs.
Verdict: **clean**.

## 4. Dev-default credentials (documented, intentional)

- `admin/admin` — Keycloak dev console
- `perfana@example.com` / `perfana` — dev login
- Keycloak realm: `perfana-prod`

Verdict: dev defaults only — safe to publish; documented in README/AGENTS.

## 5. CHANGELOG & docs-site content

Searched `CHANGELOG.md` and `docs-site/content/` for customer/internal markers
and IPv4 literals. Result: no hits. `docs-site/content/.obsidian/` (editor
config) untracked separately in Task 4.
Verdict: **clean**.

## Overall verdict

**CLEAN — keep full history as-is. No `git-filter-repo` rewrite required.**

Mandatory credential rotation (Task 7) still applies regardless, as
defense-in-depth for the private→public transition.

## TODOS.md review (Task 5)

156-line generic engineering task list (knip dead-code verification, etc.). No
customer names, secrets, or internal references. Verdict: publication-appropriate
— kept as-is.
