# Open-Sourcing Perfana — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take `perfana/perfana` from private → public as an AI-agent-friendly project, with a clean secret history, curated tracked files, accurate docs, and proper OSS governance.

**Architecture:** Scan-first (keep the 354-commit history; rotate all credentials regardless of findings). Untrack vendor/internal tooling via `git rm --cached` + `.gitignore` (files stay on disk so local workflow is unaffected). Audit and fix docs. Validate from a clean clone. Flip visibility last.

**Tech Stack:** git, git-filter-repo (installed), gitleaks + trufflehog (to install via Homebrew), GitHub CLI (`gh`), Quartz 4 docs-site, npm/turbo monorepo.

**Spec:** `docs/superpowers/specs/2026-05-31-open-source-publication-design.md`

---

## ⚠️ Read before starting

1. **This plan and its spec live under `docs/superpowers/`, which Task 9 untracks from git.** That is intended — they are internal docs. After Task 9, `git status` will show them as untracked. Keep the files on disk; do not delete them. Continue editing the checkboxes locally as you work.
2. **Credential rotation (Task 7) is mandatory even if the scan is clean.** A private repo flipping public means every secret that ever touched it must be assumed compromised.
3. **Do not flip the repo to public until the final task.** Every prior task is reversible; publication is not.
4. **No external forks exist** (repo is private, 0 stars) — so a history rewrite, if needed, is safe to force-push.
5. Work on a branch, not `main` (per project convention). Branch created in Task 0.

---

## Phase 0 — Setup

### Task 0: Create working branch and install scanning tools

**Files:** none (environment setup)

- [ ] **Step 1: Create a working branch**

```bash
cd /Users/daniel/workspace/perfana
git checkout -b chore/open-source-prep
```

Expected: `Switched to a new branch 'chore/open-source-prep'`

- [ ] **Step 2: Install the secret scanners**

```bash
brew install gitleaks trufflehog
```

Expected: both install successfully. `git-filter-repo` is already at `/opt/homebrew/bin/git-filter-repo`.

- [ ] **Step 3: Verify all three tools are available**

```bash
gitleaks version && trufflehog --version && git-filter-repo --version
```

Expected: a version string for each (no "command not found").

- [ ] **Step 4: Commit nothing — this is environment setup only**

No commit. Proceed to Phase 1.

---

## Phase 1 — Secret & sensitive-data audit (the publication gate)

> Output of this phase is an audit report committed under `docs/audit/`. **Do not delete history or rotate yet** — first gather findings, then decide (Task 6) and rotate (Task 7).

### Task 1: Scan full history with gitleaks

**Files:**
- Create: `docs/audit/2026-05-31-gitleaks-report.json`

- [ ] **Step 1: Create the audit output directory**

```bash
mkdir -p docs/audit
```

- [ ] **Step 2: Run gitleaks across all 354 commits**

```bash
gitleaks detect --source . --log-opts="--all" \
  --report-format json \
  --report-path docs/audit/2026-05-31-gitleaks-report.json \
  --redact --verbose 2>&1 | tee docs/audit/2026-05-31-gitleaks-stdout.txt
```

Expected: completes with either "no leaks found" or a count of findings. A non-zero exit code means findings exist — that is information, not a failure.

- [ ] **Step 3: Summarize the finding count**

```bash
test -f docs/audit/2026-05-31-gitleaks-report.json && \
  echo "Findings: $(jq 'length' docs/audit/2026-05-31-gitleaks-report.json)" || \
  echo "Findings: 0 (no report file written)"
```

Expected: a number. Record it; it feeds the Task 6 decision.

- [ ] **Step 4: Commit the report**

```bash
git add docs/audit/
git commit -m "chore(audit): add gitleaks full-history secret scan report"
```

### Task 2: Scan full history with trufflehog

**Files:**
- Create: `docs/audit/2026-05-31-trufflehog-report.json`

- [ ] **Step 1: Run trufflehog (verified secrets only, full git history)**

