# Reports in CI/CD

Generate an HTML report for a test run from a pipeline and store it as a build artifact.

Two calls: one to trigger generation, one to download. Generation is queued on a
worker, so the pipeline polls the download endpoint until it returns the file.

## Authentication

Use an API key (see [[RBAC]]). Both endpoints accept it as a bearer token:

```bash
-H "Authorization: Bearer $PERFANA_API_KEY"
```

## 1. Trigger generation

```bash
REPORT_ID=$(curl -sf -X POST "$PERFANA_URL/api/reports/generate" \
  -H "Authorization: Bearer $PERFANA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"test_run_id\": \"$TEST_RUN_ID\"}" \
  | jq -r .report_id)
```

`test_run_id` accepts either the test run UUID or the **human test run id** — the
one the pipeline passed to the load test tool (`my-service-2026-07-31-001`).

### Choosing the template

Three options, in order of precedence:

| Field | Behaviour |
|---|---|
| `template_id` | Explicit template UUID. Copy it from the report template list on the system's configuration screen — the copy button next to each template. |
| `template_name` | Template with that name in the test run's system / environment / workload. Names are unique per scope, so this is an unambiguous key — and it's the one a pipeline can hard-code. |
| *neither* | The **default template** for that scope. |

```bash
-d "{\"test_run_id\": \"$TEST_RUN_ID\", \"template_name\": \"Nightly regression\"}"
```

A "default template" is just a template flagged `is_default` within its scope —
there is no built-in or global one. Set it in the UI's report template list, or
via `PUT /api/report-templates/:id/set-default` (which clears the flag on the
others in that scope). If nothing matches, the call returns 404:

```
Report Template not found: "Nightly regression" in acceptance/full-load
Report Template not found: default for acceptance/full-load
```

## 2. Download the HTML

```bash
for i in $(seq 1 60); do
  code=$(curl -s -o report.html -w '%{http_code}' \
    -H "Authorization: Bearer $PERFANA_API_KEY" \
    "$PERFANA_URL/api/reports/$REPORT_ID/html/download")
  [ "$code" = "200" ] && break
  # Anything other than "still generating" is terminal — do not keep polling.
  [ "$code" = "202" ] || { cat report.html; exit 1; }
  sleep 5
done
```

Poll on a **bounded** loop and treat any non-202 as terminal. An `until [ "$code" = 200 ]`
loop never exits when generation fails (400) or the key loses access (404) — the job
hangs until the CI timeout instead of failing with the reason.

The endpoint returns:

| Status | Meaning |
|--------|---------|
| 200 | HTML file (`Content-Disposition: attachment`) |
| 202 | Still generating — retry |
| 400 | Generation failed; body carries `message` and `errorCode` |
| 404 | Report not found, or not accessible to this API key's organization |

Generation typically takes ~30s. The HTML is self-contained (graphs are embedded),
so the single file is the complete artifact — no assets to collect alongside it.

## Full example (GitLab CI)

```yaml
perfana-report:
  script:
    - |
      REPORT_ID=$(curl -sf -X POST "$PERFANA_URL/api/reports/generate" \
        -H "Authorization: Bearer $PERFANA_API_KEY" \
        -H 'Content-Type: application/json' \
        -d "{\"test_run_id\": \"$TEST_RUN_ID\"}" | jq -r .report_id)
    - |
      for i in $(seq 1 60); do
        code=$(curl -s -o report.html -w '%{http_code}' \
          -H "Authorization: Bearer $PERFANA_API_KEY" \
          "$PERFANA_URL/api/reports/$REPORT_ID/html/download")
        [ "$code" = "200" ] && exit 0
        [ "$code" = "202" ] || { cat report.html; exit 1; }
        sleep 5
      done
      echo "report generation timed out"; exit 1
  artifacts:
    paths: [report.html]
```

## Without a template: `/reports/generate/ad-hoc`

`POST /api/reports/generate/ad-hoc` takes the sections inline instead of a template id. It
accepts the same two forms of `test_run_id` as `/reports/generate` — the human id or the UUID —
and at most **20 sections** per report, the same ceiling the builder enforces. Over that, or an
id that matches no run, and the call is refused (400 and 404 respectively). Unlike
`/reports/generate`, `name` is required here.

A comparison section can set `"baselineTestRunId"` to one of two reserved values instead of
pinning a run that ages. `"previous"` compares against the most recent completed run that started
before this one in the same system / environment / workload. `"previous-successful"` narrows that
to the most recent such run whose SLOs passed (`consolidated_result.meetsRequirement`), so a
still-broken run is not compared against one that had already breached its objectives. Both are
resolved when each report is generated. See [[Templates]].

## Naming generated reports

`/reports/generate` names an unnamed report after its template plus the date **and time** (UTC,
`YYYY-MM-DD HH:MM:SS`), so a pipeline that generates nightly and again on demand on the same day
no longer produces reports with identical names. Do not match on the name string from a pipeline —
use the `report_id` the generate call returns, or `created_at`. The ad-hoc endpoint never
auto-names: it requires `name`.

## PDF instead

Same flow with `POST /api/reports/$REPORT_ID/pdf` then
`GET /api/reports/$REPORT_ID/pdf/download`. The PDF endpoint auto-queues
generation on first download request, so the POST can be skipped.

## Related

- [[Templates]] — creating and defaulting report templates
- [[Perfana Report Overview]] — the PDF rendering service
