# Report Section Index and Anchor Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a generated report an index of its sections, and let an author writing prose link to any section by name.

**Architecture:** A section's anchor is a slug of its effective title, computed by one shared helper so the API and the web builder cannot disagree. The API stamps an empty `<a id>` before each section in `renderSections()` — the single loop every section already passes through — so no existing renderer changes. A new `index` section type renders the list. Text blocks are link *sources*: they get no anchor and no index entry.

**Tech Stack:** TypeScript monorepo. `packages/shared` (plain TS, Jest via ts-jest), `apps/api` (NestJS, Jest, `.spec.ts` beside source), `apps/web` (Next.js, MUI, Jest + Testing Library, tests in `__tests__/`).

**Spec:** `docs/superpowers/specs/2026-08-24-report-section-index-and-anchors-design.md`

## Global Constraints

- **Anchor = slug of effective title.** Effective title is `section.title` if set, else `ReportUtilsService.getSectionTitle(section.type)`.
- **Slug rules:** lowercase; strip accents to ASCII; every run of non-alphanumerics becomes a single `-`; trim leading/trailing `-`. Empty result falls back to the section `type`.
- **Duplicates:** deterministic `-2`, `-3` … in document order, first occurrence keeps the bare slug. This is a fallback, not the contract — it always accompanies a warning.
- **`text_block` is never a target.** No anchor, no index entry, absent from the link picker.
- **Warnings never block generation.** A report with a bad link still generates.
- **`apps/api` reports specs are mock-based** and run without a database: `cd apps/api && npx jest src/modules/reports`. Do NOT add a spec here that needs Postgres — `perfana_test` does not exist in this environment.
- **`packages/shared` must be rebuilt** after any change to it before `apps/api` type-checks: `npm run build --workspace=@perfana/shared`. `apps/api` compiles against `packages/shared/dist`, not `src`.
- **Do not run `--fix` on lint.** `apps/worker` and friends enforce `curly`; write braces.
- **Every new behaviour is mutation-checked** before its task is done: break the implementation, confirm the new test fails, restore.

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/utils/section-anchors.ts` (create) | Slug generation, per-document slug assignment, duplicate detection. No I/O, no framework. |
| `packages/shared/src/utils/__tests__/section-anchors.test.ts` (create) | Unit tests for the above. |
| `packages/shared/src/utils/index.ts` (modify) | Export the new module from the barrel. |
| `packages/shared/src/types/reports.types.ts` (modify) | Add `index` to `SECTION_TYPE_LABELS` — the single source the arrays derive from. |
| `packages/shared/src/entities/report-template.entity.ts` (modify) | Add `'index'` to the `ReportSectionType` union. |
| `apps/api/src/modules/reports/renderers/index-renderer.ts` (create) | Render the index list. |
| `apps/api/src/modules/reports/renderers/index-renderer.spec.ts` (create) | Tests for the above. |
| `apps/api/src/modules/reports/services/report-html-compiler.service.ts` (modify) | Compute anchors once, stamp them, route the `index` type. |
| `apps/api/src/modules/reports/services/report-utils.service.ts` (modify) | Add `index` to the compile-checked title `Record`. |
| `apps/api/src/modules/reports/services/report-generation-validator.service.ts` (modify) | Dead-anchor and duplicate-title warnings. |
| `apps/api/src/modules/reports/reports.module.ts` (modify) | Provide `IndexRenderer`. |
| `apps/api/src/modules/reports/renderers/report-style.ts` (modify) | `.section-anchor` scroll-margin rule. |
| `apps/web/lib/api/reports.ts` (modify) | The deliberate web copy of the registry. |
| `apps/web/components/reports/report-generation/MarkdownField.tsx` (modify) | "Link to section" toolbar button + picker. |
| `apps/web/components/reports/report-generation/SectionConfigs.tsx` (modify) | Pass sections to `MarkdownField`; duplicate-title warning. |

---

### Task 1: Shared slug helper

**Files:**
- Create: `packages/shared/src/utils/section-anchors.ts`
- Create: `packages/shared/src/utils/__tests__/section-anchors.test.ts`
- Modify: `packages/shared/src/utils/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `slugifySectionTitle(title: string, fallback: string): string`
  - `assignSectionAnchors<T>(items: T[], titleOf: (item: T) => string, typeOf: (item: T) => string): Map<T, string>`
  - `findDuplicateTitles(titles: string[]): string[]` — returns each title that appears more than once, once, in first-appearance order.

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/utils/__tests__/section-anchors.test.ts`:

```typescript
import {
  slugifySectionTitle,
  assignSectionAnchors,
  findDuplicateTitles,
} from '../section-anchors';

describe('slugifySectionTitle', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifySectionTitle('SLO Results', 'slo')).toBe('slo-results');
  });

  it('collapses any run of non-alphanumerics into one hyphen', () => {
    expect(slugifySectionTitle('Apdex — checkout  (p95)', 'apdex')).toBe('apdex-checkout-p95');
  });

  it('strips accents rather than dropping the letters', () => {
    expect(slugifySectionTitle('Résumé Détails', 'x')).toBe('resume-details');
  });

  it('keeps digits', () => {
    expect(slugifySectionTitle('Top 10 Lists', 'top_10_lists')).toBe('top-10-lists');
  });

  it('trims leading and trailing separators', () => {
    expect(slugifySectionTitle('  --Trends--  ', 'trends')).toBe('trends');
  });

  it('falls back when the title has no alphanumerics at all', () => {
    expect(slugifySectionTitle('!!! ???', 'graphs')).toBe('graphs');
  });

  it('falls back on an empty title', () => {
    expect(slugifySectionTitle('', 'slo')).toBe('slo');
  });
});

