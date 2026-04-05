# Grafana Sync Service

> Back to [CLAUDE.md](../../CLAUDE.md) for project-wide context.

A NestJS-based background service that synchronizes Grafana dashboards with the Perfana platform, provides automatic configuration detection, and performs sanity checks.

## Overview

The Grafana Sync service is a standalone NestJS application that runs scheduled tasks to:

1. **Dashboard Synchronization** - Periodically fetch and sync Grafana dashboards from configured instances
2. **Auto-Configuration Detection** - Automatically detect and configure dashboard variables (system-under-test, workload, test-environment, etc.)
3. **Sanity Checking** - Validate dashboard configurations and detect issues

## Key Features

### Dashboard Synchronization
- Scheduled sync from multiple Grafana instances
- Configurable sync intervals and batch processing
- Retry logic with exponential backoff
- Dashboard filtering by tags and folders
- Support for both PostgreSQL and MySQL databases

### Auto-Configuration Detection
- Automatic detection of dashboard variables:
  - System-under-test ID
  - Workload identifiers
  - Test environment names
  - Application names
  - Dashboard link relationships
- Configurable confidence thresholds
- Pattern-based variable detection

### Sanity Checker
- Validates dashboard configurations
- Detects missing or outdated dashboards
- Identifies configuration errors
- Optional notifications (email, Slack)
- Configurable error thresholds

## Technology Stack

- **Framework**: NestJS (TypeScript)
- **Database**: TypeORM (PostgreSQL/MySQL)
- **Scheduling**: @nestjs/schedule
- **HTTP Client**: Axios
- **Validation**: Joi
- **Logging**: Winston
- **Utilities**: Lodash, Moment, JSONPath, Semver

## Installation

```bash
# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Edit .env with your configuration
nano .env
```

## Configuration

### Environment Variables

#### Application Settings
- `NODE_ENV` - Environment (development/production)
- `PORT` - Application port (default: 3002)
- `LOG_LEVEL` - Logging level (debug/info/warn/error)

#### Database Configuration
- `DB_TYPE` - Database type (postgres/mysql)
- `DB_HOST` - Database host
- `DB_PORT` - Database port
- `DB_USERNAME` - Database username
- `DB_PASSWORD` - Database password
- `DB_DATABASE` - Database name

#### Grafana Sync Settings
- `GRAFANA_SYNC_ENABLED` - Enable/disable sync (default: true)
- `GRAFANA_SYNC_INTERVAL_MINUTES` - Sync interval (default: 60)
- `GRAFANA_SYNC_ON_STARTUP` - Run sync on startup (default: true)
- `GRAFANA_SYNC_BATCH_SIZE` - Dashboards per batch (default: 10)
- `GRAFANA_SYNC_CONCURRENT_REQUESTS` - Max concurrent requests (default: 5)
- `GRAFANA_SYNC_MAX_RETRIES` - Max retry attempts (default: 3)
- `GRAFANA_SYNC_RETRY_DELAY_MS` - Initial retry delay (default: 1000)
- `GRAFANA_SYNC_INCLUDE_TAGS` - Dashboard tags to include (comma-separated)
- `GRAFANA_SYNC_EXCLUDE_TAGS` - Dashboard tags to exclude (comma-separated)

#### Auto-Configuration Settings
- `AUTO_CONFIG_ENABLED` - Enable auto-config (default: true)
- `AUTO_CONFIG_SCAN_INTERVAL_MINUTES` - Scan interval (default: 30)
- `AUTO_CONFIG_CONFIDENCE_THRESHOLD` - Minimum confidence (default: 0.8)
- `AUTO_CONFIG_DETECT_SYSTEM_ID` - Detect system IDs (default: true)
- `AUTO_CONFIG_DETECT_WORKLOAD` - Detect workloads (default: true)
- `AUTO_CONFIG_DETECT_TEST_ENVIRONMENT` - Detect environments (default: true)
- `AUTO_CONFIG_DETECT_APPLICATION` - Detect applications (default: true)