```bash
trufflehog git file://. --json --only-verified \
  > docs/audit/2026-05-31-trufflehog-report.json 2>docs/audit/2026-05-31-trufflehog-stderr.txt
```

Expected: completes. Each line of the JSON file is one verified secret; an empty file means none verified.

- [ ] **Step 2: Count verified findings**

```bash
echo "Verified secrets: $(grep -c . docs/audit/2026-05-31-trufflehog-report.json)"
```

Expected: a number (0 is the hoped-for result).

- [ ] **Step 3: Commit the report**

```bash
git add docs/audit/
git commit -m "chore(audit): add trufflehog verified-secret scan report"
```

### Task 3: Manual sweep of high-risk files in history

**Files:**
- Create: `docs/audit/2026-05-31-manual-sweep.md`

- [ ] **Step 1: Check whether any `.env` (non-example) was ever committed**

```bash
git log --all --diff-filter=A --name-only --pretty=format: \
  | grep -E '\.env' | grep -v -E 'example|template' | sort -u
```

Expected: empty output (confirms `.env*` was always gitignored). Any path here is a finding for Task 6.

- [ ] **Step 2: Grep entire history for credential-shaped strings**

```bash
git grep -nIE '(client[_-]?secret|password|passwd|secret|api[_-]?key|bearer|authorization:|-----BEGIN)' \
  $(git rev-list --all) -- '*.ts' '*.js' '*.json' '*.yml' '*.yaml' '*.env*' '*.md' \
  2>/dev/null | grep -ivE 'example|placeholder|<your|process\.env|\.env\.|changeme|admin/admin|test|spec|mock' \
  | head -100 > docs/audit/raw-credential-grep.txt
wc -l docs/audit/raw-credential-grep.txt
```

Expected: a manageable list. Manually inspect every line — most will be variable names / config keys, not values.

- [ ] **Step 3: Grep history for known customer / internal markers**

```bash
git grep -nIE 'beeldengeluid|beeld en geluid|tvoh|\.perfana\.(io|cloud)|[0-9]{1,3}(\.[0-9]{1,3}){3}' \
  $(git rev-list --all) 2>/dev/null \
  | grep -ivE 'localhost|127\.0\.0\.1|0\.0\.0\.0|example|github\.com/perfana' \
  | head -100 > docs/audit/raw-customer-grep.txt
wc -l docs/audit/raw-customer-grep.txt
```

Expected: a list to inspect. Real customer names, internal hostnames, or real public IPs are findings.

- [ ] **Step 4: Write the manual-sweep summary**

Create `docs/audit/2026-05-31-manual-sweep.md` documenting, for each check above:
- what was searched
- what was found (quote specific `commit:file:line` or "none")
- verdict: benign (dev default / variable name / example) or **finding** (real secret/customer data)

Use this template (fill with real results — no placeholders in the committed version):

```markdown
# Manual Sensitive-Data Sweep — 2026-05-31

## 1. Committed .env files (non-example)
Result: <none | list paths>
Verdict: <clean | FINDING>

## 2. Credential-shaped strings in history
Searched: client_secret, password, secret, api_key, bearer, PEM blocks
Result: <summary; quote any real values found by commit:file:line>
Verdict: <clean | FINDING>

## 3. Customer / internal markers
Searched: known customer names, internal domains, public IPs
Result: <summary>
Verdict: <clean | FINDING>

## 4. Dev-default credentials (documented, intentional)
- admin/admin (Keycloak dev console)
- perfana@example.com / perfana (dev login)
- Keycloak realm: perfana-prod
Verdict: dev defaults only — safe to publish, documented in README.

## Overall verdict
<CLEAN — keep history as-is | FINDINGS — history rewrite required (Task 6)>
```

- [ ] **Step 5: Remove the raw grep scratch files (keep only the summary)**

```bash
rm -f docs/audit/raw-credential-grep.txt docs/audit/raw-customer-grep.txt
```

- [ ] **Step 6: Commit the sweep**

```bash
git add docs/audit/2026-05-31-manual-sweep.md
git commit -m "chore(audit): add manual sensitive-data sweep of git history"
```