describe('assignSectionAnchors', () => {
  const titleOf = (s: { title: string }) => s.title;
  const typeOf = (s: { type: string }) => s.type;

  it('gives each distinct title its own slug', () => {
    const a = { title: 'SLO Results', type: 'slo' };
    const b = { title: 'Trends', type: 'trends' };
    const map = assignSectionAnchors([a, b], titleOf, typeOf);
    expect(map.get(a)).toBe('slo-results');
    expect(map.get(b)).toBe('trends');
  });

  it('suffixes duplicates in document order, first keeps the bare slug', () => {
    const a = { title: 'Graphs', type: 'graphs' };
    const b = { title: 'Graphs', type: 'graphs' };
    const c = { title: 'Graphs', type: 'graphs' };
    const map = assignSectionAnchors([a, b, c], titleOf, typeOf);
    expect(map.get(a)).toBe('graphs');
    expect(map.get(b)).toBe('graphs-2');
    expect(map.get(c)).toBe('graphs-3');
  });

  it('does not let a suffixed slug collide with a real title', () => {
    // A section literally titled "Graphs 2" must not steal graphs-2.
    const a = { title: 'Graphs', type: 'graphs' };
    const b = { title: 'Graphs 2', type: 'graphs' };
    const c = { title: 'Graphs', type: 'graphs' };
    const map = assignSectionAnchors([a, b, c], titleOf, typeOf);
    expect(map.get(a)).toBe('graphs');
    expect(map.get(b)).toBe('graphs-2');
    expect(new Set([map.get(a), map.get(b), map.get(c)]).size).toBe(3);
  });

  it('returns an empty map for no sections', () => {
    expect(assignSectionAnchors([], titleOf, typeOf).size).toBe(0);
  });
});

