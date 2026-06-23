# Branch protection rulesets

Repository rulesets that protect `main` once the repo is open-sourced.

## What's here

| File | Purpose |
|------|---------|
| `main-branch-protection.json` | The "Protect main" ruleset definition |
| `apply-rulesets.sh` | Idempotent script to create/update the ruleset via `gh` |

## When to run

> ⚠️ **Rulesets require the repo to be PUBLIC** (or a GitHub Pro/Team/Enterprise
> plan). `perfana/perfana` is private as of this writing, so the API returns
> `403` until it's made public. Run the script the moment the repo goes public.

```bash
# After making perfana/perfana public:
.github/rulesets/apply-rulesets.sh
```

## What "Protect main" enforces

- **Pull request required** — no direct pushes to `main`
  - 1 approving review
  - stale approvals dismissed when new commits are pushed
  - all review conversations must be resolved before merge
- **No force-pushes** (`non_fast_forward`)
- **No branch deletion** (`deletion`)
- **Admin bypass allowed** — repository admins (role id `5`) can bypass in
  emergencies (`bypass_mode: always`)

## Not yet included: required status checks

No workflow currently triggers on `pull_request` — `pr-quality-gate.yml` is
`workflow_dispatch`-only and `docker-build.yml` / `docs.yml` run on `push`.
Requiring a status check that never runs on a PR would block every merge, so
**status checks are intentionally omitted**.

To add them later: give `pr-quality-gate.yml` (or a lighter lint/type-check
job) a `pull_request:` trigger, then add a `required_status_checks` rule to
`main-branch-protection.json`:

```json
{
  "type": "required_status_checks",
  "parameters": {
    "strict_required_status_checks_policy": true,
    "required_status_checks": [
      { "context": "Quality Gate ✓" }
    ]
  }
}
```

Re-run `apply-rulesets.sh` to push the update (it updates in place).

## Troubleshooting

If `gh` reports `HTTP 401: Bad credentials`, a stale `GITHUB_TOKEN` env var is
overriding your CLI login. Prefix the command:

```bash
GITHUB_TOKEN="" .github/rulesets/apply-rulesets.sh
```
