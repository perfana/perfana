---
name: perfana-report
description: >
  Use this skill to analyse a Perfana performance test run and generate a comprehensive
  standardised performance test report written directly into Obsidian. Includes automatic
  cross-source root cause investigation when data sources (Tempo traces, Pyroscope flamegraphs,
  Dynatrace problems) are connected. Trigger when the user says things like "analyse test run",
  "generate a Perfana report", "write a performance test report", "create a report for run X",
  "analyse PerfanaWebshop-acc-loadTest-XXXXX", "report on the latest load test",
  "find root cause", "why did performance regress", or "investigate regression".
  Also trigger when the user asks to compare a run to a baseline or summarise test results.
  Requires Perfana MCP and Obsidian Local REST API.
context: fork
disable-model-invocation: true
---

# Perfana performance test report

Fetches all Perfana data for a test run, classifies regressions, derives hypotheses,
investigates root causes across connected data sources (traces, flamegraphs, infrastructure),
and writes a standardised Markdown report to an Obsidian vault.

## Step 1 — Resolve inputs

Ask for `testRunId` if not provided. Accept optional `baselineRunId`.
If no baseline, call `perfana:get_recent_runs` and use the most recent run
where `is_control_group: true` for the same SUT / environment / workload.

## Step 2 — Choose output destination

Ask the user: **"Write the report to Obsidian or save as a local file?"**

- **Obsidian** → Read the API key from the vault config using the Read tool:
  ```
  Read file: {vaultRoot}/.obsidian/plugins/obsidian-local-rest-api/data.json
  ```
  Extract `$.apiKey`. See `references/obsidian-api.md` for endpoint details.
  If the vault root is unknown, check common locations: `~/Documents/Obsidian`, `~/Obsidian`, or ask the user.
- **Local file** → The report will be written to `./reports/{testRunId}.md` in the current working directory.

## Step 3 — Fetch all Perfana data in parallel

Call these tools simultaneously (do not wait for one before starting the next):

```
perfana:get_test_run             { testRunId }
perfana:get_transaction_stats    { testRunId }
perfana:get_check_results        { testRunId }
perfana:get_adapt_results        { testRunId }
perfana:get_performance_rankings { testRunId, dimension: "slowest" }
perfana:get_performance_rankings { testRunId, dimension: "highest_impact" }
perfana:get_performance_rankings { testRunId, dimension: "highest_error_rate" }
perfana:get_error_analysis       { testRunId }
perfana:get_deep_links           { testRunId }
perfana:get_recent_runs          { systemUnderTest, testEnvironment, workload, limit: 5 }
```

If a baseline is available, also call in parallel:

```
perfana:compare_runs    { baselineRunId, testRunId }
perfana:get_config_diff { baselineRunId, testRunId }
```

For each entry in `get_error_analysis.topErrorsByTransaction`, call:

```
perfana:get_error_details { testRunId, transactionName, samplerName, url }
```

## Step 3.5 — Review pre-classified adapt data

The `get_adapt_results` tool returns **pre-processed** data — no manual parsing needed.
The response includes:

- `classifiedRegressions` — each regression already tagged with a classification
  (Computation kernel, Transaction latency, JVM memory / GC, Container resources, etc.)
  and a generated hypothesis string
- `byDashboard` — regressions grouped by dashboard with source type labels
  (Performance test, JVM monitoring, Infrastructure, Connection pool, etc.)
- `causalChains` — detected cross-source causal chains with confidence levels
  (e.g. "Compute regressions → CPU spike → GC pressure" = High confidence)
- `hypotheses` — deduplicated list of all hypotheses ready for investigation

From `get_check_results`: also list all **failed** SLO checks. Note the dashboard and metric.

Use the `hypotheses` list directly to drive targeted investigation in the next step.

## Step 3.6 — Discover connected sources and investigate

First, discover what data sources are available:

```
perfana:list_connected_sources  { testRunId }
```

This returns `{grafana, tempo, pyroscope, dynatrace}` with `available: true/false` for each.

Then, read `references/investigation-playbook.md` for the full mapping of hypothesis
types to investigation tool calls.

For each hypothesis from Step 3.5, call the tools prescribed by the playbook —
but **only if the required source is available**. Run calls for independent hypotheses
in parallel.

If a tool call returns an error or empty data:
- Log which source was unavailable and why
- Skip that investigation branch
- Note the gap: "Tempo traces were not available — trace-level analysis was skipped"
- **Never abort the entire analysis because one source failed**

If `list_connected_sources` shows no sources available at all, skip to Step 4 and note:
"No external data sources connected — investigation based on Perfana metrics only."

## Step 3.7 — Correlate evidence across sources

Cross-reference the investigation results to strengthen or weaken each hypothesis.

**Correlation patterns to check:**

