# Connect Dynatrace

Connect Dynatrace so Perfana can pull problems and service metrics into a test run's Root Cause Analysis. Set this up when you want Dynatrace observability alongside your load-test results.

**Before you start**
- Select your active organization in the sidebar (**Configuration** group).
- Be an **organization admin** of the organization you are adding the integration to. Creating an integration is an org-admin action.
- Know whether your Dynatrace is **Managed** or **SaaS**, and have your environment URL (the **Server URL**) and an API token with read access.
- If your browser reaches Dynatrace at a different address than your servers do (a reverse proxy, or split DNS), have that browser-facing address too.
- Know the request attributes your load test sends for the test-run id and the request name (used for mapping).

**Steps**
1. In the sidebar, open **Integrations**.
   The Integrations page opens.
2. Click **Add Integration**, choose **Dynatrace**, then click **Connect**.
   The Dynatrace connection dialog opens.
3. Select your deployment type, **Managed** or **SaaS**.
   The form adjusts to the deployment you chose.
4. Enter the **Server URL** and your **API token**.
   The Server URL is the address Perfana's own server uses to call the Dynatrace API. It is fixed once the integration is created, so get it right here — the field is read-only when you reopen the dialog later.
   ![The Add Integration dialog with Grafana, Dynatrace, Pyroscope, and Distributed Tracing options](../assets/integration-picker.png)
   *Figure: choose Dynatrace in the Add Integration dialog.*
5. Optional: enter a **Client URL**.
   This is the address your **browser** opens Dynatrace at when you click a link out of Perfana. Fill it in only when it differs from the Server URL — for example when Dynatrace sits behind a reverse proxy, or when split DNS means the internal name does not resolve from a laptop. On a **Managed** deployment include the environment path (`…/e/<env-id>`). Leave it empty and links use the Server URL, as before.
6. Set the **request-attribute mapping** so Perfana can match Dynatrace requests to your test runs: map the attribute that carries the **test-run id** and the attribute that carries the **request name**.
   These mappings let Perfana correlate Dynatrace data with the correct run and transactions.
7. Click **Test Connection**.
   Perfana confirms it can reach the Dynatrace environment with the supplied token.
8. Save the integration.
   A Dynatrace card appears on the Integrations page with **Settings** and **Delete** actions.

**Result**
Dynatrace is connected at the organization level. The Dynatrace card now appears in the Root Cause Analysis tab of a test run.

**Changing the integration later**
Open the Dynatrace card and click **Settings**. You can rename it, set or clear the Client URL, and change the request-attribute mapping. Leave the **API token blank** to keep the existing one — you only need to paste a token in when you are actually rotating it. (**Test Connection** does need a token, so paste one in if you want to re-test.) The **Server URL cannot be changed** after creation; if it moves, add a new integration and delete the old one.

**Troubleshooting**
- *Test Connection fails* — Verify the Server URL matches your deployment type (Managed URLs differ from SaaS) and that the API token has the required read scopes.
- *No Dynatrace data on a run* — Check that your load test actually sends the mapped request attributes for test-run id and request name.
- *Links to Dynatrace open an address your browser cannot reach* — Your browser and Perfana's server see Dynatrace at different addresses. Open the Dynatrace card, click **Settings**, and set the **Client URL** to the address you use in your browser. On Managed, include the environment path (`…/e/<env-id>`).
- *"You do not have permission to create a Dynatrace configuration in this organization"* — You are not an org admin of the organization selected in the sidebar. Ask an org admin, or switch to an organization where you are one.

**Related**
- [Root Cause Analysis](../test-runs/root-cause-analysis.md)
- [Connect Grafana](connect-grafana.md)
