# Claude Code Skills

This directory contains Claude Code skills — reusable prompt-driven workflows that Claude can invoke via `/skill-name`.

## Skill Layout

Skills are organized into two categories:

### Global Skills (gstack — symlinked)

27 skills from [gstack](https://github.com/gstack-ai/gstack), a general-purpose AI developer toolkit. These are installed globally via `gstack setup` and symlinked into this directory. They provide capabilities like:

- **QA & Testing**: `/qa`, `/qa-only`, `/browse`, `/benchmark`, `/canary`
- **Code Review**: `/review`, `/codex`
- **Shipping**: `/ship`, `/land-and-deploy`, `/setup-deploy`
- **Planning**: `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/autoplan`
- **Design**: `/design-consultation`, `/design-review`
- **Safety**: `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/cso`
- **Other**: `/investigate`, `/office-hours`, `/retro`, `/document-release`, `/gstack-upgrade`

These are **not** checked into this repo — they are managed by gstack and symlinked at `.claude/skills/<name> -> gstack/<name>`. To reinstall: `cd .claude/skills/gstack && ./setup`.

### Repo-Local Skills (checked in)

| Skill | Directory | Purpose |
|-------|-----------|---------|
| `auth-audit` | `auth-audit/` | Perfana-specific authentication and authorization audit — traces JWT/API key flows, verifies RBAC enforcement, checks multi-tenant isolation |
| `perfana-report` | `perfana-report/` | Generates comprehensive performance test reports from Perfana data. Fetches ADAPT regressions, classifies them, investigates root causes across connected data sources (Tempo, Pyroscope, Dynatrace), and writes Markdown reports to Obsidian or local files |

## Adding a New Repo-Local Skill

1. Create a directory: `.claude/skills/<skill-name>/`
2. Add `SKILL.md` with frontmatter (`name`, `description`, `context`) and step-by-step instructions
3. Optionally add `README.md` for human documentation and `references/` for supporting docs
4. Claude Code auto-discovers skills in `.claude/skills/` — no registration needed
