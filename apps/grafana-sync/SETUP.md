# Grafana Sync Service Setup

## Quick Start

The Grafana Sync service is now integrated into the monorepo and will start automatically when you run:

```bash
npm run dev
```

This will start ALL services in the monorepo:
- **API** (port 3001)
- **Web** (port 4001)
- **Worker** (background service)
- **Grafana Sync** (port 3002)

## Starting Grafana Sync Only

To start just the Grafana Sync service:

```bash
npm run dev:grafana-sync
```

## Environment Configuration

The service requires a `.env` file in `apps/grafana-sync/`. A template file has been created for you:

**Location:** `/Users/daniel/workspace/perfana-next-gen/apps/grafana-sync/.env`

### Required Environment Variables

```bash
# Database (must match your PostgreSQL setup)
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=perfana
DB_PASSWORD=perfana
DB_NAME=perfana_native  # Same database as API/Worker

# Application
PORT=3002
NODE_ENV=development
LOG_LEVEL=info
```

### Optional Configuration

```bash
# Sync behavior
GRAFANA_SYNC_INTERVAL=30000  # 30 seconds
GRAFANA_MAX_SERIES=2
GRAFANA_PROPAGATE_TEMPLATE_UPDATES=false

# Sanity checkers (disabled by default)
TESTRUN_SANITY_CHECKER_ENABLED=false
SANITY_CHECKER_ENABLED=false
```

See `.env.example` for all available options.

## How It Works

The Grafana Sync service uses TypeORM to access the same database as the API and Worker services. All entities are imported from `@perfana/shared/entities`:

- **GrafanaInstance** - Grafana server configurations
- **GrafanaDashboard** - Dashboard metadata
- **ApplicationDashboard** - Test run dashboard associations
- **TestRun** - Test run records (for auto-config)
- **Benchmark** - Benchmark data (for sanity checking)

These entities are explicitly registered in `app.module.ts` to ensure TypeORM can find them.

## Troubleshooting

### EntityMetadataNotFoundError

**Symptom:** Service starts but fails with "No metadata for [EntityName] was found"

**Cause:** TypeORM entities are not properly registered.

**Solution:** Verify that all required entities are imported and registered in `src/app.module.ts`:

```typescript
import {
  GrafanaInstance,
  GrafanaDashboard,
  ApplicationDashboard,
  TestRun,
  Benchmark,
} from '@perfana/shared/entities';

// In TypeOrmModule.forRootAsync:
entities: [
  GrafanaInstance,
  GrafanaDashboard,
  ApplicationDashboard,
  TestRun,
  Benchmark,
],
```

### Service doesn't start with `npm run dev`

**Symptom:** Grafana sync service starts but immediately fails with database connection error.

**Cause:** The PostgreSQL database doesn't exist or isn't running.

**Solutions:**

1. **Check database is running:**
   ```bash
   psql -h localhost -U perfana -l
   ```

2. **Verify database name in .env matches the API:**
   ```bash
   # Should be perfana_native (or whatever API uses)
   cat apps/api/.env | grep DB_NAME
   cat apps/grafana-sync/.env | grep DB_NAME
   ```

3. **Create database if missing:**
   ```bash
   psql -h localhost -U perfana -c "CREATE DATABASE perfana_native;"
   ```

### Check if service is running

```bash
# Check process
ps aux | grep "nest start"

# Check port
lsof -i :3002

# Check logs
npm run dev:grafana-sync
```

### Environment variable errors

**Symptom:** Service fails to start with validation errors.

**Solution:** Ensure all required variables are set in `.env` file:
- DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_NAME
- PORT, NODE_ENV, LOG_LEVEL

## Verification

Once running, you should see:

```
[Nest] INFO [NestFactory] Starting Nest application...
[Nest] INFO [InstanceLoader] AppModule dependencies initialized
[Nest] INFO [InstanceLoader] TypeOrmModule dependencies initialized
[Nest] LOG Grafana Sync Service started on port 3002
[Nest] LOG Environment: development
[Nest] LOG Sync Interval: 30000ms
```

## Architecture

The service runs as a standalone NestJS application with scheduled tasks:

- **Sync Job:** Runs every 30 seconds (configurable)
- **Auto-Config:** Runs every minute
- **Sanity Checkers:** Run every 5 minutes / 1 hour (if enabled)

It shares the same database as the API and Worker services.

## Next Steps

To implement the actual synchronization logic:

1. Read the source perfana-grafana app to understand the sync algorithms
2. Port the dashboard sync logic to `modules/grafana-sync/` services
3. Port the auto-config finder logic to `modules/auto-config/` services
4. Port the sanity checker logic to `modules/sanity-checker/` services
5. Add integration tests with real Grafana instances

See `CODING_RULES.md` for development guidelines.
