# Tempo Module

Provides distributed tracing integration with Grafana Tempo via TraceQL queries and the Tempo HTTP API.

## Architecture

```
TempoModule
├── TempoController   — HTTP layer
└── TempoService      — TraceQL query building + Tempo API calls
```

## Entities (from `@perfana/db`)

| Entity | Table | Purpose |
|--------|-------|---------|
| `TracingInstance` | `tracing_instances` | Tempo instance URL and metadata |
| `TracingService` | `tracing_services` | Maps service names to systems under test |

## REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/tempo/search` | Search traces via TraceQL |
| `POST` | `/tempo/:traceId` | Fetch full trace details (all spans) |
| `POST` | `/tempo/health` | Test connectivity to a Tempo instance |

## TraceQL Query Construction

`searchTraces` builds a TraceQL expression from the DTO fields:

```
{
  resource.service.name="<serviceName>"
  && ."perfana-test-run-id" = "<testRunId>"
  && ."perfana-request-name" =~ "<scenario>[|]<transaction>[|].*"
}
```

When `sampler` is provided the request-name condition uses exact match instead of regex.

## Span Parsing

`getTraceDetails` parses OTLP `resourceSpans` → `scopeSpans` → `spans` format and converts to the internal `OTelSpan` interface. Jaeger-format `batches` are also supported.

## Connection

All HTTP calls use native `fetch`. The health check uses `AbortSignal.timeout(5000)` for a 5-second limit.

The `tracingApiUrl` field on `TracingInstance` (e.g. `http://tempo:3200`) is required for all query operations.
