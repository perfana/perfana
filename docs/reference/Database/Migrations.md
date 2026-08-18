---
tags:
  - database
  - operations
---

# Migrations

Database migrations are managed through TypeORM and consolidated migration scripts.

## Migration System

Perfana uses TypeORM migrations located in `packages/shared/src/database/migrations/`:

- **1 consolidated migration** (`1700000000000-ConsolidatedSchema.ts`) — consolidates legacy migration records and syncs schema state with codebase entities
- **Standalone migrations** layered on top of it, applied in timestamp order:

| Migration | Purpose |
|---|---|
| `1783409734007-AddProxyServer` | Proxy server configuration |
| `1788000000000-AddHypertableCompression` | TimescaleDB compression on `ds_metrics` |
| `1789000000000-AddComparePresetDisplayConfig` | Display config on compare presets |
| `1790000000000-BackfillTextBlockMarkdownOff` | Pins report text blocks authored before markdown rendering to `markdown: false`. Not reversible — `down()` is intentionally a no-op, since it cannot tell a backfilled `false` from one an author chose. |
| `1791000000000-AddTestRunStartTimeIndex` | Indexes `test_runs (system_under_test_id, test_environment, workload, start_time)` for the previous-run baseline lookup. Built `CONCURRENTLY` so it does not hold a write lock on a hot table, which is why it issues an explicit `COMMIT` first — a concurrent build cannot run inside a transaction. Greenfield deploys get the index from the consolidated schema instead. |

## Commands

| Command | Description |
|---|---|
| `npm run migration:generate` | Generate migration from entity changes |
| `npm run migration:run` | Apply pending migrations |
| `npm run migration:revert` | Revert last migration |
| `npm run migration:show` | Show migration status |
| `npm run db:push` | Apply Supabase migrations |
| `npm run db:reset` | Reset database (destructive) |

## Migration Files

Additional standalone migration scripts in `database/`:

| File | Purpose |
|---|---|
| `MIGRATION_CONSOLIDATION.md` | Consolidation strategy documentation |
| `PRODUCTION_DEPLOYMENT_SUMMARY.md` | Production deployment notes |
| `DEPLOYMENT_CHECKLIST.md` | Pre-deployment checklist |

## Key Migration Topics

### Ownership Columns
Added `organization_id` and `created_by` columns to all tenant-scoped tables. See [[Multi-tenancy]] for details.

### Supabase to PostgreSQL Migration
The project migrated from Supabase-managed PostgreSQL to self-hosted PostgreSQL with TypeORM. Key changes:
- Removed Supabase SDK dependency for data access
- Replaced Supabase Auth with Keycloak
- Maintained TimescaleDB extension
- Added TypeORM entity definitions for all tables

> [!warning] Destructive Commands
> `npm run db:reset` drops and recreates the entire database. Never run in production.

## Related

- [[Schema Overview]] — Current schema
- [[Getting Started]] — Initial database setup
