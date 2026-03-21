---
aliases:
  - External Integrations
  - Data Sources
tags:
  - feature
  - integrations
---

# Integrations

Perfana integrates with multiple observability platforms to collect performance data.

## Grafana

Primary metrics source. Full bidirectional sync via [[Grafana Sync Overview]].

### Capabilities
- **Dashboard sync** — Automatic discovery and sync every 30 seconds
- **Metrics extraction** — Pull time-series data from Grafana data sources
- **Variable discovery** — Auto-detect dashboard variables
- **Template propagation** — Push template changes across dashboards

### Supported Data Sources (via Grafana)
- **Prometheus** — Metric queries
- **InfluxDB** — Time-series queries
- **Any Grafana data source** — Generic query support

### Configuration
```
Settings → Integrations → Grafana
  ├── URL: Grafana server URL
  ├── API Key: Grafana API token
  └── Test Connection: Verify connectivity
```

## Dynatrace

APM integration for service and host monitoring.

### Capabilities
- **Service entities** — Service-level metrics and topology
- **Host entities** — Host CPU, memory, disk, network metrics
- **Problem detection** — Health issues and severity tracking
- **Performance graphs** — Time-series visualization (CPU, memory, disk, network)

### Frontend Components
- `DynatraceCard` — Dual-tab interface (Services | Hosts)
- `HostDetailPanel` — Host properties, problems, performance graphs
- `HostPerformanceGraphs` — 2x2 Plotly time-series graphs (CPU, Memory, Disk, Network)

### Data Flow
```
DynatraceCard (filters entities)
  ├── ServicesTabContent
  │   └── Per-service detail panels
  └── HostsTabContent
      └── HostDetailPanel (per host)
          ├── HostPropertiesSection (system info)
          ├── HostProblemsSection (health issues)
          └── HostPerformanceGraphs (Plotly charts)
```

### API Functions
- `fetchHostProperties(hostId, configId)` — Host system info
- `fetchHostMetrics(hostId, start, end, configId)` — Performance metrics
- `fetchHostProblems(hostId, start, end, configId)` — Health issues
- `storeHostProperties(hostId, testRunId, displayName, props)` — Auto-store to test_run_configs

## Pyroscope

Continuous profiling integration.

### Capabilities
- **CPU profiling** — Flamegraphs and CPU usage analysis
- **Memory profiling** — Heap allocation analysis
- **Profile comparison** — Diff between test runs

### Configuration
Configured per system under test with Pyroscope instance URL and application tags.

## Tempo (Grafana)

Distributed trace storage and querying.

### Capabilities
- **Trace querying** — Search traces by service, operation, duration
- **Span analysis** — Detailed span hierarchy and timing
- **Service topology** — Service dependency visualization

## Trace Analysis

Built on top of Tempo/tracing data:

### Services
| Service | Purpose |
|---|---|
| `TraceAnalysisService` | Main analysis facade |
| `TraceAnalyzerService` | Analysis logic |
| `TraceQueryService` | Trace data queries |
| `HierarchyBuilderService` | Span hierarchy construction |
| `SpanAggregationService` | Span metric aggregation |

## Deep Links

Configurable deep links to external tools from test run context:

- Links to Grafana dashboards with time-range parameters
- Links to Dynatrace entities
- Links to Elastic/Kibana logs
- Template-based URL generation with variable substitution

## Related

- [[Grafana Sync Overview]] — Dashboard sync service
- [[Data Flow]] — Data collection pipeline
- [[Worker Overview]] — Metric collection pipelines
