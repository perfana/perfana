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
  ├── API Key: Grafana API token (service account token) — preferred
  ├── Username / Password: HTTP basic auth, used only when no API key is set
  └── Test Connection: checks that a URL, an org id and one credential are present
```

A non-blank API key always wins; a username and password (both, or neither) are used only when
no key is set, as HTTP basic auth. Prefer the token: basic auth puts a reusable account password
on every request where a token is scoped and separately revocable, so use it over `https` only.
Both credentials are encrypted at rest and masked when read back.

Two things about the dialog: **Test Connection does not contact Grafana** — it only checks the
fields are filled in, so it cannot tell you a credential is wrong — and a blank credential field
on an existing instance means "keep the stored value", so the UI cannot clear one.

### Minimum service-account role

**Viewer** collects metrics. **Editor** is needed for the write features; nothing Perfana
does requires org **Admin**.

| Perfana feature | Grafana calls | Role |
|---|---|---|
| Metrics collection, variable values | `POST /api/ds/query`, `/api/datasources/proxy/uid/:uid/*` | Viewer |
| Discovering `perfana`-tagged dashboards | `GET /api/search`, `GET /api/dashboards/uid/:uid` | Viewer |
| Dashboard push / restore, folder creation | `POST /api/dashboards/db`, `POST /api/folders`, `DELETE /api/dashboards/uid/:uid` | Editor |
| Test-run annotations | `POST` / `DELETE /api/annotations` | Editor |

One residue needs Admin, on **Grafana 8 schema dashboards only**: a panel or query variable
that names its datasource with no `type` beside it falls back to
`GET /api/datasources/uid/:uid` (or `/name/:name`), and `datasources:read` arrives only with
Admin's `fixed:datasources:writer` — a Viewer holds `fixed:datasources.id:reader`, which
reads an id and not a type. Grafana 9+ embeds the type in the dashboard JSON and Perfana
reads it from there. The symptom on a Grafana 8 dashboard is that it never appears in
Perfana's dashboard list, with one `Skipped dashboard "<title>" (UID: …)` WARN in the
grafana-sync log; re-save the dashboard in Grafana 9+ to get the embedded type.

**Minimum Grafana version: 9.0.** Variable values are resolved through
`POST /api/ds/query` with `datasource: { uid, type }` and no `datasourceId`, which is
uid-only resolution. Verified against Grafana 12.4.13; not verified below 9.

### Every collected query needs a `legendFormat`

A series' legend is stored as `ds_metrics.metric_name`, which is `varchar(255)` **and part of the
table's conflict key** — it is also the identity a baseline, an SLO, a graph preset and a series
grouping rule match on. A Prometheus query with no `legendFormat` is named by Grafana after the
query's whole label set, which passes 255 characters on an ordinary Kubernetes scrape (measured:
301 characters for a stock openshift-user-workload-monitoring label set, 409 with a MicroProfile
`method` label), so the worker clamps the name and warns naming the panel to fix. Two series
agreeing on their first 255 characters then merge into one row, last value winning — a `topk()`
panel whose distinguishing label sits at the end of the label set is the case that loses data
rather than readability. Widening the column is not the alternative it looks like: `metric_name`
is `varchar(255)` in `ds_metric_statistics`, `ds_compare_config` and `ds_metric_series_groups`
too. Before v0.2.97.70 the live (incremental) collector did not clamp at all and such a panel
failed every tick with 22001 while an analysis of the same dashboard worked. See "Every
`ds_metrics` writer clamps to the column widths, from one definition" in `apps/worker/CLAUDE.md`,
the operator-facing version in `docs-user/docs/integrations/connect-grafana.md`, and
[[Series Grouping]] for why a rule cannot group a name with no `legendFormat`.

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

## Splunk

Log events turned into time series per test run (v0.2.97.72), stored in `ds_metrics` like a
Dynatrace metric, so they take part in ADAPT, SLOs, graphs and reports. Full design:
[[Splunk Log Metrics (spec)]]; operator guide: `docs-user/docs/integrations/connect-splunk.md`.

### Capabilities
- **Log metrics** — counts (or `avg`/`p95`/`max`/`dc` of a field) per bucket, split by a field
  such as the log level or host, per panel
- **Starter panels** — log events by level, errors by host, exceptions by type
- **Run card** — *Splunk Logs* in Root Cause Analysis, with an *Open in Splunk* link per panel

### Configuration
```
Settings → Integrations → Splunk (splunk_configs, org-owned)
  ├── Management URL (host): the REST port, usually 8089, never Splunk Web on 8000
  ├── Splunk Web URL (client_url, optional): for Open in Splunk links; falls back to host
  ├── Authentication token, or username + password (token wins)
  ├── App (search namespace) and concurrent searches (keep under the role's quota)
  └── Use proxy
System config → Splunk tab (per environment/workload)
  ├── Sources (splunk_entity_mappings): index / sourcetype / host pattern, at system,
  │     environment or workload level, optional labels
  └── Panels (splunk_queries): a filter that must use $entities, value, split field
```

Perfana owns the time range and the bucketing: the run window is sent as the export endpoint's
`earliest_time`/`latest_time` parameters (v0.2.97.80), and saving or previewing a panel refuses a
filter whose search terms carry their own time modifier. The Splunk role behind the token is the
boundary for what can be read.

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
- [[Splunk Log Metrics (spec)]] — Splunk log metrics design

## Confluence

Publishes generated reports as Confluence pages (Cloud and Data Center 7.9+). Not a metrics source: it is configured on the Integrations page like the others, and used from the Reports card's share menu. Design and limits: [[Confluence Publishing]]; operator guide: `docs-user/docs/integrations/connect-confluence.md`.
