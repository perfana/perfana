# Perfana

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE) [![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/) [![Node](https://img.shields.io/badge/node-18%2B-green.svg)](https://nodejs.org/)

Open-source performance analysis platform. Ingest load test results, collect metrics from Grafana/Dynatrace/Prometheus, detect regressions with the ADAPT algorithm, and track SLO compliance — all in one place.

## Features

- **Automated regression detection** — ADAPT algorithm detects anomalies in metrics across test runs from different sources
- **Apdex scoring** — Application performance index for transaction-level performance scoring
- **SLO compliance** — Define and track service level objectives with configurable thresholds
- **Run comparison** — Time series comparison between test runs
- **Multi-source metrics** — Grafana, Dynatrace, InfluxDB, Prometheus, and more
- **Load test support** — Gatling, JMeter, k6, Neoload
- **Distributed tracing** — Tempo and Jaeger integration
- **Profiling** — Pyroscope integration for continuous profiling
- **Automated report generation** — Generate performance reports automatically
- **CI quality gate** — Integrate with CI pipelines to gate releases on performance
- **Dashboard library** — 21 pre-built Grafana dashboards for common scenarios
- **Automated dashboard configuration** — Configure Grafana dashboards from profiles and metric discovery
- **MCP server** — Query test runs, metrics, and analysis results from AI agents
- **Multi-tenant** — Organizations and teams with role-based access

## Quick Start

```bash
git clone https://github.com/perfana/perfana.git
cd perfana
./scripts/setup.sh    # installs deps, starts Postgres + Redis + Keycloak
npm run dev
```

| Service  | URL |
|----------|-----|
| Web UI   | http://localhost:4001 |
| API Docs | http://localhost:3001/api/docs |
| Keycloak | http://localhost:8080 (admin / admin) |

Login: `perfana@example.com` / `perfana`

### Prerequisites

- Node.js 18+
- Docker & Docker Compose

### Manual Setup

```bash
npm install
docker compose -f docker-compose.infra.yml up -d
# Wait for Postgres + Keycloak to be healthy, then:
npm run seed   # load demo test run + metrics (setup.sh runs this automatically)
npm run dev
```

## Architecture

```
┌─────────────┐  ┌──────────────┐  ┌────────────────┐  ┌──────────┐
│  Next.js    │  │  NestJS API  │  │  Grafana Sync  │  │  Worker  │
│  Frontend   │──│  REST API    │  │  Background    │  │  BullMQ  │
│  :4001      │  │  :3001       │  │  :3002         │  │          │
└─────────────┘  └──────┬───────┘  └───────┬────────┘  └────┬─────┘
                        │                  │               │
                 ┌──────┴──────────────────┴───────────────┴──┐
                 │            PostgreSQL + TimescaleDB         │
                 │            Redis · Keycloak                 │
                 └────────────────────────────────────────────┘
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed system diagrams and data flow.

| App | Path | Description |
|-----|------|-------------|
| API | `apps/api/` | NestJS REST API with 36+ modules |
| Web | `apps/web/` | Next.js frontend (App Router, MUI + Tailwind) |
| Worker | `apps/worker/` | BullMQ pipelines, ADAPT algorithm |
| Grafana Sync | `apps/grafana-sync/` | Dashboard synchronization service |
| Shared | `packages/shared/` | TypeORM entities, types, utilities |

## Development

```bash
npm run dev           # Start all services
npm run dev:api       # API only (port 3001)
npm run dev:web       # Frontend only (port 4001)
npm run test          # Run all tests
npm run type-check    # TypeScript checking
npm run lint          # Linting
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow, branch naming, and PR guidelines.

AI agents: read [CLAUDE.md](CLAUDE.md) for comprehensive project context. Issues labeled `good-first-issue-for-ai` include file paths and acceptance criteria.

## Documentation

- [CLAUDE.md](CLAUDE.md) — Complete project guide (architecture, auth, conventions)
- [ARCHITECTURE.md](ARCHITECTURE.md) — System diagrams and data flow
- [CONVENTIONS.md](CONVENTIONS.md) — Code patterns and naming rules
- [apps/api/CODING_RULES.md](apps/api/CODING_RULES.md) — Backend standards
- [apps/web/CODING_RULES.md](apps/web/CODING_RULES.md) — Frontend standards

## License

[Apache License 2.0](LICENSE)
