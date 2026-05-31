# Contributing to Perfana

Thank you for your interest in contributing to Perfana! This guide covers both human and AI agent contributors.

## Quick Start

```bash
git clone https://github.com/perfana/perfana.git
cd perfana
./scripts/setup.sh
npm run dev
```

- API: http://localhost:3001/api/docs
- Web: http://localhost:4001
- Login: perfana@example.com / perfana

## For AI Agents (Claude Code, Cursor, Codex)

1. Read `CLAUDE.md` — it's the comprehensive project guide with architecture, conventions, and patterns.
2. Look for issues labeled `good-first-issue-for-ai` — these include file paths, test expectations, and acceptance criteria.
3. Follow the coding rules in `apps/api/CODING_RULES.md` and `apps/web/CODING_RULES.md`.
4. Run `npm run test` before submitting. All tests must pass.

## Development Workflow

### Branch Naming

- `feat/description` — new features
- `fix/description` — bug fixes
- `chore/description` — maintenance, deps, tooling
- `refactor/description` — code restructuring

### Making Changes

1. Create a branch from `main`
2. Make your changes
3. Run tests: `npm run test`
4. Run type checking: `npm run type-check`
5. Run linting: `npm run lint`
6. Commit with conventional commit messages:
   - `feat: add Prometheus metrics source`
   - `fix: handle null dashboard in sync`
   - `chore: upgrade dependencies`
   - `refactor: extract pipeline registry`
7. Open a pull request against `main`

### Pull Request Requirements

- All CI checks pass (type-check + tests)
- Description explains what and why
- Tests added for new functionality
- No secrets or credentials in the diff

## Project Structure

| Directory | What's There |
|-----------|-------------|
| `apps/api/` | NestJS REST API |
| `apps/web/` | Next.js frontend |
| `apps/worker/` | BullMQ job processing, ADAPT algorithm |
| `apps/grafana-sync/` | Dashboard sync background service |
| `packages/shared/` | TypeORM entities, types, utilities |
| `packages/config/` | TypeORM configuration factory |

## Common Tasks

### Add a New API Endpoint

1. Create or extend a module in `apps/api/src/modules/`
2. Add controller, service, DTOs
3. Include Swagger decorators (`@ApiTags`, `@ApiOperation`)
4. All endpoints are auth-protected by default
5. Add tests

### Add a New Metrics Source Type

1. Read `packages/shared/src/entities/metrics-source.entity.ts` for the pattern
2. Add a new `MetricsSourceType` enum value
3. Create collection logic in `apps/worker/`
4. Add frontend display in `apps/web/`
5. Add tests at each layer

### Add a Database Migration

```bash
cd apps/api
npx typeorm migration:generate -d src/config/typeorm.config.ts src/migrations/YourMigrationName
```

## CI/CD Pipeline

### GitHub Actions Workflows

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| **PR Quality Gate** (`pr-quality-gate.yml`) | Manual / PR | Runs type-check and test suite across all apps (API, web, worker, shared, grafana-sync) |
| **Claude Code Review** (`claude-review.yml`) | PR comment with `/review` | AI-powered code review using Claude |
| **Docker Build** (`docker-build.yml`) | Push to `main`/`develop`, version tags | Builds and pushes Docker images for all services |
| **Deploy Documentation** (`docs.yml`) | Push to `main` (docs-site changes) | Builds and deploys the documentation site |

### Running Checks Locally

Before opening a PR, run these locally:

```bash
npm run type-check    # TypeScript compilation across all apps
npm run test          # Full test suite (API: Jest, Worker: Vitest, Web: Jest)
npm run lint          # ESLint across all apps
npm run build         # Production build
```

Individual app tests:

```bash
cd apps/api && npx jest              # API tests (Jest)
cd apps/worker && npx vitest run     # Worker tests (Vitest)
cd apps/web && npx jest              # Frontend tests (Jest)
cd apps/grafana-sync && npx jest     # Grafana sync tests (Jest)
```

