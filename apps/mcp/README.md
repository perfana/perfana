# @perfana/mcp

MCP server that exposes Perfana test run data to Claude Desktop (or any MCP-compatible client).

## Tools

| Tool | Description |
|---|---|
| `get_test_run` | Metadata, status, and configuration for a test run |
| `get_transaction_stats` | Response times (avg/p50/p90/p95/p99), throughput, error rates, Apdex scores |
| `get_recent_runs` | Recent runs for a SUT/environment/workload — for trend comparison |
| `compare_runs` | Side-by-side regression diff between two runs |
| `get_config_diff` | Diff test run configuration items between two runs — highlights added/removed/changed keys (JVM flags, pool sizes, feature flags, etc.) |
| `get_check_results` | SLO / requirements check results — which objectives passed or failed |
| `get_adapt_results` | Adapt regression analysis: overall verdict, tracked regressions with severity/confidence/% change vs baseline |
| `get_deep_links` | Resolved dashboard/tool links associated with a test run |

## Setup

### 1. Build

```bash
cd apps/mcp
npm install
npm run build
```

### 2. Configure Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "perfana": {
      "command": "node",
      "args": ["/absolute/path/to/perfana-next-gen/apps/mcp/dist/index.js"],
      "env": {
        "PERFANA_API_URL": "http://localhost:3001/api",
        "PERFANA_API_KEY": ""
      }
    }
  }
}
```

### 3. (Optional) Add Obsidian MCP

To write analysis notes directly to your vault, also add the [obsidian-mcp](https://github.com/StevenStavrakis/obsidian-mcp) server.

## Usage examples

Once configured, just ask Claude Desktop:

> "Analyze test run `perfana-gatling-myapp-1741859234` and write a performance report to my Obsidian vault under `Performance Tests/2026-03-16 myapp peak-load.md`"

> "Compare the last 3 test runs for `myapp` in the `production` environment and tell me if there are any regressions"

> "What was the Apdex score for `/api/checkout` in test run X?"

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PERFANA_API_URL` | `http://localhost:3001/api` | Base URL of the Perfana API |
| `PERFANA_API_KEY` | _(empty)_ | Perfana API key — sent as `Authorization: Bearer <key>`. Generate one in Perfana under Settings → API Keys. |
