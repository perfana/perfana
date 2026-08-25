/**
 * Anchor warnings the BUILDER shows the author.
 *
 * The API detects the same two hazards at generation time, but can only write
 * them to a server log the author cannot read — so a report with two sections
 * pointing at one anchor looks correct in the builder and silently misroutes
 * links. These tests pin the author-facing half: which section objects get a
 * warning, and that the warning names the target actually at risk.
 *
 * The slug-collision cases deliberately use titles that are DIFFERENT STRINGS
 * but the SAME SLUG. Comparing titles rather than slugs is the specific bug the
 * shared `findAnchorProblems` exists to avoid, and a test using two identical
 * titles would pass against that broken implementation too.
 */
import { findSectionAnchorWarnings } from '@/components/reports/report-generation/SectionConfigs';
import type { ReportSectionConfig } from '@/lib/api/reports';

describe('findSectionAnchorWarnings', () => {
  it('returns no warnings when every section slugs uniquely', () => {
    const sections: ReportSectionConfig[] = [
      { type: 'slo', order: 0 },
      { type: 'graphs', order: 1 },
      { type: 'error_analysis', order: 2 },
    ];

    expect(findSectionAnchorWarnings(sections).size).toBe(0);
  });

  it('warns BOTH sections when two different titles produce the same slug', () => {
    const first: ReportSectionConfig = { type: 'graphs', order: 0, title: 'Graphs' };
    const second: ReportSectionConfig = { type: 'graphs', order: 1, title: 'graphs!' };

    const warnings = findSectionAnchorWarnings([first, second]);

    // Both, not just the later one — either is equally the thing to rename.
    expect(warnings.size).toBe(2);
    expect(warnings.get(first)).toContain('#section-graphs');
    expect(warnings.get(second)).toContain('#section-graphs');
    expect(warnings.get(first)).toMatch(/distinct title/);
  });

  it('leaves a third, uniquely-titled section unwarned', () => {
    const collidingA: ReportSectionConfig = { type: 'graphs', order: 0, title: 'Latency' };
    const collidingB: ReportSectionConfig = { type: 'slo', order: 1, title: 'latency' };
    const clean: ReportSectionConfig = { type: 'apdex', order: 2, title: 'Apdex' };

    const warnings = findSectionAnchorWarnings([collidingA, collidingB, clean]);

    expect(warnings.has(collidingA)).toBe(true);
    expect(warnings.has(collidingB)).toBe(true);
    expect(warnings.has(clean)).toBe(false);
  });

  it('warns a section whose title produces no slug at all, with different advice', () => {
    const titleless: ReportSectionConfig = { type: 'slo', order: 0, title: '数据结果' };

    const warning = findSectionAnchorWarnings([titleless]).get(titleless);

    expect(warning).toBeDefined();
    // "Give it a distinct title" is actively wrong here — any other title in the
    // same script collapses to the identical fallback. The advice must differ.
    expect(warning).not.toMatch(/distinct title/);
    expect(warning).toMatch(/Latin letter or digit/);
  });

  it('does not report a titleless section as a slug collision', () => {
    // Two titleless sections of the same type DO share a base slug, but renaming
    // cannot fix it, so they must surface only as titleless.
    const a: ReportSectionConfig = { type: 'slo', order: 0, title: '数据' };
    const b: ReportSectionConfig = { type: 'slo', order: 1, title: '結果' };

    const warnings = findSectionAnchorWarnings([a, b]);

    expect(warnings.get(a)).toMatch(/Latin letter or digit/);
    expect(warnings.get(b)).toMatch(/Latin letter or digit/);
    expect(warnings.get(a)).not.toMatch(/same link target/);
  });

  it('ignores non-linkable sections, which never get an anchor to collide', () => {
    // A text block titled the same as a real section is not a hazard: text
    // blocks render as prose and are never link targets.
    const textBlock: ReportSectionConfig = { type: 'text_block', order: 0, title: 'Summary' };
    const slo: ReportSectionConfig = { type: 'slo', order: 1, title: 'Summary' };

    const warnings = findSectionAnchorWarnings([textBlock, slo]);

    expect(warnings.size).toBe(0);
  });

  it('detects a collision between two default (untitled) sections of the same type', () => {
    const a: ReportSectionConfig = { type: 'graphs', order: 0 };
    const b: ReportSectionConfig = { type: 'graphs', order: 1 };

    const warnings = findSectionAnchorWarnings([a, b]);

    // Both fall back to "Custom Graphs" via SECTION_RENDER_TITLES, which is a
    // real slug — so this is the renameable kind.
    expect(warnings.get(a)).toContain('#section-custom-graphs');
    expect(warnings.get(b)).toContain('#section-custom-graphs');
  });

  it('handles an empty list and a missing argument', () => {
    expect(findSectionAnchorWarnings([]).size).toBe(0);
    expect(findSectionAnchorWarnings().size).toBe(0);
  });
});
