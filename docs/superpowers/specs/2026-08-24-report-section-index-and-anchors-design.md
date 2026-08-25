# Report section index and anchor links

**Date:** 2026-08-24
**Status:** approved, not yet implemented

## Problem

A generated report is a flat run of sections with no way to navigate it. Long
reports are scrolled, not consulted. There is no index, and nothing to link to
even if an author wanted to write "see the SLO results below" — no section emits
an `id`.

Two things are missing, and they are the same feature:

1. An index listing every section, each entry linking to that section.
2. A way for an author writing prose to link to a section by name.

## What already exists

Three facts about the current code shape the design, and each one removes work:

- **`ReportHtmlCompilerService.renderSections()` is a single choke point.** Every
  section passes through one loop that sorts by `order` and joins the rendered
  HTML. Anchors can be stamped there rather than edited into twelve renderers.

- **The markdown allowlist already permits `#` hrefs.** `SAFE_HREF` in
  `packages/shared/src/utils/markdown.ts` matches `^(https?:\/\/|mailto:|\/(?![/\\])|#)`,
  so `[see SLO](#slo-results)` already renders as a working `<a>` today. What is
  missing is only the target.

- **PDF rendering is a separate service consuming the same HTML.**
  `apps/perfana-report` runs Puppeteer `page.pdf()` over the API's compiled
  output. Chrome preserves same-document `#` links as real PDF link annotations,
  so anchors work in the PDF with no cross-service change.

A `.toc-page` class exists in the compiler's print stylesheet with nothing
generating it. It is unused and stays unused; this design does not adopt it.

## Decisions

| Question | Decision | Rejected |
|---|---|---|
| How the index enters a report | A new `index` section type the author places | Automatic injection; automatic with a per-report toggle |
| What an anchor is named | Slug of the section's effective title | Stable stored id; author-assigned anchor |
| Index depth | Flat, one entry per section | Nested under text-block headings; page numbers |
| How an author links | A "Link to section" toolbar button | Hand-written markdown; extending the existing Link button |
| Text blocks | Link source only — never a target, never listed | Anchoring them; listing titled ones |
| Two sections sharing a title | Titles must be unique; warn when they are not | Silent positional suffixes; stable ids |

### Why title-slugs rather than stable ids

A stored `id` on `ReportSectionConfig` would survive retitling, which title-slugs
do not. It was rejected because it requires a backfill of every existing template
(sections live in a JSON column), and because an opaque `#s-a1b2c3` is unwritable
by hand — it would make the toolbar picker a hard prerequisite rather than a
convenience. Title-slugs are guessable, need no migration, and are what markdown
authors already expect.

The cost is real and accepted: **renaming a section breaks links pointing at its
old slug.** Section 4 mitigates it with a warning rather than preventing it.

## Design

### 1. The anchor contract

A section's anchor is a slug of its **effective title** — `section.title` when
set, otherwise the type's default label from `ReportUtilsService.getSectionTitle()`.

```
"SLO Results"        -> slo-results
"Apdex — checkout"   -> apdex-checkout
"Top 10 Lists"       -> top-10-lists
```

Slugging: lowercase, strip accents to ASCII, replace any run of non-alphanumeric
characters with a single `-`, trim leading and trailing `-`. A title that slugs to
the empty string (punctuation only) falls back to the type name.

**Text blocks are never targets.** A `text_block` is where links are written
*from*. It gets no anchor and is not listed in the index. Every other section type
is a target.

**Titles must be unique among target sections.** The title is the address, so two
sections called "Graphs" is a conflict, not a case to paper over.

Duplicates are still handled deterministically — `-2`, `-3` … in document order,
so nothing crashes and the output is reproducible — but they also raise a warning
(section 4) telling the author to retitle. This is a fallback, not the contract.

The reason the contract matters is that positional suffixes are only stable
against *adding*. Given "Graphs" → `#graphs` and "Graphs" → `#graphs-2`:

- delete the first, and the survivor becomes `#graphs` — so an existing link to
  `#graphs` now silently opens a different section, and `#graphs-2` dangles
- reorder them, and both links quietly swap targets

A dead link is a click that does nothing; this is a link that works and goes
somewhere wrong. It is not detectable after the fact — the anchor still resolves —
which is precisely why the warning fires at the point the duplicate is created
rather than when a link later breaks.

**Where it lives:** `packages/shared/src/utils/section-anchors.ts`, beside
`markdown.ts` and for the same stated reason — two consumers must agree on the
output. The API stamps the anchors; the web toolbar picker must compute an
identical slug or the link it inserts will not resolve. A second implementation
would drift.

**Where it is emitted:** `renderSections()` emits an empty anchor immediately
before each section's HTML:

```html
<a id="slo-results" class="section-anchor" aria-hidden="true"></a>
```

An empty element has no layout and no CSS impact, so no existing renderer changes
and no `section h2` styling shifts. It is a valid PDF destination. A
`scroll-margin-top` rule on `.section-anchor` keeps a jumped-to heading clear of
the top edge in the HTML view.

