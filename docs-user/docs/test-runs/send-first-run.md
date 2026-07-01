# Send your first test run

This lets your load-test tool (Gatling, JMeter, k6, NeoLoad) push results into Perfana automatically, so every run is collected, analysed, and ready to inspect. Do this once to wire up your pipeline; afterwards every test run shows up on its own.

**Before you start**
- An **API key** to authenticate the call. See [Create an API key](../administration/api-keys.md).
- A **name** for your system under test (SUT) — for example `checkout-service`. The system does **not** need to exist beforehand: Perfana creates it automatically the first time it sees a new name.
- The values that identify a run: the **system name**, a **test environment**, a **workload**, and a **test run id**.

**Steps**

1. **Create an API key** in Perfana and copy the token.
   You now have a Bearer token your pipeline can send. See [Create an API key](../administration/api-keys.md) for the exact steps.

2. **Have your load-test tool call `POST /api/test`** at the start of the test, with the API key as a Bearer token and the run details in the JSON body. The `systemUnderTest` field is the **name** of your application — if no system with that name exists yet, Perfana creates it. A minimal example:

   ```bash
   curl -X POST http://localhost:3001/api/test \
     -H "Authorization: Bearer <your-api-key>" \
     -H "Content-Type: application/json" \
     -d '{
       "systemUnderTest": "checkout-service",
       "testEnvironment": "acceptance",
       "workload": "checkout-load",
       "testRunId": "checkout-load-2026-06-30-001"
     }'
   ```

   Perfana creates the run with status **INITIALIZING** — along with the system under test, if this is a new name — and starts collecting metrics for the test window.

3. **Watch the run appear** on the Test Runs list at `/test-runs`.
   A new row shows up for your run, with its system, environment, and workload.
   ![The Test Runs list showing runs with System, Environment, and Workload columns](../assets/test-runs-list.png)
   *Figure: your run appears in the Test Runs list.*

4. **Let the test finish.** When your tool signals completion (or the test window ends), Perfana runs analysis automatically, including ADAPT regression detection.
   The run moves out of INITIALIZING and its checks and analysis become available on the run detail page.

**Result**
Your load-test tool now creates a Perfana run on every execution, with metrics collected and analysis run on completion. The first run also creates the system under test, which you can then configure — see [Create a system under test](../configuration/create-system-under-test.md). This call is the building block for a CI performance gate: your pipeline can fail the build when Perfana reports a regression.

**Tip — see a populated run fast**
If you want to explore a fully populated run before writing any integration code, clone the **perfana-demo** repository and run `npm run seed`. It loads example runs you can browse immediately.

**Troubleshooting**
- *401 Unauthorized* — the API key is missing, mistyped, or expired. Check the `Authorization: Bearer <key>` header and create a fresh key if needed.
- *A duplicate system appeared* — `systemUnderTest` is matched by exact name, so a typo creates a second, separate system. Send the same spelling on every run.
- *The run never leaves INITIALIZING* — your tool never signalled completion and the window has not closed. Confirm your pipeline calls the completion step for the run.

**Related**
- [Create a system under test](../configuration/create-system-under-test.md)
- [Create an API key](../administration/api-keys.md)
- [Upload a JMeter result file](upload-jtl.md)
- [Key concepts](../concepts.md)
