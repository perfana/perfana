# Define SLOs

Service Level Objectives (SLOs) are the checks Perfana evaluates against each test run. Define them so every run gets a clear pass/fail result instead of you reading raw graphs.

**Before you start**
- You have a [system under test](create-system-under-test.md).
- You know the metric and threshold you want to enforce (for example, p95 response time under 500 ms).

**Steps**
1. Open the system from **Systems Under Test** (`/systems`) using its **Actions** button.
   You see the system's configuration page.

2. Open the **Service Level Objectives** tab.
   You see the SLOs already defined for this system.
   [[SCREENSHOT: /systems/[id]/config — the Service Level Objectives tab]]

3. Add a Service Level Objective and set the metric, the comparison, and the threshold (for example, **p95 < 500 ms**).
   The check appears in the list and applies to future runs.
   [[SCREENSHOT: /systems/[id]/config — adding a check with metric and threshold]]

4. Save the check.
   New runs of this system are now evaluated against it.

**About Apdex thresholds**
Some checks use an Apdex score, a single 0–1 rating of user satisfaction based on two thresholds you set: a target time (requests at or under it are "satisfied") and a tolerating limit (up to four times the target by convention). Requests slower than the tolerating limit count as "frustrated". A higher Apdex score means more requests felt fast to users.

**Result**
The system has one or more SLOs. After a run completes, each check shows as passed or failed in the run's results — see [SLO and check results](../test-runs/slo-check-results.md).

**Tip**
To reuse the same checks across many systems, define them in a [profile](create-profile.md) instead and let runs inherit them.

**Related**
- [SLO and check results](../test-runs/slo-check-results.md)
- [Create a profile](create-profile.md)
- [Concepts](../concepts.md)
