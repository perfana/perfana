# Pyroscope Module

Manages Pyroscope continuous-profiling instances and generates deep-link URLs for single-run and comparison flamegraph views.

## Architecture

```
PyroscopeModule
├── PyroscopeInstancesController   — CRUD for PyroscopeInstance records
├── PyroscopeUrlController         — URL generation + profiler type list
├── PyroscopeInstancesService      — Instance management + connection testing
└── PyroscopeUrlService            — Stateless URL builder
```

## Entities (from `@perfana/db`)

| Entity | Table | Purpose |
|--------|-------|---------|
| `PyroscopeInstance` | `pyroscope_instances` | Pyroscope server URL and standalone flag |

## REST Endpoints

### Instance management (`/pyroscope-instances`)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/pyroscope-instances` | List instances visible to the current user |
| `GET` | `/pyroscope-instances/:id` | Get a single instance |
| `POST` | `/pyroscope-instances` | Create an instance |
| `POST` | `/pyroscope-instances/test-connection` | Test connectivity (without saving) |
| `POST` | `/pyroscope-instances/:id/test-connection` | Test connectivity for a saved instance |
| `PATCH` | `/pyroscope-instances/:id` | Update an instance |
| `DELETE` | `/pyroscope-instances/:id` | Delete an instance |

### URL generation (`/pyroscope`)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/pyroscope/profiler-types` | List available profiler metric IDs |
| `POST` | `/pyroscope/generate-url` | Generate single-run flamegraph URL |
| `POST` | `/pyroscope/generate-compare-url` | Generate baseline-vs-current diff URL |

## URL Generation

`PyroscopeUrlService` is purely stateless — it does not read from the database. The caller provides the `pyroscopeUrl` directly in the request body.

### Standalone vs Grafana-embedded

- **Standalone** (`isStandalone: true`): Generates a direct Pyroscope UI URL. Colons in profiler metric IDs are **not** percent-encoded because Pyroscope does not decode `%3A`.
- **Grafana-embedded** (`isStandalone: false`): Generates a URL for Pyroscope embedded inside a Grafana Explore panel, using URLSearchParams for all other parameters.

## Profiler Types

Seven Java profiler metrics are pre-configured covering CPU, memory allocation, mutex, and block profilers. These map to async-profiler event types.

## Organisation Filtering

`findAll` applies organisation-scoped filtering: users see only instances belonging to their accessible organisations, plus legacy instances with a null `organization_id`.
