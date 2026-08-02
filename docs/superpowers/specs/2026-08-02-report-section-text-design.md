# Report section accompanying text (replaces section comments)

**Date:** 2026-08-02
**Status:** Approved, ready for implementation plan

## Problem

Report sections carry an optional `comment` string. It is presented and rendered as an
annotation — a tinted callout with a speech-bubble icon, 13px type, blue left border —
but it is used as narrative prose that accompanies the section. Three further problems
have accumulated around it:

1. **Editor inconsistency.** The inline editor uses `MarkdownField` (formatting toolbar
   + live preview). The preview modal uses a bare MUI `TextField` for the same value,
   which is then rendered as markdown. Users writing in the preview modal get no toolbar
   and no feedback.
2. **Commentable-set mismatch.** `packages/shared` and the API validator exclude
   `header` and `text_block`; `apps/web` includes every type. Saving a header section
   with a comment works in ad-hoc generation but throws `ValidationException` when saved
   as a template (`report-template.service.ts:779-784`).
3. **Length-limit mismatch.** API allows 5000 chars (`create-report.dto.ts:93`), the UI
   caps at 2000 (`SectionConfigs.tsx:23`, `SectionPreviewModal.tsx:175`).

## Goals

- Every section type except `text_block` has an optional accompanying **text**.
- The word "comment" disappears from the user-facing UI.
- One text editing component everywhere, including preview mode.
- The rendered output reads as prose belonging to the section, not as an annotation.
- No DB migration; existing templates keep rendering.

## Non-goals

- Multiple text blocks per section.
- Rich text beyond the existing markdown subset (`packages/shared/src/utils/markdown.ts`).
- Changing `text_block` sections themselves — their `content` field already is the text.
- Touching `apps/perfana-report` (Puppeteer only; no comment logic).

## Design

### Data model

`ReportSectionConfig` gains `text`; `comment` is retained, deprecated, read-only.

```ts
// packages/shared/src/entities/report-template.entity.ts
export interface ReportSectionConfig {
  type: ReportSectionType;
  order: number;
  title?: string;
  config?: Record<string, unknown>;
  /** Accompanying text for this section (markdown). Not available on text_block. */
  text?: string;
  /** @deprecated Read-only fallback for templates saved before 2026-08-02. Use `text`. */
  comment?: string;
}
```

Storage is unchanged: both keys live inside the existing `report_templates.sections`
jsonb column. No migration runs. Old `comment` values keep rendering; a template that
is re-saved through the UI writes `text` and drops `comment`.

A single helper owns the fallback so it is not duplicated across eleven renderers:

```ts
// packages/shared/src/types/reports.types.ts
export function getSectionText(section: Pick<ReportSectionConfig, 'text' | 'comment'>):
  string | undefined {
  return section.text ?? section.comment;
}
```

**Writes never set `comment`.** Every producer (DTO mapping, web dialog, preview modal)
writes `text` only.

### Shared type renames

| Before | After |
|---|---|
| `CommentableSectionType` | `TextableSectionType = Exclude<ReportSectionType, 'text_block'>` |
| `COMMENTABLE_SECTION_TYPES` (9 types) | `SECTION_TYPES_WITH_TEXT` (10 types — `header` added) |
| `isCommentableSection()` | `sectionSupportsText()` |

`header` joins the list, resolving mismatch (2). The header's text renders inside the
Test Run Summary block, never on the cover page — that placement rule in
`header-renderer.ts:119-124` is unchanged.

`REPORT_LIMITS.MAX_COMMENT_LENGTH` → `MAX_SECTION_TEXT_LENGTH = 5000`, resolving
mismatch (3). The UI adopts 5000; the API value is unchanged.

The web-local duplicate registry in `apps/web/lib/api/reports.ts:34-51` gets the same
renames. (Per `project_web_local_report_section_type`, this registry is independent of
`@perfana/shared` and must be edited in both places.)

### Rendering

