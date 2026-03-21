---
tags:
  - database
  - operations
---

# Migrations

Database migrations are managed through TypeORM and consolidated migration scripts.

## Migration System

Perfana uses TypeORM migrations located in `packages/shared/src/database/migrations/`:

- **3 consolidated migrations** (1700000000000-1 through 1700000000000-3)
- Consolidates legacy migration records
- Syncs schema state with codebase entities

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
