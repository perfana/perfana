# Comment on a test run

Comments let your team discuss a test run where the evidence is: on a card of the run page, on a row inside a card, or at a moment on a Graphs chart. Each comment starts a thread that others can reply to, and everyone who can see the run sees the thread.

**Before you start**

- Open a test run at `/test-runs/[id]`.
- You need a Perfana login. An API key can read comments but cannot write, edit or delete them, unless it was created with **Allow writing comments**: then it writes as an AI agent, marked as such (see [Comments from AI agents](#comments-from-ai-agents)), and still cannot delete anything.

## Start a thread on a card

1. Hover over the card you want to comment on.
   A comment icon appears just outside the card's top-right corner.
2. Click the icon.
   The card expands if it was collapsed, and its comments panel opens beside it (below it on a narrow screen).
3. Type your comment in **New comment on this card…** and click **Comment**, or press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> (<kbd>Cmd</kbd>+<kbd>Enter</kbd> on a Mac).
   The thread appears in the panel, and others see it within a second without reloading the page.

Comments are plain text, up to 10,000 characters.

## Comment on a row

Some cards take comments on a single row or section as well as on the whole card: a transaction in **Performance analysis** (on the Overview tab, in each Top 10 list, and an error group on the Error Analysis tab), a row in **Anomaly detection**, an SLO, a Splunk panel, a Loki panel or log pattern, a Dynatrace service, a tracing service, a Pyroscope profiler, a configuration item on **Configuration** or a dashboard tile on **Dashboards**.

1. Hover over the row. An outlined comment icon appears at its end.
2. Click it.
   The card's comments panel opens with **Comment on *row name*…** in the composer.
3. Write the comment and click **Comment**.

A row with threads shows a filled comment icon, with a dot when someone else wrote there since you last looked. To comment on the whole card instead, click the close icon next to the row name in the composer.

A comment on a **Performance analysis** Top 10 row belongs to that list: the same transaction in another Top 10 list does not show it. A tab of the card that holds commented rows shows a small comment icon in its label. **Show in context** opens the right tab and scrolls to the row; if the tab's own filters, the scenario filter or the **Analysis timerange** switch hide the row, the thread still opens but there is no row to scroll to.

When you open a comment on a configuration item or a dashboard tile, from its link, **Show in context** or an investigation step, the card shows only that item, whatever filters you had set. A bar above the list reads *Showing the item from a comment:* with the item's name, and **Show all** brings back your own filters as you left them. A comment on a configuration item also records which run the card was comparing with: **Restore view** selects that run again, with **Undo** to go back, and the report prints the comparison under the comment. A comment written on the **Traces Diff** tab of the Distributed tracing card, or the **Diff** view of the Pyroscope card, records that it was written on the diff and what it compared: the baseline run, or with **Two time ranges in this run** both ranges as times from the run's start; on the tracing card it also records a summary of the **Compare Traces** result on screen (trace counts, average duration against the baseline, likely root causes, new and missing spans, new errors) and the request it was computed for. That line shows under the comment and in the report. It has no **Restore view**.

## Tag a thread

A tag says what a thread is in an analysis, so a reader can tell the symptom from the cause at a glance. Tags go on the first comment of a thread; replies are never tagged.

| Tag | Use it for |
|---|---|
| **Symptom** | what was observed, for example "p95 jumps at 14:32" |
| **Hypothesis** | a possible explanation that is still being checked |
| **Evidence** | something that supports or narrows down a hypothesis |
| **Ruled out** | an explanation that was checked and does not hold |
| **Root cause** | the explanation you settle on |
| **Action** | what to do about it: a fix, a re-run, a follow-up |

- **When you write it**: pick a tag in **Add tag** next to the **Comment** (or **Place marker**) button. A thread can have one tag, or none.
- **Later**: click **Edit** under your own first comment and change or remove the tag. Only the author can change a tag. Changing only the tag does not mark the comment **(edited)**.

The tag is shown above the thread's text in the panel, and before the comment in the report's Comments section. A deleted comment keeps its tag.

A thread whose first comment is a step of an investigation you can see shows a chip per investigation under it in the panel, such as **In: Checkout latency after deploy**, the same as in the Comments dialog. Click one to open that investigation in the reader.

## Reply, edit and delete

- **Reply**: click a thread to expand it, then type in **Reply…** and click **Reply**. Threads are one level deep: every reply belongs to the thread's first comment.
- **Edit**: click **Edit** under one of your own comments, change the text and click **Save**. An edited comment shows **(edited)** after its time.
- **Delete**: click **Delete** under one of your own comments and confirm. An organization admin also sees **Delete** under other people's comments, to remove one that should not be there.

**Edit** appears on your own comments only, so nobody can change what someone else wrote. What deleting leaves behind depends on the comment:

- A reply, or a thread with no replies, disappears completely.
- The first comment of a thread that has replies, every graph marker, and every comment that is a step of an [investigation](#walk-through-an-investigation) is replaced by **Comment deleted**. The replies stay readable, and a deleted marker keeps its number on the chart, greyed out. Nobody can reply to a deleted thread. When the comment is in an investigation you can see, the delete confirmation names the investigation and the step.

## See what is new

Perfana keeps track, per card, of which comments you have seen.

- **On a card**: a red badge with a number means that many comments by others are unread. A grey badge shows the total when you have read them all. A card with no comments shows no badge.
- **In the run header**: the comments icon next to the tabs shows the run's comment total, in red while comments by others or an [investigation](#walk-through-an-investigation) are unread. Its tooltip says what, for example *Comments: 12, 3 unread · Investigations: 1 unread*. Click it to open the [Comments dialog](#see-every-comment-on-the-run), where **Next unread** opens the next card, in page order, that still has unread comments, so you can work through them one card at a time.
- **In the Comments dialog**: the **All comments** and **Investigations** tabs each show how many are unread, and every unread thread or investigation in their lists is marked with a red dot. A thread counts as unread when its first comment or any reply is.
- **In the test-run list**: a run with comments shows a comment badge. Clicking it opens the run at the first card with unread comments, or at the first card with comments when you have read them all. This badge counts comments only, not investigations.
- **In the panel**: unread threads are tinted and marked with a dot, and listed first.

A comment counts as seen once you open the comments panel of its card. Loading the page, expanding a card, opening the Comments dialog or reading an investigation does not mark any comment as read. Only comments from the last 30 days count as unread, and your own comments never do.

An investigation counts as unread when someone else published it since you last opened it: a new publication, publishing it again after unpublishing, or changing its steps while it is published all make it unread again, while a correction to its title or conclusion does not. An AI agent's draft is unread until you open it, and again whenever the agent changes it. Opening an investigation in the reader marks it as read. Your own investigations never count, and only the last 30 days do.

## See every comment on the run

The comments icon in the run header, next to the **Results**, **Root Cause Analysis** and **Reporting** tabs, opens the **Comments** dialog. The icon shows the run's comment total, turns red while there are unread comments by others, and only appears once the run has comments or investigations. On a phone the dialog fills the screen.

The dialog has two tabs:

- **All comments**: the first comment of every thread on the run, newest first, with its tag, card, row or marker, author, time, the first two lines of its text and its number of replies. A comment that is a step of an investigation you can see shows a chip per investigation, such as **In: Checkout latency after deploy** (two at most, then **+N**); click one to open that investigation in the reader. Narrow the list by tag (click a tag chip; pick several to see any of them), by card, by author, to **Markers only**, or to comments **Not in an investigation yet**.
- **Investigations**: the run's [investigations](#walk-through-an-investigation).

On each comment:

- **Show in context** closes the dialog, opens the card, scrolls to the row, shows the recorded chart view and opens the thread, exactly as a [link to the comment](#link-to-a-comment) does.
- **Add to investigation** adds the comment to one of your investigations, or starts a new one.

**Next unread (n)**, at the top of the dialog while anything is unread, closes the dialog and opens the next card with unread comments. Opening the dialog itself marks nothing as read.

## Walk through an investigation

An analysis usually spans several cards: a symptom on **Performance analysis**, evidence on **Graphs**, a host checked on **Dynatrace**, the cause in **Configuration**. An investigation puts those comments in the order that makes sense, so a reviewer can follow your reasoning from one link, seeing each comment's evidence on the page, instead of searching the cards for it.

An investigation never copies a comment: each step points at a thread, so the reader always sees the comment's current text.

### Start an investigation

1. On a thread's first comment, click **Add to investigation**: in the **All comments** tab, or under the thread in a card's comments panel.
2. Pick one of your investigations to add the comment as its last step, or click **New investigation…**, type a title and click **Create**.

A new investigation is a **draft**: only you can see it.

### Edit an investigation

Open the run's **Comments** dialog, go to **Investigations** and click **Edit** on one of your investigations. You can:

- change the **Title** and the **Conclusion**, the last thing a reader sees;
- reorder the steps by dragging the handle, or with the up and down arrows;
- add a **Note** to a step, your connecting words such as "so I looked at the hosts…";
- remove a step (the comment itself stays);
- click **Suggest order** to sort the steps by tag, from **Symptom** to **Action**, and then by when each comment was written. It sorts once; you can reorder afterwards.

Click **Save** to keep your changes. An investigation holds at most 50 steps, and each comment appears in it once.

### Publish

Click **Publish** to let everyone who can see the run read the investigation; **Unpublish** makes it a draft again. An investigation needs at least one step before it can be published. Only the author edits, publishes or unpublishes an investigation (an AI agent's draft is the exception, see [Review an agent's investigation](#review-an-agents-investigation)). The author, an organization admin and a global admin can delete it; deleting an investigation never deletes its comments.

### Read an investigation

Click **Read** on an investigation in the **Investigations** tab, or one of the **In: …** chips on a comment in **All comments**. The dialog closes and the investigation opens:

1. **Introduction**: the title, the author and the list of steps. Click **Start**, or a step to begin there.
2. **Steps**: a bar at the bottom of the screen shows the step number (*Investigation · step 3 of 6*), the tag, the card and row, the comment (click **more** for a long one), its author and the author's note for the step. Behind it, the page opens the card, scrolls to the row, shows the recorded chart view and opens the card's comments panel on that thread, so its replies are right there. Opening the panel marks that card's comments as read, as opening it yourself does. If you close the panel, **Open thread** opens it again.
3. **Conclusion**: the investigation's conclusion, with links back to any step.

Use **‹ Prev** and **Next ›**, or the left and right arrow keys, to move through the steps. Press <kbd>Esc</kbd> or click the close icon to leave the investigation. Leaving puts every chart card the investigation changed back to the view you had before, so no single step needs an undo. A row filter that a step applied on **Configuration** or **Dashboards** stays until you click **Show all**.

A step whose comment was deleted shows **Comment deleted**, with its tag and note, and does not move the page. A step on a card this run no longer shows (for example, after an integration was removed) says **card not available on this run**.

Opening an investigation marks the investigation itself as read, but none of the comments in it. The address of each step is shareable (the parameter is still called `story`):

```
/test-runs/[id]?story=<investigation id>&step=<n>
```

Without `step`, the link opens the introduction.

### Share an investigation

When an investigation is published, every channel of the system that has [comment notifications](../configuration/notifications.md#notify-on-comments) turned on gets one message, for example "Daniel published an investigation on Shop run Shop-acc-load-00042: Checkout latency after deploy (6 steps)", with a link to the investigation's introduction. It names the investigation's title but not its conclusion or its comments. An investigation is announced once: unpublishing and publishing it again sends nothing new, and an investigation deleted before the message went out is not announced. To print published investigations in a report, set the **Comments** report section's layout to **Investigations** (see [Reporting templates](../configuration/reporting-templates.md#investigations-in-a-report)).

## Link to a comment

Every thread has its own address:

```text
/test-runs/[id]?card=<card>&comment=<comment id>
```

Opening it expands the card, opens its comments panel and highlights the thread. If the comment has a recorded chart view, the link also shows that view (see [Restore a chart view](#restore-a-chart-view)). The links that [comment notifications](../configuration/notifications.md#notify-on-comments) post to your chat channel use this form.

## Pin a marker on a Graphs chart

A marker is a numbered pin at one moment of a chart, with a thread attached. Use it to point at the spike, the drop or the step change you want to talk about.

1. On the **Graphs** card, build the chart you want to discuss.
2. Click **+ add marker** above the chart.
   The label changes to **placing marker…** and the cursor becomes a crosshair.
3. Click the point on the chart where something happens.
   The pin snaps to the nearest data point, and the Graphs comments panel opens with **New marker at** and the time.
4. If the pin is one step off, use the arrow buttons next to the time to move it one data point earlier or later. You can do this without a mouse.
5. Describe what happens there and click **Place marker**. Press <kbd>Esc</kbd> or click **Cancel** to drop the pin instead.

**Result**
The chart shows a numbered pin, and the thread in the panel carries the same number. Click a pin to open its thread. A pin outside the plotted time range is hidden until you zoom out to include it.

Markers are numbered per run, starting at 1. A number is never reused: when marker ② is deleted, ③ stays ③ and the next new marker is ④.

## Restore a chart view

When you start a thread on the **Graphs**, **Trends** or **Compare** card, Perfana records what the card was showing, so readers can see the chart you were looking at:

- **Graphs**: the series, the zoomed time range, the chart title and the axis mode.
- **Trends**: the series, the time range and the aggregation. A relative range such as "Last week" is stored as the dates it covered when you wrote the comment.
- **Compare**: the series and the baseline.

An expanded thread with a recorded view shows one line describing it, for example *Placed on 3 series · …*, and a **Restore view** button.

1. Click **Restore view**.
   The card replaces what it is showing with the recorded view, and a message confirms it, for example *Showing marker 2's view*.
2. To go back to what you had before, click **Undo** in that message.

A few things to know:

- The recorded view decides what is shown. If a graph preset was used, later changes to that preset do not change the view.
- If some series have no data any more (a dashboard was removed, or a grouping rule changed), Perfana draws the ones that still resolve and says how many are missing.
- On Compare, a baseline that is no longer offered is left as it is, and the message says so.
- A card that was empty when you commented records no view.

## Comments from AI agents

An AI agent connected through the Perfana MCP server can leave its analysis on a run as comments, if your organization gave it an API key with **Allow writing comments** ([Create an API key](../administration/api-keys.md)). Its comments look like anyone else's, with three differences:

- An **AI** chip next to the author, who is the API key's description (for example *Claude analysis agent*). Read an agent's *root cause* as a proposal to check, not a colleague's conclusion.
- They are never posted to Slack, Teams or Mattermost channels.
- They count as unread like other comments, and the unread button in the run header says how many came from agents, for example *5 unread (3 from AI)*.

An agent pins each comment to what it is about, in the same places you can: a transaction row on **Performance analysis**, a row in **Anomaly detection**, a configuration item (with the comparison it was looking at), a tile on **Dashboards**, an SLO row, a numbered marker on a **Graphs** series, a tracing service (with the request filters it was looking at), or a Pyroscope profiler, in single or diff view. A diff view compares with the most recent earlier completed run of the same workload. On the Dynatrace and Splunk cards an agent comments on the whole card. Perfana checks the thing exists in the run before it accepts the comment. You can reply to an agent's comment, and the agent can answer. It cannot delete anything; an organization admin can delete an agent's comment as for any other author. The **Comments** report section prints the AI chip too.

### Review an agent's investigation

An agent can also assemble its comments into an investigation and hand its user a link to it. Such an investigation is a proposal, and a person decides whether the team gets to see it as a finding:

- It starts as a draft labelled **AI draft · not reviewed**, with the **AI** chip next to the agent's name. Unlike your own drafts, everyone who can see the run sees it on the **Investigations** tab of the run's **Comments** dialog, marked unread until they open it, otherwise nobody could review it.
- Anyone who can comment on the run can open it with **Edit**, then reword the title, conclusion and step notes, reorder or remove steps, or **Delete investigation** if the proposal is wrong. Check each step against the run before you publish: the agent's comments are pinned to things that exist in the run, but the claims in them are not checked.
- **Publish** makes it an investigation like any other, and names you as its reviewer: it then reads *Proposed by Claude analysis agent · reviewed and published by Anna*. After that only you can edit or unpublish it (an organization admin can still delete it), and the agent can no longer change it.

The agent cannot publish its own investigation or delete one, and it may create at most 10 investigations per run.

## Related

- [Read a test run](read-a-run.md)
- [Send notifications to Slack, Teams or Mattermost](../configuration/notifications.md) — including posts when comments are added
- [Generate and share a report](generate-report.md) — the **Comments** report section
