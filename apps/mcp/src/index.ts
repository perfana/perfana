#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { PerfanaClient } from './perfana-client.js';
import { diffConfigs, buildComparison, buildPerformanceRanking, buildErrorAnalysis } from './helpers.js';
import type { RankingDimension } from './helpers.js';

const PERFANA_API_URL = process.env.PERFANA_API_URL ?? 'http://localhost:3001/api';
const PERFANA_API_KEY = process.env.PERFANA_API_KEY ?? '';

const client = new PerfanaClient(PERFANA_API_URL, PERFANA_API_KEY);

/** Wrap a tool handler so errors are returned as MCP error content instead of crashing. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeTool(
  handler: (args: any) => Promise<{ content: Array<{ type: 'text'; text: string }> }>,
): (args: any) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  return async (args) => {
    try {
      return await handler(args);
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err ? (err as Error).message : String(err);
      return { content: [{ type: 'text' as const, text: msg }], isError: true };
    }
  };
}

const server = new McpServer({
  name: 'perfana',
  version: '0.1.0',
});

// ─── Tool: get_test_run ───────────────────────────────────────────────────────

server.tool(
  'get_test_run',
  'Get metadata and overview for a specific Perfana test run',
  { testRunId: z.string().describe('The test run ID (e.g. "perfana-gatling-abc-1234567890")') },
  safeTool(async ({ testRunId }) => {
    const run = await client.getTestRun(testRunId);
    return { content: [{ type: 'text', text: JSON.stringify(run, null, 2) }] };
  }),
);

// ─── Tool: get_transaction_stats ─────────────────────────────────────────────

server.tool(
  'get_transaction_stats',
  'Get transaction-level performance statistics for a test run: response times (avg, p50, p90, p95, p99), throughput, error rates, and Apdex scores',
  {
    testRunId: z.string().describe('The test run ID'),
    sinceMinutes: z
      .number()
      .optional()
      .describe('Only include data from the last N minutes of the run (useful for running tests)'),
  },
  safeTool(async ({ testRunId, sinceMinutes }) => {
    const stats = await client.getTransactionStats(testRunId, sinceMinutes);
    return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
  }),
);

// ─── Tool: get_recent_runs ────────────────────────────────────────────────────

server.tool(
  'get_recent_runs',
  'Get a list of recent test runs for a given system under test, environment, and workload — useful for trend comparison',
  {
    systemUnderTest: z.string().describe('System under test name'),
    testEnvironment: z.string().describe('Test environment (e.g. "performance", "staging")'),
    workload: z.string().describe('Workload name (e.g. "loadtest", "soak")'),
    limit: z.number().optional().default(5).describe('Number of runs to return (default: 5)'),
  },
  safeTool(async ({ systemUnderTest, testEnvironment, workload, limit }) => {
    const runs = await client.getRecentRuns(systemUnderTest, testEnvironment, workload, limit);
    return { content: [{ type: 'text', text: JSON.stringify(runs, null, 2) }] };
  }),
);

// ─── Tool: compare_runs ───────────────────────────────────────────────────────

server.tool(
  'compare_runs',
  'Compare two test runs side-by-side: response time deltas, Apdex changes, error rate changes. Useful for regression detection.',
  {
    testRunId: z.string().describe('The test run to analyse'),
    baselineRunId: z.string().describe('The baseline run to compare against'),
  },
  safeTool(async ({ testRunId, baselineRunId }) => {
    const [current, baseline] = await Promise.all([
      client.getTransactionStats(testRunId),
      client.getTransactionStats(baselineRunId),
    ]);

    const comparison = buildComparison(current, baseline);
    return { content: [{ type: 'text', text: JSON.stringify(comparison, null, 2) }] };
  }),
);

// ─── Tool: get_test_run_configs ───────────────────────────────────────────────

server.tool(
  'get_test_run_configs',
  'Get configuration items for a test run: JVM settings, thread counts, connection pool sizes, feature flags, application versions, and other key-value pairs captured during the test.',
  { testRunId: z.string().describe('The test run ID') },
  safeTool(async ({ testRunId }) => {
    const configs = await client.getTestRunConfigs(testRunId);
    return { content: [{ type: 'text', text: JSON.stringify(configs, null, 2) }] };
  }),
);

// ─── Tool: get_config_diff ────────────────────────────────────────────────────

server.tool(
  'get_config_diff',
  'Compare test run configuration items (JVM settings, thread counts, connection pool sizes, feature flags, etc.) between two runs. Highlights added, removed, and changed keys — useful for explaining why performance changed.',
  {
    testRunId: z.string().describe('The test run to analyse'),
    baselineRunId: z.string().describe('The run to compare against'),
  },
  safeTool(async ({ testRunId, baselineRunId }) => {
    const [current, baseline] = await Promise.all([
      client.getTestRunConfigs(testRunId),
      client.getTestRunConfigs(baselineRunId),
    ]);

    const diff = diffConfigs(current, baseline);
    return { content: [{ type: 'text', text: JSON.stringify(diff, null, 2) }] };
  }),
);

// ─── Tool: get_check_results ──────────────────────────────────────────────────

server.tool(
  'get_check_results',
  'Get SLO / requirements check results for a test run — shows which service level objectives passed or failed (e.g. p95 < 500ms, error rate < 1%).',
  { testRunId: z.string().describe('The test run ID') },
  safeTool(async ({ testRunId }) => {
    const results = await client.getCheckResults(testRunId);
    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
  }),
);

// ─── Tool: get_adapt_results ──────────────────────────────────────────────────

server.tool(
  'get_adapt_results',
  'Get the Adapt regression analysis results for a test run: overall verdict, list of tracked metric regressions (with severity, confidence, % change, and resolution status) compared against the baseline. This is the primary pass/fail signal in Perfana.',
  { testRunId: z.string().describe('The test run ID') },
  safeTool(async ({ testRunId }) => {
    const [conclusion, regressions] = await Promise.all([
      client.getAdaptConclusion(testRunId),
      client.getTrackedRegressions(testRunId),
    ]);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ conclusion, regressions }, null, 2),
        },
      ],
    };
  }),
);

// ─── Tool: get_deep_links ─────────────────────────────────────────────────────

server.tool(
  'get_deep_links',
  'Get resolved deep links (dashboard URLs, tool links) associated with a test run — useful for including in analysis notes',
  { testRunId: z.string().describe('The test run ID') },
  safeTool(async ({ testRunId }) => {
    const links = await client.getDeepLinks(testRunId);
    return { content: [{ type: 'text', text: JSON.stringify(links, null, 2) }] };
  }),
);

// ─── Tool: get_performance_rankings ──────────────────────────────────────────

server.tool(
  'get_performance_rankings',
  'Get top N transactions ranked by a dimension: slowest response times, highest throughput, highest performance impact (avg * count), or highest error rate. Useful for identifying bottlenecks.',
  {
    testRunId: z.string().describe('The test run ID'),
    dimension: z
      .enum(['slowest', 'highest_throughput', 'highest_impact', 'highest_error_rate'])
      .describe('Ranking dimension'),
    limit: z.number().optional().default(10).describe('Number of results (default: 10)'),
  },
  safeTool(async ({ testRunId, dimension, limit }) => {
    const [stats, run] = await Promise.all([
      client.getTransactionStats(testRunId),
      client.getTestRun(testRunId),
    ]);

    const durationSeconds = run.duration ?? run.duration_seconds ?? 0;
    const result = buildPerformanceRanking(stats, durationSeconds, dimension as RankingDimension, limit);
    result.testRunId = testRunId;

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }),
);

// ─── Tool: get_error_analysis ────────────────────────────────────────────────

server.tool(
  'get_error_analysis',
  'Get comprehensive error analysis for a test run: error summary, errors grouped by HTTP status code, and errors grouped by transaction/sampler. Identifies which endpoints are failing and why.',
  { testRunId: z.string().describe('The test run ID') },
  safeTool(async ({ testRunId }) => {
    const [summary, byCode, byTransaction] = await Promise.all([
      client.getErrorSummary(testRunId),
      client.getErrorsByCode(testRunId),
      client.getErrorsByTransaction(testRunId),
    ]);

    const result = buildErrorAnalysis(testRunId, summary, byCode, byTransaction);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }),
);

// ─── Tool: get_error_details ─────────────────────────────────────────────────

server.tool(
  'get_error_details',
  'Get detailed error instances for a specific transaction/sampler/URL — includes request headers, response headers, response body, and status code. Use after get_error_analysis to drill into root cause.',
  {
    testRunId: z.string().describe('The test run ID'),
    transactionName: z.string().describe('Transaction name from error analysis'),
    samplerName: z.string().describe('Sampler name from error analysis'),
    url: z.string().describe('URL from error analysis'),
  },
  safeTool(async ({ testRunId, transactionName, samplerName, url }) => {
    const details = await client.getErrorDetails(testRunId, transactionName, samplerName, url);

    // Truncate response bodies to keep token usage manageable
    const truncated = details.slice(0, 3).map((d) => ({
      ...d,
      responseData: d.responseData?.length > 2000
        ? d.responseData.slice(0, 2000) + '... (truncated)'
        : d.responseData,
    }));

    return { content: [{ type: 'text', text: JSON.stringify(truncated, null, 2) }] };
  }),
);

// ─── Tool: get_available_metrics ──────────────────────────────────────────────

server.tool(
  'get_available_metrics',
  'List all available dashboards, panels, and metric names for a test run. Use this first to discover what metrics can be queried with get_metric_trends. Returns dashboards like "Docker container metrics", "HTTP server requests", "Hikari Connection Pool" etc. with their panels and metric names.',
  { testRunId: z.string().describe('The test run ID') },
  safeTool(async ({ testRunId }) => {
    const panels = await client.getAvailableMetrics(testRunId);
    return { content: [{ type: 'text', text: JSON.stringify(panels, null, 2) }] };
  }),
);

// ─── Tool: get_metric_trends ─────────────────────────────────────────────────

server.tool(
  'get_metric_trends',
  'Get time-series data for a specific metric during a test run. Use get_available_metrics first to discover valid dashboard/panel/metric combinations. Returns timestamped values for trend analysis (e.g. CPU usage over time, response time trends, throughput patterns).',
  {
    testRunId: z.string().describe('The test run ID'),
    dashboardLabel: z.string().describe('Dashboard label (e.g. "Docker container metrics perfana-demo-afterburner-fe-1")'),
    panelTitle: z.string().describe('Panel title (e.g. "CPU", "Memory", "Requests response times")'),
    metricName: z.string().optional().describe('Specific metric name within the panel (omit to get all metrics in the panel)'),
    excludeRampUp: z.boolean().optional().default(true).describe('Exclude ramp-up period data (default: true)'),
  },
  safeTool(async ({ testRunId, dashboardLabel, panelTitle, metricName, excludeRampUp }) => {
    const data = await client.getMetricTimeSeries(testRunId, dashboardLabel, panelTitle, metricName, excludeRampUp);

    // For LLM consumption, summarize if there are too many data points
    if (data.length > 200) {
      // Group by metric_name and downsample each to ~50 points
      const grouped = new Map<string, typeof data>();
      for (const point of data) {
        const key = point.metric_name ?? 'unknown';
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(point);
      }

      const downsampled: typeof data = [];
      for (const [, points] of grouped) {
        const step = Math.max(1, Math.floor(points.length / 50));
        for (let i = 0; i < points.length; i += step) {
          downsampled.push(points[i]);
        }
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            note: `Downsampled from ${data.length} to ${downsampled.length} points for readability`,
            data: downsampled,
          }, null, 2),
        }],
      };
    }

    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }),
);

// ─── Tool: list_connected_sources ────────────────────────────────────────────

server.tool(
  'list_connected_sources',
  'Discover which data sources (Grafana, Tempo, Pyroscope, Dynatrace) are connected for a test run. Call this first to know which investigation tools are available before starting root cause analysis.',
  { testRunId: z.string().describe('The test run ID') },
  safeTool(async ({ testRunId }) => {
    const sources = await client.getConnectedSources(testRunId);
    return { content: [{ type: 'text', text: JSON.stringify(sources, null, 2) }] };
  }),
);

// ─── Tool: get_grafana_dashboard_snapshot ─────────────────────────────────────

server.tool(
  'get_grafana_dashboard_snapshot',
  'Get a summary snapshot of all panels in a Grafana dashboard for a test run — returns min/max/avg/last for each metric in each panel. Much faster than querying individual panels. Use get_available_metrics to find dashboard names first.',
  {
    testRunId: z.string().describe('The test run ID'),
    dashboard: z.string().describe('Dashboard label or name (from get_available_metrics)'),
  },
  safeTool(async ({ testRunId, dashboard }) => {
    const snapshot = await client.getDashboardSnapshot(testRunId, dashboard);
    return { content: [{ type: 'text', text: JSON.stringify(snapshot, null, 2) }] };
  }),
);

// ─── Tool: get_slow_traces ───────────────────────────────────────────────────

server.tool(
  'get_slow_traces',
  'Get the slowest distributed traces from Tempo/Jaeger for a test run, sorted by duration. Useful for identifying which requests took the longest and drilling into span-level bottlenecks.',
  {
    testRunId: z.string().describe('The test run ID'),
    service: z.string().optional().describe('Filter by service name (optional — omit to search all services)'),
    limit: z.number().optional().default(10).describe('Number of traces to return (default: 10, max: 50)'),
  },
  safeTool(async ({ testRunId, service, limit }) => {
    const traces = await client.getSlowTraces(testRunId, service, Math.min(limit, 50));
    return { content: [{ type: 'text', text: JSON.stringify(traces, null, 2) }] };
  }),
);

// ─── Tool: get_trace_detail ──────────────────────────────────────────────────

server.tool(
  'get_trace_detail',
  'Get the full span breakdown for a specific trace — shows every service call, database query, and external request with timing. Use after get_slow_traces to drill into a specific slow trace.',
  {
    testRunId: z.string().describe('The test run ID (used to resolve which Tempo instance to query)'),
    traceId: z.string().describe('The trace ID from get_slow_traces results'),
  },
  safeTool(async ({ testRunId, traceId }) => {
    const detail = await client.getTraceDetail(testRunId, traceId);

    // Truncate if too many spans
    if (detail.spans.length > 100) {
      detail.spans = detail.spans.slice(0, 100);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ...detail,
            note: `Truncated from ${detail.spanCount} to 100 spans for readability`,
          }, null, 2),
        }],
      };
    }

    return { content: [{ type: 'text', text: JSON.stringify(detail, null, 2) }] };
  }),
);

// ─── Tool: get_error_traces ──────────────────────────────────────────────────

server.tool(
  'get_error_traces',
  'Get distributed traces that contain errors from Tempo/Jaeger for a test run. Useful for identifying which requests failed and where the error originated in the service chain.',
  {
    testRunId: z.string().describe('The test run ID'),
    service: z.string().optional().describe('Filter by service name (optional)'),
    limit: z.number().optional().default(10).describe('Number of traces to return (default: 10, max: 50)'),
  },
  safeTool(async ({ testRunId, service, limit }) => {
    const traces = await client.getErrorTraces(testRunId, service, Math.min(limit, 50));
    return { content: [{ type: 'text', text: JSON.stringify(traces, null, 2) }] };
  }),
);

// ─── Tool: get_flamegraph ────────────────────────────────────────────────────

server.tool(
  'get_flamegraph',
  'Get CPU flamegraph data from Pyroscope for a service during a test run. Returns collapsed-stack format (one line per stack path with sample count) — ideal for identifying hot methods and GC pressure.',
  {
    testRunId: z.string().describe('The test run ID'),
    service: z.string().describe('Application/service name as configured in Pyroscope'),
    detailLevel: z
      .enum(['summary', 'full'])
      .optional()
      .default('summary')
      .describe('summary = top 50 stacks (~5KB), full = top 200 stacks (~20KB)'),
  },
  safeTool(async ({ testRunId, service, detailLevel }) => {
    const result = await client.getFlamegraph(testRunId, service, detailLevel);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }),
);

// ─── Tool: get_hotspots ──────────────────────────────────────────────────────

server.tool(
  'get_hotspots',
  'Get the top N hottest methods from Pyroscope for a service during a test run — sorted by CPU sample count. Faster than get_flamegraph for a quick overview of where CPU time is spent.',
  {
    testRunId: z.string().describe('The test run ID'),
    service: z.string().describe('Application/service name as configured in Pyroscope'),
    limit: z.number().optional().default(20).describe('Number of methods to return (default: 20)'),
  },
  safeTool(async ({ testRunId, service, limit }) => {
    const hotspots = await client.getHotspots(testRunId, service, limit);
    return { content: [{ type: 'text', text: JSON.stringify(hotspots, null, 2) }] };
  }),
);

// ─── Tool: get_dynatrace_problems ────────────────────────────────────────────

server.tool(
  'get_dynatrace_problems',
  'Get Dynatrace-detected problems (outages, slowdowns, resource contention) that occurred during a test run time window. Useful for correlating performance regressions with infrastructure issues detected by Dynatrace AI.',
  { testRunId: z.string().describe('The test run ID') },
  safeTool(async ({ testRunId }) => {
    const problems = await client.getDynatraceProblems(testRunId);
    return { content: [{ type: 'text', text: JSON.stringify(problems, null, 2) }] };
  }),
);

// ─── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
