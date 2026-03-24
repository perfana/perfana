# Investigation playbook

Maps regression classifications (from `classification-rules.md`) to targeted MCP tool
calls. For each hypothesis type, this table prescribes which tools to call and what to
look for in the results.

## Hypothesis → Investigation mapping

| Classification | Required source | Tool calls | What to look for |
|---|---|---|---|
| **Transaction latency** | Tempo | `get_slow_traces { testRunId, service: affectedService, limit: 10 }` | Are the slowest traces in the regressed transaction? Which downstream span is slowest? |
| **Transaction latency** | Tempo | `get_trace_detail { testRunId, traceId }` (for top 3 slow traces) | Full span breakdown — which service/method dominates the critical path? |
| **Request latency** | Tempo | `get_slow_traces { testRunId, service: affectedService, limit: 10 }` | Same as transaction latency — drill into slow spans |
| **Computation kernel** | Pyroscope | `get_hotspots { testRunId, service: affectedService, limit: 20 }` | Are the compute methods (`_compute`, `_processing`) in the top hotspots? |
| **Computation kernel** | Pyroscope | `get_flamegraph { testRunId, service: affectedService, detailLevel: "full" }` | Does the flamegraph show the compute method dominating CPU? |
| **JVM memory / GC** | Pyroscope | `get_hotspots { testRunId, service: affectedService }` | Look for GC-related methods: `G1`, `gc`, `safepoint`, `cleanup`, `evacuate` |
| **JVM memory / GC** | Grafana | `get_grafana_dashboard_snapshot { testRunId, dashboard: JVM_MEMORY_DASHBOARD }` | Heap usage, old-gen promotion rate, GC pause time |
| **JVM CPU / threads** | Pyroscope | `get_flamegraph { testRunId, service: affectedService, detailLevel: "summary" }` | CPU profile — which methods are hot? |
| **Container resources** | Grafana | `get_grafana_dashboard_snapshot { testRunId, dashboard: CONTAINER_DASHBOARD }` | CPU throttling, memory limits, OOM events |
| **DB connection pool** | Grafana | `get_grafana_dashboard_snapshot { testRunId, dashboard: HIKARI_DASHBOARD }` | Active connections approaching max, wait time, timeout count |
| **DB connection pool** | Tempo | `get_slow_traces { testRunId, service: affectedService }` | Are slow traces waiting on DB connections? Look for `getConnection` spans |
| **Error rates** | Tempo | `get_error_traces { testRunId, service: affectedService, limit: 10 }` | What errors are occurring at the span level? Timeouts? 5xx from downstream? |
| **Error rates** | Dynatrace | `get_dynatrace_problems { testRunId }` | Did Dynatrace detect an outage or degradation during the test? |
| **Throughput drops** | Grafana | `get_grafana_dashboard_snapshot { testRunId, dashboard: HTTP_SERVER_DASHBOARD }` | Request rate over time — did it drop suddenly or gradually? |
| **Infrastructure** | Dynatrace | `get_dynatrace_problems { testRunId }` | Host-level problems: CPU saturation, disk I/O, network issues |

## Dashboard name resolution

The dashboard names above are placeholders. To find the actual dashboard name for a
test run, use the results from `get_adapt_results` — each regression entry includes
the `dashboard` field. Use that exact value in `get_grafana_dashboard_snapshot`.

If the dashboard name from Adapt doesn't match any available dashboard, fall back to
`get_available_metrics` to list all dashboards and pick the closest match.

## Investigation order

1. **Always call first:** `list_connected_sources` — determines which investigation
   branches are possible.

2. **Parallel batch 1 (broad):** For each affected service identified in Step 3.5:
   - `get_slow_traces` (if Tempo available)
   - `get_hotspots` (if Pyroscope available)
   - `get_dynatrace_problems` (if Dynatrace available)

3. **Parallel batch 2 (targeted, after batch 1 results):**
   - `get_trace_detail` for the top 3 slowest traces (if traces were found)
   - `get_flamegraph` if hotspots suggest a specific method worth profiling
   - `get_grafana_dashboard_snapshot` for dashboards mentioned in regressions

4. **Skip if source unavailable.** Note the gap in the report but continue.

## Evidence quality assessment

When evaluating evidence from each source:

| Source | Strong evidence | Weak evidence |
|---|---|---|
| **Traces** | Slow span in exact service/method matching regression | Slow trace in unrelated service |
| **Flamegraph** | Hotspot method matches regressed metric name | Generic framework methods dominating (e.g., `Thread.run`) |
| **Dashboard snapshot** | Metric value changed significantly vs recent runs | Metric within normal range |
| **Dynatrace problems** | Problem time window overlaps test run exactly | Problem started hours before test |

## When to drill deeper

Call `get_trace_detail` (expensive — returns all spans) only when:
- The slow trace's root service matches a regressed service from Adapt
- The trace duration is >2x the expected response time
- You need to identify which specific downstream call is the bottleneck

Call `get_flamegraph` with `detailLevel: "full"` only when:
- `get_hotspots` shows a suspicious method in the top 5
- The hypothesis involves CPU-bound computation or GC pressure
- `detailLevel: "summary"` (top 50 stacks) wasn't enough to confirm
