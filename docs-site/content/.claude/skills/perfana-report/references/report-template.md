# Performance test report template

Fill all `{{placeholders}}` from fetched Perfana data. Write `_No data available_` for
any section with no data — never leave placeholder text in the output.

````markdown
---
testRunId: {{testRunId}}
system: {{systemUnderTest}}
environment: {{testEnvironment}}
workload: {{workload}}
release: {{applicationRelease}}
date: {{startTime | YYYY-MM-DD}}
duration: {{durationSeconds}}s
result: {{PASS or FAIL}}
tags: [performance-report, {{csvTags}}]
baseline: {{baselineRunId}}
---

# Performance test report — {{testRunId}}

## Summary

| Field | Value |
|---|---|
| System | {{systemUnderTest}} |
| Environment | {{testEnvironment}} |
| Workload | {{workload}} |
| Release | `{{applicationRelease}}` |
| Start time | {{startTime}} |
| Duration | {{durationSeconds}}s (planned {{plannedDuration}}s) |
| Completion | {{completionPct}}% |
| **Overall result** | **{{PASS ✅ or FAIL ❌}}** |
| Adapt verdict | {{adaptConclusion}} |
| SLO checks passed | {{sloPassCount}} / {{sloTotalCount}} |
| Annotations | {{annotations}} |
| Tags | {{csvTags}} |

> {{oneLineSummary}}

---

## Verdict

### Adapt regression analysis

| Metric | Count |
|---|---|
| Total metrics evaluated | {{totalResults}} |
| Regressions | {{regressionCount}} |
| Improvements | {{improvementCount}} |
| Differences | {{differenceCount}} |
| No difference | {{noDifferenceCount}} |
| **Conclusion** | **{{adaptConclusion}}** |

### SLO / requirements checks

| Dashboard | Metric | Result | Value | Requirement |
|---|---|---|---|---|
{{for each sloCheck}}
| {{dashboard_label}} | {{panel_title}} | {{PASS ✅ or FAIL ❌}} | {{panel_average}} | {{requirement summary}} |
{{end}}

---

## Transaction performance

### Response time table

| Transaction | Scenario | Avg (ms) | p95 (ms) | p99 (ms) | Threshold (ms) | Apdex | |
|---|---|---|---|---|---|---|---|
{{for each transaction sorted by apdex asc}}
| {{transaction_name}} | {{scenario_name}} | {{avg_response_time}} | {{p95_response_time}} | {{p99_response_time}} | {{active_threshold}} | {{apdex_score}} | {{✅ ⚠️ or ❌}} |
{{end}}

_✅ Apdex ≥ 0.85 · ⚠️ Apdex 0.70–0.85 · ❌ Apdex < 0.70_

### p99 tail overshoot (transactions where p99 > threshold)

| Transaction | p99 (ms) | Threshold (ms) | Overshoot | % over |
|---|---|---|---|---|
{{for each transaction where p99 > threshold, sorted by overshoot desc}}
| {{transaction_name}} | {{p99}} | {{threshold}} | +{{overshoot}}ms | +{{pct}}% |
{{end}}

### Top 5 by impact score

| Rank | Transaction | Avg RT (ms) | Count | Impact | Apdex |
|---|---|---|---|---|---|
{{for rank 1..5 from highest_impact ranking}}
| {{rank}} | {{transaction_name}} | {{avg_response_time_ms}} | {{total_count}} | {{impact}} | {{apdex_score}} |
{{end}}

---

## Regression analysis vs baseline

> Baseline: `{{baselineRunId}}` — {{baselineRelease}} ({{baselineDate}})
> Config changes: {{configChangedCount}} · Unchanged: {{configUnchangedCount}}

{{if configChanges}}
### Config changes

| Key | Baseline | Current |
|---|---|---|
{{for each configChange}}
| `{{key}}` | {{baseline}} | {{current}} |
{{end}}
{{else}}
All {{configUnchangedCount}} config items are **identical**. The regression is
attributable solely to the code change.
{{end}}

### Regressions by classification

{{for each classificationGroup with regressions}}
#### {{groupName}} ({{count}} regressions)

**Hypothesis:** {{hypothesis}}

| Metric | Dashboard | Baseline | Current | Change |
|---|---|---|---|---|
{{for top 8 regressions in group, sorted by |change_pct| desc}}
| `{{metric_name}}` | {{dashboard}} | {{baseline}}{{unit}} | {{current}}{{unit}} | {{change_pct}}% |
{{end}}

{{end}}

### Improvements (preserve in any rollback)

| Metric | Dashboard | Baseline | Current | Change |
|---|---|---|---|---|
{{for each improvement}}
| `{{metric_name}}` | {{dashboard}} | {{baseline}}{{unit}} | {{current}}{{unit}} | {{change_pct}}% |
{{end}}

---

## Error analysis

| Metric | Value |
|---|---|
| Total requests | {{totalRequests}} |
| Total errors | {{totalErrors}} |
| Overall error rate | {{errorRatePct}}% |
| Unique HTTP error codes | {{uniqueResponseCodes}} |
| Transactions with errors | {{transactionsWithErrors}} |

### Errors by status code

| Code | Count | Avg RT (ms) | Min RT (ms) | Max RT (ms) |
|---|---|---|---|---|
{{for each errorByCode}}
| {{responseCode}} | {{errorCount}} | {{avgResponseTime}} | {{minResponseTime}} | {{maxResponseTime}} |
{{end}}

### Errors by transaction

| Transaction | Sampler | URL | Code | Count | Classification |
|---|---|---|---|---|---|
{{for each topError}}
| {{transactionName}} | {{samplerName}} | `{{url}}` | {{responseCode}} | {{errorCount}} | {{Flaky fixture or Real error}} |
{{end}}

{{if allErrorsAreFlaky}}
> All errors originate from `/flaky` endpoints (Afterburner chaos fixture).
> These are **not real application errors** — classify as test infrastructure noise.
{{end}}

---

## Root cause & recommendations

### Root cause

{{rootCauseNarrative — 2-4 sentences linking the code change, the top compute
kernel regressions, and the JVM GC data}}

### Recommendations

1. **Profile the compute hotspot** — Run Pyroscope on `afterburner-fe` with profiler
   `process_cpu:cpu:nanoseconds:cpu:nanoseconds` during a load test.
2. **Review commit `{{gitCommitDelta}}`** — Inspect for intermediate object allocations.
3. **Consider async/lazy execution** — Move the computation off the request thread.
4. **Re-run with fix** — Validate against baseline `{{baselineRunId}}`.
5. **Preserve improvements** — {{improvementCount}} error rate improvements introduced;
   ensure these are not lost in a rollback.

---

## Run trend (last {{recentRunCount}} runs)

| Run | Date | Release | Result | Adapt |
|---|---|---|---|---|
{{for each recentRun}}
| `{{testRunId}}` | {{startDate}} | {{applicationRelease}} | {{PASS ✅ or FAIL ❌}} | {{adaptConclusion}} |
{{end}}

---

## Links

{{for each deepLink}}
- [{{name}}]({{url}})
{{end}}
- [CI build]({{ciBuildResultsUrl}})]

---

_Report generated {{reportTimestamp}} by Claude Code · Perfana report skill v1.0_
````
