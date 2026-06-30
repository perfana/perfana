# Send your first test run

This lets your load-test tool (Gatling, JMeter, k6, NeoLoad) push results into Perfana automatically, so every run is collected, analysed, and ready to inspect. Do this once to wire up your pipeline; afterwards every test run shows up on its own.

**Before you start**
- An **API key** to authenticate the call. See [Create an API key](../administration/api-keys.md).
- The **systemUnderTestId** of the system you are testing (the system must already exist in Perfana).
- The three coordinates that identify a run: **systemUnderTestId**, **testEnvironment**, and **workload**.

**Steps**

1. **Create an API key** in Perfana and copy the token.
   You now have a Bearer token your pipeline can send. See [Create an API key](../administration/api-keys.md) for the exact steps.

2. **Find your systemUnderTestId**. Open the system in Perfana, or list your systems through the API at `http://localhost:3001/api/docs`.
   You have the identifier that ties this run to the right system.
   [[SCREENSHOT: /api/docs — the GET /systems-under-test endpoint, highlight the id field in the response]]

3. **Have your load-test tool call `POST /api/test-runs/init`** at the start of the test, with the API key as a Bearer token and the three coordinates in the JSON body. A minimal example:

   ```bash
   curl -X POST http://localhost:3001/api/test-runs/init \
     -H "Authorization: Bearer <your-api-key>" \
     -H "Content-Type: application/json" \
     -d '{
       "systemUnderTestId": "<your-sut-id>",
       "testEnvironment": "acceptance",
       "workload": "checkout-load",
       "testRunId": "checkout-load-2026-06-30-001"
     }'
   ```

   Perfana creates the run with status **INITIALIZING** and starts collecting metrics for the test window.

4. **Watch the run appear** on the Test Runs list at `/test-runs`.
   A new row shows up for your run, with its system, environment, and workload.
   [[SCREENSHOT: /test-runs — the new run row, highlight status and the SUT/environment/workload columns]]

5. **Let the test finish.** When your tool signals completion (or the test window ends), Perfana runs analysis automatically, including ADAPT regression detection.
   The run moves out of INITIALIZING and its checks and analysis become available on the run detail page.

**Result**
Your load-test tool now creates a Perfana run on every execution, with metrics collected and analysis run on completion. This call is the building block for a CI performance gate: your pipeline can fail the build when Perfana reports a regression.

**Tip — see a populated run fast**
If you want to explore a fully populated run before writing any integration code, clone the **perfana-demo** repository and run `npm run seed`. It loads example runs you can browse immediately.

**Troubleshooting**
- *401 Unauthorized* — the API key is missing, mistyped, or expired. Check the `Authorization: Bearer <key>` header and create a fresh key if needed.
- *The run never leaves INITIALIZING* — your tool never signalled completion and the window has not closed. Confirm your pipeline calls the completion step for the run.
- *404 / system not found* — the `systemUnderTestId` is wrong or the system does not exist yet. Verify the id from step 2.

**Related**
- [Create an API key](../administration/api-keys.md)
- [Upload a JMeter result file](upload-jtl.md)
- [Key concepts](../concepts.md)
