# @perfana/shared

> Back to [CLAUDE.md](../../CLAUDE.md) for project-wide context.

Shared TypeScript types, utilities, and database migrations for the Perfana platform.

## Overview

This package contains code shared across all Perfana services (API, Worker, Grafana Sync).

### Contents

- **Database**: TypeORM entities, migrations, and configuration
- **Types**: Shared TypeScript interfaces and types
- **Utilities**: Common utility functions
- **Config**: Shared configuration helpers

## Database Migrations

### Migration Strategy (Post-Consolidation)

**Production databases**: Continue with existing 15-migration history (unchanged)
**Fresh installs**: Use new consolidated 2-migration approach

This consolidation is **forward-only** - it simplifies new installations without affecting existing production databases.

### Running Migrations

From the API service directory:

```bash
cd apps/api
npm run migrate

# Or directly
npx ts-node -r tsconfig-paths/register run-migrations.ts
```

### Migration Status

Check which migrations have been applied:

```bash
psql -U perfana -d perfana -c "SELECT * FROM migrations ORDER BY timestamp;"
```

Expected result after consolidation:
```
 id |   timestamp   |                 name
----+---------------+--------------------------------------
  1 | 1700000000000 | ConsolidatedSchema1700000000000
  2 | 1774000000000 | CleanupMigrationHistory1774000000000
```

### Creating New Migrations

1. **Generate timestamp** (migrations must be timestamped after 1774000000000):
```bash
date +%s000
```

2. **Create migration file**:
```bash
npx typeorm migration:create packages/shared/src/database/migrations/[TIMESTAMP]-YourMigrationName
```

3. **Export migration** in `/packages/shared/src/database/index.ts`:
```typescript
export { YourMigrationName[TIMESTAMP] } from './migrations/[TIMESTAMP]-YourMigrationName';
```

⚠️ **CRITICAL**: Forgetting to export the migration will prevent it from running!

4. **Build package**:
```bash
cd packages/shared
npm run build
```

5. **Test migration**:
```bash
cd apps/api
DB_NAME=perfana_test npx ts-node -r tsconfig-paths/register run-migrations.ts
```

### Migration Guidelines

- Use descriptive names (e.g., `AddUserPreferencesTable`)
- Include both `up()` and `down()` methods
- Test migrations on a copy of production data
- Never modify existing migrations that have been deployed
- Always backup database before running migrations in production

## Database Configuration

The shared package provides TypeORM configuration used by all services:

- **API Service**: Standard connection pool (50 connections)
- **Worker Service**: Larger connection pool (100 connections)
- **Grafana Sync**: Uses API configuration

Configuration location: `/packages/shared/src/config/typeorm.config.ts`

## Migration History

See [Migration Consolidation Documentation](../../database/MIGRATION_CONSOLIDATION.md) for details on the schema consolidation performed on 2026-02-03.

### Key Points

- Migrations 1-11 were consolidated into a single schema
- Only 2 migrations exist now: ConsolidatedSchema and CleanupMigrationHistory
- Migrations 9-11 were never exported in previous versions (bug fixed)
- Complete schema includes 65+ tables with TimescaleDB support

## Development

### Building

```bash
npm run build
```

### Type Checking

```bash
npm run type-check
```

### Linting

```bash
npm run lint
```

## References

- [Migration Consolidation](../../database/MIGRATION_CONSOLIDATION.md)
- [Deployment Checklist](../../database/DEPLOYMENT_CHECKLIST.md)
- [TypeORM Documentation](https://typeorm.io/)
- [TypeORM Migrations](https://typeorm.io/migrations)
