# Perfana DS Worker

Node.js worker application for processing Perfana DS pipeline jobs.

## Overview

This is the Node.js implementation of the Perfana DS pipeline system, migrated from Python/FastAPI/Celery/MongoDB to Node.js/pg-boss/PostgreSQL architecture.

## Architecture

- **Pure Worker Design**: No HTTP endpoints, only job processing via pg-boss
- **PostgreSQL-centric**: All data and job coordination through PostgreSQL
- **Pipeline-based**: 7 core pipelines for performance data processing

## Pipeline Components

1. **Metrics Pipeline** - Grafana data extraction (core component)
2. **Statistics Pipeline** - Statistical aggregations
3. **ADAPT Pipeline** - Automated difference analysis
4. **Control Groups Pipeline** - Baseline comparison groups
5. **Checks Pipeline** - Performance requirement evaluation
6. **Panels Pipeline** - Dashboard panel processing
7. **Dynatrace Pipeline** - External monitoring data

## Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your database and Grafana settings
   ```

3. **Build the application**:
   ```bash
   npm run build
   ```

4. **Run in development**:
   ```bash
   npm run dev
   ```

5. **Run in production**:
   ```bash
   npm start
   ```

## Environment Configuration

Required environment variables (same as API and grafana-sync services):

- `DB_HOST` - PostgreSQL database host
- `DB_PORT` - PostgreSQL database port (default: 5432)
- `DB_USERNAME` - PostgreSQL database username
- `DB_PASSWORD` - PostgreSQL database password
- `DB_NAME` - PostgreSQL database name

Note: Grafana URL and API token are fetched from the `grafana_instances` table in the database.

See `.env.example` for complete configuration options.

## Job Processing

The worker processes jobs queued by the Perfana DS API service:

- `analyze-test` - Complete test analysis pipeline
- `metrics-collection` - Grafana metrics extraction
- `statistics-pipeline` - Statistical calculations
- `adapt-pipeline` - ADAPT analysis
- And others...

## Development Status

✅ **Completed**:
- Project structure and configuration
- Core worker application with pg-boss integration
- Database service and connection pooling
- Job handler registration system
- Pipeline orchestration framework
- Comprehensive logging and error handling
- **MetricsPipeline implementation** (core Grafana integration)
- **Complete Grafana API client** with batching, formatting, and response processing
- Basic testing framework and Docker development setup

📋 **Next Steps**:
- Implement remaining pipeline services (Statistics, ADAPT, Checks, Control Groups, etc.)
- Add comprehensive unit and integration tests
- Performance optimization and benchmarking
- Production deployment configuration

## References

- **Python Source**: `/Users/daniel/workspace/perfana-ds`
- **Migration Specs**: `../` (specification documents)
- **Architecture Plan**: `../NODEJS_WORKER_ARCHITECTURE_PLAN.md`

## Testing

```bash
npm test                    # Unit tests
npm run test:integration   # Integration tests
```

## Docker

```bash
docker build -t perfana-ds-worker .
docker run perfana-ds-worker
```