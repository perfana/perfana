# Connect distributed tracing

Connect a distributed-tracing backend so Perfana can link traces into a test run's Root Cause Analysis. Set this up when you want to jump from a load test to the traces behind slow or failing requests.

**Before you start**
- Select your active organization in the sidebar (**Configuration** group).
- Know which backend you use — **Tempo**, **Jaeger**, or **Elastic APM** — and have its URL and any required credentials.

**Steps**
1. In the sidebar, open **Integrations**.
   The Integrations page opens.
2. Click **Add Integration**, choose **Distributed Tracing**, then click **Connect**.
   The tracing connection dialog opens.
3. Select your backend: **Tempo**, **Jaeger**, or **Elastic APM**.
   The form adjusts to the backend you chose.
4. Enter the backend URL and any required credentials.
   [[SCREENSHOT: /integrations — the Distributed Tracing dialog with backend choice and URL fields]]
5. Choose how Perfana shows traces: **embed (iframe)** to display the tracing UI inside Perfana, or **external link** to open it in a new tab.
   This controls how the Distributed Tracing card behaves on a test run.
6. Click **Test Connection**.
   Perfana confirms it can reach the tracing backend.
7. Save the integration.
   A Distributed Tracing card appears on the Integrations page with **Settings** and **Delete** actions.

**Result**
Distributed tracing is connected at the organization level. The Distributed Tracing card now appears in the Root Cause Analysis tab of a test run.

**Troubleshooting**
- *Embedded view is blank* — Some backends block being embedded in an iframe; switch to **external link** mode in **Settings**.

**Related**
- [Root Cause Analysis](../test-runs/root-cause-analysis.md)
- [Connect Grafana](connect-grafana.md)