### Task 4: Audit CHANGELOG.md and docs-site content for internal references

**Files:**
- Modify: `CHANGELOG.md` (only if findings)
- Modify: files under `docs-site/content/` (only if findings)
- Append to: `docs/audit/2026-05-31-manual-sweep.md`

- [ ] **Step 1: Scan the working-tree CHANGELOG and docs-site for customer/internal markers**

```bash
grep -rniE 'beeldengeluid|beeld en geluid|tvoh|[0-9]{1,3}(\.[0-9]{1,3}){3}' \
  CHANGELOG.md docs-site/content/ \
  | grep -ivE 'localhost|127\.0\.0\.1|0\.0\.0\.0|example|github\.com' | head -50
```

Expected: ideally empty. (A probe in brainstorming already found 0 customer-name hits in CHANGELOG.) Inspect any hits.

- [ ] **Step 2: Remove the Obsidian editor config from docs-site**

```bash
git rm -r --cached docs-site/content/.obsidian 2>/dev/null || true
echo "docs-site/content/.obsidian/" >> docs-site/.gitignore
```

Expected: `.obsidian` untracked (it is editor state, not content). If `docs-site/.gitignore` does not exist, this creates it.

- [ ] **Step 3: If any customer/internal references were found, edit them out**

For each hit from Step 1, replace the real value with a generic placeholder (e.g. a real customer name → `Acme Corp`, a real hostname → `grafana.example.com`). If Step 1 was empty, skip.

- [ ] **Step 4: Append results to the sweep summary**

Add a `## 5. CHANGELOG & docs-site content` section to `docs/audit/2026-05-31-manual-sweep.md` recording what was searched, found, and changed.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md docs-site/ docs/audit/2026-05-31-manual-sweep.md
git commit -m "chore(audit): scrub internal references from CHANGELOG/docs-site, untrack obsidian config"
```

### Task 5: TODOS.md review

**Files:**
- Modify or delete: `TODOS.md`

- [ ] **Step 1: Read TODOS.md and judge whether it is publication-appropriate**

```bash
cat TODOS.md
```

Decide: does it contain internal-only planning, customer references, or sensitive context? If yes → sanitize or remove. If it is a clean public roadmap → keep.

- [ ] **Step 2a: If keeping — leave as is, no change.**

- [ ] **Step 2b: If removing — untrack but keep on disk**

```bash
git rm --cached TODOS.md
echo "/TODOS.md" >> .gitignore
```

- [ ] **Step 3: Commit (only if changed)**

```bash
git add -A TODOS.md .gitignore
git commit -m "chore: sanitize TODOS.md for public repo"
```

### Task 6: History decision

**Files:**
- Append to: `docs/audit/2026-05-31-manual-sweep.md`

- [ ] **Step 1: Review all reports from Tasks 1–4 together**

Read the gitleaks count (Task 1), trufflehog count (Task 2), and the manual-sweep verdict (Task 3). Decide:
- **CLEAN** (no real secrets in history) → keep history as-is. Record the decision and **skip to Phase 2**.
- **FINDINGS** (real secrets in history) → proceed to Step 2 (history rewrite).

- [ ] **Step 2 (FINDINGS path only): Excise secrets with git-filter-repo**

For each confirmed secret file path, remove it from all history. Example for a leaked file:

```bash
# back up first
git clone --no-local . ../perfana-history-backup
# remove a leaked path from all history
git filter-repo --invert-paths --path <leaked/file/path> --force
```

For leaked *strings* inside otherwise-kept files, use a replacements file:

```bash
printf '<the-real-secret>==>REDACTED\n' > /tmp/replacements.txt
git filter-repo --replace-text /tmp/replacements.txt --force
```

Expected: filter-repo rewrites history and prints a summary. Note: it removes the `origin` remote as a safety measure — you will re-add it in Phase 7.

- [ ] **Step 3: Record the final decision in the sweep summary**

Append a `## Final history decision` section: CLEAN-keep or REWRITTEN (list what was excised). Commit:

