---
title: Perfana Documentation
aliases:
  - Home
  - Dashboard
tags:
  - home
  - navigation
---

# Perfana Documentation

Modern performance analysis and observability platform built with TypeScript, NestJS, Next.js, and PostgreSQL.

## TL;DR — What is Perfana?

Perfana collects metrics from performance tests and compares them against historical baselines. It pulls data from observability tools (Grafana, Dynatrace, Jaeger), runs statistical analysis via the ADAPT algorithm, and flags regressions or improvements automatically. Teams use the results to decide whether a release meets performance expectations.

## Quick Navigation

### Architecture
- [[Architecture Overview]] — System architecture and design principles
- [[Tech Stack]] — Technologies, frameworks, and libraries
- [[Data Flow]] — How data moves through the system
- [[Capabilities and RBAC]] — Capability model, role mapping, and where RLS does and does not backstop it

### Applications
- [[API Overview]] — NestJS backend API (port 3001)
- [[Web Overview]] — Next.js frontend (port 3000)
- [[Worker Overview]] — Background job processing (BullMQ)
- [[Grafana Sync Overview]] — Dashboard synchronization service (port 3002)
- [[Perfana Report Overview]] — PDF report generation (port 3003)

### Database
- [[Schema Overview]] — Core entities and relationships
- [[TimescaleDB]] — Time-series data storage
- [[Migrations]] — Database migration workflow

### Features
- [[ADAPT Algorithm]] — Automated regression detection
- [[Real-time Monitoring]] — Live test run monitoring via WebSocket
- [[RBAC]] — Role-based access control (Keycloak)
- [[Multi-tenancy]] — Organizations and teams
- [[Integrations]] — Grafana, Dynatrace, Pyroscope, Tempo
- [[Templates]] — Standardized checks, reports, and dashboards
- [[AWR Reports]] — Oracle AWR report analysis
- [[Reports in CI-CD]] — Generating and downloading HTML reports from a pipeline
- [[Trace Analysis]] — Distributed trace analysis

### Operations
- [[Getting Started]] — Development setup guide
- [[Docker]] — Container builds and deployment
- [[CI-CD]] — Continuous integration and deployment
- [[Environment Variables]] — Configuration reference

### Packages
- [[Shared Package]] — Shared types, entities, and utilities
- [[Config Package]] — Shared TypeScript configuration

## Repository

> [!info] Source Code
> Monorepo at `perfana-next-gen` managed with **Turborepo** and **npm workspaces**.
>
> ```
> perfana-next-gen/
> ├── apps/
> │   ├── api/              # NestJS backend
> │   ├── web/              # Next.js frontend
> │   ├── worker/           # BullMQ job processor
> │   ├── grafana-sync/     # Dashboard sync service
> │   └── perfana-report/   # PDF report generator
> ├── packages/
> │   ├── shared/           # Shared entities, types, utils
> │   └── config/           # Shared TS configuration
> └── database/             # Migration scripts
> ```

## Key Commands

| Command | Description |
|---|---|
| `npm run dev` | Start API + Web dev servers |
| `npm run dev:all` | Start all services including grafana-sync and report |
| `npm run build` | Build all applications |
| `npm run test` | Run all tests |
| `npm run lint` | Run linting |
| `npm run type-check` | TypeScript checks |
