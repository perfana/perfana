# Grafana Sync — Coding Rules

Perfana-specific development standards for `apps/grafana-sync`. For general project context, see [CLAUDE.md](../../CLAUDE.md).

## What This Service Does

Background NestJS service that runs on a schedule (port 3002). It:

1. **Syncs dashboards** from configured Grafana instances into the Perfana database
2. **Auto-detects configuration** (variable mappings, panel selections) for new dashboards
3. **Sanity-checks** existing dashboard configs for staleness or drift

## Project Structure

```
apps/grafana-sync/
  src/
    main.ts                  # Bootstrap + NestJS app config
    app.module.ts            # Root module
    config/
      app.config.ts          # General app settings
      database.config.ts     # PostgreSQL connection (TypeORM)
      grafana-sync.config.ts # Sync interval, batch size, concurrency
      auto-config.config.ts  # Auto-detection confidence thresholds
      sanity-checker.config.ts
    modules/
      grafana-sync/          # Dashboard sync from Grafana API
      grafana-api/           # Grafana HTTP client wrapper
      auto-config/           # Automatic variable/panel detection
      sanity-checker/        # Dashboard config validation
```

## Key Patterns

### Shared Entities

All database entities come from `@perfana/shared`. Never duplicate entity definitions:

```typescript
import { GrafanaInstance, GrafanaDashboard } from '@perfana/shared/entities';
import { GrafanaClient } from '@perfana/shared/services/grafana';
```

### Scheduled Tasks

Use `@nestjs/schedule` decorators. Every scheduled task must:
1. Check if the feature is enabled via config before executing
2. Wrap the entire body in try-catch (never let a cron crash the service)
3. Log start, completion, and errors with the NestJS `Logger`

### Error Handling

- **Batch processing**: Use `Promise.allSettled()` — one dashboard failure must not stop the batch
- **External API calls**: Retry with exponential backoff (3 retries, 1s initial delay)
- **Grafana API errors**: Log and skip — the dashboard will be retried next cycle

### Configuration

All behavior is configurable via environment variables. Key settings:

| Variable | Purpose | Default |
|----------|---------|---------|
| `GRAFANA_SYNC_ENABLED` | Enable/disable sync | `true` |
| `GRAFANA_SYNC_INTERVAL_MINUTES` | Sync frequency | `60` |
| `GRAFANA_SYNC_BATCH_SIZE` | Dashboards per batch | `10` |
| `AUTO_CONFIG_CONFIDENCE_THRESHOLD` | Min confidence for auto-detection | `0.8` |

## Testing

- Framework: **Jest** with NestJS testing utilities
- Config: `apps/grafana-sync/jest.config.js`
- Run: `cd apps/grafana-sync && npx jest`
- Mock all external dependencies (Grafana API, database repos, config)
- Use `test/helpers.ts` for shared mock factories

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Importing entities from local files | Import from `@perfana/shared/entities` |
| Letting one dashboard failure kill the batch | Use `Promise.allSettled()` |
| Logging API keys or credentials | Log instance name/ID only, never secrets |
| Forgetting to check feature flag | Always check `GRAFANA_SYNC_ENABLED` at task start |
