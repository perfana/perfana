# Check SLO results

See whether a test run met the thresholds you set, using pass/fail check results, the Apdex score, and metric series.

**Before you start**
- You need an open test run. See [Read a test run](read-a-run.md).
- SLOs must be defined for the system or workload. See [Define SLOs](../configuration/define-slos.md).

**Steps**
1. On the test run, open the **Results** tab.
   You see the run's result sections.
2. Go to the **Service Level Objectives** section.
   You see a list of check results, each marked as passed or failed.
   [[SCREENSHOT: /test-runs/[id] — the Service Level Objectives section with pass/fail check results]]
3. Read each **check result**. A check compares a measured value against the threshold you defined.
   A failing check (red) means the run missed that target; a passing check means it met it.
4. Read the **Apdex** score, a value from 0 to 1 that summarises how satisfying response times were.
   A higher score means more requests were fast enough; a lower score signals slow responses.
5. Open a check's **metric series** to see the underlying values over the run.
   You can see how the metric behaved across the test, not just the final verdict.
   [[SCREENSHOT: /test-runs/[id] — an expanded check showing its metric series]]

**Result**
You know which targets the run met or missed, its Apdex score, and how each measured metric behaved.

**Troubleshooting**
- *No checks appear* — no SLOs are defined for this system or workload yet. See [Define SLOs](../configuration/define-slos.md).
- *A check shows no data* — the metric may not have been collected. Use **Re-fetch** from the run's actions menu to pull the metrics again.

**Related**
- [Define SLOs](../configuration/define-slos.md)
- [Understand ADAPT verdicts](understand-adapt.md)
- [Concepts](../concepts.md)