```bash
git add docs/audit/2026-05-31-manual-sweep.md
git commit -m "chore(audit): record git-history publication decision"
```

### Task 7: Rotate all credentials (mandatory, regardless of scan result)

**Files:** none in-repo (external rotation) — record completion in audit dir

- [ ] **Step 1: Rotate the Keycloak client secret**

In the production Keycloak admin console, regenerate `KEYCLOAK_CLIENT_SECRET` for the Perfana client. Update the value in your production secret store (not in the repo).

- [ ] **Step 2: Rotate database passwords**

Rotate production `DB_PASSWORD` (and any other DB creds) in the secret store / deployment config.

- [ ] **Step 3: Revoke any API keys that ever lived in the repo or its history**

Includes the Perfana MCP API keys referenced in maintainer memory. Issue new ones via `/api-keys`; distribute out-of-band.

- [ ] **Step 4: Record rotation completion**

Create `docs/audit/2026-05-31-rotation-checklist.md` with a dated checklist of what was rotated (no secret values — just "Keycloak client secret rotated: yes/date", etc.). Commit:

```bash
git add docs/audit/2026-05-31-rotation-checklist.md
git commit -m "chore(audit): record mandatory credential rotation"
```

---

## Phase 2 — Repo curation

### Task 8: Untrack all of `.claude/skills/`, keep `.claude/agents/`

**Files:**
- Modify: `.gitignore`
- Untrack (keep on disk): everything under `.claude/skills/`

- [ ] **Step 1: Confirm what is currently tracked under `.claude/`**

```bash
git ls-files .claude | sed 's#/[^/]*$##' | sort -u
```

Expected: `.claude/agents`, `.claude/skills/...` (≈55 SKILL.md), and `.claude/worktrees/naughty-shamir-284b5e`. Confirm `.claude/agents` is the only dir to keep.

- [ ] **Step 2: Untrack all of `.claude/skills/` (files remain on disk)**

```bash
git rm -r --cached .claude/skills
```

Expected: lists the removed-from-index SKILL.md files. They stay on disk — verify with `ls .claude/skills | head`.

- [ ] **Step 3: Untrack the stray worktree artifact**

```bash
git rm -r --cached .claude/worktrees 2>/dev/null || true
```

- [ ] **Step 4: Extend `.gitignore` to ignore all skills but keep agents**

The file already ignores `.claude/skills/gstack/`, `.claude/skills/gitnexus/`, and `.claude/worktrees/`. Replace those two specific skill lines with a blanket rule. Edit `.gitignore` so the `.claude` block reads:

```
.claude/skills/
.claude/worktrees/
.gitnexus
```

(Remove the now-redundant `.claude/skills/gstack/` and `.claude/skills/gitnexus/` lines at 210–211. `.claude/agents/` stays tracked because it is not ignored.)

- [ ] **Step 5: Verify agents survive and skills are gone from the index**

```bash
echo "tracked under .claude:"; git ls-files .claude
echo "on-disk skills still present:"; ls .claude/skills | wc -l
```

Expected: tracked list shows only `.claude/agents/*.md`; on-disk skills count is unchanged (≈60).

- [ ] **Step 6: Commit**

```bash
git add .gitignore
git commit -m "chore: untrack vendor/internal .claude skills, keep .claude/agents"
```

### Task 9: Untrack `docs/superpowers/`

**Files:**
- Modify: `.gitignore`
- Untrack (keep on disk): everything under `docs/superpowers/`

> **Note:** this untracks the spec and *this plan*. Intended. Files stay on disk; keep using them.

- [ ] **Step 1: Untrack the directory**

```bash
git rm -r --cached docs/superpowers
```

Expected: lists removed specs/plans/audits/scheduled-agents. Wait — `docs/audit/` is separate and stays tracked.

- [ ] **Step 2: Ignore it going forward**

Add to `.gitignore` (Misc section):

```
docs/superpowers/
```

- [ ] **Step 3: Verify on-disk files remain**

