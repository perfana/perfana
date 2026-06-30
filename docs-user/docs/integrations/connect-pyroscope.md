# Connect Pyroscope

Connect Pyroscope so Perfana can surface continuous-profiling (flame graph) data in a test run's Root Cause Analysis. Set this up when you profile your services and want that profiling tied to your load tests.

**Before you start**
- Select your active organization in the sidebar (**Configuration** group).
- Decide whether your Pyroscope is **standalone** or runs **as a Grafana app**, and have the matching URL and credentials.

**Steps**
1. In the sidebar, open **Integrations**.
   The Integrations page opens.
2. Click **Add Integration**, choose **Pyroscope**, then click **Connect**.
   The Pyroscope connection dialog opens.
3. Choose how Pyroscope is hosted:
   - **Standalone** — enter the Pyroscope server URL and credentials.
   - **Grafana app** — point at your Grafana instance that hosts the Pyroscope app.
   The form adjusts to the mode you chose.
   ![The Add Integration dialog with Grafana, Dynatrace, Pyroscope, and Distributed Tracing options](../assets/integration-picker.png)
   *Figure: choose Pyroscope in the Add Integration dialog.*
4. Click **Test Connection**.
   Perfana confirms it can reach Pyroscope.
5. Save the integration.
   A Pyroscope card appears on the Integrations page with **Settings** and **Delete** actions.

**Result**
Pyroscope is connected at the organization level. The Pyroscope card now appears in the Root Cause Analysis tab of a test run.

**Troubleshooting**
- *Test Connection fails in Grafana-app mode* — Confirm the Pyroscope app is installed and enabled in the target Grafana instance.

**Related**
- [Root Cause Analysis](../test-runs/root-cause-analysis.md)
- [Connect Grafana](connect-grafana.md)
