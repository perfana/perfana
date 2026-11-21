# Design: Comment tags, a run-wide comments dialog and analysis stories

Generated on 2026-11-21
Builds on: [test-run-comments.md](test-run-comments.md) (migrations 1827, 1828; PR1–PR3 as built)
Repo: perfana/perfana
Status: DRAFT — for review
Mode: Builder

## Problem Statement

Test-run comments (v1) are attached to a card, and optionally to an item on that card or a moment on the Graphs chart. That works for a single remark. It fails for an *analysis*, which in practice spans several cards and has a shape: a **symptom** (p95 jumps at 14:32 on Performance analysis), **evidence** for and against hypotheses (GC pause time on Graphs, a clean AWR report, CPU saturation on one host in Dynatrace), a **root cause** (a configuration item: heap size), and an **action** (raise the heap, re-run).

Today the reader of such an analysis has to:

- find the comments: they are spread over up to 17 card drawers, and the run-header button walks them in **page order**, not in the order the analysis makes sense;
- work out which comment is the symptom and which the cause: nothing says so;
- reconstruct the reasoning: nothing relates one comment to another.

The commenter knows the story. Perfana gives them no way to tell it.

A second gap makes this worse for two cards that matter most to root causes. **Configuration** and **Dashboards** take card-level comments only. "heap.max dropped from 2 GB to 512 MB" cannot be pinned to the `heap.max` row, and "look at the JVM dashboard" cannot be pinned to that dashboard, so a reader opening the comment lands on a card with dozens of rows and has to find the item themselves. The Configuration card makes it harder still: its default status filter shows only `changed` and `new` items, so the item a comment talks about can be hidden when the card opens.

## What Makes This Cool

- The evidence is already live. A comment on Graphs, Trends or Compare stores the view its author was looking at (`chart_context`), and the `?card=&comment=` deep link already reveals the card, focuses the item and replays that view. A story is an ordered walk over those deep links, so each step puts the reader **in front of the chart, row or config item it talks about**, not in front of a quote of it.
- "Ruled out" is a first-class step. The checks that found nothing are often what a reviewer most needs, and today they are the comments people delete.
- The same story becomes the report narrative, with the marker charts the Comments report section already draws.
- Structured tags are the groundwork for cross-run memory (the "coolest unconsidered version" in the v1 design): "last time this symptom showed up on this metric, the root cause was GC".

## Constraints

All v1 constraints carry over unchanged. The ones that bite here:

- **Multi-tenant RBAC.** New tables carry `organizationId` / `teamId` copied from the `test_runs` row (camelCase in `repo.create`), RLS policies, and service-layer org checks on every route including by-id reads: `withOrgFilter` once per request, required parameter, **404 not 403** outside the caller's orgs, `[]` early on an empty org list (CLAUDE.md Common Issue #48).
- **Realtime** goes through `TestRunsGateway` with rooms resolved from the row's own ownership, never the caller's `UserCtx`, never a broadcast (Common Issue #58). Draft stories must not leak through it (see Realtime).
- **API keys cannot write** comments (v1 eng review R3). This design narrows that: a key that opts in with a new `comments:write` role can write comments and stories as an *agent* author, for the MCP server (see MCP). Every other key keeps getting 403 on writes, and GETs stay open.
- **Migrations** above the current head (1828), no `SAVEPOINT` (Common Issue #64), and every new FK gets an index on the referencing column (Common Issue #57).
- **SUT export/import** carries comments (v1 R9); whatever references comments must travel with them, and a new column on an exported table can be `NOT NULL DEFAULT x` only because of v0.2.97.91's column-list import (Common Issue #80).
- **Stored report HTML is never regenerated.** Tags and stories appear only in reports generated after they ship.

## Premises

1. **Tags are a fixed vocabulary, not free text.** Free tags fragment ("root cause", "rootcause", "RC") and cannot drive layout, ordering or a cross-run lookup. One tag per root comment, optional.
2. **A story is its own entity**, an ordered list of references to existing root comments plus a title and a conclusion. It is not a property of a comment: one run can hold two unrelated issues, and one comment can be a step in two stories.
3. **A story never copies a comment.** Steps reference comments; the reader always shows the comment's current text, its "(edited)" marker and its replies count.
4. **The reader shows the evidence, not the drawer.** A step reveals the card, focuses the item and replays the view; the comment text sits in a bar that does not cover the card.
5. **Authoring must be cheap or it will not happen.** One click to add a comment to a story; the tag order suggests the step order.
6. **Order, not a graph, in v1.** Explicit "explains" links between comments are deferred (Approach A, Open Question 5).

## Approaches Considered

### Approach A: Typed links between comments

A comment can point at another ("explains ②", "rules out ③"), forming a graph; the reader walks it from the symptoms. Expressive, and closest to how causality actually works. Not chosen for v1: the authoring UI (pick a target comment across 17 cards) is the expensive part, a graph has no single "next", and readers mostly want a linear narrative. It stays additive on top of B.

### Approach B: Tags + story entity with ordered steps (chosen)

Tags on root comments; a `test_run_stories` table with ordered steps that reference comments; a run-wide comments dialog that indexes everything and hosts story editing; a stepper reader driven by the existing deep-link machinery. Each piece is useful on its own and ships separately.

### Approach C: A story is a special root comment whose replies are steps

No new table: a "story" root on a virtual card, whose replies quote other comments. Not chosen: replies are flat text by design (threads are one level deep), reordering replies is unnatural, a quote goes stale when the source is edited (breaks premise 3), and it overloads the delete and unread rules.

## Recommended Approach

### Tags

**Vocabulary** (shared constant `COMMENT_TAGS` in `packages/shared/src/constants/comment-cards.ts`, in this order, which is also the suggested story order):

| key | label | meaning |
|---|---|---|
| `symptom` | Symptom | what was observed: "p95 jumps at 14:32" |
| `hypothesis` | Hypothesis | a candidate explanation still being checked |
| `evidence` | Evidence | something that supports or narrows a hypothesis |
| `ruled-out` | Ruled out | a checked explanation that turned out not to hold |
| `root-cause` | Root cause | the explanation the author settles on |
| `action` | Action | what to do about it: fix, re-run, follow-up |

Each tag gets an icon and colour from the `readable` palette (`apps/web/lib/theme.ts`; Common Issue #35 — no `.dark` shades used mode-blind).

**Data.** `test_run_comments.tag varchar(32) NULL` with:

- `CHECK (tag IS NULL OR tag IN ('symptom','hypothesis','evidence','ruled-out','root-cause','action'))`. The constant and the CHECK are kept equal by a unit test, like `COMMENT_BODY_MAX_LENGTH`.
- `CHECK (tag IS NULL OR parent_id IS NULL)`: roots only. A reply discusses its root; tagging it would make a thread mean two things.
- A soft-deleted comment keeps its tag (so a story step still reads "Root cause · comment deleted").

**API.** `POST /test-runs/:id/comments` and `PATCH /comments/:id` accept `tag` (`null` clears). PATCH stays author-only (v1 R5); its editable set grows from `body` to `body` + `tag`. The list and socket payloads carry `tag`. Changing a tag does not bump `edited_at` — "(edited)" is about the text.

**Web.** A tag chip on each root in `CommentsDrawer`, a tag picker in the composer and in the root's edit mode. The chip is clickable in the comments dialog to filter.

**Report.** The Comments section prints the tag before each root.

### Item-level comments on the Configuration and Dashboards cards

Both cards join the cards that already anchor comments to items (Performance analysis, SLO, Anomaly detection, Splunk, Dynatrace, Distributed tracing, Pyroscope). No schema or API change: `item_key` / `item_label` already exist and are opaque to the API. Card-level comments on both cards stay possible.

**How the existing item mechanism works, and what is missing.** A row renders `RowCommentButton` (or a section renders `ItemCommentHeader`) with `data-comment-item=<itemKey>`; counts come from `useCommentItemCounts(card, expanded)`. When a thread anchored to an item is opened in the drawer, from a deep link or (later) from a story step, the drawer calls `focusItem(card, itemKey)`. The card's `useCommentItemFocus(card, onFocus)` then scrolls to the element and flashes it, retrying for up to 3 s. That is enough for cards that always render every item. It is not enough for these two, because **both cards filter their items** (Configuration: status, tag and key-text filters; Dashboards: search text and tags), and a filtered-out item has no element to scroll to. So each card handles focus by applying a **comment filter**.

**The comment filter (both cards).**

- In `onFocus(itemKey)`, the card sets `commentFocus = itemKey` and returns whether the item exists in its data.
- While `commentFocus` is set, the card shows **only** the matching item(s), bypassing the user's own filters **without changing them**. A chip above the list reads `Showing the item from a comment: heap.max · Show all`. "Show all" clears `commentFocus` and the user's previous filters apply again, as they left them.
- The match is **exact** on the item's key. The Configuration card's own key filter is a case-insensitive *contains* match, so filtering to `heap` would also show `heap.max` and `heap.min`. That is why the comment filter is separate state, not a write to `keyFilter`.
- If the item is not in the card's data (the config key is in neither run, the dashboard was removed from the workload), the chip says so (`heap.max is not in this comparison` / `This dashboard is no longer configured for this workload`), and the list shows its normal empty state. The comment still shows its `item_label`, which is a snapshot from when it was written.
- A new focus replaces the previous one. Closing the drawer does not clear the filter: the reader is usually still looking at the item.

**Configuration card** (`components/configuration-comparison/`).

- **Item key:** `config:<configKey>`, on the key alone. Tags are deliberately left out: they can differ between the two runs being compared, and `ConfigDiffTable` keys rows by key + tags + index, so one config key can render as more than one row. Each of those rows shows the same comment control, and the comment filter shows all of them.
- **Label:** the config key, truncated to 255 characters (`item_label`'s width). A key whose item key would exceed 1,024 characters (`item_key`'s width) gets no comment button. Keys that long are not expected; the guard just avoids a 400.
- **Button:** `RowCommentButton` in each `ConfigDiffTable` row; the row gets the hover/focus-within rule so the outlined icon appears on hover, as on Performance analysis.
- **The comment filter bypasses the default `['changed','new']` status filter.** This is the case the user hits most: a comment that says "this value did *not* change, so it is not the cause" is about a `same` item, which the default view hides.
- **What the author was comparing against.** The status and the previous value depend on which run is selected in the card's comparison picker (`selectedRelatedTestRun`, by default the previous run). A comment saying "changed from 2 GB" means nothing against a different run. So a root comment on a config item records a view, like Graphs, Trends and Compare do today: `chart_context` with a server-stamped `kind: 'config'` and `{ comparedToTestRunId, status, currentValue, previousValue }`, each value capped at 2,000 characters. That means a `ConfigChartContextDto` added to `CHART_CONTEXT_DTO_BY_CARD` (`apps/api/src/modules/comments/comments.service.ts`), so `validateChartContext` accepts a view on `config`, and its error message changes from "Only a root comment on Graphs, Trends or Compare records a view". The usual root-only rule and `CHART_CONTEXT_MAX_BYTES` apply. Three consequences:
  - The drawer shows the snapshot under the comment (`Compared with run 1234: 2 GB → 512 MB (changed)`), so the comment stays readable when the comparison has moved on.
  - "Restore view" and the `?comment=` deep link replay it through the existing card-tagged `viewRequest`: the card selects that comparison run (if it is still offered), with the usual "Previous view replaced · Undo". Opening the thread in the drawer only applies the comment filter; it does not switch the comparison, matching how Graphs threads behave.
  - Config values are already visible to everyone who can see the run, so copying them into the comment adds no exposure. They travel in the SUT export with the comment, as the run's config already does.

**Dashboards card** (`components/dashboards/`).

- **Item key:** `dashboard:<application_dashboards.id>`, which is `Dashboard.id` in the card. **Never the Grafana `dashboard_uid`**: a uid is unique only within one Grafana instance, and the same uid routinely exists on several (CLAUDE.md "`grafana_dashboards` is a mixed table", trap 3; Common Issue #43). The application dashboard id is per workload, which is exactly the scope of this card.
- **Label:** `dashboard_label`, falling back to `dashboard_name`.
- **Button:** the item is a `DashboardCard` tile in a grid, not a table row, so the tile gets an always-visible comment control in its header (the `ItemCommentHeader` styling: filled icon with threads, outlined without), carrying `data-comment-item` on the tile.
- **Comment filter:** bypasses the search text and selected tags.
- No view is recorded. The card has no view state worth replaying: the Grafana link already opens at the run's time range with the run's variables. A comment on a specific *panel* inside a dashboard is out of scope (Open Question 7).

**Ripple effects.**

- The **comments dialog** row shows `Configuration · heap.max` / `Dashboards · JVM overview` from `item_label`, and "Show in context" applies the comment filter through the same `focusItem` path.
- A **story step** on a config item or dashboard focuses it the same way. This is where the comment filter matters most, because the reader did not set up the card's filters and should not have to undo them.
- The **Comments report section** already prints `item_label` under the card heading; a config comment additionally prints its comparison snapshot.
- Each card builds its own `item_key` format today, and nothing records them centrally. The two new prefixes, `config:` and `dashboard:`, are exported as builder functions from `packages/shared/src/constants/comment-cards.ts`, so the report and future cross-run lookups parse them from one definition.

### The comments dialog (was: the comments card)

**Revised 2026-11-21, after PR3 shipped a card:** the run-wide view is a **dialog opened from an icon in the test-run details header**, not a card on the Results tab. A card cost a slot in the Results tab's order for something that is about the whole page, and it sat in the flow of the page it was meant to navigate. PR4 carries the move.

- **Header icon.** A comments icon where the red run-header unread button used to be, with a total-count badge and an unread state when others wrote since you last looked. Shown when the run has comments or stories. `aria-label` reads e.g. `Comments: 12, 3 unread`.
- **Dialog.** A large MUI `Dialog`, full screen below the `sm` breakpoint, with two tabs: **All comments** and **Stories** (below).
- **Next unread** moves into the dialog header and replaces the separate red button (v1 eng review R6): it closes the dialog and reveals the next card with unread comments, opening its drawer, as before. The test-run list's `?comments=next|first` link keeps working.
- **Navigating closes the dialog.** Show in context, Read (a story) and Next unread close it first, so the card, drawer or story bar is visible.
- PR3's `commentsExpanded` expansion key, its `TAB_CARDS` entry and the non-commentable-key allowlist go away with the card.

Two tabs inside the dialog:

**All comments.** One row per root, newest first, reading `GET /test-runs/:id/comments` with no `card` (already run-wide) and live-updated from the existing `comment:*` socket events.

- Row: tag chip · card label · item label or marker number · author · relative time · first two lines of the body · reply count · unread dot.
- Filters: tag (multi), card, author, "markers only". Client-side; a run's comment count does not justify server filtering.
- Actions: **Show in context** (the existing `?card=&comment=` path: reveal, focus item, replay view, open drawer, highlight) and **Add to story ▾** (existing stories by the caller, or "New story…").
- No composer here. A comment written without a card has no anchor and no view, and those are what make it evidence.
- Opening the dialog marks nothing seen; "seen" stays "that card's drawer is open" (v1 premise 4).

**Stories.** The run's stories (see visibility) with status, author, step count and **Read** / **Edit**; the editor lives here.

### Stories

#### Data model

`test_run_stories`

| column | type | note |
|---|---|---|
| id | uuid PK | |
| test_run_id | uuid FK → test_runs.id ON DELETE CASCADE | run uuid, not the varchar `test_run_id` |
| title | varchar(200) NOT NULL | CHECK length ≥ 1 |
| summary | text NULL | the conclusion, shown as the last screen; ≤ 10,000 chars (same cap as a comment) |
| status | varchar(16) NOT NULL DEFAULT 'draft' | CHECK in (`draft`, `published`) |
| author_id / author_name | varchar(255) | as on comments (v1 R2) |
| published_at | timestamptz NULL | set on first publish, kept on unpublish |
| notified_at | timestamptz NULL | claim column for the publish notification (see Notifications) |
| organization_id / team_id | uuid | copied from the run |
| created_at / updated_at | timestamptz | |

Index `(test_run_id, created_at)`.

`test_run_story_steps`

| column | type | note |
|---|---|---|
| story_id | uuid FK → test_run_stories.id ON DELETE CASCADE | |
| comment_id | uuid FK → test_run_comments.id ON DELETE NO ACTION | a backstop; the service never hard-deletes a step's comment (see delete rule) |
| position | int NOT NULL | 1-based, dense |
| note | text NULL | the story author's connecting words for this step ("so I looked at the hosts…"), ≤ 2,000 chars |
| organization_id | uuid | copied from the story, for RLS |

PK `(story_id, comment_id)` (a comment appears at most once per story); unique `(story_id, position)`; index `(comment_id)` — the parent-side FK check is a scan per child without it (Common Issue #57).

Service checks on write: the comment is a **root**, on the **same run**, and not soft-deleted at the time it is added. Max 50 steps per story.

`NO ACTION` rather than `RESTRICT` on `comment_id`: a run delete cascades to both comments and stories in one statement, and `NO ACTION` is checked at the end of the statement, by which time the steps are gone too.

**Why a `note` per step.** The story author is often not the comment author (a lead stitching together the team's findings). Without the note, their only way to add connecting words is to post new comments, which pollutes the cards.

#### Delete rule (extends v1)

v1: a marker root or a root with replies is soft-deleted; a plain root and any reply are hard-deleted. **Added:** a root that is a step in any story is soft-deleted. The drawer's delete confirmation names the stories ("This comment is step 3 of *Checkout latency after deploy*"). The step stays, rendering "comment deleted" with its tag and note, so the story keeps its shape.

A story is hard-deleted; its steps cascade. Deleting a story never touches comments.

#### Who can do what

- **Create** a story: anyone who can post a comment on the run (same org check). An API key needs `comments:write`; see MCP for what an agent may do with its stories.
- **Edit / reorder / publish / unpublish**: the story author.
- **Delete**: the story author, an `OrganizationRole.ADMIN` of the story's org, or a global admin (mirrors comment moderation, v1 R13).
- **See a draft**: the author only. **See a published story**: anyone who can see the run.
- An **agent's** draft follows different rules (visible to all, editable and publishable by any user who may comment); see MCP.

Drafts are private in v1 because the main reason for a draft is "not finished, don't read it yet". Co-authoring is Open Question 1.

#### API (in the existing `comments` module)

| route | notes |
|---|---|
| `GET /test-runs/:id/stories` | published stories plus the caller's own drafts, without steps; `:id` is the uuid or the `test_run_id`, as on the comments routes |
| `GET /stories/:id` | the story with its steps, each step joined to its comment (redacted shape if soft-deleted); 404 for someone else's draft |
| `POST /test-runs/:id/stories` | `{ title, summary?, steps?: [{ commentId, note? }] }` |
| `PATCH /stories/:id` | `{ title?, summary?, status? }` |
| `PUT /stories/:id/steps` | the full ordered list `[{ commentId, note? }]`; replaces all steps in one transaction (delete + insert). Reorder, add and remove are all this call — simpler than position arithmetic and the list is ≤ 50 |
| `DELETE /stories/:id` | |

All routes: `withOrgFilter` once, required parameter, 404 outside scope, `[]` early on empty org list; writes 403 for `api-key:` principals without `comments:write`, and publish and delete 403 for every key.

#### Realtime

A body-free `story:changed { testRunId, storyId }` to the per-run room only, emitted on every create/update/steps/delete. Clients refetch through the access-checked GET, which is where draft visibility is enforced. Sending story bodies on the socket would leak drafts to everyone in the run room.

The reader and the comments dialog already receive `comment:updated` / `comment:deleted`, so a step's text and its deleted state stay current without a story event.

#### Authoring

- **Add to story** from the comments dialog row and from each root in a card's drawer (menu next to Reply).
- **New story…** asks only for a title; the first step is the comment it was started from.
- **Editor** (in the comments dialog's Stories tab): title, summary, and the step list with drag-to-reorder (dnd-kit, as the report builder; mind Common Issue #65's `ClearDragWhenIdle`), keyboard up/down buttons, an inline note per step, remove.
- **Suggest order** sorts steps by `COMMENT_TAGS` order, then by `created_at`. A suggestion only: it rewrites the list once, the author can reorder after.
- **Publish** / **Unpublish**. Publishing a story with zero steps is refused (400).

#### Reader

URL: `?story=<id>&step=<n>`, 1-based; `step` absent means the intro screen. Shareable, and the channel post links to it.

**Screens.**

1. **Intro**: title, author, the step list as a table of contents (tag chip + card + first line), "Start".
2. **Step n**: the story bar (below) plus the page doing the work behind it.
3. **Conclusion**: the summary, and links back to any step.

**The story bar.** A slim bar fixed to the bottom of the viewport, over the page but not over the card's header:

`‹ Prev · Step 3 of 6 · [Root cause] Configuration › heap.max · "Heap is 512 MB, GC runs every 2 s under load" — Daniel, 2 h ago · step note · Next › · ✕`

Long bodies are clamped with "more", which expands the bar upwards. "Open thread" opens the card's drawer for replies.

**What a step does**, composed from what `CommentsContext` already offers:

- `reveal(expansionKey)` — switch tab and expand the card;
- `focusItem(card, itemKey)` when the comment has an item anchor;
- `restoreView(comment)` when it has a `chart_context` (Graphs, Trends, Compare), which also positions marker pins;
- highlight the marker pin or row for ~2 s.

It does **not** open the drawer. That is what makes the reader different from the run-header button.

**View preservation.** The v1 replay shows a "Previous view replaced · Undo" toast per replay. In story mode those toasts are suppressed: on the first visit to each card the reader snapshots that card's view (the existing `captureView`), and **Exit story** restores every card it touched. One undo for the whole walk.

**Keyboard.** ← / → for prev/next and Esc to exit, when focus is not in an input.

**Unread.** Reading a story marks nothing seen (v1: seen = drawer open). Open Question 3.

**Degraded steps.** A deleted comment shows "comment deleted", keeps its tag and note, and does not navigate. A step whose view no longer fully resolves shows the v1 "1 of 3 series no longer available" note in the bar. A step on a card the run no longer shows (e.g. the Dynatrace integration was removed) shows the text with "card not available on this run".

### Reports

A new option on the existing **Comments** report section rather than a new section type: `layout: 'by-card' | 'stories'` (default `by-card`, so stored templates keep rendering as they do). A template is reused across runs, so it cannot name a story id; `stories` renders **every published story of the run**, ordered by `published_at`:

- title, author, summary;
- each step: number, tag, card · item, comment body, step note, and — for a Graphs marker step — the chart the section already draws from `chart_context` (Trends and Compare views stay undrawn, as today);
- a deleted step prints "comment deleted".

Comments not in any story are omitted in this layout; a template that wants both uses two Comments sections.

### Notifications

Publishing a story announces it once to every channel with `notify_on_comment` (no new flag): "Daniel published an analysis on <SUT> run <id>: *Checkout latency after deploy* (6 steps)", deep-linking to the reader intro.

The v1 `CommentNotificationScheduler` sweep picks it up through the story's `notified_at` claim column, with the same claim-then-post-outside-the-transaction and release-on-retryable-failure rules. Unpublish then republish does not announce again (`notified_at` stays set). The individual comments in a story are still announced as comments, as today.

### SUT export / import

`test_run_stories` and `test_run_story_steps` join `test_run_comments` in `sut-resource-graph.ts` (`byTestRunUuid` for stories; steps by story), with the import remapping `story_id` and `comment_id` the way it remaps comment ids today. The `tag` column travels automatically; an older bundle without it imports with `tag` NULL (Common Issue #80).

### MCP: an AI agent can comment and build a story

The analysis an agent does through the MCP server today (`get_adapt_results`, `get_metric_trends`, `get_config_diff`, `get_error_analysis`, ...) ends up as chat text in the agent's own client, outside the run, where nobody else on the team sees it. The agent has already done exactly the symptom → evidence → root cause walk this design is about. It should be able to leave that walk on the run, as tagged, anchored comments and a story, for a human to review and publish.

All 20+ MCP tools are read-only today, and the server authenticates with one API key (`PERFANA_API_KEY`). So this section has three parts: letting a key write without undoing v1's reason for blocking it, letting an agent anchor a comment without knowing the web client's internal item-key formats, and keeping agent content clearly marked and under human control.

#### Reversing v1 R3, for opted-in keys only

v1 eng review R3 refused every comment write from an API key, because "a key has no person behind it" and "nobody asked for bot comments". Someone is asking now, so this design takes R3's option B, narrowed:

- **Keys stay read-only by default.** A key can write comments and stories only if it carries a new role, `comments:write`, chosen when the key is created (`api_keys.roles` already exists). Every existing key, including every CI key, keeps getting 403 on writes. The controller guard at `comments.controller.ts:22` changes from "refuse every `api-key:` principal" to "refuse an `api-key:` principal without `comments:write`". Whether `roles` can carry a scope like this or needs a sibling column is checked in implementation; it must not grant anything outside comments.
- **What an agent may write:** root comments and replies, tags on its own comments, edits to its own comments, and stories it creates. It may **not** delete anything, moderate, mark comments seen (`PUT seen` stays refused: an agent has no unread state), or **publish** a story.
- **Ownership** stays the key's organization (`request.apiKey.organization_id`), checked against the run's organization exactly as for a user; a key can comment only on runs of its own org.

#### Marking agent content

`test_run_comments` and `test_run_stories` gain `author_kind varchar(16) NOT NULL DEFAULT 'user'`, CHECK in (`user`, `agent`), set by the server from the principal and never from the request. For an agent, `author_id = api-key:<id>` and `author_name` is the key's `description` (for example "Claude analysis agent"), as R3's option B described.

Everywhere an author is shown, `agent` renders an **AI** chip next to the name: the drawer, the comments dialog, the story list, the reader bar, the report and the channel post. A reader must never mistake an agent's root-cause claim for a colleague's.

#### Agent stories are proposals, and a human publishes them

- An agent creates a story as `draft`. Unlike a user's draft (author-only), **an agent's draft is visible to everyone who can see the run**, labelled `AI draft · not reviewed`. Otherwise nobody could see it, since the author is a key.
- Any user who may comment on the run can **edit** an agent's draft (reorder, rewrite notes, drop steps) and **publish** it. Publishing records who did it: `test_run_stories` gains `published_by_id` / `published_by_name`, and the story then reads `Proposed by <agent> · reviewed and published by <user>`. The human who publishes takes responsibility for the story, which is the point of the review.
- Users can delete an agent's draft (any user who may comment, not only moderators), so a bad proposal does not have to wait for an admin.

#### Anchors: the agent names the thing, the server builds the key

Today each web card builds its own `item_key` (`panelKey` in `SplunkCard`, the transaction key in `TransactionRow`, the result key in `SLOList`, ...), and `chart_context` is captured from the card's live state. An agent sees none of that. Asking it to reproduce those formats would make every web refactor silently break agent comments, which would then point at nothing.

So `POST /test-runs/:id/comments` gains an optional **`anchor`**, mutually exclusive with `itemKey` / `itemLabel` / `markerTime` / `chartContext`, which the API resolves into those fields:

| anchor | resolves to | the agent gets the values from |
|---|---|---|
| `{ type: 'card', card }` | a card-level comment | — |
| `{ type: 'transaction', name }` | Performance analysis row | `get_transaction_stats`, `get_performance_rankings` |
| `{ type: 'config', key, comparedToTestRunId? }` | Configuration item, with the `kind: 'config'` view snapshot | `get_test_run_configs`, `get_config_diff` |
| `{ type: 'dashboard', applicationDashboardId }` | Dashboards card item | `get_available_metrics`, which gains the id (see below) |
| `{ type: 'slo', checkResultId }` | SLO row | `get_check_results` (which must return the result id; check its response in implementation) |
| `{ type: 'marker', time, series: [{ dashboardLabel, panelId, metricName }], range? }` | a numbered Graphs marker with its `chart_context` | `get_available_metrics`, `get_metric_trends` |

Rules:

- **The builders are shared.** The item-key builders for every card move into `packages/shared/src/constants/comment-cards.ts` (this design already moves the two new ones there), and the web cards import them. A contract test asserts that, for each anchor type, the server-built key equals the key the web row renders. Without it, server and web drift and agent comments stop resolving silently.
- **The server checks the anchor exists in the run** (the transaction has rows, the config key is in the run, the check result belongs to the run, the dashboard belongs to the run's workload, the series are in `ds_metrics` for the run) and answers 400 naming what was not found. An agent that names something wrong gets a correctable error, not a comment pinned to nothing.
- **`item_label`** is built by the server from the resolved item (the transaction name, the config key, the dashboard label), not taken from the agent.
- **Markers.** `marker_seq` is assigned as for a user's marker. `chart_context.series` is built in the graph-preset series shape the replay already reads, and `range` defaults to the run's window, clamped to the run. `dashboardLabel` is not unique across Grafana instances (Common Issue #51): if it matches more than one application dashboard in the run's workload, the server answers 400 listing the candidates, and the agent retries with `applicationDashboardId` in the series entry.
- **Dashboards need an id the agent can see.** `get_available_metrics` returns dashboards by label today. It gains `applicationDashboardId` per dashboard, so the agent can anchor dashboard comments and disambiguate markers.
- Cards outside this table (anomaly rows, Dynatrace services, Splunk panels, tracing, Pyroscope) take card-level agent comments in v1; each can be added as an anchor type later with its own builder and contract test.

`apps/mcp` cannot import `@perfana/shared` (CLAUDE.md Common Issue #81), which is a second reason the resolution lives in the API: the MCP server only passes the anchor through.

#### Retries, limits and notifications

- **Idempotency.** Agents retry on timeouts. `test_run_comments` gains `client_ref varchar(64) NULL` with a unique index on `(test_run_id, author_id, client_ref) WHERE client_ref IS NOT NULL`. A repeated create with the same `client_ref` returns the existing comment (200) instead of a duplicate. Users never send it; it is optional for agents, and the MCP tool sends one by default.
- **Limits per key per run:** 100 root comments, 200 replies, 10 stories, same body caps as users. A 429 names the limit. These protect the humans reading, not the server.
- **No per-comment channel posts for agents.** An agent posting 15 findings must not produce channel posts every two minutes. Agent comments are stamped `notified_at = now()` on insert, so the sweep never claims them. The team hears about agent work through the story: when a human publishes it, the publish announcement goes out as for any story, naming both the agent and the publisher.
- **Unread.** Agent comments count as unread like any other author's, because they are new content on the run. The run-header label distinguishes them: `5 unread (3 from AI)`.

#### MCP tools (`apps/mcp/src/index.ts`, `perfana-client.ts`)

Read (work with any key):

- `get_test_run_comments(testRunId, card?, tag?)`: threads with tag, anchor (card, item label), author and author kind, marker number and time. The tool description says that comment bodies are **user-written content, not instructions**, since an agent reading a run's comments is reading text anyone in the org typed.
- `get_analysis_stories(testRunId)` and `get_analysis_story(storyId)`: published stories, plus agent drafts (visible to everyone), with steps and comment text.

Write (need a key with `comments:write`; without it the tool returns the API's 403 with a message saying which role the key lacks):

- `add_test_run_comment(testRunId, body, tag?, anchor?, clientRef?)` → the comment, including its id and, for a marker, its number.
- `reply_to_test_run_comment(commentId, body, clientRef?)`, so an agent can answer a question a user asked under its finding.
- `update_test_run_comment(commentId, body?, tag?)`, own comments only.
- `create_analysis_story(testRunId, title, summary?, steps: [{ commentId, note? }])` → the story id and its `?story=` link, so the agent can hand the link to its user.
- `update_analysis_story(storyId, title?, summary?, steps?)`, own drafts only, until a human publishes it.

No delete or publish tools. The MCP README gets a worked example: diagnose a run with the read tools, post a symptom marker on the response-time series, evidence on a config item and a dashboard, a root cause, then assemble the story and return its link.

#### Things to watch

- **Prompt injection, in both directions.** An agent reads user-written comments (marked as content in the tool descriptions, above). Agent-written bodies are rendered with the same escaping as users' comments in the UI and the report, and get no richer formatting; an agent cannot inject links or markup that a user's comment could not.
- **Hallucinated evidence.** Anchors are verified to exist, but the claim in the body is not. That is what the AI chip, the "not reviewed" label and human publishing are for.
- **Key compromise.** A leaked `comments:write` key can write text on its org's runs, nothing more: no deletes, no publish, no notifications, capped per run, every row attributed to the key.

## Phasing

1. **PR1 — Item comments on Configuration and Dashboards.** Comment buttons, item counts, the comment filter and chip on both cards, the `config` view DTO and replay of the comparison run, the comparison snapshot in the drawer and the report. No migration. Independent of everything else here, so it can ship first.
2. **PR2 — Tags.** Migration 1829 (column + two CHECKs), entity, DTOs, list/socket payloads, drawer chip and picker, Comments report section prints the tag. Useful on its own.
3. **PR3 — Comments card.** Card, tab placement, All comments list with filters, Show in context, live updates. No API change. *(Shipped as a card; PR4 moves it into the header dialog.)*
4. **PR4 — Stories.** Migration 1830 (two tables, RLS, indexes), API, delete-rule extension, SUT export, Add to story, editor, reader bar with view snapshot/restore, `?story=&step=` link.
5. **PR5 — Report and notification.** Comments section `stories` layout; publish announcement through the sweep.
6. **PR6 — Agents through MCP.** Migration 1831 (`author_kind` on comments and stories, `client_ref` + index, `published_by_*`), the `comments:write` key role and its option in the API-key dialog, the `anchor` resolver with shared item-key builders and their contract test, `applicationDashboardId` in `get_available_metrics`, the AI chip and agent-draft rules in the web, the sweep skipping agent comments, the MCP tools and README example. `author_kind` could ship in PR4's migration instead, so stories never exist without it; decide when PR4 starts.

## Tests

- **Item comments:** opening a thread on a `same` config item shows it although the default status filter hides `same`; the comment filter matches `heap.max` exactly and not `heap.max.extra`; "Show all" restores the user's own status, tag and key filters unchanged; a config key in neither run and a removed dashboard each show their chip message; a config root records `kind: 'config'` with the selected comparison run, a reply cannot record a view, an oversized value → 400; Restore view selects the recorded comparison run and Undo returns to the previous one; dashboard item keys use the application dashboard id, so the same Grafana uid on two instances yields two separate items.
- **Tags:** CHECK and constant stay equal; tag on a reply → 400; PATCH tag by non-author → 403; tag survives soft delete.
- **Stories API:** someone else's draft is 404 on GET/PATCH/PUT/DELETE; a published one is readable cross-user in the same org and 404 cross-org; steps referencing a reply, another run's comment, or a soft-deleted comment → 400; `PUT steps` is atomic (a failing insert leaves the old list); API-key writes → 403; 51 steps → 400.
- **Agents:** a key without `comments:write` → 403 on every write; with it, delete, publish and `PUT seen` still 403; `author_kind` cannot be set from the request; a key on another org's run → 404; each anchor type resolves to the same `item_key` the web row renders (contract test, one per type); an anchor naming a missing transaction, config key, check result, dashboard or series → 400 naming it; an ambiguous `dashboardLabel` → 400 listing candidates; a repeated `client_ref` returns the first comment; the 101st root comment → 429; agent comments are never claimed by the notification sweep; an agent draft is visible to another user, who can edit and publish it, and publishing records `published_by`; the MCP tools pass anchors through unchanged and surface a 403's message.
- **Delete rule:** deleting a step's root soft-deletes it, even with no replies and no marker; deleting a story leaves its comments; a run delete removes both without an FK error.
- **RLS:** the new tables in `apps/api/src/test/rls/` alongside `test-run-comments.spec.ts`.
- **Realtime:** `story:changed` carries no title, summary or steps.
- **SUT transfer:** round-trip a run with a story; import a bundle exported before PR1.
- **Web:** reader navigates prev/next and via URL; it never opens the drawer; Exit restores each touched card's view; no per-step Undo toast in story mode; keyboard nav ignores inputs; deleted step does not navigate.
- **Browser (Vibium):** a six-step story across Performance analysis, Graphs (marker), Dynatrace and Configuration on a real run, at desktop and 1302 px content width (Common Issue #37), checking the bar never covers the focused row or marker.

## Open Questions

1. **Co-authoring.** Should a draft be visible to, or editable by, colleagues? v1 proposal: author-only; others can "Duplicate as my draft" later.
2. **Who may tag.** Only the comment author (proposed), or also a story author when adding someone else's comment? Letting others tag means a tag no longer reflects the comment author's intent.
3. **Should reading a step mark its card seen?** Proposed no, for consistency with v1. Counter-argument: someone who read the whole story has effectively read those comments.
4. **Icon visibility.** Hide the header comments icon on runs without comments or stories (proposed), or always show it so people learn the feature exists?
5. **Typed links (Approach A).** Revisit once stories are in use: do authors write step notes like "this explains step 1"? If so, that is the demand signal for links.
6. **Story-level verdict.** Should a published story be able to set or suggest the run's verdict / annotation? Out of scope here; worth deciding before anyone builds it ad hoc.
7. **Comments on a Grafana panel.** A dashboard-level anchor is what this design adds. Pinning a comment to one panel of an embedded dashboard needs a panel list per dashboard in the card: `DashboardDialog` embeds the whole dashboard in an iframe, and Perfana cannot see clicks inside it. Worth it only if dashboard comments turn out to be mostly about one panel.
8. **Should the Configuration comment filter switch the comparison run on plain open**, not only on Restore view? Proposed no, for consistency with Graphs. The drawer's snapshot covers the case where the runs differ.
9. **May an agent publish its own story**, for teams that want fully automated analysis (for example a CI step that runs an agent after every run)? Proposed no in v1: human publishing is what keeps an unreviewed root-cause claim out of the channel and the report. A later per-key `stories:publish` role could allow it, still labelled AI.
10. **Should agent comments count as unread?** Proposed yes, labelled. If agents turn out to be chatty, the alternative is to count only published agent stories.

## Out of Scope

- Cross-run memory (surfacing earlier runs' root causes on a similar symptom). Tags are designed to make it possible; it gets its own design.
- Free-text or custom tags.
- AI drafting *inside* Perfana (a "suggest a story" button). Agents work through the MCP server only, with their own key.
- Stories spanning several runs.

## Success Criteria

- A comment on a configuration item or a dashboard opens with that item, and only that item, visible, whatever the card's filters were, and the reader can return to their own filters in one click.
- A reviewer can follow a cross-card analysis from one link, in the author's order, seeing each comment's evidence (chart view, row, config item), without opening a drawer.
- Leaving the story returns every card to the view the reader had before.
- An AI agent can diagnose a run through the MCP server, leave anchored, tagged comments and a draft story on it, and hand its user a link. Every piece is marked AI, nothing reaches the team channel until a human publishes, and a key without `comments:write` can still write nothing.
- A report generated after PR4 can contain the story with its marker charts.
- No cross-tenant read: drafts and stories are 404 outside their org and to non-authors (drafts), in the API, on the socket and in the SUT export.
