---
aliases:
  - Architecture
tags:
  - architecture
---

# Architecture Overview

Perfana is a **multi-service monorepo** for performance analysis and observability. It ingests data from multiple sources, processes it through statistical pipelines, and presents actionable insights.

## System Diagram

```
┌─────────────┐     ┌─────────────┐     ┌───────────────┐
│   Next.js   │────▶│   NestJS    │────▶│  PostgreSQL   │
│   Frontend  │◀────│   API       │◀────│  TimescaleDB  │
│  (port 3000)│     │ (port 3001) │     │               │
└─────────────┘     └──────┬──────┘     └───┬────────┬──┘
       │                   │                │        │
       │ WebSocket    ┌────▼────┐      ┌────▼────┐   │
       └──────────────│  Redis  │◀─────│ Worker  │   │
                      │         │─────▶│ (BullMQ)│   │
                      └────┬────┘      └─────────┘   │
                           │                         │
                 ┌─────────▼──────────┐  ┌───────────▼─────────┐
                 │   Perfana Report   │  │   Grafana Sync      │
                 │   (port 3003)      │  │   (port 3002)       │
                 └────────────────────┘  └─────────────────────┘
```

## Services

| Service | Technology | Port | Purpose |
|---|---|---|---|
| **API** | NestJS | 3001 | REST API, WebSocket gateway, auth |
| **Web** | Next.js 15 | 3000 | Frontend UI (App Router) |
| **Worker** | NestJS + BullMQ | — | Background job processing |
| **Grafana Sync** | NestJS | 3002 | Dashboard synchronization |
| **Perfana Report** | NestJS + Puppeteer | 3003 | PDF report generation |

## Infrastructure Requirements

| Component       | Image / Version                     | Purpose                                                |
| --------------- | ----------------------------------- | ------------------------------------------------------ |
| **PostgreSQL**  | 15                                  | Primary relational database                            |
| **TimescaleDB** | `timescale/timescaledb:latest-pg15` | Time-series extension on PostgreSQL                    |
| **Redis**       | 7 (`redis:7-alpine`)                | Job queues (BullMQ), caching, Pub/Sub                  |
| **Keycloak**    | 26.x                                | Authentication & SSO (JWT, OIDC)                       |
| **Node.js**     | 20 (min 18)                         | Runtime for all services                               |
| **Chromium**    | System package (Alpine)             | Headless rendering for PDF generation (Perfana Report) |

## Communication Patterns

### Synchronous
- **Web → API**: REST over HTTP + WebSocket (Socket.IO)
- **API → Database**: TypeORM queries (PostgreSQL)
- **API → External**: Grafana API, Dynatrace API, Pyroscope API

### Asynchronous
- **API → Worker**: Job enqueue via BullMQ (Redis)
- **API → Perfana Report**: Report generation jobs via BullMQ (Redis)
- **Worker → API**: Progress updates via Redis Pub/Sub
- **Grafana Sync → Grafana**: Scheduled bidirectional sync (every 30s, via `@nestjs/schedule`)

### Real-time
- **WebSocket**: Socket.IO for live test run updates
- **Redis Pub/Sub**: Job progress streaming to frontend
- **Polling**: Grafana Sync interval-based synchronization

## Design Principles

1. **Multi-tenancy first** — All data scoped by `organization_id` with Row-Level Security
2. **Type safety end-to-end** — Full TypeScript across all services
3. **Shared domain model** — `@perfana/shared` package for entities and types
4. **Event-driven processing** — BullMQ for decoupled job processing
5. **Statistical rigor** — ADAPT algorithm for automated regression detection

## Related

- [[Tech Stack]] — Detailed technology choices
- [[Data Flow]] — Request lifecycle and data pipelines
- [[Schema Overview]] — Database entity relationships
