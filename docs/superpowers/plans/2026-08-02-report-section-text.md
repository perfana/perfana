# Report Section Accompanying Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-section report "comments" with an accompanying **text** field that renders as plain prose, edited everywhere through the same markdown editor.

**Architecture:** `ReportSectionConfig.comment` is superseded by `ReportSectionConfig.text`, both stored in the existing `report_templates.sections` jsonb column. A single shared helper `getSectionText()` reads `text ?? comment`, so pre-existing templates keep rendering with no DB migration. The API's `commentBlock()` callout becomes `sectionText()`, emitting bare markdown. On the web side the value stops being smuggled through the section `config` object and becomes an explicit `text` / `onTextChange` prop pair.

**Tech Stack:** TypeScript monorepo — `packages/shared` (types/entities, Jest), `apps/api` (NestJS, Jest), `apps/web` (Next.js + MUI, Jest + Testing Library).

**Spec:** `docs/superpowers/specs/2026-08-02-report-section-text-design.md`

## Global Constraints

- Max accompanying-text length is **5000** characters everywhere (API DTO already allows 5000; the web UI's 2000 is being raised to match).
- The user-facing word is **"Text"**. No user-visible string may contain "Comment"/"comments" after this work.
- Writes **never** set `comment`. `comment` is read-only backward compatibility.
- Every section type supports accompanying text **except `text_block`**. `header` is included.
- No database migration. No change to `apps/perfana-report`.
- The rendered accompanying text is **plain prose**: no icon, no background tint, no border, no font-size reduction. Position is unchanged — directly under the section header, above the section's content.
- Branch: `feat/report-section-text` (already created, spec already committed).
- Commit style: conventional commits, no `Co-Authored-By` trailer needed on intermediate commits (the final PR commit gets it).

## Amendments to the spec (discovered while planning)

Two things the spec did not account for. Both are folded into the tasks below.

1. **`config.text` collision.** `HeaderConfig` already has its own `text` field (the header's caption). Today `GenerateReportDialog` smuggles the section-level `comment` *into* the config object (`GenerateReportDialog.tsx:333-342` splits it back out). Renaming to `text` would make `HeaderConfigForm`'s own `config.text` collide with the section-level `text` and get destroyed by the split. **Resolution:** stop smuggling. Section text becomes an explicit `text` / `onTextChange` prop on every config form. This *deletes* the split/merge code and the "lift comment out of config" code in the preview components — a net simplification.

2. **Latent bug in `validateSections`.** `report-template.service.ts:735-746` lists valid section types and is missing `'top_10_lists'`, so saving a template containing a Top 10 Lists section throws `Invalid section type`. Task 3 edits the adjacent lines; the missing type is added there.

## File Structure

**Modified — `packages/shared`**
- `src/entities/report-template.entity.ts` — `ReportSectionConfig.text`, deprecate `comment`
- `src/types/reports.types.ts` — `TextableSectionType`, `SECTION_TYPES_WITH_TEXT`, `sectionSupportsText()`, `getSectionText()`, `REPORT_DEFAULTS.MAX_SECTION_TEXT_LENGTH`
- `src/types/reports.types.spec.ts` — **created**

**Modified — `apps/api/src/modules/reports`**
- `renderers/report-style.ts` — `commentBlock()` → `sectionText()`
- `renderers/report-style.spec.ts` — describe block rewritten
- `renderers/{slo,apdex,transaction-response-times,regressions,awr,trends,comparisons,graphs,top-10-lists,header}-renderer.ts` — call-site swap
- `renderers/text-block-renderer.ts` — accompanying text removed entirely
- `renderers/text-block-renderer.spec.ts` — **created**
- `services/report-html-compiler.service.ts` — `.section-comment` CSS deleted from both stylesheets
- `services/report-template.service.ts` — validator narrowed to `text_block`, `top_10_lists` added to valid types
- `dto/create-report.dto.ts` — `text` field on `ReportSectionConfigDto`
- `controllers/report-generation.controller.ts`, `controllers/report-template.controller.ts` — passthroughs

**Modified — `apps/web`**
- `lib/api/reports.ts` — `text` field, registry renames, `MAX_SECTION_TEXT_LENGTH`
- `components/reports/report-generation/SectionPreviewModal.tsx` — `MarkdownField` + copy
- `components/reports/report-generation/preview/HtmlSectionPreview.tsx`, `preview/ApdexSectionPreview.tsx` — explicit `text` prop
- `components/reports/report-generation/SectionConfigs.tsx` — shell + 11 forms
- `components/reports/report-generation/GenerateReportDialog.tsx` — explicit prop wiring
- `components/reports/report-generation/section-summary.ts` — fallback via `getSectionText`
- matching `.spec.tsx` / `.test.tsx` files
- `components/reports/report-generation/preview/README.md` — comment paragraphs updated

---

### Task 1: Shared types — `text` field and `getSectionText`

**Files:**
- Modify: `packages/shared/src/entities/report-template.entity.ts:31-42`
- Modify: `packages/shared/src/types/reports.types.ts:25-29, 556-569, 609-620, 626-630`
- Test: `packages/shared/src/types/reports.types.spec.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface ReportSectionConfig { type; order; title?; config?; text?: string; comment?: string }`
  - `type TextableSectionType = Exclude<ReportSectionType, 'text_block'>`
  - `const SECTION_TYPES_WITH_TEXT: readonly TextableSectionType[]` (10 entries)
  - `function sectionSupportsText(type: ReportSectionType): type is TextableSectionType`
  - `function getSectionText(section: Pick<ReportSectionConfig, 'text' | 'comment'>): string | undefined`
  - `REPORT_DEFAULTS.MAX_SECTION_TEXT_LENGTH = 5000`
  - **Removed:** `CommentableSectionType`, `COMMENTABLE_SECTION_TYPES`, `isCommentableSection`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/types/reports.types.spec.ts`:

```ts
import {
  getSectionText,
  sectionSupportsText,
  SECTION_TYPES_WITH_TEXT,
  REPORT_DEFAULTS,
} from './reports.types';

describe('getSectionText', () => {
  it('prefers text over the deprecated comment', () => {
    expect(getSectionText({ text: 'new', comment: 'old' })).toBe('new');
  });

  it('falls back to comment when text is absent', () => {
    expect(getSectionText({ comment: 'old' })).toBe('old');
  });

  it('returns undefined when neither is set', () => {
    expect(getSectionText({})).toBeUndefined();
  });

  it('honours an empty text rather than resurrecting a stale comment', () => {
    // Clearing the field in the UI writes '' — a `||` fallback would wrongly
    // bring back the pre-migration comment here.
    expect(getSectionText({ text: '', comment: 'old' })).toBe('');
  });
});

describe('sectionSupportsText', () => {
  it('accepts every section type except text_block', () => {
    expect(sectionSupportsText('header')).toBe(true);
    expect(sectionSupportsText('slo')).toBe(true);
    expect(sectionSupportsText('top_10_lists')).toBe(true);
    expect(sectionSupportsText('text_block')).toBe(false);
  });

  it('lists ten types and never text_block', () => {
    expect(SECTION_TYPES_WITH_TEXT).toHaveLength(10);
    expect(SECTION_TYPES_WITH_TEXT).not.toContain('text_block');
  });
});

describe('REPORT_DEFAULTS', () => {
  it('caps section text at 5000 characters', () => {
    expect(REPORT_DEFAULTS.MAX_SECTION_TEXT_LENGTH).toBe(5000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx jest src/types/reports.types.spec.ts`
Expected: FAIL — `TS2305: Module './reports.types' has no exported member 'getSectionText'`

- [ ] **Step 3: Add `text` to the entity interface**

In `packages/shared/src/entities/report-template.entity.ts`, replace the `comment` line of `ReportSectionConfig` (line 41-42):

```ts
  /** Section-specific configuration */
  config?: Record<string, unknown>;
  /** Accompanying text for this section, rendered as markdown prose. Not available on text_block. */
  text?: string;
  /**
   * @deprecated Read-only fallback for templates saved before 2026-08-02.
   * Use `text`. Never written by new code — read it through `getSectionText()`.
   */
  comment?: string;
}
```

- [ ] **Step 4: Rename the textable-section type**

In `packages/shared/src/types/reports.types.ts`, replace lines 25-29:

```ts
/**
 * Section types that support accompanying text.
 * All except 'text_block' — a text block's `content` already is the text.
 */
export type TextableSectionType = Exclude<ReportSectionType, 'text_block'>;
```

- [ ] **Step 5: Rename the registry constant**

In the same file, replace the `COMMENTABLE_SECTION_TYPES` block (lines 556-569):

```ts
/**
 * Section types that support accompanying text
 */
export const SECTION_TYPES_WITH_TEXT: readonly TextableSectionType[] = [
  'header',
  'slo',
  'apdex',
  'transaction_response_times',
  'regressions',
  'awr',
  'trends',
  'comparisons',
  'graphs',
  'top_10_lists',
] as const;
```

- [ ] **Step 6: Add the length limit**

In the same file, add to `REPORT_DEFAULTS` (after `MAX_CUSTOM_CSS_LENGTH`, line ~619):

```ts
  /** Maximum custom CSS length */
  MAX_CUSTOM_CSS_LENGTH: 10000,
  /** Maximum accompanying-text length per section */
  MAX_SECTION_TEXT_LENGTH: 5000,
} as const;
```

- [ ] **Step 7: Replace the type guard and add the read helper**

In the same file, replace the `isCommentableSection` block (lines 626-630):

```ts
/**
 * Check if a section type supports accompanying text
 */
export function sectionSupportsText(type: ReportSectionType): type is TextableSectionType {
  return SECTION_TYPES_WITH_TEXT.includes(type as TextableSectionType);
}

/**
 * Read a section's accompanying text.
 *
 * Templates saved before 2026-08-02 store the value under the deprecated
 * `comment` key; there is no data migration, so every reader goes through
 * here. Nullish coalescing (not `||`) so a deliberately cleared '' wins over
 * a stale comment.
 */
export function getSectionText(
  section: Pick<ReportSectionConfig, 'text' | 'comment'>,
): string | undefined {
  return section.text ?? section.comment;
}
```

`ReportSectionConfig` is already imported/re-exported in this file via `../entities`; if the import is missing, add `import type { ReportSectionConfig } from '../entities/report-template.entity';` at the top.

- [ ] **Step 8: Run test to verify it passes**

Run: `cd packages/shared && npx jest src/types/reports.types.spec.ts`
Expected: PASS — 8 tests

- [ ] **Step 9: Verify nothing else referenced the old names**

Run: `grep -rn "isCommentableSection\|COMMENTABLE_SECTION_TYPES\|CommentableSectionType" packages apps --include=*.ts --include=*.tsx | grep -v node_modules | grep -v /dist/`
Expected: only hits under `apps/web/` (its own local copy, handled in Task 4) and `apps/web/__tests__`. Zero hits under `packages/` or `apps/api/`.

Run: `cd packages/shared && npm run type-check`
Expected: exit 0

- [ ] **Step 10: Commit**

```bash
git add packages/shared/src/entities/report-template.entity.ts \
        packages/shared/src/types/reports.types.ts \
        packages/shared/src/types/reports.types.spec.ts
git commit -m "feat(reports): add section text field with getSectionText fallback"
```

---

### Task 2: Render accompanying text as prose

**Files:**
- Modify: `apps/api/src/modules/reports/renderers/report-style.ts:350-370`
- Modify: `apps/api/src/modules/reports/renderers/report-style.spec.ts:15, 209-251`
- Modify: `apps/api/src/modules/reports/services/report-html-compiler.service.ts:256-266, 594-605`
- Modify: 10 renderer files (see Step 5)
- Modify: `apps/api/src/modules/reports/renderers/text-block-renderer.ts`
- Test: `apps/api/src/modules/reports/renderers/text-block-renderer.spec.ts` (create)

**Interfaces:**
- Consumes: `getSectionText` from `@perfana/shared` (Task 1).
- Produces: `export function sectionText(text: string | null | undefined): string` in `report-style.ts`. `commentBlock` no longer exists.

This task changes `report-style.ts` and all its callers together — `commentBlock` is deleted, so a partial commit would not compile.

- [ ] **Step 1: Rewrite the failing spec**

In `apps/api/src/modules/reports/renderers/report-style.spec.ts`, change the import on line 15 from `commentBlock,` to `sectionText,`, then replace the whole `describe('comment block (rule 07)', ...)` block (lines 209-251) with:

```ts
  describe('section text (rule 07)', () => {
    it('renders the text as bare prose', () => {
      const html = sectionText('Investigated with team, see PERF-42');
      expect(html).toContain('section-text');
      expect(html).toContain('PERF-42');
    });

    it('carries no callout chrome — no icon, tint, or accent border', () => {
      // Accompanying text is narrative belonging to the section, not an
      // annotation about it. Any of these would reintroduce the old bubble.
      const html = sectionText('Some prose');
      expect(html).not.toContain('<svg');
      expect(html).not.toContain('#f5f9ff');
      expect(html).not.toContain('border-left');
      expect(html).not.toContain('section-comment');
    });

    it('omits entirely when empty or whitespace', () => {
      expect(sectionText(undefined)).toBe('');
      expect(sectionText('')).toBe('');
      expect(sectionText('   ')).toBe('');
    });

    it('escapes text content', () => {
      expect(sectionText('<img onerror=x>')).toContain('&lt;img');
    });

    it('renders markdown, matching the toolbar the editor offers', () => {
      const html = sectionText('The **p95** rose\n\n- checkout\n- search');

      expect(html).toContain('<strong>p95</strong>');
      expect(html).toContain('<ul');
      expect(html).toContain('<li>checkout</li>');
      expect(html).not.toContain('**p95**');
    });

    it('still escapes author HTML once markdown rendering is in play', () => {
      const html = sectionText('<script>alert(1)</script> and [x](javascript:alert(1))');

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<a href="javascript');
    });

    it('keeps a heading from inheriting the report section chrome', () => {
      // The text sits inside <section>, so an unreset h2 would pick up the
      // brand colour and underline meant for real section titles.
      const html = sectionText('## Note');

      expect(html).toContain('color:inherit');
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest src/modules/reports/renderers/report-style.spec.ts`
Expected: FAIL — `'"./report-style"' has no exported member named 'sectionText'`

- [ ] **Step 3: Replace `commentBlock` with `sectionText`**

In `apps/api/src/modules/reports/renderers/report-style.ts`, replace the block at lines 350-370 (header comment through the closing brace):

```ts
// ---------------------------------------------------------------------------
// Rule 07 · Optional accompanying section text
// ---------------------------------------------------------------------------

/**
 * Accompanying text, rendered directly under the section header as plain
 * prose — the same markdown subset and typography a text block body gets, so
 * the two read identically. Empty/whitespace text → '' (omit entirely — no
 * empty box, no placeholder).
 *
 * renderMarkdown escapes the source before emitting any tag, so this is not an
 * HTML hole even though the output is served unauthenticated via share links.
 */
export function sectionText(text: string | null | undefined): string {
  const value = (text ?? '').trim();
  if (!value) return '';
  return `<div class="section-text" style="margin:0 0 20px;">${renderMarkdown(value)}</div>`;
}
```

If `ACCENT` or `REPORT_COLORS` becomes unused in this file as a result, leave them — they are used elsewhere in the module. Verify with the lint run in Step 9.

- [ ] **Step 4: Delete the `.section-comment` stylesheet rules**

In `apps/api/src/modules/reports/services/report-html-compiler.service.ts`, delete both rule blocks — the preview stylesheet at lines 256-266 (`.section-comment { … font-weight: 500; }`) and the print stylesheet at lines 594-605 (including its `/* Section Comment */` comment line). Add no replacement rule; `.section-text` is a consumer hook only, its typography comes from `renderMarkdown`.

- [ ] **Step 5: Swap the ten renderer call sites**

Each of these files has exactly one `const comment = section.comment;` line and one or more `commentBlock(comment)` call sites. In every file apply the same four edits:

1. In the `./report-style` import list, change `commentBlock,` → `sectionText,`.
2. Add `getSectionText` to the existing `@perfana/shared` import (create the import if the file has none: `import { getSectionText } from '@perfana/shared';`).
3. Change `const comment = section.comment;` → `const text = getSectionText(section);`
4. Change every `commentBlock(comment)` → `sectionText(text)`.

| File | `const comment` line | `commentBlock(...)` lines |
|---|---|---|
| `slo-renderer.ts` | 44 | 52, 69, 88 |
| `apdex-renderer.ts` | 74 | 83, 96, 123 |
| `transaction-response-times-renderer.ts` | 53 | 64, 111 |
| `regressions-renderer.ts` | 49 | 61, 84 |
| `awr-renderer.ts` | 49 | 59, 88 |
| `trends-renderer.ts` | 43 | 67, 197 |
| `comparisons-renderer.ts` | 65, 114 | 75, 90, 152, 347 |
| `graphs-renderer.ts` | 59 | 115, 298 |
| `top-10-lists-renderer.ts` | 73 | 77 |
| `header-renderer.ts` | — (inline) | 125 |

Two files have an extra private helper whose parameter must be renamed too — `trends-renderer.ts:193` and `graphs-renderer.ts:294`:

```ts
  private renderNoDataSection(title: string, text: string | undefined, message: string): string {
```

and its internal `${commentBlock(comment)}` becomes `${sectionText(text)}`. Their call sites (`trends-renderer.ts:47,53`; `graphs-renderer.ts:65,99,102,104`) pass the local variable, which Step 5.3 already renamed to `text` — no further edit needed there.

`header-renderer.ts` has no local variable; change line 125 directly:

```ts
        <section>
          <h2>Test Run Summary</h2>
          ${sectionText(getSectionText(section))}
```

and update its comment on lines 118-119 to say "accompanying text" instead of "author comment".

- [ ] **Step 6: Remove accompanying text from text blocks**

In `apps/api/src/modules/reports/renderers/text-block-renderer.ts`, delete the `import { commentBlock } from './report-style';` line and replace the body of `renderTextBlockSection` from the `// An empty text block…` comment onward:

```ts
    // An empty text block otherwise prints as a bare bordered card in the PDF.
    if (!content.trim()) return '';

    // The plain-text branch is the escape hatch for blocks authored before
    // markdown rendering existed, where a leading `-` or `#` was meant literally.
    const body = markdown ? renderMarkdown(content) : renderPlainText(content);

    return `
      <section class="text-block" style="text-align: ${alignment};">
        ${body}
      </section>
    `;
  }
```

- [ ] **Step 7: Add the text-block regression test**

Create `apps/api/src/modules/reports/renderers/text-block-renderer.spec.ts`:

```ts
import { TextBlockRenderer } from './text-block-renderer';
import type { ReportSectionConfig } from '@perfana/shared';

describe('TextBlockRenderer', () => {
  const renderer = new TextBlockRenderer();

  const section = (over: Partial<ReportSectionConfig>): ReportSectionConfig => ({
    type: 'text_block',
    order: 0,
    ...over,
  });

  it('renders the content as markdown', () => {
    const html = renderer.renderTextBlockSection(section({ config: { content: 'The **p95** rose' } }));
    expect(html).toContain('<strong>p95</strong>');
  });

  it('ignores a legacy comment — a text block has no accompanying text', () => {
    const html = renderer.renderTextBlockSection(
      section({ config: { content: 'Body copy' }, comment: 'legacy annotation' }),
    );
    expect(html).toContain('Body copy');
    expect(html).not.toContain('legacy annotation');
  });

  it('renders nothing when the content is empty, even with a legacy comment', () => {
    expect(
      renderer.renderTextBlockSection(section({ config: { content: '  ' }, comment: 'legacy' })),
    ).toBe('');
  });

  it('rejects an unknown alignment rather than interpolating it', () => {
    const html = renderer.renderTextBlockSection(
      section({ config: { content: 'x', alignment: 'left"><script>alert(1)</script>' } }),
    );
    expect(html).toContain('text-align: left;');
    expect(html).not.toContain('<script>');
  });
});
```

- [ ] **Step 8: Run the tests**

Run: `cd apps/api && npx jest src/modules/reports/renderers/`
Expected: PASS — all renderer specs green, including the 7 rewritten `section text (rule 07)` tests and the 4 new text-block tests.

- [ ] **Step 9: Verify the API compiles and no `commentBlock` survives**

Run: `grep -rn "commentBlock\|section-comment" apps/api/src --include=*.ts`
Expected: no output.

Run: `cd apps/api && npm run type-check && npm run lint`
Expected: exit 0 for both.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/reports/renderers apps/api/src/modules/reports/services/report-html-compiler.service.ts
git commit -m "feat(reports): render section text as prose instead of a comment callout"
```

---

### Task 3: API contract — DTO, validator, controllers

**Files:**
- Modify: `apps/api/src/modules/reports/dto/create-report.dto.ts:84-94`
- Modify: `apps/api/src/modules/reports/services/report-template.service.ts:735-746, 778-784`
- Modify: `apps/api/src/modules/reports/controllers/report-generation.controller.ts:354, 428`
- Modify: `apps/api/src/modules/reports/controllers/report-template.controller.ts:272, 387, 598`
- Test: `apps/api/src/modules/reports/services/report-template.service.spec.ts` (create — the file does not exist)

**Interfaces:**
- Consumes: `getSectionText`, `REPORT_DEFAULTS.MAX_SECTION_TEXT_LENGTH` (Task 1).
- Produces: `ReportSectionConfigDto.text?: string` — accepted by every endpoint that accepts sections. `comment` still accepted, undocumented.

- [ ] **Step 1: Write the failing validator tests**

`validateSections` is private and pure — it touches none of the service's three injected dependencies — so it can be exercised directly with a stub-constructed instance. Create `apps/api/src/modules/reports/services/report-template.service.spec.ts`:

```ts
import { ReportTemplateService } from './report-template.service';
import type { ReportSectionConfig } from '@perfana/shared';

describe('ReportTemplateService.validateSections', () => {
  // validateSections reads no injected dependency, so stubs are enough.
  const service = new ReportTemplateService({} as never, {} as never, {} as never);
  const validate = (sections: ReportSectionConfig[]) =>
    (service as unknown as { validateSections(s: ReportSectionConfig[]): void }).validateSections(sections);

  const section = (over: Partial<ReportSectionConfig>): ReportSectionConfig => ({
    type: 'slo',
    order: 0,
    ...over,
  });

  it('accepts text on a header section', () => {
    expect(() => validate([section({ type: 'header', text: 'intro' })])).not.toThrow();
  });

  it('accepts a top_10_lists section', () => {
    expect(() => validate([section({ type: 'top_10_lists' })])).not.toThrow();
  });

  it('rejects text on a text_block section', () => {
    expect(() => validate([section({ type: 'text_block', text: 'nope' })])).toThrow(
      /not allowed on 'text_block'/,
    );
  });

  it('rejects a legacy comment on a text_block section', () => {
    expect(() => validate([section({ type: 'text_block', comment: 'nope' })])).toThrow(
      /not allowed on 'text_block'/,
    );
  });

  it('still rejects an unknown section type', () => {
    expect(() => validate([section({ type: 'nonsense' as never })])).toThrow(/Invalid section type/);
  });

  it('still rejects duplicate orders', () => {
    expect(() => validate([section({ order: 0 }), section({ order: 0 })])).toThrow(
      /Duplicate section order/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest src/modules/reports/services/report-template.service.spec.ts`
Expected: FAIL — the header case throws `Comments are not allowed on 'header' sections`, and the `top_10_lists` case throws `Invalid section type 'top_10_lists'`.

- [ ] **Step 3: Fix the valid-types list and narrow the text restriction**

In `apps/api/src/modules/reports/services/report-template.service.ts`, add the missing type to `validTypes` (line 735-746):

```ts
    const validTypes = [
      'header',
      'text_block',
      'slo',
      'apdex',
      'transaction_response_times',
      'regressions',
      'awr',
      'trends',
      'comparisons',
      'graphs',
      'top_10_lists',
    ];
```

Then replace the comment restriction (lines 778-784):

```ts
      // Accompanying text is not available on text_block — its `content` is the text.
      if (getSectionText(section) && section.type === 'text_block') {
        throw new ValidationException(
          `Accompanying text is not allowed on 'text_block' sections (index ${i})`,
        );
      }
```

Add `getSectionText` to the file's existing `@perfana/shared` import.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest src/modules/reports/services/report-template.service.spec.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Add `text` to the DTO**

In `apps/api/src/modules/reports/dto/create-report.dto.ts`, replace the `comment` property block (lines 84-94):

```ts
  @ApiPropertyOptional({
    description: 'Accompanying text for the section, rendered as markdown (not available for text_block)',
    example: 'All SLOs met during this test run',
    maxLength: REPORT_DEFAULTS.MAX_SECTION_TEXT_LENGTH,
  })
  @IsOptional()
  @IsString()
  @Length(0, REPORT_DEFAULTS.MAX_SECTION_TEXT_LENGTH, {
    message: `Text must not exceed ${REPORT_DEFAULTS.MAX_SECTION_TEXT_LENGTH} characters`,
  })
  text?: string;

  /**
   * @deprecated Superseded by `text`. Still accepted so older API clients and
   * CI pipelines keep working; read it through `getSectionText()`.
   */
  @IsOptional()
  @IsString()
  @Length(0, REPORT_DEFAULTS.MAX_SECTION_TEXT_LENGTH)
  comment?: string;
}
```

Add `REPORT_DEFAULTS` to the file's existing `@perfana/shared` import — this is the one consumer that makes the shared constant earn its place, so the 5000 is declared once.

Note the deprecated field intentionally has no `@ApiPropertyOptional` — it stays out of the Swagger contract.

- [ ] **Step 6: Thread `text` through the five controller passthroughs**

Each of these five spots maps a DTO section to a `ReportSectionConfig`. In all five, add a `text` line immediately above the existing `comment` line:

- `report-generation.controller.ts:354` and `:428`
- `report-template.controller.ts:272`, `:387`, `:598`

The first four use `s.` / `dto.section.`:

```ts
          config: s.config,
          text: s.text,
          comment: s.comment,
```

`report-generation.controller.ts:428` uses `dto.section.`:

```ts
          config: dto.section.config,
          text: dto.section.text,
          comment: dto.section.comment,
```

`report-template.controller.ts:598` (addSection) uses bare `dto.`:

```ts
        config: dto.config,
        text: dto.text,
        comment: dto.comment,
```

- [ ] **Step 7: Verify the whole API suite and types**

Run: `cd apps/api && npx jest src/modules/reports && npm run type-check`
Expected: PASS, exit 0.

Run: `grep -rn "s.text\|dto.text\|dto.section.text" apps/api/src/modules/reports/controllers | wc -l`
Expected: `5`

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/reports
git commit -m "feat(reports): accept section text on the API and allow it on header sections"
```

---

### Task 4: Web API layer

**Files:**
- Modify: `apps/web/lib/api/reports.ts:31-51, 100-108, 1017-1022, 1106-1114`

**Interfaces:**
- Consumes: nothing (this file is a standalone mirror of the shared registry — see the `project_web_local_report_section_type` gotcha: web does **not** import section types from `@perfana/shared`).
- Produces: `ReportSectionConfig.text?: string`, `SECTION_TYPES_WITH_TEXT`, `TextableSectionType`, `sectionSupportsText()`, `getSectionText()`, `REPORT_LIMITS.MAX_SECTION_TEXT_LENGTH`.

This task is additive plus renames of symbols whose only consumers are updated in Tasks 6-8; those consumers still reference `comment` at this point, which remains a valid field, so the app keeps compiling.

- [ ] **Step 1: Rename the registry**

In `apps/web/lib/api/reports.ts`, replace the `COMMENTABLE_SECTION_TYPES` block (lines 31-51):

```ts
/**
 * Section types that support accompanying text — every type except
 * text_block, whose `content` already is the text.
 */
export const SECTION_TYPES_WITH_TEXT = [
  'header',
  'slo',
  'apdex',
  'transaction_response_times',
  'regressions',
  'awr',
  'trends',
  'comparisons',
  'graphs',
  'top_10_lists',
] as const;

export type TextableSectionType = (typeof SECTION_TYPES_WITH_TEXT)[number];
```

- [ ] **Step 2: Add `text` to the section config interface**

Replace the `ReportSectionConfig` interface (lines ~100-108):

```ts
export interface ReportSectionConfig {
  type: ReportSectionType;
  order: number;
  title?: string;
  config?: Record<string, unknown>;
  /** Accompanying text, rendered as markdown prose under the section header. */
  text?: string;
  /** @deprecated Read-only fallback for templates saved before 2026-08-02. Use `text`. */
  comment?: string;
}
```

- [ ] **Step 3: Replace the type guard and add the read helper**

Replace the `isCommentableSection` block (lines ~1017-1022):

```ts
/**
 * Check if a section type supports accompanying text
 */
export function sectionSupportsText(type: ReportSectionType): type is TextableSectionType {
  return SECTION_TYPES_WITH_TEXT.includes(type as TextableSectionType);
}

/**
 * Read a section's accompanying text, falling back to the deprecated
 * `comment` for templates saved before 2026-08-02. Nullish coalescing so a
 * deliberately cleared '' wins over a stale comment.
 */
export function getSectionText(
  section: Pick<ReportSectionConfig, 'text' | 'comment'>,
): string | undefined {
  return section.text ?? section.comment;
}
```

- [ ] **Step 4: Rename the length limit**

In `REPORT_LIMITS` (line ~1110), replace `MAX_COMMENT_LENGTH: 5000,` with:

```ts
  MAX_SECTION_TEXT_LENGTH: 5000,
```

- [ ] **Step 5: Verify**

Run: `grep -rn "MAX_COMMENT_LENGTH\|isCommentableSection\|COMMENTABLE_SECTION_TYPES" apps/web --include=*.ts --include=*.tsx | grep -v node_modules`
Expected: only hits in `apps/web/__tests__/components/reports/GenerateReportDialog.test.tsx` (its jest mock of this module, updated in Task 7).

Run: `cd apps/web && npx tsc -p tsconfig.json --noEmit 2>&1 | grep -v "app/test-runs/" | head -20`
Expected: only the `GenerateReportDialog.test.tsx` mock error, if any. (Per `project_web_typecheck_excludes_testruns`: the build tsconfig excludes `app/test-runs/**`, so the full-project tsconfig with a filter is the honest check.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/api/reports.ts
git commit -m "feat(reports): add section text to the web API layer"
```

---

### Task 5: Preview modal uses the markdown editor

**Files:**
- Modify: `apps/web/components/reports/report-generation/SectionPreviewModal.tsx` (whole file)
- Modify: `apps/web/components/reports/report-generation/SectionConfigs.tsx:149-161` (two-line caller update only)
- Test: `apps/web/components/reports/report-generation/SectionPreviewModal.spec.tsx` (create)

**Interfaces:**
- Consumes: `MarkdownField` from `./MarkdownField` (existing: `{ label, value, onChange, placeholder, rows, markdown, onBlur, maxLength, helperText, expandable }`, where `onChange` receives the **string**, not an event); `REPORT_LIMITS` from `@/lib/api/reports` (Task 4).
- Produces: `SectionPreviewModalProps { open, onClose, sectionTitle, sectionType, children, initialText?, onSaveText?, testRunId? }` — consumed by Task 7.

- [ ] **Step 1: Write the failing test**

Create `apps/web/components/reports/report-generation/SectionPreviewModal.spec.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import SectionPreviewModal from './SectionPreviewModal';

describe('SectionPreviewModal', () => {
  const open = (props: Partial<React.ComponentProps<typeof SectionPreviewModal>> = {}) =>
    render(
      <SectionPreviewModal
        open
        onClose={jest.fn()}
        sectionTitle="Apdex Score"
        sectionType="Apdex"
        initialText=""
        onSaveText={jest.fn()}
        {...props}
      >
        <div>preview content</div>
      </SectionPreviewModal>,
    );

  it('offers the formatting toolbar, not a bare textarea', () => {
    open();
    // The whole point of the change: the same editor as the inline form.
    expect(screen.getByRole('button', { name: /bold/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Text' })).toBeInTheDocument();
  });

  it('uses "Text" wording throughout', () => {
    open();
    expect(screen.queryByText(/comment/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Text' })).toBeInTheDocument();
  });

  it('saves the edited text', () => {
    const onSaveText = jest.fn();
    open({ onSaveText });

    fireEvent.change(screen.getByRole('textbox', { name: 'Text' }), {
      target: { value: 'p95 improved 12%' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Text' }));

    expect(onSaveText).toHaveBeenCalledWith('p95 improved 12%');
  });

  it('discards edits on cancel', () => {
    const onSaveText = jest.fn();
    open({ initialText: 'original', onSaveText });

    fireEvent.change(screen.getByRole('textbox', { name: 'Text' }), { target: { value: 'edited' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onSaveText).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx jest components/reports/report-generation/SectionPreviewModal.spec.tsx`
Expected: FAIL — no Bold button (the modal renders a bare `TextField`), and `Save Comment` ≠ `Save Text`.

- [ ] **Step 3: Rewrite the modal's imports and props**

In `apps/web/components/reports/report-generation/SectionPreviewModal.tsx`, replace the import block and props interface (lines 1-30):

```tsx
'use client';

import React, { useState } from 'react';
import {
  Dialog,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Box,
  Button,
  Paper,
  Divider,
  Chip,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import VisibilityIcon from '@mui/icons-material/Visibility';
import NotesIcon from '@mui/icons-material/Notes';
import { MarkdownField } from './MarkdownField';
import { REPORT_LIMITS } from '@/lib/api/reports';

export interface SectionPreviewModalProps {
  open: boolean;
  onClose: () => void;
  sectionTitle: string;
  sectionType: string;
  children: React.ReactNode; // The preview content (section-specific renderer)
  initialText?: string;
  onSaveText?: (text: string) => void;
  testRunId?: string;
}
```

Note `TextField` and `CommentIcon` are dropped from the imports.

- [ ] **Step 4: Rewrite the component's state and handlers**

Replace the JSDoc block and the component signature through `handleClose` (lines 32-78):

```tsx
/**
 * Generic modal for previewing a report section and editing its accompanying text
 *
 * Usage:
 * <SectionPreviewModal
 *   open={previewOpen}
 *   onClose={() => setPreviewOpen(false)}
 *   sectionTitle="Apdex Score"
 *   sectionType="Apdex"
 *   initialText={text}
 *   onSaveText={onTextChange}
 * >
 *   <ApdexSectionPreview testRunId={testRunId} config={config} />
 * </SectionPreviewModal>
 */
export default function SectionPreviewModal({
  open,
  onClose,
  sectionTitle,
  sectionType,
  children,
  initialText = '',
  onSaveText,
  testRunId: _testRunId,
}: SectionPreviewModalProps) {
  const [text, setText] = useState(initialText);
  const [hasChanges, setHasChanges] = useState(false);

  // MarkdownField hands back the string, not a change event.
  const handleTextChange = (value: string) => {
    setText(value);
    setHasChanges(value !== initialText);
  };

  const handleSave = () => {
    if (onSaveText) {
      onSaveText(text);
    }
    setHasChanges(false);
    onClose();
  };

  const handleClose = () => {
    // Reset to the initial value if not saved
    setText(initialText);
    setHasChanges(false);
    onClose();
  };
```

- [ ] **Step 5: Update the dialog transition reset**

In the `TransitionProps` block (lines ~85-91):

```tsx
      TransitionProps={{
        onEnter: () => {
          // Reset state when modal opens
          setText(initialText);
          setHasChanges(false);
        },
      }}
```

- [ ] **Step 6: Replace the comment Paper with the markdown editor**

Replace the whole `{/* Comment Section */}` Paper (lines ~148-187):

```tsx
          {/* Accompanying Text */}
          <Paper
            elevation={2}
            sx={{
              p: 3,
              borderRadius: 2,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <NotesIcon sx={{ mr: 1, color: '#1976d2' }} />
              <Typography variant="h6" component="div">
                Text
              </Typography>
            </Box>
            <Divider sx={{ mb: 2 }} />
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Add text based on what you see in the preview above. It is saved with the
              section configuration and rendered above this section in the report.
            </Typography>
            <MarkdownField
              label="Text"
              value={text}
              onChange={handleTextChange}
              placeholder="Write the text that accompanies this section, or use the buttons above to format it"
              rows={6}
              maxLength={REPORT_LIMITS.MAX_SECTION_TEXT_LENGTH}
              helperText={`${text.length} / ${REPORT_LIMITS.MAX_SECTION_TEXT_LENGTH} characters`}
            />
          </Paper>
```

- [ ] **Step 7: Rename the save button**

In the action bar (lines ~222-236), change the disabled expression and the label:

```tsx
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={!hasChanges && text === initialText}
              sx={{
                textTransform: 'none',
                fontWeight: 600,
                background: 'linear-gradient(135deg, #1976d2 0%, #1565c0 100%)',
                '&:hover': {
                  background: 'linear-gradient(135deg, #1565c0 0%, #0d47a1 100%)',
                },
              }}
            >
              Save Text
            </Button>
```

- [ ] **Step 8: Update the one caller so the app still compiles**

In `apps/web/components/reports/report-generation/SectionConfigs.tsx`, lines 155-156 — rename the two props only. The shell's own internals stay as they are until Task 7:

```tsx
        initialText={localComment}
        onSaveText={onCommentChange}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd apps/web && npx jest components/reports/report-generation/SectionPreviewModal.spec.tsx`
Expected: PASS — 4 tests

If the Bold button query fails, check `MarkdownField.spec.tsx` for the accessible name the toolbar buttons actually expose and match it — do not weaken the assertion to a `data-testid`.

- [ ] **Step 10: Commit**

```bash
git add apps/web/components/reports/report-generation/SectionPreviewModal.tsx \
        apps/web/components/reports/report-generation/SectionPreviewModal.spec.tsx \
        apps/web/components/reports/report-generation/SectionConfigs.tsx
git commit -m "feat(reports): use the markdown editor for section text in preview mode"
```

---

### Task 6: Preview components take text explicitly

**Files:**
- Modify: `apps/web/components/reports/report-generation/preview/HtmlSectionPreview.tsx:7-12, 44-66`
- Modify: `apps/web/components/reports/report-generation/preview/ApdexSectionPreview.tsx:29-44`
- Modify: `apps/web/components/reports/report-generation/preview/HtmlSectionPreview.spec.tsx:25-47`
- Modify: `apps/web/components/reports/report-generation/preview/README.md`

**Interfaces:**
- Consumes: `previewSection` from `@/lib/api/reports` (unchanged signature — its section argument now carries `text`).
- Produces: `HtmlSectionPreviewProps { testRunId?, sectionType, config, text? }` and the same `text?` prop on `ApdexSectionPreview` — consumed by Task 7.

This removes the "lift the comment out of config" hack: the caller now passes the section text as its own prop, so `config` is only ever section config.

- [ ] **Step 1: Rewrite the failing spec**

In `apps/web/components/reports/report-generation/preview/HtmlSectionPreview.spec.tsx`, replace the test at lines 25-47 (keep the file's existing mocks and imports):

```tsx
  it('renders the resolved HTML in a fully sandboxed iframe and sends text at the section level', async () => {
    render(
      <HtmlSectionPreview
        testRunId="run-1"
        sectionType="slo"
        config={{ maxItems: 5 }}
        text="my observation"
      />,
    );

    await waitFor(() => expect(previewSection).toHaveBeenCalled());

    expect(previewSection).toHaveBeenCalledWith(
      {
        type: 'slo',
        order: 0,
        text: 'my observation',
        config: { maxItems: 5 },
      },
      'run-1',
      undefined,
      expect.anything(),
    );

    const iframe = document.querySelector('iframe');
    expect(iframe).toHaveAttribute('sandbox', '');
  });
```

Keep the rest of the file's tests untouched.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx jest components/reports/report-generation/preview/HtmlSectionPreview.spec.tsx`
Expected: FAIL — the call is made with `comment: undefined` and `config: { maxItems: 5 }`, and TS rejects the unknown `text` prop.

- [ ] **Step 3: Add the `text` prop to `HtmlSectionPreview`**

Replace the props interface (lines 7-12):

```tsx
interface HtmlSectionPreviewProps {
  testRunId?: string;
  /** API section type, e.g. 'slo', 'trends' */
  sectionType: ReportSectionType;
  /** Section config — section config only; accompanying text is a separate prop */
  config: Record<string, unknown>;
  /** Accompanying text, sent at the section level */
  text?: string;
}
```

- [ ] **Step 4: Use it in the fetch**

Change the component signature (line 29) to destructure `text`:

```tsx
export default function HtmlSectionPreview({ testRunId, sectionType, config, text }: HtmlSectionPreviewProps) {
```

The fetch is keyed on config content via `configKey`; the text must retrigger it too. Add a ref alongside `configRef` (after line 39):

```tsx
  const configRef = useRef(config);
  configRef.current = config;
  const configKey = JSON.stringify(config ?? {});

  const textRef = useRef(text);
  textRef.current = text;
```

Then replace the lift-and-post block (lines 49-63):

```tsx
        const html = await previewSection(
          {
            type: sectionType,
            order: 0,
            text: textRef.current,
            config: configRef.current ?? {},
          },
          testRunId,
          undefined,
          controller.signal
        );
```

Finally add `text` to the effect's dependency array so editing the text refreshes the preview. Locate the `}, [...])` closing the `useEffect` and add `text` to it, e.g. `}, [configKey, sectionType, testRunId, text]);` — match the existing dependency list, adding only `text`.

- [ ] **Step 5: Add the `text` prop to `ApdexSectionPreview`**

In `apps/web/components/reports/report-generation/preview/ApdexSectionPreview.tsx`, add `text?: string` to its props interface and destructure it in the component signature, then replace the `comment` line inside the `previewSection` call (line 34):

```tsx
            type: 'apdex',
            order: 0,
            text,
```

Add `text` to that effect's dependency array as well.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/web && npx jest components/reports/report-generation/preview/`
Expected: PASS

- [ ] **Step 7: Update the preview README**

In `apps/web/components/reports/report-generation/preview/README.md`, replace every "comment" reference with "text": the max length becomes 5000, and the storage note becomes "Accompanying text is stored on the section (`section.text`), not in the section config and not as a separate entity." Leave the stale per-section-preview-boilerplate paragraphs alone — out of scope.

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/reports/report-generation/preview
git commit -m "refactor(reports): pass section text to previews explicitly instead of via config"
```

---

### Task 7: Section config forms and the generate dialog

**Files:**
- Modify: `apps/web/components/reports/report-generation/SectionConfigs.tsx` (shell + 11 forms)
- Modify: `apps/web/components/reports/report-generation/GenerateReportDialog.tsx:330-343, 918-948`
- Modify: `apps/web/components/reports/report-generation/SectionConfigs.spec.tsx:72-90, 166`
- Modify: `apps/web/__tests__/components/reports/GenerateReportDialog.test.tsx:45-47, 69`

**Interfaces:**
- Consumes: `SectionPreviewModal` `{ initialText, onSaveText }` (Task 5); `HtmlSectionPreview` / `ApdexSectionPreview` `text` prop (Task 6); `REPORT_LIMITS.MAX_SECTION_TEXT_LENGTH` (Task 4).
- Produces: every exported `*ConfigForm` gains two props — `text?: string` and `onTextChange: (text: string) => void` — alongside its existing `config` / `onChange` / `testRunId`. Every `*Config` interface loses its `comment` field.

The shell's prop change and the dialog's wiring must land together — this is one deliverable.

- [ ] **Step 1: Rewrite the failing form tests**

In `apps/web/components/reports/report-generation/SectionConfigs.spec.tsx`, replace the test at lines 72-90:

```tsx
  it('commits text changes on blur, not on every keystroke', () => {
    const onTextChange = jest.fn();
    render(
      <SloConfigForm
        config={{}}
        onChange={jest.fn()}
        text=""
        onTextChange={onTextChange}
        testRunId="run-1"
      />,
    );

    // Query by role: the text editor's toolbar also carries the field name
    const textField = screen.getByRole('textbox', { name: 'Text' });
    expect(textField).toBeInTheDocument();

    fireEvent.change(textField, { target: { value: 'looks good' } });
    expect(onTextChange).not.toHaveBeenCalled();

    fireEvent.blur(textField);
    expect(onTextChange).toHaveBeenCalledWith('looks good');
  });

  it('gives a text block no accompanying-text editor — its content is the text', () => {
    render(
      <TextBlockConfigForm config={{ content: 'body' }} onChange={jest.fn()} testRunId="run-1" />,
    );

    expect(screen.queryByRole('textbox', { name: 'Text' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Content' })).toBeInTheDocument();
  });
```

Adjust the render props of any other test in this file that mounts a form (e.g. the text-block test at line 166) to match the new prop signature. Import `TextBlockConfigForm` if it is not already imported.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx jest components/reports/report-generation/SectionConfigs.spec.tsx`
Expected: FAIL — no `Text` textbox (the label is still "Section Comments"), and `text`/`onTextChange` are unknown props.

- [ ] **Step 3: Rewrite the shell**

In `apps/web/components/reports/report-generation/SectionConfigs.tsx`, replace the constant on line 23:

```tsx
import { REPORT_LIMITS } from '@/lib/api/reports';
```

added to the existing `@/lib/api/reports` import if there is one, and delete `const COMMENT_MAX_LENGTH = 2000;`.

Replace the props interface (lines 31-50):

```tsx
interface SectionConfigShellProps {
  /** Modal title, e.g. "Apdex Score" */
  sectionTitle: string;
  /** Human-readable type label shown in the modal chip, e.g. "Apdex" */
  sectionType: string;
  /** API section type used by the generic server-rendered HTML preview */
  previewType: ReportSectionType;
  /** Current section config — config only; accompanying text is separate */
  previewConfig: Record<string, unknown>;
  /**
   * Accompanying text. Omit both this and onTextChange to render no text
   * editor — text_block sections, whose Content field already is the text.
   */
  text?: string;
  onTextChange?: (text: string) => void;
  testRunId?: string;
  /** Extra per-form condition that disables the preview button */
  previewDisabled?: boolean;
  /** Tooltip shown when previewDisabled is true */
  previewDisabledReason?: string;
  /** Bespoke preview content; defaults to the server-rendered HTML preview */
  previewContent?: React.ReactNode;
  children?: React.ReactNode;
}
```

Replace the component body from its signature through the closing `}` (lines 52-164):

```tsx
/**
 * Shared wrapper that gives every section config form the same affordances:
 * the form's own fields, an accompanying-text editor and a "Preview Section"
 * button that opens the preview modal.
 */
function SectionConfigShell({
  sectionTitle,
  sectionType,
  previewType,
  previewConfig,
  text,
  onTextChange,
  testRunId,
  previewDisabled = false,
  previewDisabledReason,
  previewContent,
  children,
}: SectionConfigShellProps) {
  const [previewOpen, setPreviewOpen] = useState(false);

  // Local draft of the text so typing doesn't propagate to the parent (and
  // re-render every section card) on each keystroke; committed on blur and
  // before opening the preview modal.
  const [localText, setLocalText] = useState(text ?? '');

  // Sync the draft when the text changes externally (e.g. saved from the
  // preview modal).
  useEffect(() => {
    setLocalText(text ?? '');
  }, [text]);

  const commitText = () => {
    if (onTextChange && localText !== (text ?? '')) {
      onTextChange(localText);
    }
  };

  const disabled = !testRunId || previewDisabled;
  const disabledReason = !testRunId
    ? 'Select a test run to enable preview'
    : previewDisabledReason || 'Preview is not available for the current configuration';

  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {children}

        {/* Accompanying text — same editor as the text block body, so every
            section gets the formatting toolbar and preview. */}
        {onTextChange && (
          <MarkdownField
            label="Text"
            value={localText}
            onChange={setLocalText}
            onBlur={commitText}
            placeholder="Write the text that accompanies this section, or use the buttons above to format it"
            rows={4}
            maxLength={REPORT_LIMITS.MAX_SECTION_TEXT_LENGTH}
            helperText={`${localText.length} / ${REPORT_LIMITS.MAX_SECTION_TEXT_LENGTH} characters`}
          />
        )}

        {/* Preview Button */}
        <Tooltip title={disabled ? disabledReason : ''} arrow>
          <Box component="span" sx={{ display: 'block' }}>
            <Button
              variant="outlined"
              startIcon={<VisibilityIcon />}
              onClick={() => {
                // Commit any in-progress draft so the preview payload includes
                // the latest text.
                commitText();
                setPreviewOpen(true);
              }}
              fullWidth
              disabled={disabled}
              sx={{
                textTransform: 'none',
                fontWeight: 600,
                borderColor: 'primary.main',
                color: 'primary.main',
                py: 1.5,
                '&:hover': {
                  borderColor: 'primary.dark',
                  bgcolor: 'rgba(25, 118, 210, 0.04)',
                },
                '&.Mui-disabled': {
                  borderColor: 'rgba(0, 0, 0, 0.12)',
                  color: 'rgba(0, 0, 0, 0.26)',
                },
              }}
            >
              Preview Section
            </Button>
          </Box>
        </Tooltip>
      </Box>

      {/* Preview Modal */}
      <SectionPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        sectionTitle={sectionTitle}
        sectionType={sectionType}
        testRunId={testRunId}
        initialText={localText}
        onSaveText={onTextChange}
      >
        {previewContent ?? (
          <HtmlSectionPreview
            testRunId={testRunId}
            sectionType={previewType}
            config={previewConfig}
            text={localText}
          />
        )}
      </SectionPreviewModal>
    </>
  );
}
```

- [ ] **Step 4: Rewire the header form**

Replace `HeaderConfig` and `HeaderConfigForm` (lines 168-219) — note `config.text` here is the header's own caption and is untouched; the section text arrives as a prop:

```tsx
/** @public */
export interface HeaderConfig {
  text?: string;
  level?: number;
}

interface HeaderConfigFormProps {
  config: HeaderConfig;
  onChange: (config: HeaderConfig) => void;
  text?: string;
  onTextChange: (text: string) => void;
  testRunId?: string;
}

export function HeaderConfigForm({ config, onChange, text, onTextChange, testRunId }: HeaderConfigFormProps) {
  return (
    <SectionConfigShell
      sectionTitle={config.text || 'Header'}
      sectionType="Header"
      previewType="header"
      previewConfig={config}
      text={text}
      onTextChange={onTextChange}
      testRunId={testRunId}
    >
```

The `<TextField label="Header Text" …>` and level `Select` children are unchanged.

- [ ] **Step 5: Rewire the text block form (no text editor)**

Replace `TextBlockConfig` and the `TextBlockConfigForm` signature + shell props (lines 223-248):

```tsx
/** @public */
export interface TextBlockConfig {
  content?: string;
  fontSize?: number;
  markdown?: boolean;
  alignment?: 'left' | 'center' | 'right' | 'justify';
}

interface TextBlockConfigFormProps {
  config: TextBlockConfig;
  onChange: (config: TextBlockConfig) => void;
  testRunId?: string;
}

// A text block has no accompanying text — its Content field already is the
// text, so the shell gets no text/onTextChange and renders no second editor.
export function TextBlockConfigForm({ config, onChange, testRunId }: TextBlockConfigFormProps) {
  return (
    <SectionConfigShell
      sectionTitle="Text Block"
      sectionType="Text Block"
      previewType="text_block"
      previewConfig={config}
      testRunId={testRunId}
    >
```

Its children (Content `MarkdownField`, font size, alignment, markdown switch) are unchanged.

- [ ] **Step 6: Rewire the remaining nine forms**

For each of `SloConfigForm`, `ApdexConfigForm`, `TransactionResponseTimesConfigForm`, `RegressionsConfigForm`, `GraphsConfigForm`, `AwrConfigForm`, `TrendsConfigForm`, `ComparisonsConfigForm`, `Top10ListsConfigForm` apply the same three edits:

1. Delete `comment?: string;` from its exported `*Config` interface.
2. Add to its `*ConfigFormProps` interface:
   ```tsx
     text?: string;
     onTextChange: (text: string) => void;
   ```
   and destructure `text, onTextChange` in the component signature.
3. Replace the two shell props:
   ```tsx
       comment={config.comment}
       onCommentChange={(comment) => onChange({ ...config, comment })}
   ```
   with:
   ```tsx
       text={text}
       onTextChange={onTextChange}
   ```

`ApdexConfigForm` also passes a bespoke `previewContent={<ApdexSectionPreview … />}`; add `text={text}` to that element's props.

Interface line numbers for reference: SLO 300, Apdex 368, TransactionResponseTimes 426, Regressions 580, Graphs 714, AWR 803, Trends 888, Comparisons 968, Top10 1061. Shell prop pairs: 316-317, 384-385, 498-499, 621-622, 730-731, 819-820, 904-905, 984-985, 1186-1187.

- [ ] **Step 7: Delete the config split in the dialog**

In `apps/web/components/reports/report-generation/GenerateReportDialog.tsx`, replace `handleConfigChange` (lines 330-343) and add a sibling handler:

```tsx
  // Handle section config change
  const handleConfigChange = (index: number, config: Record<string, unknown>) => {
    const newSections = [...sections];
    newSections[index] = { ...newSections[index], config };
    setSections(newSections);
  };

  // Handle section text change — a section-level field, never part of config
  const handleTextChange = (index: number, text: string) => {
    const newSections = [...sections];
    newSections[index] = { ...newSections[index], text };
    setSections(newSections);
  };
```

- [ ] **Step 8: Thread the new handler to the section card**

The forms live inside `LayoutSectionCard`. Three edits:

1. Call site, `GenerateReportDialog.tsx:740` — add a line under the existing handler:

```tsx
                      onConfigChange={(config) => handleConfigChange(index, config)}
                      onTextChange={(text) => handleTextChange(index, text)}
```

2. Props interface, line 888 — add under `onConfigChange`:

```tsx
  onConfigChange: (config: Record<string, unknown>) => void;
  onTextChange: (text: string) => void;
```

3. Component signature, line 897 — destructure it:

```tsx
function LayoutSectionCard({ id, section, index, onDelete, onConfigChange, onTextChange, onMoveUp: _onMoveUp, onMoveDown: _onMoveDown, testRunId, systemUnderTestId, testEnvironment, workload }: LayoutSectionCardProps) {
```

- [ ] **Step 9: Rewrite `renderConfigForm`**

Replace the merge and the switch (lines 918-948):

```tsx
  // Render the appropriate config form. Section text is a section-level field
  // passed as its own prop — it is deliberately NOT merged into config, which
  // would collide with HeaderConfig's own `text`.
  const renderConfigForm = () => {
    const sectionConfig = (section.config || {}) as Record<string, unknown>;
    const text = getSectionText(section);

    switch (section.type) {
      case 'header':
        return <HeaderConfigForm config={sectionConfig} onChange={onConfigChange} text={text} onTextChange={onTextChange} testRunId={testRunId} />;
      case 'text_block':
        return <TextBlockConfigForm config={sectionConfig} onChange={onConfigChange} testRunId={testRunId} />;
      case 'slo':
        return <SloConfigForm config={sectionConfig} onChange={onConfigChange} text={text} onTextChange={onTextChange} testRunId={testRunId} />;
      case 'apdex':
        return <ApdexConfigForm config={sectionConfig} onChange={onConfigChange} text={text} onTextChange={onTextChange} testRunId={testRunId} />;
      case 'transaction_response_times':
        return <TransactionResponseTimesConfigForm config={sectionConfig} onChange={onConfigChange} text={text} onTextChange={onTextChange} testRunId={testRunId} />;
      case 'regressions':
        return <RegressionsConfigForm config={sectionConfig} onChange={onConfigChange} text={text} onTextChange={onTextChange} testRunId={testRunId} />;
      case 'graphs':
        return <GraphsConfigForm config={sectionConfig} onChange={onConfigChange} text={text} onTextChange={onTextChange} testRunId={testRunId} />;
      case 'awr':
        return <AwrConfigForm config={sectionConfig} onChange={onConfigChange} text={text} onTextChange={onTextChange} testRunId={testRunId} />;
      case 'trends':
        return <TrendsConfigForm config={sectionConfig} onChange={onConfigChange} text={text} onTextChange={onTextChange} testRunId={testRunId} />;
      case 'comparisons':
        return <ComparisonsConfigForm config={sectionConfig} onChange={onConfigChange} text={text} onTextChange={onTextChange} testRunId={testRunId} systemUnderTestId={systemUnderTestId} testEnvironment={testEnvironment} workload={workload} />;
      case 'top_10_lists':
        return <Top10ListsConfigForm config={sectionConfig} onChange={onConfigChange} text={text} onTextChange={onTextChange} testRunId={testRunId} />;
      default:
        return null;
    }
  };
```

Add `getSectionText` to the file's `@/lib/api/reports` import.

- [ ] **Step 10: Update the dialog's jest mock**

In `apps/web/__tests__/components/reports/GenerateReportDialog.test.tsx`, replace the mock entries at lines 45-47 and 69:

```ts
  sectionSupportsText: jest.fn((type: string) => type !== 'text_block'),
  getSectionText: jest.fn((s: { text?: string; comment?: string }) => s.text ?? s.comment),
```

and

```ts
    MAX_SECTION_TEXT_LENGTH: 5000,
```

- [ ] **Step 11: Run the tests**

Run: `cd apps/web && npx jest components/reports/report-generation __tests__/components/reports`
Expected: PASS

- [ ] **Step 12: Verify types**

Run: `cd apps/web && npx tsc -p tsconfig.json --noEmit 2>&1 | grep -v "app/test-runs/" | head -20`
Expected: no output

- [ ] **Step 13: Commit**

```bash
git add apps/web/components/reports/report-generation apps/web/__tests__/components/reports
git commit -m "feat(reports): edit section text as an explicit prop, drop it from text blocks"
```

---

### Task 8: Collapsed-card summary

**Files:**
- Modify: `apps/web/components/reports/report-generation/section-summary.ts:28-30, 71`
- Modify: `apps/web/components/reports/report-generation/section-summary.spec.ts:20-21, 48-96`

**Interfaces:**
- Consumes: `getSectionText` from `@/lib/api/reports` (Task 4); `HeaderConfig` / `TextBlockConfig` without `comment` (Task 7).
- Produces: nothing downstream.

- [ ] **Step 1: Update the failing tests**

In `apps/web/components/reports/report-generation/section-summary.spec.ts`, change every `comment:` key in a section fixture to `text:` — lines 21, 66, 83, 88 — and update the test names from "comment" to "text". Replace the `consults config.comment` test (lines 92-96) with a legacy-fallback test:

```ts
  it('falls back to a legacy comment when text is absent', () => {
    expect(sectionSummary(section({ type: 'apdex', comment: 'legacy note' }))).toBe('legacy note');
  });

  it('prefers text over a legacy comment', () => {
    expect(sectionSummary(section({ type: 'apdex', text: 'new note', comment: 'legacy note' }))).toBe(
      'new note',
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx jest components/reports/report-generation/section-summary.spec.ts`
Expected: FAIL — sections carrying `text` summarise as `null`.

- [ ] **Step 3: Read through the shared helper**

In `apps/web/components/reports/report-generation/section-summary.ts`, replace lines 28-30:

```ts
export function sectionSummary(section: ReportSectionConfig): string | null {
  const text = trim(getSectionText(section));
```

and add `getSectionText` to the existing `@/lib/api/reports` import (change the `import type` line into a value import, or add a second import line for the function).

- [ ] **Step 4: Rename the local variable at its six use sites**

Within the same function, replace each bare `comment` reference with `text`: the `header` case return (line 37), `text_block` (line 42), `transaction_response_times` (line 48), `comparisons` (lines 52 and 62), and the `default` case (line 71). Update the ponytail comment on line 70:

```ts
    default:
      // ponytail: no naming field in these configs — the text is the only distinguisher
      return text;
```

Note the `header` case already has a local `const text = trim(cfg.text)` for the header caption — rename **that** one to `caption` to avoid shadowing:

```ts
    case 'header': {
      const cfg = (section.config ?? {}) as HeaderConfig;
      const caption = trim(cfg.text);
      const level =
        typeof cfg.level === 'number' && Number.isInteger(cfg.level) && cfg.level >= 1 && cfg.level <= 6
          ? cfg.level
          : 1;
      return caption ? `H${level} — ${caption}` : text;
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && npx jest components/reports/report-generation/section-summary.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/reports/report-generation/section-summary.ts \
        apps/web/components/reports/report-generation/section-summary.spec.ts
git commit -m "feat(reports): summarise collapsed sections by their text"
```

---

### Task 9: Full verification and release prep

**Files:**
- Modify: `VERSION`
- Modify: `CHANGELOG.md` (if the repo keeps one; skip if absent)

**Interfaces:**
- Consumes: everything above.
- Produces: a branch ready for PR.

- [ ] **Step 1: Confirm no user-facing "comment" wording survives**

Run:
```bash
grep -rni "comment" apps/web/components/reports apps/web/lib/api/reports.ts \
  apps/api/src/modules/reports --include=*.ts --include=*.tsx \
  | grep -v "^\s*//" | grep -v "\* " | grep -v "@deprecated"
```
Expected: only the deliberate backward-compat identifiers — `comment?:` field declarations in `reports.ts` / `create-report.dto.ts`, `s.comment` / `dto.comment` in the five controller passthroughs, and `section.comment` inside `getSectionText`. No JSX strings, labels, placeholders, or button text.

- [ ] **Step 2: Run every affected test suite**

Run:
```bash
cd packages/shared && npx jest && \
cd ../../apps/api && npx jest src/modules/reports && \
cd ../web && npx jest components/reports __tests__/components/reports
```
Expected: all green. Record the failure output verbatim if anything fails — do not proceed past a red suite.

- [ ] **Step 3: Run the repo health gates**

Run: `npm run preflight`
Expected: exit 0 (lint + type-check across the monorepo, then the API RLS suite).

- [ ] **Step 4: Verify the rendered output by hand**

Start the stack (`npm run dev`), open a test run at http://localhost:4000, open the report generation dialog, and check all four of:

1. A non-text-block section shows a **Text** editor with the formatting toolbar.
2. "Preview Section" opens the modal; the modal's editor has the same toolbar; **Save Text** persists back into the inline editor.
3. The preview iframe shows the text as plain prose above the section content — no blue box, no speech-bubble icon.
4. A Text Block section shows **only** its Content editor — no second Text editor.

- [ ] **Step 5: Bump the version**

Edit `VERSION`, incrementing the patch: `0.2.61.103` → `0.2.61.104`.

- [ ] **Step 6: Check the change scope**

Run: `npx gitnexus analyze` then `gitnexus_detect_changes()`
Expected: affected symbols confined to the reports modules listed in this plan. Investigate anything outside them before opening the PR.

- [ ] **Step 7: Commit and push**

```bash
git add VERSION
git commit -m "chore: bump version to 0.2.61.104"
git push -u origin feat/report-section-text
```

- [ ] **Step 8: Open the PR**

```bash
gh pr create --title "feat(reports): replace section comments with accompanying text" --body "$(cat <<'EOF'
Replaces per-section report comments with an accompanying **text** field.

- `ReportSectionConfig.text` supersedes `comment`; `getSectionText()` reads `text ?? comment` so existing templates keep rendering. No DB migration.
- Rendered as plain markdown prose under the section header — the blue callout with the speech-bubble icon is gone.
- Every section type except `text_block` has one; `header` now included (previously a shared-vs-web mismatch).
- Preview mode uses the same `MarkdownField` editor as the inline form, with the formatting toolbar.
- Section text is now an explicit prop rather than smuggled through the section `config` object — this removes the split/merge hack and would otherwise have collided with `HeaderConfig.text`.
- Drive-by: `validateSections` was missing `top_10_lists`, so Top 10 Lists sections could not be saved in a template.

Spec: `docs/superpowers/specs/2026-08-02-report-section-text-design.md`
Plan: `docs/superpowers/plans/2026-08-02-report-section-text.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 9: Discard gitnexus auto-edits**

Run: `git checkout -- CLAUDE.md AGENTS.md 2>/dev/null; git status --short`
Expected: clean tree (the gitnexus post-commit hook rewrites index stats into `CLAUDE.md`; those edits are noise).

---

## Out of scope

Recorded so a reviewer does not mistake them for oversights:

- `TextBlockConfig.fontSize` is written by the web form and read by nothing in `text-block-renderer.ts`. Pre-existing dead config.
- `TextBlockSectionOptions` (`reports.types.ts:57-62`) is missing `markdown`, `fontSize`, and `'justify'` versus the web-side type. Pre-existing drift.
- The stale per-section-preview-boilerplate paragraphs in `preview/README.md`.
- A one-shot SQL migration rewriting the `comment` jsonb key. Deliberately declined in the spec — the read-time fallback carries it.
