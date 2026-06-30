# Connect Dynatrace

Connect Dynatrace so Perfana can pull problems and service metrics into a test run's Root Cause Analysis. Set this up when you want Dynatrace observability alongside your load-test results.

**Before you start**
- Select your active organization in the sidebar (**Configuration** group).
- Know whether your Dynatrace is **Managed** or **SaaS**, and have your environment URL and an API token with read access.
- Know the request attributes your load test sends for the test-run id and the request name (used for mapping).

**Steps**
1. In the sidebar, open **Integrations**.
   The Integrations page opens.
2. Click **Add Integration**, choose **Dynatrace**, then click **Connect**.
   The Dynatrace connection dialog opens.
3. Select your deployment type, **Managed** or **SaaS**.
   The form adjusts to the deployment you chose.
4. Enter the **environment URL** and your **API token**.
   [[SCREENSHOT: /integrations — the Dynatrace connection dialog with deployment type, URL, and token fields]]
5. Set the **request-attribute mapping** so Perfana can match Dynatrace requests to your test runs: map the attribute that carries the **test-run id** and the attribute that carries the **request name**.
   These mappings let Perfana correlate Dynatrace data with the correct run and transactions.
6. Click **Test Connection**.
   Perfana confirms it can reach the Dynatrace environment with the supplied token.
7. Save the integration.
   A Dynatrace card appears on the Integrations page with **Settings** and **Delete** actions.

**Result**
Dynatrace is connected at the organization level. The Dynatrace card now appears in the Root Cause Analysis tab of a test run.

**Troubleshooting**
- *Test Connection fails* — Verify the environment URL matches your deployment type (Managed URLs differ from SaaS) and that the API token has the required read scopes.
- *No Dynatrace data on a run* — Check that your load test actually sends the mapped request attributes for test-run id and request name.

**Related**
- [Root Cause Analysis](../test-runs/root-cause-analysis.md)
- [Connect Grafana](connect-grafana.md)
