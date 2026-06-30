# Read a test run

Open a single test run and find your way around its tabs to understand how the test performed.

**Before you start**
- You need at least one test run in the list. See [Find and filter test runs](find-and-filter-runs.md).

**Steps**
1. From the **Test Runs** list, click the run you want to open.
   You see the test run detail page with a details card and three tabs.
   [[SCREENSHOT: /test-runs/[id] — the detail page header, details card, and the three tabs]]
2. Read the **details card** for the run's metadata (system, environment, workload, timing). Use it to edit the run's **tags** and **annotations**.
   Your tags and notes are saved to the run for later reference.
3. Open the **Results** tab to review what happened. It groups several sections:
   - **Configuration comparison** — what changed versus a previous run.
   - **Dashboards** — the Grafana dashboards captured for the run.
   - **Deep Links** — shortcuts out to related external tools.
   - **Performance Analysis** — per-transaction statistics, including Apdex; drill into tracing or Dynatrace from here.
   - **Service Level Objectives** — the pass/fail checks and metric series.
   - **Anomaly Detection** — the ADAPT regression verdicts.
   - **Events** — notable events during the run.
   [[SCREENSHOT: /test-runs/[id] — the Results tab with its sections labelled]]
4. Open the **Root Cause Analysis** tab when you need to dig into why something happened. It has Dynatrace, Distributed Tracing, Pyroscope, and AWR Report cards.
   You can investigate the underlying system behaviour for the run.
5. Open the **Reporting** tab to produce and compare outputs. It offers **Generate Report**, Trends, Compare, and Graphs.
   You can create a shareable report or compare this run against others.
6. To act on the whole run, open the per-run actions menu. It offers **Re-evaluate**, **Re-fetch**, **Mark as / Remove Changepoint**, **Disable Baseline Mode**, and **Delete**.
   [[SCREENSHOT: /test-runs/[id] — the per-run actions menu open]]

**Result**
You can read a run's metadata, move between the Results, Root Cause Analysis, and Reporting tabs, and edit its tags and annotations.

**Related**
- [Check SLO results](slo-check-results.md)
- [Understand ADAPT verdicts](understand-adapt.md)
- [Concepts](../concepts.md)
