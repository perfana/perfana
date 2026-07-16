---
tags:
  - architecture
  - tech-stack
---

# Tech Stack

## Backend

| Technology | Version | Purpose |
|---|---|---|
| **NestJS** | — | API framework (DI, decorators, modules) |
| **TypeORM** | — | ORM for PostgreSQL |
| **BullMQ** | 5.x | Redis-backed job queue |
| **IORedis** | 5.x | Redis client |
| **Socket.IO** | 4.x | WebSocket server |
| **Swagger** | — | API documentation |

## Frontend

| Technology | Version | Purpose |
|---|---|---|
| **Next.js** | 15.5.9 | React framework (App Router) |
| **React** | 18.2 | UI library |
| **MUI (Material-UI)** | 7.3 | Component library |
| **Tailwind CSS** | 3.3 | Utility-first CSS |
| **React Query** | 5.x | Server state management |
| **React Hook Form** | 7.x | Form state management |
| **Zod** | 3.x | Schema validation |
| **Recharts** | 2.x | Charting |
| **Plotly.js** | — | Advanced visualization |
| **Socket.IO Client** | 4.x | WebSocket client |
| **Keycloak.js** | 26.x | OpenID Connect client |

## Database

| Technology | Purpose |
|---|---|
| **PostgreSQL** | Primary database |
| **TimescaleDB** | Time-series extension (hypertables for metrics) |

## Infrastructure

| Technology | Purpose |
|---|---|
| **Redis** | Job queue, caching, pub/sub, rate limiting |
| **Keycloak** | Identity provider (SSO, OAuth, RBAC) |
| **Docker** | Containerization |
| **Turborepo** | Monorepo build orchestration |

## External Integrations

| Platform | Integration Type |
|---|---|
| **Grafana** | Dashboard sync, metrics extraction |
| **Dynatrace** | APM data, host metrics, service analysis |
| **Pyroscope** | Continuous profiling |
| **Tempo** | Distributed trace storage |
| **Prometheus** | Metrics source |
| **InfluxDB** | Metrics source |

## Development

| Tool | Purpose |
|---|---|
| **TypeScript** | 5.3 — Type safety |
| **Jest** | Testing framework |
| **Playwright** | E2E testing |
| **Testcontainers** | Integration testing |
| **ESLint** | Linting |
| **Prettier** | Code formatting |
| **SonarQube** | Code quality analysis |

## Related

- [[Architecture Overview]]
- [[Getting Started]] — Setup instructions
