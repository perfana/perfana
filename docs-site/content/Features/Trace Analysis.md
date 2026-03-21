---
aliases:
  - Distributed Tracing
  - Traces
tags:
  - feature
---

# Trace Analysis

Perfana provides distributed trace analysis capabilities, integrating with Grafana Tempo for trace storage and querying.

## Architecture

```
Tempo (Trace Storage)
  │
  ▼
TraceQueryService ──▶ Fetch traces by service/operation/duration
  │
  ▼
TraceAnalyzerService ──▶ Analyze trace data
  │
  ├── HierarchyBuilderService ──▶ Build span tree
  └── SpanAggregationService ──▶ Aggregate span metrics
  │
  ▼
TraceAnalysisService (facade) ──▶ API endpoints
```

## Services

| Service | Responsibility |
|---|---|
| `TraceAnalysisService` | Main facade for trace operations |
| `TraceAnalyzerService` | Core analysis logic |
| `TraceQueryService` | Trace data retrieval from Tempo |
| `HierarchyBuilderService` | Constructs span parent-child hierarchy |
| `SpanAggregationService` | Aggregates metrics across spans |

## Capabilities

- **Trace search** — Find traces by service name, operation, duration range
- **Span hierarchy** — Visualize parent-child span relationships
- **Span aggregation** — Aggregate timing across multiple traces
- **Service topology** — Understand service dependencies
- **Latency analysis** — Identify slow spans and bottlenecks

## Frontend Integration

Trace analysis appears in the **Root Cause Analysis** tab alongside:
- Dynatrace service/host analysis
- Pyroscope profiling
- AWR reports
- Deep links to external tools

## Configuration

Tracing instances configured at `/integrations`:
- `TracingInstance` entity stores connection details
- Supports Tempo backend
- Service/span configuration via `TracingServices` module

## Related

- [[Integrations]] — All integration types
- [[API Modules]] — trace-analysis module
