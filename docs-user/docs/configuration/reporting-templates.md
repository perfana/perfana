# Manage reporting templates

A reporting template defines what a generated report contains and how it is laid out. Manage templates per system so your reports follow a consistent structure every time.

**Before you start**
- You have a [system under test](create-system-under-test.md).
- The Reporting integration is connected (the **Reporting Templates** tab appears only when it is).

**Steps**
1. Open the system from **Systems Under Test** (`/systems`) using its **Edit Config** button.
   You see the system's configuration page.

2. Open the **Reporting Templates** tab.
   You see the templates already defined for this system.
   ![The Reporting Templates tab in system configuration](../assets/sut-reporting-templates.png)
   *Figure: the Reporting Templates tab.*

3. Create a template and configure how it shapes the report.
   The template appears in the list and can be used when generating reports.

4. To remove a template, delete it and confirm in the dialog.
   The template is removed from the list once you confirm.

**Result**
The system has one or more reporting templates. When you generate a report for a run, you can apply a template so the output follows the structure you defined — see [Generate a report](../test-runs/generate-report.md).

## The Comments section

Add a **Comments** section to a template to put the team's [discussion of a run](../test-runs/comments.md) in its report.

- **Which comments**: by default the section lists the comments on every card. To narrow it, pick one or more cards in the section's settings; only threads on those cards are included.
- **How they are laid out**: threads are grouped by card. Each thread shows its first comment and its replies in the order they were written, each with the author and the time in UTC, and **(edited)** where a comment was changed. A thread's [tag](../test-runs/comments.md#tag-a-thread), such as **Root cause**, is printed before its first comment.
- **Graph markers**: a thread started with a [marker](../test-runs/comments.md#pin-a-marker-on-a-graphs-chart) on the Graphs card is headed by the chart it was placed on, drawn from the series and time range recorded with it, with the marker's number called out at its moment. Series that no longer have data are left out of that chart and counted in a note under it.
- **Configuration items**: a thread on a [configuration item](../test-runs/comments.md#comment-on-a-row) prints the comparison it was written against under its first comment, for example *Compared with run Shop-acc-load-00041: 4 → 8 (changed)*, so it stays readable after the card compares with another run.
- **Diff tabs**: a thread written on the Distributed tracing **Traces Diff** tab or the Pyroscope **Diff** view prints the baseline run, or the two time ranges of the run, it was compared with, and for tracing the **Compare Traces** result, under its first comment.
- **Deleted comments** appear as **Comment deleted** where a thread still has replies, so the replies keep their context. A deleted marker gets no chart.
- **Text stays text**: comment text is shown exactly as written. Formatting characters and HTML in a comment are not interpreted.

A report is a snapshot: comments added after you generate it appear only in a report generated again.

### Investigations in a report

Set the section's **Layout** to **Investigations** to print the run's published [investigations](../test-runs/comments.md#walk-through-an-investigation) instead of its threads. A section with no title of its own is headed **Investigations**. Every published investigation of the run is included, oldest publication first, with its title, author and conclusion, and then each step in order: its number, tag, card and row, the comment, and the author's note for that step. A step on a Graphs marker is headed by the marker's chart, and a step on a Configuration row shows the comparison it was written against, as in the **By card** layout. A step whose comment was deleted prints **Comment deleted** with its tag and note. An AI agent's investigation names the person who published it and marks the agent, for example *Anna published · proposed by Claude analysis agent* followed by an **AI** chip, and a step written by an agent carries the **AI** chip next to its author. Drafts are never printed, comments that are in no investigation are left out, and the **Cards** filter does not apply. A run with no published investigation shows "No published investigations for this run." To have both the threads and the investigations in one report, add two Comments sections. Sections saved before this option existed keep the **By card** layout.

## The Loki Logs section

Add a **Loki Logs** section to put what the run's logs said into its report: the findings of the Loki Logs card on the run page, frozen at generation. It needs [Loki panels](../integrations/connect-loki.md) on the run's workload; without them the section says so.

The section always opens with four figures: the **error rate** (error lines as a share of all lines) against the baseline, with **Higher**, **Lower** or **In line** beside it, and the counts of **log lines**, **error lines** and **new patterns**. The baseline is the run's control group, or its previous runs when it has none, and is named at the top of the section.

What follows is set in the section's settings:

| Setting | Default | What it adds |
|---|---|---|
| **Applications** | on | Lines, errors, warnings and error rate per application, against the baseline, worst first. An application missing from every baseline run is marked **New**. |
| **Top log patterns** | on | The most frequent log patterns, each marked **New** when no baseline run had it, with a link to the lines in Grafana Explore. |
| **Only new patterns** | off | Leaves the patterns the baseline already had out of that table. Turn it on for a short "what is new in this release" report. |
| **Latest error lines** | off | The newest sampled error lines, verbatim. Log lines can carry user ids, hostnames or tokens: check them before you share or publish the report. |
| **Loki panel totals** | off | The top series of each Loki panel over the whole run. |
| **Levels** | Errors and warnings | Which levels the pattern and line tables list. |
| **Rows per table** | 10 | Up to 50. |
| **Applications** filter | all | Narrows every figure and table to the applications you pick (values of the connection's application label). Add one section per application to report them separately. |

**Suggested setups**
- *Release report*: the defaults. One look tells a reader whether the logs got worse and which application and pattern to blame.
- *Regression hunt*: **Only new patterns** on, **Levels** set to **Errors**, **Latest error lines** on.
- *Per-team report*: one section per application, each with the **Applications** filter set and **Applications** off.

The section reads the pattern and line snapshot taken when the run was analysed, never Loki itself, so it does not depend on how long Loki keeps the logs. It is published to Confluence as tables, with **New**, **Higher** and level badges as status lozenges and the Explore links kept.

**Related**
- [Connect Loki](../integrations/connect-loki.md)
- [Comment on a test run](../test-runs/comments.md)
- [Generate a report](../test-runs/generate-report.md)
- [Create a system under test](create-system-under-test.md)