```bash
ls docs/superpowers/specs/ docs/superpowers/plans/ | head
git ls-files docs/superpowers | wc -l
```

Expected: files still on disk; tracked count is `0`.

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: untrack internal docs/superpowers (keep local)"
```

### Task 10: Strip personal-tooling sections from CLAUDE.md and AGENTS.md

**Files:**
- Modify: `CLAUDE.md` (remove lines 504–end: `## gstack`, `## Skill routing`, `# GitNexus — Code Intelligence` and its subsections)
- Modify: `AGENTS.md` (remove lines 472–end: `# GitNexus — Code Intelligence` and its subsections)

- [ ] **Step 1: Remove the gstack / skill-routing / GitNexus sections from CLAUDE.md**

Delete everything from the `## gstack` heading (line ~504) to end of file. These reference the maintainer's local `/browse`, skill routing, and the GitNexus MCP index — none apply to a public contributor.

- [ ] **Step 2: Remove the GitNexus section from AGENTS.md**

Delete everything from `# GitNexus — Code Intelligence` (line ~472) to end of file.

- [ ] **Step 3: Verify no dangling references to removed tooling remain**

```bash
grep -niE 'gitnexus|gstack|/browse|superpowers|\.claude/skills' CLAUDE.md AGENTS.md
```

Expected: empty (or only a benign mention you intentionally keep). Fix any leftover references.

- [ ] **Step 4: Verify the files still describe the project correctly**

```bash
head -60 AGENTS.md
```

Expected: Quick Start, Project Index, etc. intact — only the personal-tooling tail removed.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md AGENTS.md
git commit -m "docs: strip maintainer-local tooling sections (gstack, GitNexus, skill routing)"
```

---

## Phase 3 — Documentation

### Task 11: Broken-link / dead-reference sweep across root and agent docs

**Files:**
- Modify: `README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md`, `CONVENTIONS.md` (only where links are broken)

- [ ] **Step 1: Extract every relative markdown link target from the core docs**

```bash
for f in README.md AGENTS.md CLAUDE.md CONTRIBUTING.md ARCHITECTURE.md CONVENTIONS.md; do
  grep -oE '\]\(([^)]+)\)' "$f" 2>/dev/null | sed -E 's/\]\(|\)//g' \
    | grep -vE '^https?://|^#|^mailto:' | while read -r link; do
      target="${link%%#*}"
      [ -e "$target" ] || echo "$f -> MISSING: $link"
    done
done
```

Expected: ideally empty. Each `MISSING` line is a broken link to fix.

- [ ] **Step 2: Verify the per-app docs that AGENTS.md/CLAUDE.md reference all exist**

```bash
for p in apps/api/CODING_RULES.md apps/web/CODING_RULES.md apps/grafana-sync/CODING_RULES.md \
         apps/worker/README.md apps/mcp/README.md apps/perfana-report/README.md \
         packages/shared/README.md packages/config; do
  [ -e "$p" ] && echo "OK: $p" || echo "MISSING: $p"
