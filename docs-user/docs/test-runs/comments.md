# Comment on a test run

Comments let your team discuss a test run where the evidence is: on a card of the run page, on a row inside a card, or at a moment on a Graphs chart. Each comment starts a thread that others can reply to, and everyone who can see the run sees the thread.

**Before you start**

- Open a test run at `/test-runs/[id]`.
- You need a Perfana login. Comments are always written by a person: an API key can read comments but cannot write, edit or delete them.

## Start a thread on a card

1. Hover over the card you want to comment on.
   A comment icon appears just outside the card's top-right corner.
2. Click the icon.
   The card expands if it was collapsed, and its comments panel opens beside it (below it on a narrow screen).
3. Type your comment in **New comment on this card…** and click **Comment**, or press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> (<kbd>Cmd</kbd>+<kbd>Enter</kbd> on a Mac).
   The thread appears in the panel, and others see it within a second without reloading the page.

Comments are plain text, up to 10,000 characters.

## Comment on a row

Some cards take comments on a single row or section as well as on the whole card: a transaction in **Performance analysis**, an SLO, a Splunk panel, a Dynatrace service, a tracing service or a Pyroscope profiler.

1. Hover over the row. An outlined comment icon appears at its end.
2. Click it.
   The card's comments panel opens with **Comment on *row name*…** in the composer.
3. Write the comment and click **Comment**.

A row with threads shows a filled comment icon, with a dot when someone else wrote there since you last looked. To comment on the whole card instead, click the close icon next to the row name in the composer.

## Reply, edit and delete

- **Reply**: click a thread to expand it, then type in **Reply…** and click **Reply**. Threads are one level deep: every reply belongs to the thread's first comment.
- **Edit**: click **Edit** under one of your own comments, change the text and click **Save**. An edited comment shows **(edited)** after its time.
- **Delete**: click **Delete** under one of your own comments and confirm. An organization admin also sees **Delete** under other people's comments, to remove one that should not be there.

**Edit** appears on your own comments only, so nobody can change what someone else wrote. What deleting leaves behind depends on the comment:

- A reply, or a thread with no replies, disappears completely.
- The first comment of a thread that has replies, and every graph marker, is replaced by **Comment deleted**. The replies stay readable, and a deleted marker keeps its number on the chart, greyed out. Nobody can reply to a deleted thread.

## See what is new

Perfana keeps track, per card, of which comments you have seen.

- **On a card**: a red badge with a number means that many comments by others are unread. A grey badge shows the total when you have read them all. A card with no comments shows no badge.
- **In the run header**: a red button shows the run's total unread count. Each click opens the next card, in page order, that still has unread comments, so you can work through them one card at a time. The button disappears when nothing is unread.
- **In the test-run list**: a run with comments shows a comment badge. Clicking it opens the run at the first card with unread comments, or at the first card with comments when you have read them all.
- **In the panel**: unread threads are tinted and marked with a dot, and listed first.

A comment counts as seen once you open the comments panel of its card. Loading the page or expanding a card does not mark anything as read. Only comments from the last 30 days count as unread, and your own comments never do.

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

## Related

- [Read a test run](read-a-run.md)
- [Send notifications to Slack, Teams or Mattermost](../configuration/notifications.md) — including posts when comments are added
- [Generate and share a report](generate-report.md) — the **Comments** report section
