# Investigate root cause

This lets you go from "a run regressed" to "here is where it went wrong" by digging into server-side evidence for a single run. Use it after a comparison or a failed check tells you something slowed down.

**Before you start**
- A test run to investigate. Open it at `/test-runs/[id]` and go to the **Root Cause Analysis** tab.
- The relevant integration connected. Some cards only appear when their integration is set up for your system — see the links below.

**Steps**

1. Open the run and select the **Root Cause Analysis** tab.
   You see the analysis cards available for this run.
   ![The Root Cause Analysis tab with Distributed Tracing, Pyroscope Profiling, and AWR Reports cards](../assets/run-rca.png)
   *Figure: the Root Cause Analysis tab. A card appears for each connected integration.*

2. Use the **Dynatrace** card to inspect application and infrastructure metrics. Apply its filters to narrow to the service, host, or timeframe you care about.
   You can correlate the regression with CPU, memory, or response-time data from Dynatrace. Appears only when Dynatrace is connected — see [Connect Dynatrace](../integrations/connect-dynatrace.md).

3. Use the **Distributed Tracing** card to follow individual requests through your services (Tempo, Jaeger, or Elastic).
   You can find which span or downstream call is slow. See [Connect distributed tracing](../integrations/connect-tracing.md).

4. Use the **Pyroscope** card to drill into CPU/profiling flame data.
   You can see which code paths consumed the most time. Appears only when Pyroscope is configured — see [Connect Pyroscope](../integrations/connect-pyroscope.md).

   **Compare two time ranges within one run.** The tracing card's **Traces Diff** tab and the Pyroscope card's **Diff View** compare against another test run by default. Choose **Two time ranges in this run** to compare two windows of the same run instead, for example the first ten minutes against the last ten, to see what changed as the run went on. Drag the **Baseline range** and **Compare range** sliders; each shows its offset from the start of the run and the clock time. They start at the first and last third of the run.

5. Use the **AWR Report** card for Oracle database analysis.
   You can review the Oracle AWR report for database-side bottlenecks.

6. Use the **Splunk Logs** card to see what the run's logs did, per panel: error and warning counts, exceptions by type, or any value your logs carry.
   Each panel has an **Open in Splunk** link for the run's time window. A panel with data also has a **⋮** menu with **Open in Graphs**, **Open in Compare** and **Open in Trends**, which adds every series on that panel to the chosen card; the icon at the end of each item opens it in a new tab. Appears only when Splunk is configured for the system — see [Connect Splunk](../integrations/connect-splunk.md).

7. Use the **Loki Logs** card to see what the run's logs did: the error rate against the baseline, an **Applications** table per `service_name` (click one to narrow the card to that application), the top log patterns with the ones new since the baseline marked **NEW**, the latest error and warning lines, and each panel's series.
   Each panel and pattern links to Grafana Explore for the run's time window, and a panel with data has a **⋮** menu with **Open in Graphs**, **Open in Compare** and **Open in Trends**. Appears only when Loki is configured for the system — see [Connect Loki](../integrations/connect-loki.md).

**Result**
You have pinpointed where the regression comes from — application, a downstream service, code hot spots, or the database — instead of just knowing that the run was slow.

**Troubleshooting**
- *A card you expected is missing* — that integration is not connected for this system. Cards appear only when their source is configured. Follow the relevant integration guide linked above.
- *A card is empty* — the integration is connected but returned no data for this run's window. Check that the time range and service filters match the test.

**Related**
- [Compare test runs](compare-runs.md)
- [Generate and share a report](generate-report.md)
- [Key concepts](../concepts.md)