done
```

Expected: all `OK`. For any `MISSING`: either create a minimal README for it, or fix the reference in the index table. (`packages/config` had "—" for docs in the index, so a missing README there is acceptable; just ensure the index doesn't link to a non-existent file.)

- [ ] **Step 3: Fix each broken link or missing doc**

For broken links: correct the path or remove the link. For a genuinely missing referenced README: write a short, accurate one (purpose, how to run/test, key files) following the style of `apps/worker/README.md`.

- [ ] **Step 4: Re-run Step 1 to confirm zero broken links**

Expected: empty output.

- [ ] **Step 5: Commit**

```bash
git add README.md AGENTS.md CLAUDE.md CONTRIBUTING.md ARCHITECTURE.md CONVENTIONS.md apps/ packages/
git commit -m "docs: fix broken links and missing referenced docs"
```

### Task 12: Verify docs-site builds and is publish-ready

**Files:**
- Modify: `docs-site/quartz.config.ts` (set real `baseUrl`)

- [ ] **Step 1: Install docs-site deps and build**

```bash
cd docs-site && npm ci && npx quartz build && cd ..
```

Expected: build succeeds, output written to `docs-site/public`. Fix any content errors it reports.

- [ ] **Step 2: Set the published baseUrl**

In `docs-site/quartz.config.ts`, change `baseUrl: "localhost:8888"` to the real GitHub Pages URL for the repo (e.g. `perfana.github.io/perfana` or the custom domain if one is configured).

- [ ] **Step 3: Confirm the docs deploy workflow needs no private secrets**

```bash
grep -iE 'secrets\.' .github/workflows/docs.yml
```

Expected: empty (it uses only built-in `GITHUB_TOKEN` + Pages permissions). No change needed if empty.

- [ ] **Step 4: Rebuild to confirm the config change is valid**

```bash
cd docs-site && npx quartz build && cd ..
```

Expected: build still succeeds.

- [ ] **Step 5: Commit**

```bash
git add docs-site/quartz.config.ts
git commit -m "docs: set docs-site baseUrl for GitHub Pages publication"
```

---

## Phase 4 — Agent-friendliness

### Task 13: Validate quickstart and seed data from the existing scripts

**Files:**
- Modify: `scripts/seed.ts` and/or `README.md` (only if gaps found)

- [ ] **Step 1: Read the documented quickstart and the setup script**

```bash
sed -n '/## Quick Start/,/## /p' README.md
cat scripts/setup.sh
```

Confirm the steps a fresh contributor runs are exactly `./scripts/setup.sh` then `npm run dev` (matching README), with no undocumented manual step.

- [ ] **Step 2: Confirm seed data exists and is documented**

```bash
head -40 scripts/seed.ts
grep -niE 'seed' README.md CONTRIBUTING.md package.json
```

Expected: `scripts/seed.ts` produces demo data (a test run with metrics). If there is no `npm run`/documented way to invoke it, add a `seed` script to root `package.json` and document it in README under Quick Start.

- [ ] **Step 3: If a seed npm script is missing, add it**

In root `package.json` scripts, add (adjust the runner to match how other scripts run TS, e.g. `tsx`):

```json
"seed": "tsx scripts/seed.ts"
```

And add a line to README Quick Start: `npm run seed   # load demo test run + metrics`.

- [ ] **Step 4: Commit (only if changed)**

```bash
git add package.json README.md scripts/seed.ts
git commit -m "docs: document and wire up demo seed data for first-run agents"
```

> Full clean-clone execution of the quickstart happens in Task 17.

### Task 14: Add `good first issue` candidates and an onboarding pointer

**Files:**
- Modify: `CONTRIBUTING.md`

- [ ] **Step 1: Confirm CONTRIBUTING covers run/test/lint and the pre-push gate**

```bash
grep -niE 'npm run (dev|test|lint)|preflight|pre-push|sign-off|signed-off' CONTRIBUTING.md
```

Expected: matches for dev/test/lint. If the local `npm run preflight` pre-push gate is not described, add a short "Before you push" section documenting it (and the `--no-verify` escape hatch).

- [ ] **Step 2: Add an "Architecture onboarding" pointer**

Add a short section to `CONTRIBUTING.md` linking new contributors to `ARCHITECTURE.md`, `AGENTS.md`, and the docs-site, in reading order.

- [ ] **Step 3: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: add onboarding pointers and pre-push gate to CONTRIBUTING"
```

> Actual GitHub `good first issue` labels are created on the platform after publication (Task 18), not in-repo.

---

## Phase 5 — Governance polish

### Task 15: NOTICE file, SECURITY contact, PR template, DCO

**Files:**
- Create: `NOTICE`
- Create: `.github/PULL_REQUEST_TEMPLATE.md` (if missing)
- Modify: `CONTRIBUTING.md` (DCO section), `SECURITY.md` (verify contact)

- [ ] **Step 1: Verify SECURITY.md points to a real, monitored address**

```bash
cat SECURITY.md
```

Confirm the reporting channel is a real inbox you monitor (e.g. `security@perfana.io`). Fix if it is a placeholder.

- [ ] **Step 2: Create the NOTICE file (Apache 2.0 convention)**

Create `NOTICE`:

```
Perfana
Copyright 2026 Perfana

