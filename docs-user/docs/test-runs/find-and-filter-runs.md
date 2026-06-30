# Find and filter test runs

Browse all your test runs, narrow the list to the ones you care about, share that view, and act on several runs at once.

**Before you start**
- You need to be signed in with an active organization. See [Navigate Perfana](../getting-started/navigating.md).

**Steps**
1. In the sidebar, open **Test Runs**.
   You see a paginated table of runs, with running and completed runs listed.
   ![The Test Runs list with the filter bar and the runs table](../assets/test-runs-list.png)
   *Figure: the Test Runs list - filter by System, Environment, and Workload.*
2. Narrow the list with the **System**, **Environment**, and **Workload** filters at the top.
   The table updates to show only matching runs.
3. To clear all filters, click **Reset filters**.
   The table returns to showing every run.
4. To share exactly what you're looking at, click the **Share** icon.
   A link to the current filtered view is copied to your clipboard, ready to paste to a teammate.
5. To act on several runs at once, select the checkboxes on the rows you want.
   A batch toolbar appears with actions for the selected runs.

**Batch actions**

- **Re-evaluate** — re-runs the SLO checks and analysis against the existing collected data.
- **Re-fetch** — pulls the metrics again from the data sources, then re-evaluates.
- **Mark as Changepoint** — marks the runs as a permanent performance shift that resets the baseline.
- **Remove Changepoint** — removes that change point mark.
- **Delete** — permanently removes the selected runs. You're asked to confirm first.

**Result**
You've found the runs you need, optionally shared the view, and run any batch action across your selection.

**Troubleshooting**
- *The list is empty* — check that the correct organization is active and that your filters aren't too narrow. Click **Reset filters** to start fresh.
- *A run shows progress but no results yet* — collection or analysis is still running. The live progress banner at the top of the page shows active jobs.

**Related**
- [Read a test run](read-a-run.md)
- [Understand ADAPT verdicts](understand-adapt.md)
