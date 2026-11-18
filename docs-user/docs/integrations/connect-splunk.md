# Connect Splunk

Connect Splunk so Perfana can turn your log events into metrics per test run: error and warning counts, exceptions by type, or any value your logs carry. These log metrics take part in ADAPT regression detection, SLOs, graphs and reports like any other metric. Perfana stores counts per time bucket, not raw log lines.

Setting Splunk up has two parts: connect it once for the organization, then choose which log sources and panels each system uses.

**Before you start**
- Select your active organization in the sidebar (**Configuration** group).
- Have the Splunk **management URL**: the REST API address, usually port **8089**. Splunk Web on port 8000 does not work here.
- Have a Splunk **authentication token**, or a username and password. Perfana only sees the indexes that account's role is allowed to search.
- On **Splunk Cloud**, the REST API needs a paid stack, port 8089 opened through a Splunk support case, and Perfana's address added to the `search-api` IP allow list, which is closed by default.

## Connect Splunk to your organization

1. In the sidebar, open **Integrations**.
   The Integrations page opens.
2. Click **Add Integration**, choose **Splunk**, then click **Connect**.
   The **Add Splunk connection** dialog opens.
3. Enter a **Label**, for example `Production Splunk`.
4. Enter the **Management URL**, for example `https://splunk.example.com:8089`.
5. Optional: enter a **Splunk Web URL**, for example `https://splunk.example.com`.
   This is the address your browser opens for **Open in Splunk** links. Leave it empty and links use the management URL.
6. Enter an **Authentication token**, or a **Username** and **Password**. When a token is set, it is used instead of the username and password.
7. Check the two advanced fields:
   - **App** — the search namespace, usually `search`.
   - **Concurrent searches** — how many searches Perfana runs at once. Keep it below the search quota of the token's role; Splunk refuses searches over that limit.
8. If your organization reaches Splunk through a proxy, turn on **Connect through the organization proxy**.
9. Click **Test connection**.
   Perfana confirms it can reach Splunk with these credentials, or says why it could not.
10. Click **Add**.
    A Splunk card appears on the Integrations page with **Settings** and **Delete** actions.

To change the connection later, open the Splunk card and click **Settings**.

## Choose log sources and panels for a system

1. Open the system's configuration (**Systems Under Test** → **Edit Config**) and select the **Splunk** tab.
   The tab appears once a Splunk connection exists.
2. Select an **environment** and a **workload**. If the organization has more than one Splunk connection, pick one under **Splunk connection**.
3. Under **Sources**, click **Add source**.
   Perfana asks Splunk which indexes, sourcetypes and hosts received events in the last 24 hours and shows them as a tree with event counts. Click an entry to fill in the source, or type an **Index**, **Sourcetype** and **Host or pattern** yourself.
   Use a wildcard pattern such as `app-*` for Kubernetes pods and autoscaled hosts, whose names change on every deploy.
4. Choose what the source **Applies to**: every environment of this system, this environment, or this workload only. Optionally add **Labels** such as `frontend` or `backend`, then click **Add source**.
5. Under **Panels**, click **Add starter panels**, enter the **Field that holds the log level** (often `log_level`, `level` or `severity`), and click **Add panels**.
   Perfana adds three panels: **Log events by level**, **Errors by host** and **Exceptions by type**.
6. Optional: click **Add panel** to write your own. A panel has:
   - **Filter (SPL)** — start from `$entities`, which stands for the sources mapped above (`$entities[backend]` keeps only sources labelled `backend`). Perfana adds the run's time window and the `timechart` itself, so leave out time modifiers (`earliest`, `latest`, `starttime`, `endtime`) and `| timechart`. Saving a filter whose search terms set a time range is refused.
   - **Value** — `count`, or `avg(field)`, `p95(field)`, `max(field)`, `dc(field)`.
   - **One series per** — a field to split on, such as `log_level` or `host`.
   - **Max series** — series beyond this number are added up into `OTHER`, so totals stay correct.

   The panel preview shows the search Perfana sends, the series it returns with their totals, and the fields your logs have. An empty preview while the source tree shows events usually means the log-level field has a different name; click a field in the preview to use it.

## Result

New test runs of that workload collect the Splunk panels while the test runs and again at analysis. A **Splunk Logs** card appears in the run's Root Cause Analysis tab, with an **Open in Splunk** link per panel for the run's time window. The series are available in Graphs, Trends and Compare, can be used in SLOs (for example `ERROR count < 10`), and are compared against the baseline by ADAPT.

Runs that finished before you set this up are not collected automatically. Re-evaluate such a run with **force refetch** to collect its Splunk data, as long as Splunk still holds the logs for that window.

## Troubleshooting

- *Test connection fails* — Check that the URL uses the management port (usually 8089), not Splunk Web on 8000, and that the token or username and password are valid. On Splunk Cloud, check the support case for port 8089 and the `search-api` IP allow list.
- *The source tree is empty* — The account's role cannot search any index that received events in the last 24 hours. Ask your Splunk admin to grant the role access to the indexes you need.
- *Searches fail with "maximum number of concurrent searches"* — Lower **Concurrent searches** on the connection, or ask your Splunk admin to raise the role's search quota.
- *A panel shows no data for a run* — Check that a source is mapped at a level that covers the run's environment and workload, and that the panel is enabled.
- *The last minutes of a run are missing* — Splunk can take minutes to index events under load. Perfana re-reads recent minutes on each collection and again at analysis, so these usually fill in once the run is analysed.

## Related

- [Root Cause Analysis](../test-runs/root-cause-analysis.md)
- [Connect Dynatrace](connect-dynatrace.md)
- [Connect Grafana](connect-grafana.md)
