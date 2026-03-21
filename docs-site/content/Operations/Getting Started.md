---
aliases:
  - Setup
  - Development Setup
tags:
  - operations
  - getting-started
---

# Getting Started

Development setup guide for Perfana.

## Prerequisites

- **Node.js** 18+
- **npm** 8+
- **Docker** (for PostgreSQL, Redis, Keycloak)
- **Redis** (for BullMQ job queue)

## Installation

### 1. Clone the repository

```bash
git clone <repository-url>
cd perfana-next-gen
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

```bash
cp .env.example .env.local
# Edit .env.local with your configuration
```

See [[Environment Variables]] for all available configuration options.

### 4. Start infrastructure

Start PostgreSQL (with TimescaleDB), Redis, and Keycloak:

```bash
docker-compose up -d
```

### 5. Apply database migrations

```bash
npm run migration:run
```

### 6. Start development servers

```bash
npm run dev      # API + Web only
npm run dev:all  # All services including grafana-sync and report
```

## Service URLs

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| API | http://localhost:3001 |
| API Docs (Swagger) | http://localhost:3001/api/docs |
| Grafana Sync | http://localhost:3002 |
| Perfana Report | http://localhost:3003 |

## Development Commands

### General

| Command | Description |
|---|---|
| `npm run dev` | Start API + Web |
| `npm run dev:all` | Start all services |
| `npm run dev:api` | Start API only |
| `npm run dev:web` | Start Web only |
| `npm run build` | Build all applications |
| `npm run test` | Run all tests |
| `npm run lint` | Run linting |
| `npm run type-check` | TypeScript checks |
| `npm run clean` | Clean build artifacts |

### Database

| Command | Description |
|---|---|
| `npm run migration:generate` | Generate migration from entity changes |
| `npm run migration:run` | Apply pending migrations |
| `npm run migration:revert` | Revert last migration |
| `npm run migration:show` | Show migration status |
| `npm run db:reset` | Reset database (destructive!) |

### Individual Services

| Command | Description |
|---|---|
| `npm run dev:api` | Start API only |
| `npm run dev:web` | Start Web only |
| `npm run dev:grafana-sync` | Start Grafana Sync only |
| `npm run dev:perfana-report` | Start Report service only |

### Quality

| Command | Description |
|---|---|
| `npm run test:coverage` | Run tests with coverage |
| `npm run sonar:scan` | Run SonarQube analysis |
| `npm run sonar:baseline` | Full coverage + SonarQube scan |

## Monorepo Structure

Managed with **Turborepo** and **npm workspaces**:

```
perfana-next-gen/
├── apps/
│   ├── api/              # @perfana/api
│   ├── web/              # @perfana/web
│   ├── worker/           # @perfana/worker
│   ├── grafana-sync/     # @perfana/grafana-sync
│   └── perfana-report/   # @perfana/perfana-report
├── packages/
│   ├── shared/           # @perfana/shared
│   └── config/           # @perfana/config
└── turbo.json            # Turborepo pipeline config
```

## Related

- [[Environment Variables]] — Configuration reference
- [[Docker]] — Container builds
- [[Architecture Overview]] — System architecture