This product includes software developed at Perfana.
Licensed under the Apache License, Version 2.0 (the "License").

This repository bundles Quartz (docs-site/), Copyright jackyzha0,
licensed under the MIT License — see docs-site/LICENSE.txt.
```

- [ ] **Step 3: Add a PR template if none exists**

```bash
ls .github/PULL_REQUEST_TEMPLATE.md 2>/dev/null || echo "MISSING"
```

If MISSING, create `.github/PULL_REQUEST_TEMPLATE.md`:

```markdown
## What

<!-- What does this PR change and why? -->

## How tested

<!-- Commands run, manual checks. -->

## Checklist

- [ ] `npm run preflight` passes locally
- [ ] Docs updated if behavior changed
- [ ] Commits signed off (`git commit -s`) per DCO
```

- [ ] **Step 4: Add a DCO sign-off section to CONTRIBUTING.md**

Add a "Developer Certificate of Origin" section explaining contributors must sign off commits with `git commit -s`, and link to https://developercertificate.org/.

- [ ] **Step 5: Commit**

```bash
git add NOTICE .github/PULL_REQUEST_TEMPLATE.md CONTRIBUTING.md SECURITY.md
git commit -m "docs: add NOTICE, PR template, DCO policy; verify security contact"
```

### Task 16: Audit CI workflows for fork-PR secret exposure

**Files:**
- Modify: `.github/workflows/*.yml` (only where secrets are exposed to untrusted PRs)

- [ ] **Step 1: List every workflow and its trigger + secret usage**

```bash
for f in .github/workflows/*.yml; do
  echo "=== $f ==="
  grep -nE 'on:|pull_request|pull_request_target|secrets\.|environment:' "$f"
done
```

- [ ] **Step 2: Flag risky combinations**

A workflow that triggers on `pull_request_target` (or `pull_request`) **and** references `secrets.*` can leak secrets to fork PRs. The likely candidates are `claude-review.yml` and `docker-build.yml`. `pr-quality-gate.yml` should run lint/type/test only (no privileged secrets). `docs.yml` uses only `GITHUB_TOKEN`.

- [ ] **Step 3: Gate each risky workflow**

For each flagged workflow, apply one of:
- Switch secret-requiring jobs to trigger only on `push` to `main` (not on fork PRs), or
- Add a GitHub **environment** with required reviewers around the secret-using job, or
- Guard with `if: github.event.pull_request.head.repo.full_name == github.repository` so fork PRs skip the secret step.

Apply the minimal change that removes fork-PR secret access while keeping the job working for trusted (same-repo) runs.

- [ ] **Step 4: Validate workflow YAML syntax**

```bash
for f in .github/workflows/*.yml; do python3 -c "import yaml,sys; yaml.safe_load(open('$f')); print('OK: $f')"; done
```

Expected: `OK` for each.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/
git commit -m "ci: prevent secret exposure to fork PRs on public repo"
```

---

## Phase 6 — Clean-clone validation

### Task 17: Dogfood the repo from a fresh clone

**Files:** none (validation); fixes loop back to earlier tasks

- [ ] **Step 1: Push the branch and create a fresh local clone of it**

```bash
git push -u origin chore/open-source-prep
cd /tmp && rm -rf perfana-cleanclone
git clone --branch chore/open-source-prep git@github.com:perfana/perfana.git perfana-cleanclone
cd perfana-cleanclone
```

Expected: clone succeeds and checks out the prep branch.

- [ ] **Step 2: Confirm no internal/vendor files came along**

```bash
echo "skills (expect 0):"; git ls-files .claude/skills | wc -l
echo "superpowers (expect 0):"; git ls-files docs/superpowers | wc -l
echo "agents (expect >0):"; git ls-files .claude/agents | wc -l
echo "auth-audit present? (expect nothing):"; git ls-files | grep -i auth-audit || echo none
```

Expected: skills 0, superpowers 0, agents >0, auth-audit none.

- [ ] **Step 3: Run the documented quickstart verbatim**

```bash
./scripts/setup.sh && npm run dev
```

Expected: services come up (api :3001, web :4001) with no private registry, no missing-secret errors, no manual fixups. Note any failure — it loops back to Task 13.

- [ ] **Step 4: Run the health/preflight gates**

```bash
npm run lint && npm run type-check && npm run test
```

Expected: pass (or only known/documented failures). Record results.

- [ ] **Step 5: Build the docs site from the clean clone**

```bash
cd docs-site && npm ci && npx quartz build && cd ..
```

Expected: succeeds.

- [ ] **Step 6: Fix-and-loop**

For any failure, fix it in the working repo (`/Users/daniel/workspace/perfana`), commit to the prep branch, push, and re-pull in the clone. Repeat Steps 3–5 until all pass. Record final status in `docs/audit/2026-05-31-cleanclone-validation.md` and commit that file.

- [ ] **Step 7: Clean up the temp clone**

```bash
cd /Users/daniel/workspace/perfana && rm -rf /tmp/perfana-cleanclone
```

---

## Phase 7 — Publication & launch

> **Point of no return is Step 4. Everything before it is reversible.**

### Task 18: Merge, publish, and harden

**Files:** none in-repo (GitHub platform operations)

- [ ] **Step 1: Final pre-flight confirmation**

Confirm: (a) Task 6 history decision recorded, (b) Task 7 rotation checklist complete, (c) Task 17 clean-clone passed. Do not proceed otherwise.

- [ ] **Step 2: Open and merge the prep PR into main**

```bash
GITHUB_TOKEN="" gh auth switch --user DanielPerfana 2>/dev/null || true
gh pr create --base main --head chore/open-source-prep \
  --title "chore: prepare repo for open-source publication" \
  --body "Secret audit, repo curation, docs accuracy, governance, clean-clone validated. See docs/audit/."
```

Review, then merge via the normal flow. If Task 6 rewrote history, instead force-push the cleaned history to `main` (no external forks exist, so this is safe) rather than a normal merge — coordinate so the rewrite is the basis of the public history.

- [ ] **Step 3: Push final state**

Ensure `origin/main` reflects the fully-prepared (and, if applicable, rewritten) history.

- [ ] **Step 4: Flip the repository to public** ⚠️ point of no return

```bash
gh repo edit perfana/perfana --visibility public --accept-visibility-change-consequences
```

Expected: repo is now public. Verify:

```bash
gh repo view perfana/perfana --json visibility
```

- [ ] **Step 5: Enable repo security features**

```bash
gh api -X PATCH repos/perfana/perfana \
  -f security_and_analysis='{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}'
```

Also via the UI/API: enable Dependabot alerts, and add branch protection on `main` (require PR + the `pr-quality-gate` check).

- [ ] **Step 6: Create a few `good first issue`s**

Using the existing `.github/ISSUE_TEMPLATE/ai-ready-issue.md`, file 3–5 well-scoped starter issues and apply the `good first issue` label.

- [ ] **Step 7: Announce**

Publish release notes / announcement per your channels.

---

## Self-review notes

- **Spec coverage:** Phase 1 → Tasks 1–7; Phase 2 → Tasks 8–10; Phase 3 → Tasks 11–12; Phase 4 → Tasks 13–14; Phase 5 → Tasks 15–16; Phase 6 → Task 17; Phase 7 → Task 18. All 7 spec phases covered.
- **`.gitnexus/`** is already untracked and gitignored — no task needed (matches spec line noting "verify gitignored").
- **`auth-audit` / `perfana-report`** strip is covered by the blanket `.claude/skills/` untrack in Task 8; absence is explicitly verified in Task 17 Step 2.
- **Credential rotation** is its own mandatory task (Task 7), independent of the scan outcome.
- **No placeholders:** every code/command step contains the actual command and expected output; doc-edit steps that depend on findings (e.g. Task 4 Step 3) are explicitly conditional, not vague.
