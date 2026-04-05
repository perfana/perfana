# @perfana/mcp

MCP server that exposes Perfana test run data to Claude Desktop (or any MCP-compatible client).

## Tools

| Tool | Description |
|---|---|
| `get_test_run` | Metadata, status, and configuration for a test run |
| `get_transaction_stats` | Response times (avg/p95/p99), throughput, error rates, Apdex scores |
| `get_recent_runs` | Recent runs for a SUT/environment/workload — for trend comparison |
| `compare_runs` | Side-by-side regression diff between two runs |
| `get_test_run_configs` | Configuration items captured during a run (JVM flags, pool sizes, feature flags, etc.) |
| `get_config_diff` | Diff configuration items between two runs — highlights added/removed/changed keys |
| `get_check_results` | SLO / requirements check results — which objectives passed or failed |
| `get_adapt_results` | Adapt regression analysis: overall verdict, classified regressions, causal chains, hypotheses |
| `get_deep_links` | Resolved dashboard/tool links associated with a test run |
| `get_performance_rankings` | Top N transactions ranked by slowest, highest throughput, highest impact, or highest error rate |
| `get_error_analysis` | Error summary, errors grouped by HTTP status code and by transaction |
| `get_error_details` | Detailed error instances for a specific transaction — request/response headers and body |
| `get_available_metrics` | List all dashboards, panels, and metric names available for a test run |
| `get_metric_trends` | Time-series data for a specific metric during a test run |
| `list_connected_sources` | Discover connected data sources: Grafana, Tempo, Pyroscope, Dynatrace |
| `get_grafana_dashboard_snapshot` | Min/max/avg/last summary for all panels in a Grafana dashboard |
| `get_slow_traces` | Slowest distributed traces from Tempo/Jaeger, with optional service/scenario/transaction filter |
| `get_trace_detail` | Full span breakdown for a specific trace |
| `get_error_traces` | Distributed traces containing errors from Tempo/Jaeger |
| `get_flamegraph` | CPU flamegraph data from Pyroscope in collapsed-stack format |
| `get_hotspots` | Top N hottest methods from Pyroscope, sorted by CPU sample count |
| `get_dynatrace_problems` | Dynatrace-detected problems during the test run time window |

## Setup

### 1. Configure Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "perfana": {
      "command": "npx",
      "args": ["-y", "@perfana/mcp"],
      "env": {
        "PERFANA_API_URL": "http://localhost:3001/api",
        "PERFANA_API_KEY": "YOUR_PERFANA_API_KEY"
      }
    }
  }
}
```

Generate an API key in Perfana under **Settings → API Keys**.

### 3. (Optional) Add Obsidian MCP

To write analysis notes directly to your vault, also add the [obsidian-mcp](https://github.com/StevenStavrakis/obsidian-mcp) server.

## Usage examples

Once configured, just ask Claude Desktop:

> "Analyze test run `perfana-gatling-myapp-1741859234` and write a performance report to my Obsidian vault under `Performance Tests/2026-03-16 myapp peak-load.md`"

> "Compare the last 3 test runs for `myapp` in the `production` environment and tell me if there are any regressions"

> "What was the Apdex score for `/api/checkout` in test run X?"

> "Show me the top 10 slowest transactions in test run X and which ones are regressions vs baseline"

> "Are there any CPU hotspots in the `afterburner` service during test run X?"

## Investigation workflow

For root cause analysis, a typical agent workflow is:

1. `get_adapt_results` — get overall verdict and classified regressions
2. `list_connected_sources` — discover which investigation tools are available
3. `get_performance_rankings` (slowest/highest_impact) — identify bottleneck transactions
4. `get_slow_traces` / `get_error_traces` — drill into distributed traces
5. `get_flamegraph` or `get_hotspots` — find CPU hot methods (if Pyroscope connected)
6. `get_grafana_dashboard_snapshot` — check container/JVM metrics

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PERFANA_API_URL` | `http://localhost:3001/api` | Base URL of the Perfana API |
| `PERFANA_API_KEY` | _(required)_ | Perfana API key — sent as `Authorization: Bearer <key>`. Generate one in Perfana under **Settings → API Keys**. |
