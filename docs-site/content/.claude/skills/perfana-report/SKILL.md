---
name: perfana-report
description: >
  Use this skill to analyse a Perfana performance test run and generate a comprehensive
  standardised performance test report written directly into Obsidian. Trigger when the user
  says things like "analyse test run", "generate a Perfana report", "write a performance test
  report", "create a report for run X", "analyse PerfanaWebshop-acc-loadTest-XXXXX",
  or "report on the latest load test". Also trigger when the user asks to compare a run
  to a baseline or summarise test results. Requires Perfana MCP and Obsidian Local REST API.
context: fork
disable-model-invocation: true
---

# Perfana performance test report

Fetches all Perfana data for a test run, classifies regressions, derives hypotheses,
and writes a standardised Markdown report to an Obsidian vault.

## Step 1 — Resolve inputs

Ask for `testRunId` if not provided. Accept optional `baselineRunId`.
If no baseline, call `perfana:get_recent_runs` and use the most recent run
where `is_control_group: true` for the same SUT / environment / workload.

## Step 2 — Read Obsidian API key

Read the key from the vault config using the Filesystem MCP:

```
Filesystem:read_text_file  {vaultRoot}/.obsidian/plugins/obsidian-local-rest-api/data.json
```

Extract `$.apiKey`. See `references/obsidian-api.md` for endpoint details.

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

## Step 4 — Classify regressions and derive hypotheses

Read `references/classification-rules.md` for the full classification table and
hypothesis guide. Apply to all regressions and differences from `get_adapt_results`.

Compute derived metrics:
- **p99 tail overshoot** = `p99_response_time − active_threshold` (from `get_transaction_stats`)
- **Flaky error flag** = true if all error URLs match `/flaky`

## Step 5 — Build the report

Read `references/report-template.md` and fill every section from the fetched data.
Write `_No data available_` for any section with no data — never leave placeholders.

## Step 6 — Write to Obsidian

```bash
curl -s -X PUT \
  "http://localhost:27123/vault/Performance%20Reports/${TEST_RUN_ID}.md" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: text/markdown" \
  --data-binary "${REPORT_MARKDOWN}"
```

Expect HTTP 200 or 204. Confirm to the user:
> "Report written to Obsidian at `Performance Reports/{testRunId}.md`"

## Error handling

| Situation | Action |
|---|---|
| `get_adapt_results` parse error | Retry once; fall back to `consolidated_result.adaptTestRunOK` from `get_test_run`; note in report |
| `get_config_diff` no result | Write "Config diff unavailable" in report; continue |
| `get_transaction_stats` no result | Use Apdex from `get_check_results`; omit p99 column |
| No `is_control_group` run found | Use most recent completed run as baseline; note the assumption |
| Obsidian 401 | Re-read `data.json`; key may have rotated |
| Obsidian connection refused | Check Obsidian is open and Local REST API plugin is enabled |
| Path spaces | URL-encode spaces as `%20` in the PUT path |
