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

## Authentication

Perfana uses Keycloak for authentication. The dev environment includes a pre-configured Keycloak instance with a test user. See `CLAUDE.md` for details on the dual auth system (JWT + API keys).

## Getting Help

- Open an issue for bugs or feature requests
- Check `CLAUDE.md` for architecture and conventions
- Check existing module READMEs for module-specific patterns

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
