# Changelog - Grafana Sync Service

All notable changes to the Grafana Sync service will be documented in this file.

## [0.1.0] - 2025-11-02

### Migration to Monorepo

**BREAKING CHANGES:** The Grafana Sync service has been migrated from a standalone application to a monorepo workspace.

#### Architectural Changes

1. **Workspace Integration**
   - Moved from standalone repository to `apps/grafana-sync` in the Perfana monorepo
   - Now uses workspace protocol for shared dependencies (`@perfana/shared`)
   - Integrated with Turbo build system for optimized builds and caching

2. **Shared Package Migration**
   - TypeORM entities now imported from `@perfana/shared` package
   - Database configuration centralized in shared package
   - Removed duplicate entity definitions

3. **Build System Updates**
   - Integrated with monorepo Turbo pipeline
   - TypeScript configuration updated to reference shared package
   - Build outputs to `dist/` directory with proper source maps

#### New Features

1. **Grafana Dashboard Synchronization**
   - Scheduled sync from multiple Grafana instances
   - Configurable sync intervals (default: 60 minutes)
   - Batch processing with configurable batch size (default: 10 dashboards)
   - Concurrent request limiting (default: 5 concurrent requests)
   - Automatic retry with exponential backoff (default: 3 retries)
   - Dashboard filtering by tags and folders
   - Support for both PostgreSQL and MySQL databases

2. **Auto-Configuration Detection**
   - Automatic detection of dashboard variables:
     - System-under-test ID detection
     - Workload identifier detection
     - Test environment name detection
     - Application name detection
     - Dashboard link relationship detection
   - Configurable confidence thresholds (default: 0.8)
   - Pattern-based variable detection algorithms
   - Scheduled scanning (default: 30 minutes)

3. **Sanity Checking**
   - Validates dashboard configurations against expected state
   - Detects missing dashboards from Grafana instances
   - Identifies outdated dashboard versions
   - Configurable error thresholds:
     - Max missing dashboards (default: 5)
     - Max outdated dashboards (default: 10)
   - Optional notification system (email, Slack)
   - Scheduled validation (default: 15 minutes)

4. **Health Monitoring**
   - Health check endpoints for container orchestration
   - Metrics collection for monitoring scheduled tasks
   - Structured logging with Winston
   - Component-specific log levels

#### Technical Improvements

1. **TypeScript & Type Safety**
   - Full TypeScript implementation with strict mode
   - Proper typing for all entities and DTOs
   - Path aliases for clean imports (`@perfana/shared`)

2. **Testing Infrastructure**
   - Comprehensive unit test suite with Jest
   - Test utilities in `test/helpers.ts`
   - Mock implementations for external dependencies
   - Test coverage for all core services:
     - `GrafanaSyncService`
     - `AutoConfigService`
     - `SanityCheckerService`
     - `GrafanaApiService`

3. **Configuration Management**
   - Environment-based configuration with validation
   - Joi schema validation for all config values
   - Sensible defaults for all optional settings
   - Support for multiple deployment environments

4. **Error Handling & Resilience**
   - Comprehensive error handling in scheduled tasks
   - Graceful degradation on external service failures
   - Retry logic with exponential backoff
   - Detailed error logging with context

#### Dependencies

**Core Framework:**
- NestJS 10.2.0 - Modern Node.js framework
- @nestjs/schedule 4.0.0 - Cron job scheduling
- @nestjs/typeorm 11.0.0 - Database integration
- TypeORM 0.3.27 - ORM for database access

**Database Support:**
- pg 8.11.3 - PostgreSQL driver
- mysql 2.18.1 - MySQL driver

**Utilities:**
- axios 1.6.0 - HTTP client for Grafana API
- joi 18.0.1 - Schema validation
- winston 3.17.0 - Structured logging
- lodash 4.17.21 - Utility functions
- moment 2.29.4 - Date/time handling
- semver 7.3.8 - Version comparison
- jsonpath-plus 10.3.0 - JSON path queries
- async 3.2.1 - Async utilities
- bluebird 3.7.2 - Promise utilities

**Development:**
- TypeScript 5.3.0
- Jest 29.7.0 - Testing framework
- ts-jest 29.1.0 - TypeScript support for Jest
- ESLint 8.57.1 - Code linting

#### Configuration

**Environment Variables:**

Application Settings:
- `NODE_ENV` - Environment (development/production)
- `PORT` - Application port (default: 3002)
- `LOG_LEVEL` - Logging level (debug/info/warn/error)

Database:
- `DB_TYPE` - Database type (postgres/mysql)
- `DB_HOST` - Database host
- `DB_PORT` - Database port
- `DB_USERNAME` - Database username
- `DB_PASSWORD` - Database password
- `DB_DATABASE` - Database name

