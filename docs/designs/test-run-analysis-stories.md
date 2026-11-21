# Design: Comment tags, a run-wide comments card and analysis stories

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

## What Makes This Cool

- The evidence is already live. A comment on Graphs, Trends or Compare stores the view its author was looking at (`chart_context`), and the `?card=&comment=` deep link already reveals the card, focuses the item and replays that view. A story is an ordered walk over those deep links, so each step puts the reader **in front of the chart, row or config item it talks about**, not in front of a quote of it.
- "Ruled out" is a first-class step. The checks that found nothing are often what a reviewer most needs, and today they are the comments people delete.
- The same story becomes the report narrative, with the marker charts the Comments report section already draws.
- Structured tags are the groundwork for cross-run memory (the "coolest unconsidered version" in the v1 design): "last time this symptom showed up on this metric, the root cause was GC".

## Constraints

All v1 constraints carry over unchanged. The ones that bite here:

- **Multi-tenant RBAC.** New tables carry `organizationId` / `teamId` copied from the `test_runs` row (camelCase in `repo.create`), RLS policies, and service-layer org checks on every route including by-id reads: `withOrgFilter` once per request, required parameter, **404 not 403** outside the caller's orgs, `[]` early on an empty org list (CLAUDE.md Common Issue #48).
- **Realtime** goes through `TestRunsGateway` with rooms resolved from the row's own ownership, never the caller's `UserCtx`, never a broadcast (Common Issue #58). Draft stories must not leak through it (see Realtime).
- **API keys cannot write** comments (v1 eng review R3); the same holds for tags and stories. GETs stay open so MCP/agents can read.
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

Tags on root comments; a `test_run_stories` table with ordered steps that reference comments; a comments card that indexes everything and hosts story editing; a stepper reader driven by the existing deep-link machinery. Each piece is useful on its own and ships separately.

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

**Web.** A tag chip on each root in `CommentsDrawer`, a tag picker in the composer and in the root's edit mode. The chip is clickable in the comments card to filter.

**Report.** The Comments section prints the tag before each root.

### The comments card

A new card **Comments** on the Results tab, right after Test run details, shown only when the run has at least one comment (an empty card is noise on most runs). Its own expansion key (`commentsExpanded`) is added to `TAB_CARDS`; it is **not** a commentable card (not in `COMMENT_CARD_KEYS`). `CommentsContext` builds `PAGE_ORDER` from `TAB_CARDS` and maps each key through `cardKeyOf`, which has no entry for this card, so `PAGE_ORDER` must skip expansion keys without a comment card key, or next-unread breaks on `undefined`.

Two tabs inside the card:

**All comments.** One row per root, newest first, reading `GET /test-runs/:id/comments` with no `card` (already run-wide) and live-updated from the existing `comment:*` socket events.

- Row: tag chip · card label · item label or marker number · author · relative time · first two lines of the body · reply count · unread dot.
- Filters: tag (multi), card, author, "markers only". Client-side; a run's comment count does not justify server filtering.
- Actions: **Show in context** (the existing `?card=&comment=` path: reveal, focus item, replay view, open drawer, highlight) and **Add to story ▾** (existing stories by the caller, or "New story…").
- No composer here. A comment written without a card has no anchor and no view, and those are what make it evidence.
- Opening the card marks nothing seen; "seen" stays "that card's drawer is open" (v1 premise 4).

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

- **Create** a story: anyone who can post a comment on the run (same org check, same API-key 403).
- **Edit / reorder / publish / unpublish**: the story author.
- **Delete**: the story author, an `OrganizationRole.ADMIN` of the story's org, or a global admin (mirrors comment moderation, v1 R13).
- **See a draft**: the author only. **See a published story**: anyone who can see the run.

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

All routes: `withOrgFilter` once, required parameter, 404 outside scope, `[]` early on empty org list; writes 403 for `api-key:` principals.

#### Realtime

A body-free `story:changed { testRunId, storyId }` to the per-run room only, emitted on every create/update/steps/delete. Clients refetch through the access-checked GET, which is where draft visibility is enforced. Sending story bodies on the socket would leak drafts to everyone in the run room.

The reader and the comments card already receive `comment:updated` / `comment:deleted`, so a step's text and its deleted state stay current without a story event.

#### Authoring

- **Add to story** from the comments card row and from each root in a card's drawer (menu next to Reply).
- **New story…** asks only for a title; the first step is the comment it was started from.
- **Editor** (in the comments card's Stories tab): title, summary, and the step list with drag-to-reorder (dnd-kit, as the report builder; mind Common Issue #65's `ClearDragWhenIdle`), keyboard up/down buttons, an inline note per step, remove.
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

### MCP (later)

A read-only `get_test_run_stories` tool returning published stories with steps and comment text. GETs are already open to API keys, so this needs no auth change.

## Phasing

1. **PR1 — Tags.** Migration 1829 (column + two CHECKs), entity, DTOs, list/socket payloads, drawer chip and picker, Comments report section prints the tag. Useful on its own.
2. **PR2 — Comments card.** Card, tab placement, All comments list with filters, Show in context, live updates. No API change.
3. **PR3 — Stories.** Migration 1830 (two tables, RLS, indexes), API, delete-rule extension, SUT export, Add to story, editor, reader bar with view snapshot/restore, `?story=&step=` link.
4. **PR4 — Report and notification.** Comments section `stories` layout; publish announcement through the sweep.

## Tests

- **Tags:** CHECK and constant stay equal; tag on a reply → 400; PATCH tag by non-author → 403; tag survives soft delete.
- **Stories API:** someone else's draft is 404 on GET/PATCH/PUT/DELETE; a published one is readable cross-user in the same org and 404 cross-org; steps referencing a reply, another run's comment, or a soft-deleted comment → 400; `PUT steps` is atomic (a failing insert leaves the old list); API-key writes → 403; 51 steps → 400.
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
4. **Card visibility.** Hide the Comments card on runs without comments (proposed), or always show it so people learn the feature exists?
5. **Typed links (Approach A).** Revisit once stories are in use: do authors write step notes like "this explains step 1"? If so, that is the demand signal for links.
6. **Story-level verdict.** Should a published story be able to set or suggest the run's verdict / annotation? Out of scope here; worth deciding before anyone builds it ad hoc.

## Out of Scope

- Cross-run memory (surfacing earlier runs' root causes on a similar symptom). Tags are designed to make it possible; it gets its own design.
- Free-text or custom tags.
- AI-drafted stories from a run's comments.
- Stories spanning several runs.

## Success Criteria

- A reviewer can follow a cross-card analysis from one link, in the author's order, seeing each comment's evidence (chart view, row, config item), without opening a drawer.
- Leaving the story returns every card to the view the reader had before.
- A report generated after PR4 can contain the story with its marker charts.
- No cross-tenant read: drafts and stories are 404 outside their org and to non-authors (drafts), in the API, on the socket and in the SUT export.