Anchors and index entries are the same set: every section except `text_block`.
There is no section that is linkable but unlisted, or listed but unlinkable.

### 2. The index section

A new `index` section type, ordered and placed by the author like any other.

`renderSections()` already holds the ordered section list, so it computes the
title/slug pairs once and passes them to the index renderer. Every other renderer
keeps its current signature.

The index renders an ordered list of links to every section except itself and
`text_block`s — the same set that receives anchors, by construction, so the index
cannot list something unreachable.

Text blocks are excluded because they are the link *source*: they hold the prose an
author writes, their only default label is the generic "Text Block", and an index
reading "Text Block, Text Block, Text Block" tells a reader nothing.

If the index is the only section, or every other section is a text block, it
renders nothing rather than an empty list container.

**Registration.** As of v0.2.75.0 the section-type registry is derived from a
single definition, so this is three edits rather than six:

- `SECTION_TYPE_LABELS` in `packages/shared/src/types/reports.types.ts` — the
  single source; `REPORT_SECTION_TYPES` and `SECTION_TYPES_WITH_TEXT` derive from it
- the `Record<ReportSectionType, string>` in `report-utils.service.ts` — a compile
  error if missed
- `apps/web/lib/api/reports.ts` — the deliberate web copy, guarded by
  `apps/web/__tests__/lib/report-section-types.test.ts`

Plus a builder entry in `SectionConfigs.tsx` so the section can be added. The
`index` section needs no configuration of its own.

`SECTION_TYPES_WITH_TEXT` is derived as "everything except `text_block`", so the
index section gains accompanying-prose support automatically. That is acceptable —
an author may reasonably want a sentence above the index.

### 3. Authoring

A "Link to section" entry added to the tool array in
`apps/web/components/reports/report-generation/MarkdownField.tsx`, beside the
existing Link button. It opens a picker listing the report's sections and inserts:

```markdown
[SLO Results](#slo-results)
```

The picker computes slugs with the shared helper from section 1, over the sections
currently in the builder — so it reflects unsaved edits, including a title the
author just changed. It lists target sections only; text blocks never appear,
including the one being edited.

When two listed sections share a title, the picker marks them rather than showing
two identical rows, and repeats the retitle warning from section 4 — the author is
choosing a link target at exactly the moment the ambiguity matters.

`MarkdownField` backs both `text_block` sections and the per-section `text` prose
field, so both gain the affordance from one change.

### 4. Broken and ambiguous links

Two warnings, neither of which blocks generation. A report with a bad link is
still worth producing; refusing to generate would be a worse outcome than the
problem.

**Dead anchors.** `ReportGenerationValidatorService` scans the rendered HTML for
`href="#…"` values and compares them against the set of anchors actually emitted.
The warning names the section containing the dead link and the target it wanted,
so the fix is obvious after a rename.

**Duplicate titles.** Raised where the duplicate is created — inline in the
builder — and again at generation. This one is the load-bearing warning: as
section 1 sets out, a duplicate title makes a link's target depend on document
order, and the resulting mis-navigation is undetectable afterwards because the
anchor still resolves. Catching it at creation is the only point where it is
catchable at all.

The two warnings cover different failures and neither substitutes for the other: a
dead link is found by looking at the report's output, an ambiguous one only by
looking at its section titles.

### 5. Testing

| Layer | Covers |
|---|---|
| `packages/shared` | Slug generation: collisions and their ordering, punctuation-only titles, accents, empty input, stability of the first occurrence; duplicate detection reports the right pair |
| `apps/api` | Index renderer output and exclusion rules; `text_block` gets neither anchor nor entry; anchor stamping in `renderSections`; the empty-index case; validator warnings for a dead anchor and for duplicate titles |
| `apps/web` | The toolbar button inserts correct markdown for a chosen section; text blocks absent from the picker; duplicate titles marked in it; registry sync test guards drift |

All `apps/api` reports specs are mock-based and run without a database — verified,
32 suites / 815 tests pass in a checkout with no `perfana_test`.

Each new behaviour is mutation-checked: the test must be shown to fail when the
code it covers is broken.

## Out of scope

- **Page numbers in the index.** Not knowable at HTML-compile time, and Chrome
  does not support CSS `target-counter()`. Would require a measuring pass inside
  the headless browser in `apps/perfana-report`, and the numbers would be
  meaningless in the HTML view.
- **Headings inside text blocks as index entries.** Would require the shared
  markdown renderer to emit heading ids, which also affects the web live-preview,
  plus document-wide slug collision handling.
- **Any change to `apps/perfana-report`.** Anchors work in the PDF unmodified.
- **Retitle-safe links.** Explicitly traded away with the title-slug decision.
- **Enforcing unique titles.** Duplicates warn, loudly and in two places, but still
  generate. Blocking a report over a section title would be a worse failure than
  the ambiguity it prevents.
