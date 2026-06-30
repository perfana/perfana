# Create a system under test

A system under test (SUT) is the application you are load-testing. Create one so Perfana has a place to collect metrics, store test runs, and hold the dashboards, SLOs, and ADAPT settings for that application.

**Before you start**
- Select your active organization in the sidebar.
- Open the **Configuration** group in the sidebar.

**Steps**
1. Go to **Systems Under Test** (`/systems`).
   You see a table of existing systems, with columns for name, description, number of environments, and number of workloads.
   [[SCREENSHOT: /systems — the Systems Under Test table and the create control]]

2. Create a new system and give it a **name** and **description**.
   The new system appears in the table.

3. On the system's row, click **Actions** to open its configuration.
   You land on the system's config page (`/systems/[id]/config`), titled with the system name.
   [[SCREENSHOT: /systems/[id]/config — the configuration tabs across the top]]

4. Work through the configuration tabs to set up the system. Some tabs appear only once the matching integration is connected:
   - **Grafana dashboards**
   - **Service Level Objectives** — see [Define SLOs](define-slos.md)
   - **Deep Links**
   - **Dynatrace**, **Distributed Tracing**, **Pyroscope**
   - **Notifications**
   - **Reporting Templates** — see [Manage reporting templates](reporting-templates.md)
   - **ADAPT Settings** — see [Configure ADAPT](adapt-settings.md)

**Result**
The system appears in the **Systems Under Test** table and its configuration is reachable through **Actions**. Test runs sent to Perfana for this system can now collect metrics and produce results.

**CI alternative**
You can also provision a system from a pipeline using the idempotent provisioning API (`POST /api/systems-under-test`). It creates the system — optionally with its environments and workloads in one call — or returns the existing one with HTTP 409, so the script is safe to run on every build. See [API keys](../administration/api-keys.md) to authenticate the call.

**Related**
- [Define SLOs](define-slos.md)
- [Configure ADAPT](adapt-settings.md)
- [Manage reporting templates](reporting-templates.md)
- [Concepts](../concepts.md)
