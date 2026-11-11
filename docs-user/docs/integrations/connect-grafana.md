# Connect Grafana

Connect a Grafana instance so Perfana can pull dashboards, panels, and metrics for your test runs. Grafana is Perfana's main metrics source — it also reads InfluxDB and Prometheus data through Grafana data sources, so this is usually the first integration you set up.

**Before you start**
- Select your active organization in the sidebar (**Configuration** group).
- Have your Grafana base URL and an API token/key with read access to dashboards and data sources.
  If your Grafana has no service accounts, or sits behind HTTP basic auth, a username and password
  work instead — see step 4.

**Steps**
1. In the sidebar, open **Integrations**.
   The Integrations page lists your connected tools under "Connect your performance testing tools and observability platforms".
   ![The Integrations page with connected instances and the Add Integration button](../assets/integrations.png)
   *Figure: the Integrations page.*
2. Click **Add Integration**.
   A picker dialog opens listing the available integration types.
3. Choose **Grafana**, then click **Connect**.
   The Grafana connection dialog opens.
4. Enter the Grafana **base URL** (for example `https://grafana.example.com`) and your **API token/key**.
   If your Grafana uses organizations, set the **org id**. Enable snapshot support here if you use snapshot instances.
   Instead of a token you can fill in **Username** and **Password**, which Perfana sends as HTTP basic auth — the token wins whenever one is set, so fill in one or the other.
   Prefer the token where you can: basic auth sends a reusable account password on every request, while a token is scoped and can be revoked on its own, so only use it over `https`.
   Editing an instance later, a blank credential field means "keep what is stored", so there is no way to clear one here.
   ![The Add Integration dialog with Grafana, Dynatrace, Pyroscope, and Distributed Tracing options](../assets/integration-picker.png)
   *Figure: choose Grafana in the Add Integration dialog.*
5. Click **Test Connection**.
   This checks that the base URL, the org id and one credential are filled in. It does not
   contact Grafana, so it cannot tell you whether the credentials are accepted — the first
   test run that collects metrics is what proves that.
6. Save the integration.
   A Grafana card appears on the Integrations page with **Settings** and **Delete** actions.

**Result**
Grafana is connected at the organization level. The Grafana tab now appears on each system's configuration page, where you can pick dashboards and define SLOs per system.

**Troubleshooting**
- *Test Connection reports a missing field* — It only checks that the base URL, the org id and either a token or a username **and** password are present. It does not call Grafana, so it never fails because of an expired token or a wrong password.
- *No metrics appear after a test run* — This is where a wrong credential shows up. Check the worker log: `has no credentials configured` means the instance has neither a token nor a username and password, while a 401 from Grafana means the token expired or the username and password are wrong.
- *No dashboards appear later* — Confirm the credentials can read the Grafana folders that contain your dashboards.

**Related**
- [Add a system under test](../configuration/create-system-under-test.md)
- [Connect Dynatrace](connect-dynatrace.md)