`commentBlock()` in `apps/api/src/modules/reports/renderers/report-style.ts:359` becomes
`sectionText()`. It drops the SVG bubble, the `#f5f9ff` background, the 4px accent
border, the 6px radius, the 13px font-size reduction, and the flex row. What remains:

```ts
export function sectionText(text: string | null | undefined): string {
  const value = (text ?? '').trim();
  if (!value) return '';
  return `<div class="section-text" style="margin:0 0 20px;">${renderMarkdown(value)}</div>`;
}
```

Behaviour preserved from `commentBlock`:

- Empty / whitespace-only input returns `''` — no empty container, no placeholder.
- `renderMarkdown()` escapes before emitting tags, so this is not an HTML injection hole.
  The existing XSS assertions in `report-style.spec.ts:225,238` carry over unchanged.
- Typography comes entirely from `renderMarkdown({ styled: true })` inline styles, which
  is what `text_block` bodies already use. Result: accompanying text and text-block
  bodies render identically.

**Position:** unchanged — directly beneath the section header, above the section's own
content. It reads as an introduction to what follows.

The `.section-comment` CSS rules are deleted from both stylesheets in
`report-html-compiler.service.ts` (preview doc `:255-265`, print doc `:594-605`). No
replacement `.section-text` rule is added; the class is a hook for consumers only.

Call sites to update (`commentBlock(x)` → `sectionText(getSectionText(section))`):

| File | Lines |
|---|---|
| `slo-renderer.ts` | 52, 69, 88 |
| `apdex-renderer.ts` | 83, 96, 123 |
| `transaction-response-times-renderer.ts` | 64, 111 |
| `regressions-renderer.ts` | 61, 84 |
| `awr-renderer.ts` | 59, 88 |
| `trends-renderer.ts` | 67, 197 |
| `comparisons-renderer.ts` | 75, 90, 152, 347 |
| `graphs-renderer.ts` | 115, 298 |
| `top-10-lists-renderer.ts` | 77 |
| `header-renderer.ts` | 125 |
| `text-block-renderer.ts` | 35 — **removed entirely** |

`text-block-renderer.ts` also loses the `!content.trim() && !comment` guard's comment
term, becoming a plain `if (!content.trim()) return ''`.

### API

- `ReportSectionConfigDto` (`create-report.dto.ts:43`) gains
  `@IsOptional() @IsString() @Length(0, 5000) text?: string`, keeping `comment?` as a
  deprecated accepted-but-not-documented field so older clients do not break.
- `report-template.service.ts:779-784`: the rejection list narrows from
  `['header', 'text_block']` to `['text_block']`, and checks `getSectionText(section)`
  so a legacy `comment` on a text_block is caught too.
- `report-template.service.ts:735-746`: drive-by fix — the `validTypes` list is missing
  `'top_10_lists'`, so saving any template containing a Top 10 Lists section currently
  throws `Invalid section type`. Adjacent to the edit above; fixed there.
- Controller passthroughs add `text` alongside `comment`:
  `report-generation.controller.ts:354, 428`;
  `report-template.controller.ts:272, 387, 598`.

### Web UI

**`SectionConfigs.tsx`**

- `SectionConfigShellProps`: `comment` / `onCommentChange` → `text` / `onTextChange`.
  Local-draft-plus-commit-on-blur behaviour (`:75-87`) is unchanged.
- `COMMENT_MAX_LENGTH = 2000` → `MAX_SECTION_TEXT_LENGTH` (5000) imported from the
  shared limits rather than redeclared.
- `MarkdownField` props: `label="Text"`,
  `placeholder="Add text to accompany this section..."`.
- All ten remaining config forms rewire `comment={config.comment}` →
  `text={config.text}` and the matching `onChange`.
- `TextBlockConfigForm` (`:238-289`) stops passing `text`/`onTextChange` to the shell,
  and the shell renders no editor when they are absent. Its own `Content` field is the
  text. The Preview Section button stays.