describe('findDuplicateTitles', () => {
  it('reports a repeated title once', () => {
    expect(findDuplicateTitles(['Graphs', 'Trends', 'Graphs'])).toEqual(['Graphs']);
  });

  it('reports nothing when all titles are distinct', () => {
    expect(findDuplicateTitles(['Graphs', 'Trends'])).toEqual([]);
  });

  it('compares case-insensitively, since the slug does', () => {
    expect(findDuplicateTitles(['Graphs', 'graphs'])).toEqual(['Graphs']);
  });

  it('preserves first-appearance order across several duplicates', () => {
    expect(findDuplicateTitles(['B', 'A', 'B', 'A'])).toEqual(['B', 'A']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/shared && npx jest src/utils/__tests__/section-anchors.test.ts`
Expected: FAIL — `Cannot find module '../section-anchors'`

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/utils/section-anchors.ts`:

```typescript
/**
 * Anchor slugs for report sections.
 *
 * Lives in shared because two consumers must produce byte-identical output: the
 * API stamps the anchors into the report HTML, and the web builder's link picker
 * has to compute the same slug or the markdown it inserts will not resolve. A
 * second implementation would drift, exactly as the section-type registry did.
 *
 * The slug is derived from the section TITLE, which makes the title the address.
 * That is a deliberate trade: no schema change and a guessable anchor, at the
 * cost of a rename breaking existing links. See the design doc.
 */

/** Slug a section title. `fallback` is used when the title has no alphanumerics. */
export function slugifySectionTitle(title: string, fallback: string): string {
  const slug = (title ?? '')
    // Decompose accented characters, then drop the combining marks, so "é" ends
    // up as "e" rather than being stripped along with the punctuation. The range
    // is written escaped because the literal characters are invisible in source.
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || fallback;
}

/**
 * Assign a unique anchor to every item, in document order.
 *
 * Duplicates get `-2`, `-3` … and the first occurrence keeps the bare slug. The
 * suffix is a fallback that keeps output deterministic; the contract is that
 * titles are unique, enforced by the warning `findDuplicateTitles` drives.
 */
export function assignSectionAnchors<T>(
  items: T[],
  titleOf: (item: T) => string,
  typeOf: (item: T) => string,
): Map<T, string> {
  const taken = new Set<string>();
  const anchors = new Map<T, string>();

  for (const item of items) {
    const base = slugifySectionTitle(titleOf(item), typeOf(item));
    let candidate = base;
    let n = 1;
    // Guard against a real title that already slugs to `base-2`: keep counting
    // until the candidate is genuinely free rather than assuming n=2 is.
    while (taken.has(candidate)) {
      n += 1;
      candidate = `${base}-${n}`;
    }
    taken.add(candidate);
    anchors.set(item, candidate);
  }

  return anchors;
}

/**
 * Titles that appear more than once, each reported once, in first-appearance
 * order. Case-insensitive because the slug is.
 */
export function findDuplicateTitles(titles: string[]): string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  const order: string[] = [];

  for (const title of titles) {
    const key = (title ?? '').trim().toLowerCase();
    if (seen.has(key)) {
      if (!duplicated.has(key)) {
        duplicated.add(key);
        order.push(titles.find(t => (t ?? '').trim().toLowerCase() === key) as string);
      }
    } else {
      seen.add(key);
    }
  }

  return order;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/shared && npx jest src/utils/__tests__/section-anchors.test.ts`
Expected: PASS — 15 tests

- [ ] **Step 5: Export from the barrel**

In `packages/shared/src/utils/index.ts`, append:

```typescript
// Export report section anchor slugs (used by API report HTML + web link picker)
export * from './section-anchors';
```

- [ ] **Step 6: Mutation-check the collision guard**

Temporarily change the `while` loop in `assignSectionAnchors` to a single `if`:

```typescript
    if (taken.has(candidate)) {
      candidate = `${base}-2`;
    }
```

Run: `cd packages/shared && npx jest src/utils/__tests__/section-anchors.test.ts`
Expected: FAIL — "does not let a suffixed slug collide with a real title" and the three-duplicate case.
Then restore the `while` loop and re-run: PASS.

- [ ] **Step 7: Build shared and commit**

```bash
npm run build --workspace=@perfana/shared
git add packages/shared/src/utils/section-anchors.ts packages/shared/src/utils/__tests__/section-anchors.test.ts packages/shared/src/utils/index.ts
git commit -m "feat: shared section anchor slugs

The API stamps anchors and the web link picker must compute the same slug, so
this lives in shared for the same reason markdown.ts does."
```

---

### Task 2: Register the `index` section type

**Files:**
- Modify: `packages/shared/src/entities/report-template.entity.ts:14-26`
- Modify: `packages/shared/src/types/reports.types.ts` (`SECTION_TYPE_LABELS`)
- Modify: `apps/api/src/modules/reports/services/report-utils.service.ts:80-93`
- Modify: `apps/web/lib/api/reports.ts` (`REPORT_SECTION_TYPES` and the labels map in `getSectionTypeLabel`)

**Interfaces:**
- Consumes: nothing.
- Produces: `'index'` as a valid `ReportSectionType` everywhere; `getSectionTitle('index') === 'Index'`.

- [ ] **Step 1: Run the existing sync test to confirm it currently passes**

Run: `cd apps/web && npx jest __tests__/lib/report-section-types.test.ts`
Expected: PASS. This test compares the web copy against the shared source and is what will catch a partial registration.

- [ ] **Step 2: Add the type to the union**

In `packages/shared/src/entities/report-template.entity.ts`, add to `ReportSectionType`:

```typescript
  | 'error_analysis'
  | 'index';
```

- [ ] **Step 3: Add the label — the single source**

In `packages/shared/src/types/reports.types.ts`, add to `SECTION_TYPE_LABELS`:

```typescript
  error_analysis: 'Error Analysis',
  index: 'Index',
```

`REPORT_SECTION_TYPES` and `SECTION_TYPES_WITH_TEXT` derive from these keys, so they need no edit.

- [ ] **Step 4: Build shared and confirm the API fails to compile**

```bash
npm run build --workspace=@perfana/shared
cd apps/api && npx tsc --noEmit -p tsconfig.json
```

Expected: FAIL — `Property 'index' is missing in type` for the `Record<ReportSectionType, string>` in `report-utils.service.ts`. This is the compile-time guard working.

- [ ] **Step 5: Add the API title**

In `apps/api/src/modules/reports/services/report-utils.service.ts`, in the `titles` record:

```typescript
      error_analysis: 'Error Analysis',
      index: 'Index',
```

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: clean.

- [ ] **Step 6: Watch the web sync test fail, then fix the web copy**

Run: `cd apps/web && npx jest __tests__/lib/report-section-types.test.ts`
Expected: FAIL — the web list is missing `index`.

In `apps/web/lib/api/reports.ts`, add `'index',` to the end of `REPORT_SECTION_TYPES`, and add `index: 'Index',` to the labels record inside `getSectionTypeLabel`.

Run again: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/entities/report-template.entity.ts packages/shared/src/types/reports.types.ts apps/api/src/modules/reports/services/report-utils.service.ts apps/web/lib/api/reports.ts
git commit -m "feat: register the index report section type"
```

---

### Task 3: Stamp anchors in the compiler

**Files:**
- Modify: `apps/api/src/modules/reports/services/report-html-compiler.service.ts:57-81`
- Create: `apps/api/src/modules/reports/services/report-html-compiler.anchors.spec.ts`
- Modify: `apps/api/src/modules/reports/renderers/report-style.ts`

**Interfaces:**
- Consumes: `assignSectionAnchors` from Task 1; `'index'` type from Task 2.
- Produces: `renderSections()` emits `<a id="{slug}" class="section-anchor" aria-hidden="true"></a>` before every non-`text_block` section.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/reports/services/report-html-compiler.anchors.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ReportHtmlCompilerService } from './report-html-compiler.service';
import { ReportUtilsService } from './report-utils.service';
import { ReportSectionConfig } from '@perfana/shared';

// Every renderer is stubbed: this suite is about the anchors the compiler emits
// around section HTML, not about what any renderer produces.
const stubRenderer = (marker: string) => ({
  [marker]: jest.fn().mockResolvedValue(`<section class="${marker}"></section>`),
});

describe('ReportHtmlCompilerService anchors', () => {
  let service: ReportHtmlCompilerService;

  const section = (over: Partial<ReportSectionConfig>): ReportSectionConfig =>
    ({ type: 'slo', order: 0, ...over }) as ReportSectionConfig;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReportHtmlCompilerService,
        ReportUtilsService,
        // Renderer providers are supplied by the module in production; the
        // helper below replaces whichever ones each test needs.
      ],
    })
      .useMocker((token) => {
        if (token === ReportUtilsService) return undefined;
        return { render: jest.fn() };
      })
      .compile();

    service = moduleRef.get(ReportHtmlCompilerService);
  });

  it('emits an anchor before a section, slugged from its title', async () => {
    const html = await service.renderSections(
      [section({ type: 'slo', order: 0, title: 'SLO Results' })],
      null,
      null,
    );
    expect(html).toContain('<a id="slo-results" class="section-anchor" aria-hidden="true"></a>');
  });

  it('uses the type default title when the section has none', async () => {
    const html = await service.renderSections([section({ type: 'trends', order: 0 })], null, null);
    expect(html).toContain('id="trends"');
  });

  it('emits no anchor for a text block', async () => {
    const html = await service.renderSections(
      [section({ type: 'text_block', order: 0, config: { content: 'hi' } })],
      null,
      null,
    );
    expect(html).not.toContain('class="section-anchor"');
  });

  it('suffixes a duplicate title in document order', async () => {
    const html = await service.renderSections(
      [
        section({ type: 'graphs', order: 0, title: 'Graphs' }),
        section({ type: 'graphs', order: 1, title: 'Graphs' }),
      ],
      null,
      null,
    );
    expect(html).toContain('id="graphs"');
    expect(html).toContain('id="graphs-2"');
  });

  it('anchors by sorted order, not array order', async () => {
    const html = await service.renderSections(
      [
        section({ type: 'graphs', order: 5, title: 'Graphs' }),
        section({ type: 'graphs', order: 1, title: 'Graphs' }),
      ],
      null,
      null,
    );
    // The order:1 section renders first, so it owns the bare slug.
    expect(html.indexOf('id="graphs"')).toBeLessThan(html.indexOf('id="graphs-2"'));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/api && npx jest src/modules/reports/services/report-html-compiler.anchors.spec.ts`
Expected: FAIL — no `section-anchor` in the output.

If the `useMocker` wiring above fails to construct the service, read the provider list in `apps/api/src/modules/reports/reports.module.ts` and supply an explicit `{ provide: X, useValue: { ... } }` for each renderer the constructor takes. Do not change the service to suit the test.

- [ ] **Step 3: Implement**

In `report-html-compiler.service.ts`, add the import:

```typescript
import { assignSectionAnchors } from '@perfana/shared';
```

Replace the body of `renderSections` (currently lines 63-81) with:

```typescript
    const sortedSections = [...sections].sort((a, b) => a.order - b.order);

    // Anchors are assigned over the sections that can be link TARGETS. A text
    // block is where links are written from, never to, so it is excluded here —
    // which also keeps it from consuming a slug a real section wants.
    const targets = sortedSections.filter(s => s.type !== 'text_block');
    const anchors = assignSectionAnchors(
      targets,
      s => s.title || this.utils.getSectionTitle(s.type),
      s => s.type,
    );

    const renderedSections: string[] = [];

    for (const section of sortedSections) {
      try {
        const sectionHtml = await this.renderSection(
          section,
          testRun,
          report,
          userId,
          roles,
          anchors,
        );
        const anchor = anchors.get(section);
        renderedSections.push(
          anchor
            ? `<a id="${anchor}" class="section-anchor" aria-hidden="true"></a>\n${sectionHtml}`
            : sectionHtml,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to render section ${section.type}: ${(error as Error).message}`,
        );
        renderedSections.push(this.placeholderRenderer.renderErrorSection(section, (error as Error).message));
      }
    }

    return renderedSections.join('\n');
```

Add the parameter to `renderSection`'s signature (it is passed through for Task 4):

```typescript
  private async renderSection(
    section: ReportSectionConfig,
    testRun: TestRun | null,
    _report: GeneratedReport | null,
    userId: string = '',
    roles: string[] = [],
    anchors: Map<ReportSectionConfig, string> = new Map(),
  ): Promise<string> {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx jest src/modules/reports/services/report-html-compiler.anchors.spec.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Confirm nothing else broke**

Run: `cd apps/api && npx jest src/modules/reports`
Expected: PASS — all suites. The anchor is an empty element, so no existing renderer snapshot should shift. If one does, read it: an assertion that counted elements or matched the full document string may legitimately need updating, but an assertion about a section's own markup must not.

- [ ] **Step 6: Add the scroll-margin rule**

In `apps/api/src/modules/reports/renderers/report-style.ts`, find the stylesheet string that already carries `.cover-page, .title-page, .toc-page` and add nearby:

```css
    .section-anchor {
      display: block;
      position: relative;
      scroll-margin-top: 24px;
    }
```

- [ ] **Step 7: Mutation-check the text-block exclusion**

Temporarily remove the `.filter(s => s.type !== 'text_block')`.
Run: `cd apps/api && npx jest src/modules/reports/services/report-html-compiler.anchors.spec.ts`
Expected: FAIL — "emits no anchor for a text block". Restore, re-run: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/reports/services/report-html-compiler.service.ts apps/api/src/modules/reports/services/report-html-compiler.anchors.spec.ts apps/api/src/modules/reports/renderers/report-style.ts
git commit -m "feat: stamp section anchors in the report compiler

One empty anchor before each target section, assigned at the single loop every
section already passes through, so no renderer changes and no layout shifts."
```

---

### Task 4: The index renderer

**Files:**
- Create: `apps/api/src/modules/reports/renderers/index-renderer.ts`
- Create: `apps/api/src/modules/reports/renderers/index-renderer.spec.ts`
- Modify: `apps/api/src/modules/reports/services/report-html-compiler.service.ts` (route the `index` case)
- Modify: `apps/api/src/modules/reports/reports.module.ts`

**Interfaces:**
- Consumes: `anchors: Map<ReportSectionConfig, string>` from Task 3; `sectionHeader(title)` from `./report-style`; `ReportUtilsService.getSectionTitle` and `.escapeHtml`.
- Produces: `IndexRenderer.renderIndexSection(section, entries): string` where `entries: { title: string; anchor: string }[]`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/reports/renderers/index-renderer.spec.ts`:

```typescript
import { IndexRenderer } from './index-renderer';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportSectionConfig } from '@perfana/shared';

describe('IndexRenderer', () => {
  const renderer = new IndexRenderer(new ReportUtilsService());
  const section = { type: 'index', order: 0 } as ReportSectionConfig;

  it('renders one linked entry per section, in order', () => {
    const html = renderer.renderIndexSection(section, [
      { title: 'SLO Results', anchor: 'slo-results' },
      { title: 'Trends', anchor: 'trends' },
    ]);
    expect(html).toContain('href="#slo-results"');
    expect(html).toContain('SLO Results');
    expect(html).toContain('href="#trends"');
    expect(html.indexOf('#slo-results')).toBeLessThan(html.indexOf('#trends'));
  });

  it('renders nothing when there are no entries', () => {
    expect(renderer.renderIndexSection(section, [])).toBe('');
  });

  it('escapes a title that contains markup', () => {
    const html = renderer.renderIndexSection(section, [
      { title: '<img src=x onerror=alert(1)>', anchor: 'img' },
    ]);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('uses the section title override for its own heading', () => {
    const html = renderer.renderIndexSection(
      { type: 'index', order: 0, title: 'Contents' } as ReportSectionConfig,
      [{ title: 'Trends', anchor: 'trends' }],
    );
    expect(html).toContain('Contents');
  });

  it('falls back to the default heading when not overridden', () => {
    const html = renderer.renderIndexSection(section, [
      { title: 'Trends', anchor: 'trends' },
    ]);
    expect(html).toContain('Index');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/api && npx jest src/modules/reports/renderers/index-renderer.spec.ts`
Expected: FAIL — `Cannot find module './index-renderer'`

- [ ] **Step 3: Implement the renderer**

Create `apps/api/src/modules/reports/renderers/index-renderer.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { ReportSectionConfig } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import { sectionHeader } from './report-style';

/** One row of the index: a section's display title and the anchor it links to. */
export interface IndexEntry {
  title: string;
  anchor: string;
}

/**
 * Renderer for the index section.
 *
 * The entry list is computed by the compiler, which is the only place that sees
 * every section at once. This renderer just formats it.
 */
@Injectable()
export class IndexRenderer {
  constructor(private readonly utils: ReportUtilsService) {}

  renderIndexSection(section: ReportSectionConfig, entries: IndexEntry[]): string {
    // An index of nothing is a bordered empty box in the PDF. Render nothing at
    // all, the same way an empty text block does.
    if (entries.length === 0) return '';

    const title = section.title || this.utils.getSectionTitle('index');

    const items = entries
      .map(
        entry =>
          `<li style="margin:0 0 8px;"><a href="#${this.utils.escapeHtml(entry.anchor)}" style="color:inherit; text-decoration:none;">${this.utils.escapeHtml(entry.title)}</a></li>`,
      )
      .join('\n');

    return `
      <section class="index-section">
        ${sectionHeader(title)}
        <ol style="margin:0; padding-left:22px;">
          ${items}
        </ol>
      </section>
    `;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx jest src/modules/reports/renderers/index-renderer.spec.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Wire it into the compiler**

In `report-html-compiler.service.ts`, import and inject:

```typescript
import { IndexRenderer } from '../renderers/index-renderer';
```

Add `private readonly indexRenderer: IndexRenderer,` to the constructor, and add the case to the `switch` in `renderSection`, before `default`:

```typescript
      case 'index':
        return this.indexRenderer.renderIndexSection(
          section,
          [...anchors.entries()]
            .filter(([target]) => target !== section)
            .map(([target, anchor]) => ({
              title: target.title || this.utils.getSectionTitle(target.type),
              anchor,
            })),
        );
```

`anchors` is already insertion-ordered by sorted section order from Task 3, and already excludes text blocks, so the entry list needs no further filtering or sorting.

- [ ] **Step 6: Provide it in the module**

In `apps/api/src/modules/reports/reports.module.ts`, add `IndexRenderer` to the imports and to the `providers` array beside the other renderers.

- [ ] **Step 7: Add the integration test**

Append to `apps/api/src/modules/reports/services/report-html-compiler.anchors.spec.ts`:

```typescript
  it('lists every target section but not itself or a text block', async () => {
    const html = await service.renderSections(
      [
        section({ type: 'index', order: 0 }),
        section({ type: 'slo', order: 1, title: 'SLO Results' }),
        section({ type: 'text_block', order: 2, config: { content: 'prose' } }),
      ],
      null,
      null,
    );
    expect(html).toContain('href="#slo-results"');
    expect(html).not.toContain('href="#index"');
    expect(html).not.toContain('href="#text"');
  });
```

Run: `cd apps/api && npx jest src/modules/reports`
Expected: PASS — all suites.

- [ ] **Step 8: Mutation-check the self-exclusion**

Temporarily remove `.filter(([target]) => target !== section)` from the compiler's `index` case.
Run: `cd apps/api && npx jest src/modules/reports/services/report-html-compiler.anchors.spec.ts`
Expected: FAIL — "lists every target section but not itself or a text block". Restore, re-run: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/reports/renderers/index-renderer.ts apps/api/src/modules/reports/renderers/index-renderer.spec.ts apps/api/src/modules/reports/services/report-html-compiler.service.ts apps/api/src/modules/reports/services/report-html-compiler.anchors.spec.ts apps/api/src/modules/reports/reports.module.ts
git commit -m "feat: render the report index section"
```

---

### Task 5: Dead-anchor and duplicate-title warnings

**Files:**
- Modify: `apps/api/src/modules/reports/services/report-generation-validator.service.ts`
- Create: `apps/api/src/modules/reports/services/report-generation-validator.anchors.spec.ts`

**Interfaces:**
- Consumes: `findDuplicateTitles` from Task 1.
- Produces:
  - `findDeadAnchors(html: string): string[]` — `#` targets referenced but never defined, deduplicated, in first-appearance order.
  - `warnOnAnchorProblems(html: string, titles: string[]): void` — logs; never throws.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/reports/services/report-generation-validator.anchors.spec.ts`:

```typescript
import { ReportGenerationValidatorService } from './report-generation-validator.service';

describe('ReportGenerationValidatorService anchor checks', () => {
  let service: ReportGenerationValidatorService;

  beforeEach(() => {
    service = new ReportGenerationValidatorService();
  });

  describe('findDeadAnchors', () => {
    it('finds a link whose target was never emitted', () => {
      const html = `
        <a id="slo-results" class="section-anchor"></a>
        <p><a href="#trends">see trends</a></p>
      `;
      expect(service.findDeadAnchors(html)).toEqual(['trends']);
    });

    it('finds nothing when every target exists', () => {
      const html = `
        <a id="trends" class="section-anchor"></a>
        <p><a href="#trends">see trends</a></p>
      `;
      expect(service.findDeadAnchors(html)).toEqual([]);
    });

    it('reports a repeated dead target once', () => {
      const html = `<a href="#gone">a</a><a href="#gone">b</a>`;
      expect(service.findDeadAnchors(html)).toEqual(['gone']);
    });

    it('ignores non-anchor hrefs', () => {
      const html = `<a href="https://example.com/#frag">x</a>`;
      expect(service.findDeadAnchors(html)).toEqual([]);
    });
  });

  describe('warnOnAnchorProblems', () => {
    it('never throws, whatever it finds', () => {
      expect(() =>
        service.warnOnAnchorProblems('<a href="#gone">x</a>', ['Graphs', 'Graphs']),
      ).not.toThrow();
    });

    it('logs a dead anchor and a duplicate title', () => {
      const warn = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);

      service.warnOnAnchorProblems('<a href="#gone">x</a>', ['Graphs', 'Graphs']);

      const messages = warn.mock.calls.map(c => String(c[0])).join(' | ');
      expect(messages).toContain('gone');
      expect(messages).toContain('Graphs');
      warn.mockRestore();
    });

    it('logs nothing when the report is clean', () => {
      const warn = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);

      service.warnOnAnchorProblems(
        '<a id="trends"></a><a href="#trends">x</a>',
        ['Trends', 'Graphs'],
      );

      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/api && npx jest src/modules/reports/services/report-generation-validator.anchors.spec.ts`
Expected: FAIL — `service.findDeadAnchors is not a function`

- [ ] **Step 3: Implement**

In `report-generation-validator.service.ts`, add the imports. The class currently has no logger and no constructor, so both the `Logger` import and the field below are new:

```typescript
import { Logger } from '@nestjs/common';
import { findDuplicateTitles } from '@perfana/shared';
```

Add to the class:

```typescript
  private readonly logger = new Logger(ReportGenerationValidatorService.name);

  /**
   * `#` link targets that no section emitted.
   *
   * Catches the common case: a section was renamed and the links pointing at its
   * old slug now go nowhere. It CANNOT catch the worse case — a duplicate title
   * making a link resolve to the wrong section — because that anchor still
   * exists. That is what the duplicate-title warning is for.
   */
  findDeadAnchors(html: string): string[] {
    const defined = new Set<string>();
    for (const match of html.matchAll(/\sid="([^"]+)"/g)) {
      defined.add(match[1]);
    }

    const dead: string[] = [];
    const seen = new Set<string>();
    // Only same-document fragments: href="#x", not href="https://…/#x".
    for (const match of html.matchAll(/href="#([^"]+)"/g)) {
      const target = match[1];
      if (defined.has(target) || seen.has(target)) continue;
      seen.add(target);
      dead.push(target);
    }

    return dead;
  }

  /** Log link problems. Never throws — a report with a bad link still generates. */
  warnOnAnchorProblems(html: string, titles: string[]): void {
    const dead = this.findDeadAnchors(html);
    if (dead.length > 0) {
      this.logger.warn(
        `Report links point at ${dead.length} anchor(s) that do not exist: ${dead.join(', ')}. ` +
          `A section was probably renamed after the links were written.`,
      );
    }

    const duplicates = findDuplicateTitles(titles);
    if (duplicates.length > 0) {
      this.logger.warn(
        `Report has sections sharing a title: ${duplicates.join(', ')}. ` +
          `Anchors fall back to numbered suffixes, so reordering or deleting one of them ` +
          `silently repoints existing links. Give them distinct titles.`,
      );
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx jest src/modules/reports/services/report-generation-validator.anchors.spec.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Call it from the generation path**

In `apps/api/src/modules/reports/services/report-generation.service.ts`, find where the compiled HTML is produced (search for `renderSections`). After the HTML exists and before it is persisted, add:

```typescript
    this.validator.warnOnAnchorProblems(
      sectionsHtml,
      sections.filter(s => s.type !== 'text_block').map(s => s.title || this.utils.getSectionTitle(s.type)),
    );
```

Match the local variable names actually in that method. If `ReportGenerationValidatorService` is not already injected there, add it to the constructor.

Run: `cd apps/api && npx jest src/modules/reports`
Expected: PASS — all suites.

- [ ] **Step 6: Mutation-check the dead-anchor detection**

Temporarily change the `href` regex to also accept absolute URLs: `/href="[^"]*#([^"]+)"/g`.
Run: `cd apps/api && npx jest src/modules/reports/services/report-generation-validator.anchors.spec.ts`
Expected: FAIL — "ignores non-anchor hrefs". Restore, re-run: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/reports/services/report-generation-validator.service.ts apps/api/src/modules/reports/services/report-generation-validator.anchors.spec.ts apps/api/src/modules/reports/services/report-generation.service.ts
git commit -m "fix: warn on dead anchors and duplicate section titles

Neither blocks generation. The duplicate warning is the load-bearing one: a
duplicate title makes a link's target depend on document order, and that
mis-navigation is undetectable afterwards because the anchor still resolves."
```

---

### Task 6: The "Link to section" toolbar button

**Files:**
- Modify: `apps/web/components/reports/report-generation/MarkdownField.tsx`
- Create: `apps/web/__tests__/components/reports/MarkdownFieldSectionLink.test.tsx`

**Interfaces:**
- Consumes: `slugifySectionTitle`, `assignSectionAnchors` from Task 1 — imported from the shared **source** path used by `apps/web/__tests__/lib/report-section-types.test.ts`, since apps/web has no `@perfana/shared` dependency. Copy that test's import style exactly.
- Produces: `MarkdownField` accepts `linkTargets?: { title: string; anchor: string }[]`. When non-empty, a "Link to section" toolbar button appears.

- [ ] **Step 1: Write the failing test**

Create `apps/web/__tests__/components/reports/MarkdownFieldSectionLink.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { MarkdownField } from '@/components/reports/report-generation/MarkdownField';

const targets = [
  { title: 'SLO Results', anchor: 'slo-results' },
  { title: 'Trends', anchor: 'trends' },
];

function setup(props: Partial<React.ComponentProps<typeof MarkdownField>> = {}) {
  const onChange = jest.fn();
  render(
    <MarkdownField
      label="Text"
      value=""
      onChange={onChange}
      markdown
      linkTargets={targets}
      {...props}
    />,
  );
  return { onChange };
}

describe('MarkdownField section links', () => {
  it('offers the button when there are targets', () => {
    setup();
    expect(screen.getByLabelText('Link to section')).toBeInTheDocument();
  });

  it('hides the button when there are none', () => {
    setup({ linkTargets: [] });
    expect(screen.queryByLabelText('Link to section')).not.toBeInTheDocument();
  });

  it('inserts markdown pointing at the chosen section', () => {
    const { onChange } = setup();

    fireEvent.click(screen.getByLabelText('Link to section'));
    fireEvent.click(screen.getByText('SLO Results'));

    expect(onChange).toHaveBeenCalledWith('[SLO Results](#slo-results)');
  });

  it('marks sections that share a title, so the author can tell them apart', () => {
    setup({
      linkTargets: [
        { title: 'Graphs', anchor: 'graphs' },
        { title: 'Graphs', anchor: 'graphs-2' },
      ],
    });

    fireEvent.click(screen.getByLabelText('Link to section'));
    expect(screen.getByText(/duplicate title/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web && npx jest __tests__/components/reports/MarkdownFieldSectionLink.test.tsx`
Expected: FAIL — no element labelled "Link to section".

- [ ] **Step 3: Implement**

In `MarkdownField.tsx`:

1. Add to `MarkdownFieldProps`:

```typescript
  /**
   * Sections this text can link to, already slugged by the caller. Empty or
   * absent hides the button — a report with no target sections has nothing to
   * link to, and a disabled button would just raise the question.
   */
  linkTargets?: { title: string; anchor: string }[];
```

2. Import `AccountTreeIcon from '@mui/icons-material/AccountTree'` and `Menu, MenuItem, Typography` from `@mui/material` (add to the existing MUI import if present).

3. Add menu state beside the existing state hooks:

```typescript
  const [sectionMenuAnchor, setSectionMenuAnchor] = useState<null | HTMLElement>(null);
```

4. Add the insert handler beside `applyTool`:

```typescript
  const insertSectionLink = (target: { title: string; anchor: string }) => {
    setSectionMenuAnchor(null);
    const el = inputRef.current;
    const markdown = `[${target.title}](#${target.anchor})`;

    if (!el) {
      onChange(value + markdown);
      return;
    }

    const before = value.slice(0, el.selectionStart);
    const after = value.slice(el.selectionEnd);
    onChange(before + markdown + after);
  };
```

5. Render the button after the `TOOLS.map(...)` block, guarded on targets:

```tsx
          {(linkTargets?.length ?? 0) > 0 && (
            <Tooltip title="Link to section" arrow>
              <IconButton
                size="small"
                aria-label="Link to section"
                onClick={(e) => setSectionMenuAnchor(e.currentTarget)}
                onMouseDown={(e) => e.preventDefault()}
              >
                <AccountTreeIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Menu
            anchorEl={sectionMenuAnchor}
            open={Boolean(sectionMenuAnchor)}
            onClose={() => setSectionMenuAnchor(null)}
          >
            {duplicateTargetTitles.length > 0 && (
              <Typography variant="caption" sx={{ display: 'block', px: 2, py: 1, color: 'warning.main' }}>
                Sections with a duplicate title: rename them, or a link may open the wrong one.
              </Typography>
            )}
            {(linkTargets ?? []).map((target) => (
              <MenuItem key={target.anchor} onClick={() => insertSectionLink(target)}>
                {target.title}
                {duplicateTargetTitles.includes(target.title.trim().toLowerCase()) && (
                  <Typography variant="caption" sx={{ ml: 1, color: 'warning.main' }}>
                    (#{target.anchor})
                  </Typography>
                )}
              </MenuItem>
            ))}
          </Menu>
```

6. Compute the duplicate set above the return:

```typescript
  const duplicateTargetTitles = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of linkTargets ?? []) {
      const key = t.title.trim().toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].filter(([, n]) => n > 1).map(([key]) => key);
  }, [linkTargets]);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx jest __tests__/components/reports/MarkdownFieldSectionLink.test.tsx`
Expected: PASS — 4 tests.

- [ ] **Step 5: Confirm the existing MarkdownField tests still pass**

Run: `cd apps/web && npx jest apps/web/components/reports/report-generation/MarkdownField.spec.tsx --rootDir .`
If that path form fails, run `cd apps/web && npx jest MarkdownField`.
Expected: PASS. The new button is additive and hidden without `linkTargets`.

- [ ] **Step 6: Mutation-check the insert**

Temporarily change `insertSectionLink` to emit `[${target.title}](${target.anchor})` (no `#`).
Run: `cd apps/web && npx jest __tests__/components/reports/MarkdownFieldSectionLink.test.tsx`
Expected: FAIL — "inserts markdown pointing at the chosen section". Restore, re-run: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/reports/report-generation/MarkdownField.tsx apps/web/__tests__/components/reports/MarkdownFieldSectionLink.test.tsx
git commit -m "feat: link-to-section button in the report markdown toolbar"
```

---

### Task 7: Feed the builder's sections to the toolbar

**Files:**
- Modify: `apps/web/components/reports/report-generation/SectionConfigs.tsx:107` and `:261`
- Modify: `apps/web/components/reports/report-generation/SectionPreviewModal.tsx:173`

**Interfaces:**
- Consumes: `MarkdownField.linkTargets` from Task 6; `assignSectionAnchors` from Task 1.
- Produces: nothing downstream.

- [ ] **Step 1: Find how each call site already receives the section list**

Read `SectionConfigs.tsx` around lines 100-120 and 255-270, and `SectionPreviewModal.tsx` around line 173. Determine whether the full ordered section array is already in scope at each call site. If it is not, thread it down as a new prop named `allSections` from whichever parent owns the builder state — do not reach for context or a store.

- [ ] **Step 2: Write the failing test**

Add to `apps/web/__tests__/components/reports/MarkdownFieldSectionLink.test.tsx`:

```tsx
import { assignSectionAnchors } from '../../../../packages/shared/src/utils/section-anchors';

describe('builder link targets', () => {
  it('excludes text blocks and matches what the API will emit', () => {
    const sections = [
      { type: 'index', order: 0, title: '' },
      { type: 'slo', order: 1, title: 'SLO Results' },
      { type: 'text_block', order: 2, title: '' },
      { type: 'graphs', order: 3, title: 'Graphs' },
    ];

    const targets = sections
      .filter((s) => s.type !== 'text_block')
      .sort((a, b) => a.order - b.order);

    const anchors = assignSectionAnchors(
      targets,
      (s) => s.title || s.type,
      (s) => s.type,
    );

    expect([...anchors.values()]).toEqual(['index', 'slo-results', 'graphs']);
  });
});
```

- [ ] **Step 3: Run it to verify it passes already**

Run: `cd apps/web && npx jest __tests__/components/reports/MarkdownFieldSectionLink.test.tsx`
Expected: PASS. This test pins the target-list rule so a later change to the filter is caught; it exercises Task 1's helper directly, so it does not need new code.

- [ ] **Step 4: Build the target list and pass it down**

At each of the three `MarkdownField` call sites, compute and pass:

```tsx
linkTargets={useMemo(() => {
  const targets = allSections
    .filter((s) => s.type !== 'text_block')
    .sort((a, b) => a.order - b.order);
  const anchors = assignSectionAnchors(
    targets,
    (s) => s.title || getSectionTypeLabel(s.type),
    (s) => s.type,
  );
  return targets.map((s) => ({
    title: s.title || getSectionTypeLabel(s.type),
    anchor: anchors.get(s) as string,
  }));
}, [allSections])}
```

`getSectionTypeLabel` is already exported from `apps/web/lib/api/reports.ts`. Import `assignSectionAnchors` the same way the registry sync test imports from the shared source.

If `useMemo` inside JSX trips the rules-of-hooks lint rule, hoist the computation to the top of the component and pass the resulting variable.

- [ ] **Step 5: Verify the whole web suite**

Run: `cd apps/web && npx jest`
Expected: PASS — all suites.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/reports/report-generation/SectionConfigs.tsx apps/web/components/reports/report-generation/SectionPreviewModal.tsx apps/web/__tests__/components/reports/MarkdownFieldSectionLink.test.tsx
git commit -m "feat: offer the report's own sections as link targets in the builder"
```

---

### Task 8: Make the index addable in the builder

**Files:**
- Modify: `apps/web/components/reports/report-generation/SectionConfigs.tsx`

**Interfaces:**
- Consumes: `'index'` type from Task 2.
- Produces: nothing downstream.

- [ ] **Step 1: Find the section-type list the builder renders**

Search `apps/web/components/reports/report-generation/` for where `REPORT_SECTION_TYPES` or a section-picker list is consumed. Read how a config-less section type (the closest existing analogue) is handled.

- [ ] **Step 2: Add the index entry**

Add `index` alongside the others. It takes **no configuration** — if the builder renders a config panel per type, give it an empty one or reuse whatever a config-less type already does. Do not invent settings.

- [ ] **Step 3: Verify**

Run: `cd apps/web && npx jest`
Expected: PASS — all suites, including the registry sync test.

- [ ] **Step 4: Manual check**

Start the app (`npm run dev`), open a report template, add an Index section plus two other sections, and generate. Confirm: the index lists both, clicking an entry jumps to the section, and a text block appears in neither the index nor the link picker.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/reports/report-generation/SectionConfigs.tsx
git commit -m "feat: add the index section in the report builder"
```

---

### Task 9: Documentation and full verification

**Files:**
- Modify: `docs/REPORT_SECTION_CONFIGURATIONS.md`

- [ ] **Step 1: Document the index section and anchors**

Read `docs/REPORT_SECTION_CONFIGURATIONS.md` and follow its existing per-section format. Add an `index` entry noting it takes no configuration, and a short subsection explaining that any section can be linked from prose as `[Title](#title-slug)`, that text blocks cannot be linked to, and that two sections sharing a title makes links ambiguous.

- [ ] **Step 2: Full gate**

```bash
npm run preflight
npm run test
```

Expected: preflight 13/13; all test tasks pass. The API RLS suites will fail only if run directly — they need `perfana_test`, which does not exist here and is unrelated to this work.

- [ ] **Step 3: Commit**

```bash
git add docs/REPORT_SECTION_CONFIGURATIONS.md
git commit -m "docs: index section and report anchor links"
```

---

## Self-Review Notes

**Spec coverage.** Design section 1 (anchor contract) → Tasks 1 and 3. Section 2 (index section) → Tasks 2, 4, 8. Section 3 (authoring) → Tasks 6 and 7. Section 4 (warnings) → Task 5 plus the picker warning in Task 6. Section 5 (testing) → tests live in the task that creates the behaviour. No spec requirement is unimplemented.

**Known soft spots, flagged rather than papered over:**

- **Task 3, Step 2** depends on the NestJS testing-module wiring for a service with many injected renderers. The step says what to do if `useMocker` cannot construct it, and forbids reshaping the service to suit the test.
- **Task 5, Step 5** and **Task 7, Step 1** require reading the surrounding code to find the right variable names and prop threading; both say so explicitly rather than inventing names that may not exist.
- **Task 8** is deliberately thin: the builder's section-picker structure was not read while writing this plan, so the task directs the implementer to read it first rather than guessing at a shape.
