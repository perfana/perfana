# Connect Loki

Connect Loki so Perfana can turn your logs into metrics per test run: lines by log level, error lines per service, log volume, or any value your logs carry. These log metrics take part in ADAPT regression detection, SLOs, graphs and reports like any other metric. For each run Perfana also keeps the top log patterns, which ones are new since the baseline, and the latest error lines.

Perfana reaches Loki **through Grafana**: a Loki connection is a Loki datasource on a Grafana instance you have already connected. No Loki address, token or tenant header is needed, and Grafana's own data source permissions apply.

Setting Loki up has two parts: connect it once for the organization, then choose which log streams and panels each system uses.

**Before you start**
- Select your active organization in the sidebar (**Configuration** group).
- Connect the Grafana instance that has your Loki datasource — see [Connect Grafana](connect-grafana.md). Its service account needs the **Viewer** role and permission to query the Loki datasource.
- Log patterns need **Loki 3** with the pattern ingester enabled and **Grafana 11** or later. Without them everything else works, and Perfana groups sampled error lines itself.

## Connect Loki to your organization

1. In the sidebar, open **Integrations**.
2. Click **Add Integration**, choose **Loki**, then click **Connect**.
   The **Add Loki connection** dialog opens.
3. Choose the **Grafana instance**.
   Perfana lists the Loki datasources on that Grafana. If Grafana does not list them, type the datasource **uid**: in Grafana open **Connections** → **Data sources** → your Loki datasource; the uid is the last part of the address.
4. Choose the **Loki datasource** and enter a **Label**, for example `Loki production`.
5. Check the **Level parser** and **Level label**: where a line's level comes from.
   With the parser set to **None (a label)**, the level label is a label Loki already attaches. Loki 3 adds `detected_level` when level discovery is on; older setups often use `level` or `severity`.
   When the level is a field inside the line itself, as in JSON logs (`{"level":"ERROR", …}`) or logfmt logs (`level=error …`), set the parser to **json** or **logfmt** and the level label to the field's name, usually `level`.
   Check the **Application label** too: the label that names an application, `service_name` by default (Loki 3 adds it to every stream). The run page's Applications table is built from it.
6. Optional: change **Concurrent queries**, the number of queries Perfana runs at once.
7. Click **Test connection**.
   Perfana lists the labels Loki has seen in the last hour, or says why it could not reach it. It also checks the level over the last hour.
   If the level label is on none of the lines but a parsed field is, the result names that field. Click **Use it** to fill in the parser and label.
8. Click **Add**.
   A Loki card appears on the Integrations page with **Settings** and **Delete** actions.

## Choose log streams and panels for a system

1. Open the system's configuration (**Systems Under Test** → **Edit Config**) and select the **Loki** tab.
   The tab appears once a Loki connection exists.
2. Select an **environment** and a **workload**. If the organization has more than one Loki connection, pick one under **Loki connection**.
3. Under **Streams**, click **Add streams** and build a stream selector from label matchers, for example `namespace = perf` and `app =~ shop-.*`.
   Label names and values come from Loki. Each value you pick narrows the values offered for the next label. Use a regex (`=~`) for pods, whose names change on every deploy. At least one matcher must select something; `app =~ ".*"` alone is refused, as Loki itself would.
4. Choose what the streams **Apply to**: every environment of this system, this environment, or this workload only. Optionally add **Tags** such as `frontend` or `backend`, then click **Add streams**.
5. Under **Panels**, click **Add starter panels**, choose the **Label that names a service** (often `service_name`, `app` or `container`), and click **Add panels**.
   Perfana adds **Log lines by level**, **Error lines by service** and **Log volume by service**. Keep **Log lines by level**: the run page's error rate is computed from it.