1. **Adapt cross-source causal chain:** Group regressions from `get_adapt_results` by their
   `dashboard` field — each dashboard represents a different data source (performance test
   metrics = JMeter/Gatling, JVM memory = Grafana JVM dashboard, Docker container = Grafana
   infra, Hikari = Grafana connection pool, etc.). Look for causal chains across sources:
   - Compute subrequest regressions (perf test) → CPU spike (Docker container) → GC pressure (JVM) → **High confidence**
   - Latency regression (perf test) → connection pool saturation (Hikari) → **High confidence**
   - Error rate spike (perf test) + CPU spike (Docker) + Dynatrace problem → **High confidence**
   This correlation is available from Adapt data alone — no traces or flamegraphs needed.

2. **Trace ↔ Flamegraph:** Do the slowest traces point to the same service/method that
   appears as a hotspot in the flamegraph? If yes → **High confidence**.

3. **Metric ↔ Trace:** Does the timing of the metric regression (from Adapt) match the
   duration of slow traces? If traces show 2s calls and the metric regressed by 2s → **High confidence**.

4. **Dynatrace ↔ Metric:** Did a Dynatrace problem start at the same time as the regression?
   If a "CPU saturation" problem coincides with a CPU metric regression → **High confidence**.

5. **Config ↔ Everything:** Did a config change (from `get_config_diff`) coincide with the
   regression? If thread pool size was halved and connection pool metrics regressed → **High confidence**.

6. **Flamegraph ↔ GC:** Does the flamegraph show GC-related methods (containing `gc`, `G1`,
   `safepoint`, `cleanup`) as hotspots? If yes and JVM memory metrics regressed → **High confidence**.

**Assign confidence to each hypothesis:**

| Level | Criteria |
|---|---|
| **High** | Corroborating evidence from 2+ independent sources |
| **Medium** | Evidence from 1 source with plausible mechanism |
| **Low** | Hypothesis consistent with symptoms but no direct evidence |

Pick the **single most likely root cause** — the hypothesis with the highest confidence
and most corroborating evidence. The report should be opinionated, not a list of "could be"s.

## Step 4 — Classify regressions and derive hypotheses (enhanced with investigation)

Read `references/classification-rules.md` for the full classification table and
hypothesis guide. Apply to all regressions and differences from `get_adapt_results`.

Enrich each hypothesis with the investigation evidence from Steps 3.6–3.7:
- Attach the confidence level (High/Medium/Low) from the correlation step
- Include specific evidence references (e.g., "trace abc123 shows 2.1s in OrderService.process()")
- Note which sources contributed evidence and which were unavailable

Compute derived metrics:
- **p99 tail overshoot** = `p99_response_time − active_threshold` (from `get_transaction_stats`)
- **Flaky error flag** = true if all error URLs match `/flaky`

## Step 5 — Build the report

Read `references/report-template.md` and fill every section from the fetched data.
Write `_No data available_` for any section with no data — never leave placeholders.

## Step 6 — Write report to chosen destination

### If Obsidian was chosen:

```bash
curl -s -X PUT \
  "http://localhost:27123/vault/Performance%20Reports/${TEST_RUN_ID}.md" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: text/markdown" \
  --data-binary "${REPORT_MARKDOWN}"
```

Expect HTTP 200 or 204. Confirm to the user:
> "Report written to Obsidian at `Performance Reports/{testRunId}.md`"

### If local file was chosen:

Write the report to `./reports/{testRunId}.md` using the Write tool.
Create the `reports/` directory if it doesn't exist.
Confirm to the user:
> "Report written to `reports/{testRunId}.md`"

## Error handling

| Situation | Action |
|---|---|
| `get_adapt_results` parse error | Retry once; fall back to `consolidated_result.adaptTestRunOK` from `get_test_run`; note in report |
| `get_config_diff` no result | Write "Config diff unavailable" in report; continue |
| `get_transaction_stats` no result | Use Apdex from `get_check_results`; omit p99 column |
| No `is_control_group` run found | Use most recent completed run as baseline; note the assumption |
| `list_connected_sources` error | Skip investigation entirely; note "Data source discovery failed" in report |
| `get_slow_traces` empty result | Write "No slow traces found in test run time window" in Investigation section |
| `get_error_traces` empty result | Write "No error traces found" in Investigation section |
| `get_flamegraph` error (service not found) | Write "Pyroscope data unavailable for service X — available: Y, Z" in report |
| `get_hotspots` empty result | Write "No CPU hotspots detected" in Investigation section |
| `get_dynatrace_problems` empty result | Write "No Dynatrace problems detected during test window" — this is a positive signal |
| `get_trace_detail` error | Skip that trace; continue with remaining traces |
| `get_grafana_dashboard_snapshot` error | Fall back to individual `get_metric_trends` calls; if those fail too, note gap |
| No sources connected at all | Skip Steps 3.6–3.7; write "No external data sources connected" in report |
| Obsidian 401 | Re-read `data.json`; key may have rotated |
| Obsidian connection refused | Suggest local file output instead; Obsidian may not be running |
| Path spaces | URL-encode spaces as `%20` in the PUT path |