#### Sanity Check Settings
- `SANITY_CHECK_ENABLED` - Enable sanity checks (default: true)
- `SANITY_CHECK_INTERVAL_MINUTES` - Check interval (default: 15)
- `SANITY_CHECK_ON_STARTUP` - Run check on startup (default: true)
- `SANITY_CHECK_MAX_MISSING_DASHBOARDS` - Max missing dashboards threshold (default: 5)
- `SANITY_CHECK_MAX_OUTDATED_DASHBOARDS` - Max outdated dashboards threshold (default: 10)
- `SANITY_CHECK_NOTIFY_ON_ERROR` - Send notifications (default: true)

See `.env.example` for complete configuration options.

## Development

```bash
# Start in development mode (with watch)
npm run dev

# Run type checking
npm run type-check

# Run linting
npm run lint

# Run tests
npm run test

# Run tests in watch mode
npm run test:watch

# Generate test coverage
npm run test:cov
```

## Production

```bash
# Build the application
npm run build

# Start in production mode
npm run start:prod
```

## Architecture

### Module Structure
```
src/
├── main.ts                 # Application entry point
├── app.module.ts           # Root module
├── config/                 # Configuration modules
├── grafana-sync/           # Dashboard sync module
│   ├── grafana-sync.service.ts
│   └── grafana-sync.module.ts
├── auto-config/            # Auto-configuration module
│   ├── auto-config.service.ts
│   └── auto-config.module.ts
├── sanity-checker/         # Sanity check module
│   ├── sanity-checker.service.ts
│   └── sanity-checker.module.ts
├── shared/                 # Shared utilities
│   ├── database/
│   ├── logging/
│   └── utils/
└── entities/               # TypeORM entities
```

### Scheduled Tasks

1. **Dashboard Sync** - Runs every N minutes (configurable)
   - Fetches dashboards from Grafana instances
   - Updates database with latest dashboard data
   - Handles errors and retries

2. **Auto-Configuration** - Runs every N minutes (configurable)
   - Scans dashboards for variable patterns
   - Detects and applies configurations
   - Updates dashboard metadata

3. **Sanity Check** - Runs every N minutes (configurable)
   - Validates dashboard configurations
   - Checks for missing/outdated dashboards
   - Reports issues and sends notifications

## Logging

Logs are written to:
- Console (stdout/stderr)
- File system (`./logs/` directory)
- Configurable log rotation and retention

Log levels:
- `debug` - Detailed debugging information
- `info` - General informational messages
- `warn` - Warning messages
- `error` - Error messages

Component-specific log levels can be configured via environment variables.

## Monitoring

The service exposes:
- Health check endpoint
- Metrics endpoint (if enabled)
- Scheduled task status

## Database Schema

The service uses the shared Perfana database schema:
- `grafana_instance` - Grafana instance configurations
- `grafana_dashboard` - Dashboard metadata
- `grafana_application_config` - Auto-detected configurations
- `test_run` - Test run data for linking

## Troubleshooting

### Common Issues

1. **Database Connection Errors**
   - Verify DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD are correct
   - Ensure database exists and is accessible
   - Check firewall rules

2. **Sync Failures**
   - Verify Grafana instance URLs are accessible
   - Check API keys/credentials
   - Review GRAFANA_SYNC_* configuration

3. **High Memory Usage**
   - Reduce GRAFANA_SYNC_BATCH_SIZE
   - Reduce GRAFANA_SYNC_CONCURRENT_REQUESTS
   - Adjust MAX_MEMORY_MB limit

4. **Missing Dashboards**
   - Check GRAFANA_SYNC_INCLUDE_TAGS and EXCLUDE_TAGS
   - Verify dashboard folder filters
   - Review sync logs for errors

## Contributing

Follow the Perfana backend coding standards (see `/apps/api/CODING_RULES.md`):
- Use TypeScript with strict typing
- Follow NestJS conventions
- Write unit tests for new features
- Use dependency injection
- Document complex logic

## License

Apache-2.0