**`SectionPreviewModal.tsx`** — the main UX fix.

- `initialComment` / `onSaveComment` → `initialText` / `onSaveText`.
- The bare `TextField` (`:167-186`) is replaced by `MarkdownField` with the same props
  the inline editor uses: `label="Text"`, `rows={6}`,
  `maxLength={MAX_SECTION_TEXT_LENGTH}`, character-count `helperText`. Toolbar and live
  preview come for free.
- Copy: heading "Section Comments" → **"Text"**; helper copy → "Add text based on what
  you see in the preview above. It is saved with the section configuration."; button
  "Save Comment" → **"Save Text"**; `CommentIcon` → a text/notes icon.
- Unsaved-changes chip, cancel-resets, and `onEnter` re-init behaviour are unchanged.

**Other web files**

- `GenerateReportDialog.tsx:333-342` and `:919-923` — **the split/merge is deleted.**
  Section text stops being smuggled through the `config` object and becomes an explicit
  `text` / `onTextChange` prop on every form. Required, not cosmetic: `HeaderConfig`
  already has its own `config.text` (the header caption), which the existing split would
  destroy. See "Amendment 1" in the implementation plan.
- `section-summary.ts:29-72` — the collapsed-card fallback label reads
  `getSectionText(section)`; the header case's own `const text = trim(cfg.text)` is
  renamed to `caption` to avoid shadowing.
- `preview/HtmlSectionPreview.tsx:50-63` and `preview/ApdexSectionPreview.tsx:29-44` —
  gain an explicit `text?: string` prop; the "lift the comment out of config" code is
  deleted.
- `apps/web/lib/api/reports.ts` — `text?: string` on the section type (`:107`),
  registry renames, `MAX_COMMENT_LENGTH` → `MAX_SECTION_TEXT_LENGTH`.

## Backward compatibility

| Case | Behaviour |
|---|---|
| Template saved before this change, not re-saved | `comment` renders via `getSectionText` fallback, in the new prose style |
| Template re-saved after this change | Writes `text`, drops `comment` |
| Older API client POSTing `comment` | Accepted by the DTO, renders via fallback |
| `comment` on a `text_block` (possible today via ad-hoc generation) | No longer rendered; validator rejects it on template save |

The last row is the one deliberate behaviour loss: a text_block that has both `content`
and a comment will stop showing the comment. Acceptable — `content` is the text, and the
combination was only ever reachable through the ad-hoc path that skips validation.

## Testing

Updated:

- `report-style.spec.ts:205-250` — the comment-block describe becomes `sectionText`.
  Assertions on emptiness, XSS escaping, markdown subset, and heading reset carry over;
  assertions on the bubble SVG / background colour are replaced with assertions that
  they are *absent*.
- `SectionConfigs.spec.tsx`, `MarkdownField.spec.tsx`,
  `HtmlSectionPreview.spec.tsx:25-47`, `GenerateReportDialog.test.tsx:45`.

New:

- `getSectionText` unit test: prefers `text`, falls back to `comment`, returns
  `undefined` when neither is set.
- `SectionPreviewModal` test: the formatting toolbar is present and `onSaveText` fires
  with the edited value.
- `text-block-renderer` test: a section with a legacy `comment` renders only `content`.

Gates: `npm run preflight` (lint + type-check + RLS suite) before push.

## Out of scope / follow-ups

- `TextBlockConfig.fontSize` is written by the web form and consumed by nothing in
  `text-block-renderer.ts`. Pre-existing dead config; not touched here.
- `TextBlockSectionOptions` in `reports.types.ts:57-62` is missing `markdown`,
  `fontSize`, and `'justify'` versus the web-side type. Pre-existing drift; not touched.
- `preview/README.md` is partly stale (describes per-section preview boilerplate that
  `SectionConfigShell` now centralises). Its comment-related paragraphs are updated;
  the stale boilerplate section is left alone.
