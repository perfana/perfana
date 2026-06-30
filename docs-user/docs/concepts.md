# Concepts

Perfana uses a small set of terms throughout the app. Learn these once and the rest of
the guide reads easily. You don't need to understand how anything works internally —
just what each word means.

## The core hierarchy

**System under test (SUT)**
: The application or service whose performance you measure — for example
  `checkout-service`. Everything else hangs off the SUT: its environments, workloads,
  dashboards, and SLOs.

**Test environment**
: The deployment a test ran against — for example `acc` or `prod-like`.

**Workload**
: The named load scenario or script that was run — for example `peak-hour` or `smoke`.

**Test run**
: One execution of a performance test, identified by its SUT + test environment +
  workload. Perfana collects its metrics, analyzes them, and gives the run a verdict.
  Runs with the same SUT + environment + workload are directly comparable.

## How a run gets judged

**SLO (Service Level Objective) / check**
: A performance threshold you define — for example *p95 response time < 500 ms*.
  Perfana evaluates each run against its SLOs and produces pass/fail **check results**.
  ("Benchmark" means the same thing in some older screens.)

**ADAPT**
: Perfana's automated regression detection. Instead of you setting every threshold by
  hand, ADAPT statistically compares a run's metrics against a baseline of similar past
  runs and labels each metric **No change**, **Improvement**, **Regression**, or
  **Inconclusive**, then gives the run an overall verdict. See
  [Understand ADAPT verdicts](test-runs/understand-adapt.md).

**Baseline / control group**
: The set of similar historical runs (same SUT + environment + workload) that defines
  "normal". ADAPT and run comparison measure against this baseline.

**Change point**
: A moment when performance shifts permanently — for example after an infrastructure
  upgrade. Marking a change point resets the baseline so older, no-longer-comparable
  runs stop polluting the analysis.

**Apdex**
: A score from 0 to 1 that summarizes how satisfying response times were for a
  transaction, based on thresholds you set. 1.0 is perfect; lower means slower.

## What feeds the analysis

**Metrics source**
: An external system Perfana pulls data from: **Grafana** (and through it InfluxDB and
  Prometheus), **Dynatrace**, **Pyroscope** (profiling), and **Tempo / Jaeger / Elastic**
  (distributed traces) — plus the raw results from your load-test tool.

**Profile**
: A reusable bundle of "what to monitor" — a named set of Grafana dashboards plus SLOs.
  When a test run starts it inherits its profile, so analysis is set up automatically
  instead of configured per run.

## Who sees what

**Organization**
: The top-level tenancy boundary. Every resource belongs to one organization. You pick
  your active organization in the sidebar.

**Team**
: An optional group within an organization. Teams own systems and have their own
  members and roles.

**Roles**
: Your role (such as org admin, member, or viewer) decides what you can see and change.
  Some screens — like **Organizations** and **Audit Logs** — appear only to
  administrators.