6. Optional: click **Add panel** to write your own. A panel has:
   - **LogQL** — start with `$entities`, which stands for the streams mapped above (`$entities[backend]` keeps only streams tagged `backend`), followed by pipeline stages: `|= "timeout"`, `| json`, `| level="error"`. Perfana adds the aggregation and the time range, so leave out `{…}`, `[5m]`, `unwrap` and functions such as `count_over_time`.
   - **Value** — `count` (lines), `bytes`, or `sum(field)`, `avg(field)`, `max(field)`, `min(field)`, `p95(field)` of a number a parser stage extracts, for example `avg(duration_ms)` after `| json`.
   - **One series per** — a label to split on, such as the level label or `service_name`.
   - **Max series** — count series beyond this number are added up into `OTHER`, so totals stay correct.

   **Preview last hour** shows the LogQL Perfana sends, the series it returns with their totals, and the labels Loki has.

## Result

New test runs of that workload collect the Loki panels while the test runs and again at analysis. A **Loki Logs** card appears in the run's Root Cause Analysis tab with:

- a **Baseline** picker, with the same choices as the Compare card: the run's **control group** (the earlier runs anomaly detection compares it with; the default when it has one) or any run of the same workload. Under it the card names the runs it compared with. Without a control group and with nothing picked, it compares with the five previous runs and says so;
- the **error rate** (error lines as a share of all lines) against that baseline;
- a tab per application (the **Application label**, default `service_name`), and on the **All applications** tab the **Applications** table: per application its lines, error lines, error rate against the same application in the baseline runs, and new patterns. A row, or its tab, narrows the rest of the card to that application;
- the **top log patterns** of the run, with the ones not seen in the baseline runs marked **NEW**, and a link to the matching lines in Grafana Explore;
- the **latest error and warning lines**, each expandable to show its labels;
- each **panel** with its series totals, an **Open in Grafana Explore** link and a **⋮** menu that opens its series in Graphs, Compare or Trends.

The patterns and lines are stored with the run when it is analysed, so the card keeps them after Loki's retention has dropped the window. The series are available in Graphs, Trends and Compare, can be used in SLOs (for example error lines `< 10` per bucket), and are compared against the baseline by ADAPT. Out of the box, ADAPT treats more lines on the **Error lines by service** starter panel than in the baseline as a regression (classification USE Errors, lower is better). The other two starter panels, and panels you add yourself, are unclassified: ADAPT reports their changes but never fails a run on them, until you classify them on the Anomaly Detection card or with an ADAPT template. A renamed starter panel is left unclassified, and a classification you save yourself is never overwritten. A profile can add an SLO on a Loki panel to every workload through **Loki — all panels**.

Runs that finished before you set this up are not collected automatically. Re-evaluate such a run with **force refetch** to collect its Loki data and patterns, as long as Loki still holds the logs for that window.

## Troubleshooting

- *Test connection fails with 403* — The Grafana service account may not query this datasource. Grant it query permission on the Loki datasource in Grafana.
- *Grafana does not list its datasources* — Type the datasource uid instead; listing needs a permission some Grafana setups withhold.
- *A panel shows no data for a run* — Check that streams are mapped at a level that covers the run's environment and workload, and that the panel is enabled. The preview says when a split label is missing from the lines.
- *The card shows no patterns* — Patterns are taken when the run is analysed. If Loki's patterns API is not available, Perfana groups up to 2,000 sampled error and warning lines and says so; if Loki no longer holds the window, re-analysing finds nothing and keeps any earlier snapshot.
- *No Applications table* — The lines carry no Application label, or the run was analysed before Perfana 0.2.97.109; re-analyse it while Loki still holds the window. Check the label in the connection's **Settings**.
- *An application shows lines but no patterns* — Patterns are taken for the 20 applications with the most errors, and only when the Application label is a stream label. Lines and counts still work.
- *No error rate on the card* — Add the **Log lines by level** starter panel, or any count panel split by the connection's level label.
- *"No line of this run carries the level label"* — The level panel came back with every line under `(none)`. The level label is not on the lines, so Perfana cannot tell errors apart. It shows no error rate instead of a misleading 0%, and the per-application error rates read 0 for the same reason. Run **Test connection** in the connection's **Settings** and set the parser it suggests. Then delete and re-add the two level starter panels, and re-analyse the run while Loki still holds the window.

## Related

- [Root Cause Analysis](../test-runs/root-cause-analysis.md)
- [Connect Grafana](connect-grafana.md)
- [Connect Splunk](connect-splunk.md)