Grafana Sync:
- `GRAFANA_SYNC_ENABLED` - Enable/disable sync (default: true)
- `GRAFANA_SYNC_INTERVAL_MINUTES` - Sync interval (default: 60)
- `GRAFANA_SYNC_ON_STARTUP` - Run sync on startup (default: true)
- `GRAFANA_SYNC_BATCH_SIZE` - Dashboards per batch (default: 10)
- `GRAFANA_SYNC_CONCURRENT_REQUESTS` - Max concurrent requests (default: 5)
- `GRAFANA_SYNC_MAX_RETRIES` - Max retry attempts (default: 3)
- `GRAFANA_SYNC_RETRY_DELAY_MS` - Initial retry delay (default: 1000)
- `GRAFANA_SYNC_INCLUDE_TAGS` - Dashboard tags to include
- `GRAFANA_SYNC_EXCLUDE_TAGS` - Dashboard tags to exclude

Auto-Configuration:
- `AUTO_CONFIG_ENABLED` - Enable auto-config (default: true)
- `AUTO_CONFIG_SCAN_INTERVAL_MINUTES` - Scan interval (default: 30)
- `AUTO_CONFIG_CONFIDENCE_THRESHOLD` - Minimum confidence (default: 0.8)
- `AUTO_CONFIG_DETECT_SYSTEM_ID` - Detect system IDs (default: true)
- `AUTO_CONFIG_DETECT_WORKLOAD` - Detect workloads (default: true)
- `AUTO_CONFIG_DETECT_TEST_ENVIRONMENT` - Detect environments (default: true)
- `AUTO_CONFIG_DETECT_APPLICATION` - Detect applications (default: true)

Sanity Check:
- `SANITY_CHECK_ENABLED` - Enable sanity checks (default: true)
- `SANITY_CHECK_INTERVAL_MINUTES` - Check interval (default: 15)
- `SANITY_CHECK_ON_STARTUP` - Run check on startup (default: true)
- `SANITY_CHECK_MAX_MISSING_DASHBOARDS` - Max missing threshold (default: 5)
- `SANITY_CHECK_MAX_OUTDATED_DASHBOARDS` - Max outdated threshold (default: 10)
- `SANITY_CHECK_NOTIFY_ON_ERROR` - Send notifications (default: true)

#### Migration Notes

**For Developers:**

1. **Import Path Changes:**
   ```typescript
   // OLD (standalone)
   import { GrafanaInstance } from './entities/grafana-instance.entity';

   // NEW (monorepo)
   import { GrafanaInstance } from '@perfana/shared/entities';
   ```

2. **Running the Service:**
   ```bash
   # OLD (standalone)
   npm run dev

   # NEW (monorepo - from root)
   npm run dev:grafana-sync

   # OR (from grafana-sync directory)
   cd apps/grafana-sync && npm run dev
   ```

3. **Building:**
   ```bash
   # NEW (from root, builds all deps)
   npm run build

   # OR (grafana-sync only)
   cd apps/grafana-sync && npm run build
   ```

4. **Testing:**
   ```bash
   # NEW (from root)
   npm run test --filter=@perfana/grafana-sync

   # OR (from grafana-sync directory)
   cd apps/grafana-sync && npm test
   ```

**For Deployment:**

1. The service now requires the shared package to be built first
2. Use `npm run build` from root to ensure proper build order
3. Environment variables remain the same
4. Database schema is managed centrally in `packages/shared`
5. Port default changed from 3000 to 3002 to avoid conflicts

#### Known Issues

1. **Test Warnings:** Jest shows warnings about `.js` files in the shared package - these are safe to ignore
2. **Database Migrations:** Database schema changes now managed in `packages/shared/src/entities`

#### Future Improvements

1. **Enhanced Monitoring:**
   - Prometheus metrics export
   - Grafana dashboard for service monitoring
   - Advanced alerting rules

2. **Performance Optimization:**
   - Incremental sync (only changed dashboards)
   - Parallel batch processing
   - Caching of Grafana API responses

3. **Feature Additions:**
   - Dashboard version control
   - Dashboard diff visualization
   - Automated dashboard backup/restore
   - Multi-tenant support
   - Dashboard templating engine

4. **Testing Improvements:**
   - Integration tests with real Grafana instance
   - E2E test suite
   - Performance benchmarks

---

**Full Changelog Format:**
- **Added** for new features
- **Changed** for changes in existing functionality
- **Deprecated** for soon-to-be removed features
- **Removed** for now removed features
- **Fixed** for any bug fixes
- **Security** in case of vulnerabilities
