# Perfana User Guide

Perfana tells you whether a release meets its performance expectations. It collects
metrics from your performance tests, compares each run against historical baselines,
and automatically flags regressions and improvements — so you can decide whether to
ship.

This guide is for the people who **use** Perfana: performance engineers reading and
comparing test runs, and administrators setting up systems, integrations, and teams.
It is task-based — each article answers one question and walks you through it
step by step.

## New to Perfana?

Start here, in order:

1. **[Concepts](concepts.md)** — the handful of terms you need (test run, SUT, ADAPT, profile).
2. **[Sign in to Perfana](getting-started/sign-in.md)** — get into the app.
3. **[Navigate Perfana](getting-started/navigating.md)** — find your way around.
4. **[Read a test run](test-runs/read-a-run.md)** — the core thing you'll do every day.

## Find a task

| I want to… | Go to |
|---|---|
| Send test results from my CI pipeline | [Send your first test run](test-runs/send-first-run.md) |
| Upload a JMeter `.jtl` file by hand | [Upload a JMeter result file](test-runs/upload-jtl.md) |
| Understand why a run passed or failed | [Check SLO results](test-runs/slo-check-results.md) · [Understand ADAPT verdicts](test-runs/understand-adapt.md) |
| Compare two runs | [Compare test runs](test-runs/compare-runs.md) |
| Find the root cause of a regression | [Investigate root cause](test-runs/root-cause-analysis.md) |
| Share results with my team | [Generate and share a report](test-runs/generate-report.md) |
| Set up a new application to test | [Create a system under test](configuration/create-system-under-test.md) |
| Connect Grafana, Dynatrace, or tracing | [Integrations](integrations/connect-grafana.md) |
| Give a CI pipeline programmatic access | [Create an API key](administration/api-keys.md) |
| Manage who can see what | [Manage organizations](administration/organizations.md) · [Manage teams](administration/teams.md) |
