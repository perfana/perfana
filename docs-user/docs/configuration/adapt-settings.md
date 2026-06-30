# Configure ADAPT

ADAPT is Perfana's automated regression detection. It compares each run against a baseline and flags metrics that have changed. Configure it per system to control how sensitive that detection is.

**Before you start**
- You have a [system under test](create-system-under-test.md).
- You have at least one run you are happy to treat as the baseline (the "known good" point of comparison).

**Steps**
1. Open the system from **Systems Under Test** (`/systems`) using its **Actions** button.
   You see the system's configuration page.

2. Open the **ADAPT Settings** tab.
   You see the current detection settings for this system.
   [[SCREENSHOT: /systems/[id]/config — the ADAPT Settings tab]]

3. Adjust the sensitivity to match how much change you consider normal:
   - **Tighten** sensitivity to catch smaller changes. ADAPT flags more runs, including minor shifts. Use this when even small slowdowns matter.
   - **Loosen** sensitivity to tolerate more variation. ADAPT flags only larger changes. Use this when your environment is noisy and small swings are expected.
   The settings update for this system's future comparisons.

4. Save the settings.
   New runs of this system are analysed using the values you set.

**Result**
ADAPT applies your chosen sensitivity to each new run. If a metric drifts beyond what you allow, the run is flagged as a regression. For how to read the outcome, see [Understand ADAPT results](../test-runs/understand-adapt.md).

**Troubleshooting**
- *Too many runs flagged as regressions* — your sensitivity is too tight, or the baseline is not representative. Loosen the sensitivity or pick a more stable baseline.
- *Real slowdowns are missed* — sensitivity is too loose. Tighten it so smaller changes are caught.

**Related**
- [Understand ADAPT results](../test-runs/understand-adapt.md)
- [Concepts](../concepts.md)
