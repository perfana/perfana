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

Duplicate slugs get `-2`, `-3` … assigned in document order. The first occurrence
keeps the bare slug, so adding a second "Graphs" section later cannot change the
anchor of the first.

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

Every section gets an anchor, including ones the index does not list.

### 2. The index section

A new `index` section type, ordered and placed by the author like any other.

`renderSections()` already holds the ordered section list, so it computes the
title/slug pairs once and passes them to the index renderer. Every other renderer
keeps its current signature.

The index renders an ordered list of links. It excludes itself. Every section is
listed except one case: **a `text_block` with no author-set title is skipped**, because
its only available label would be the generic "Text Block" and an index reading
"Text Block, Text Block, Text Block" is noise. Every other type has a meaningful
default label and is listed whether or not the author retitled it.

Skipped sections still receive anchors and remain linkable; they are only absent
from the list.

If the index is the only section, or every other section is skipped, it renders
nothing rather than an empty list container.

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
author just changed.

`MarkdownField` backs both `text_block` sections and the per-section `text` prose
field, so both gain the affordance from one change.

### 4. Broken links

`ReportGenerationValidatorService` scans the rendered HTML for `href="#…"` values
and compares them against the set of anchors actually emitted. Unmatched targets
are **logged as a warning and do not block generation**. A dead anchor is a click
that does nothing, not a broken report — refusing to generate would be a worse
outcome than the problem.

The warning names the section containing the dead link and the target it wanted,
so the fix is obvious after a rename.

### 5. Testing

| Layer | Covers |
|---|---|
| `packages/shared` | Slug generation: collisions and their ordering, punctuation-only titles, accents, empty input, stability of the first occurrence |
| `apps/api` | Index renderer output and exclusion rules; anchor stamping in `renderSections`; the empty-index case; validator warning on a dead anchor |
| `apps/web` | The toolbar button inserts correct markdown for a chosen section; registry sync test guards drift |

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