### Docker

Build images locally:

```bash
docker compose -f docker-compose.infra.yml up -d   # Infrastructure (Postgres, Redis, Keycloak)
npm run dev                                          # Development servers
```

## Authentication

Perfana uses Keycloak for authentication. The dev environment includes a pre-configured Keycloak instance with a test user. See `CLAUDE.md` for details on the dual auth system (JWT + API keys).

## Getting Help

- Open an issue for bugs or feature requests
- Check `CLAUDE.md` for architecture and conventions
- Check existing module READMEs for module-specific patterns

## RBAC migration (in progress until 2026-08-01)

When you modify any file listed in `apps/api/.rbac-migration-allowlist.json`, migrate its `isGlobalAdmin` sites to the capabilities API as part of the same PR. The lint rule (`no-direct-is-global-admin`) blocks new sites; the allowlist tolerates existing ones. Migration patterns:

- **Bucket A (filter bypass):** use `withOrgFilter` (`apps/api/src/common/utils/with-org-filter.ts`).
- **Bucket B (guard):** use the `@RequiresCapability(...)` decorator.
- **Bucket C (mixed):** check `docs/superpowers/audits/2026-04-26-audit-decisions.md` — these aren't always migratable. If yours is in C and resists migration, leave a comment on the call site explaining why.

After migrating a site, remove its file from `apps/api/.rbac-migration-allowlist.json` (when the LAST site in that file is migrated) and update the burndown table in the audit log.

## Phase 5b RLS migration (in progress)

When you modify any file listed in `apps/api/.rls-em-migration-allowlist.json`, migrate its owned-resource repository calls to `withRequestEm()` as part of the same PR. The lint rule (`owned-resource-must-use-request-em`) blocks new un-wrapped sites in non-allowlisted files; the allowlist tolerates existing un-migrated files until they're touched.

The transformation is mechanical: `this.<ownedRepo>.<method>(...)` → `withRequestEm(this.<ownedRepo>).<method>(...)`. The wrapper participates in the per-request transaction opened by `RlsTransactionInterceptor`, which sets the GUCs that RLS policies read.

Migration references:
- [Phase 5b spec](docs/superpowers/specs/2026-05-04-rbac-phase5b-rls-design.md) §4.2
- [Phase 5b plan](docs/superpowers/plans/2026-05-04-rbac-phase5b-rls.md) — "Standard transformation pattern"
- [Phase 5b decisions](docs/superpowers/audits/2026-05-04-rls-decisions.md)

After migrating, remove the file from `apps/api/.rls-em-migration-allowlist.json` in the same PR and update the burndown table in the decisions doc.

## Before you push

Run the local pre-push gate before pushing:

```bash
npm run preflight
```

`npm run preflight` runs lint + type-check across the monorepo plus the API
RLS test suite. It is wired to `git push` via `.githooks/pre-push`, which is
installed automatically when you run `npm install` (via the `prepare` script).

If you must bypass the gate, use `git push --no-verify` — but do so sparingly,
and only when you understand why it would otherwise fail.

## Architecture onboarding

New here? Read these in order to get oriented:

1. [README.md](README.md) — what Perfana is and how to run it
2. [ARCHITECTURE.md](ARCHITECTURE.md) — system diagrams and how the apps fit together
3. [AGENTS.md](AGENTS.md) — conventions and guidance for humans and AI agents
4. The documentation site under [`docs-site/`](docs-site/) — deep reference for
   ADAPT, RBAC, schemas, and features

## Developer Certificate of Origin (DCO)

By contributing to Perfana, you certify that you wrote the contribution or
otherwise have the right to submit it under the project's license. We use the
[Developer Certificate of Origin](https://developercertificate.org/) to record
this.

Sign off your commits with the `-s` flag:

```bash
git commit -s -m "your message"
```

This appends a `Signed-off-by: Your Name <your@email>` trailer to the commit
message. All commits in a pull request must be signed off.

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
