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
  ├── URL (client_url, required): address the browser loads panels from
  ├── Server URL (server_url, optional): address api/worker call, when it differs
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

### Configuration
```
Settings → Integrations → Dynatrace
  ├── Server URL (host, required): address api/worker call the Dynatrace API from
  │     read-only after creation — the API has never accepted a change to it
  ├── Client URL (client_url, optional): address the browser opens deep links at,
  │     when it differs (reverse proxy, split DNS). Managed deploys include the
  │     environment path (…/e/<env-id>). Falls back to the server URL when unset.
  ├── API Token: Dynatrace API token with read scopes
  ├── Deployment type: SaaS or Managed
  └── Request-attribute mapping: test-run id + request name attributes
```

> Note the polarity is the **opposite** of Grafana, on purpose. Grafana's required URL is the client one (Perfana renders Grafana panels in the browser); Dynatrace's required URL is the server one (every Dynatrace API call is made server-side). See `CLAUDE.md` → "Client URL vs server URL".

Creating a Dynatrace configuration requires `integration:dynatrace:create` **in the target organization**. A request may name an `organizationId`; the service checks membership before writing, and defaults to the caller's own organization when the body names none. RLS does not backstop this — see [[RBAC]].

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

Every Dynatrace deep link resolves its base address through `deepLinkBaseUrl(config)` in
`apps/web/app/test-runs/[id]/components/dynatrace/utils/dynatrace-formatters.ts`, which returns
`clientUrl || host`. Build a new Dynatrace link from that helper, not from `config.host` — reading
`host` directly is what sent links to an unreachable address on proxied and split-DNS deploys
before v0.2.92.0.

For SaaS tenants, `createPlatformUrl` maps `https://<tenant>[.live].dynatrace.com` to its
`<tenant>.apps.dynatrace.com` platform twin. It rewrites **only** that single-label tenant shape;
a Managed host, a proxy client URL, or a URL already naming the platform host is returned
unchanged.

## Related

- [[Grafana Sync Overview]] — Dashboard sync service
- [[Data Flow]] — Data collection pipeline
- [[Worker Overview]] — Metric collection pipelines
