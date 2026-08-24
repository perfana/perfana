/**
 * The web half of the three-site anchor contract.
 *
 * The compiler stamps `<a id="…">`, the index renderer emits `href="#…"`, and
 * the builder's link picker inserts `[Title](#…)`. The first two are checked
 * together in
 * apps/api/src/modules/reports/services/report-html-compiler.anchor-contract.spec.ts.
 * apps/web cannot import API code, so this file pins the SAME literal slugs from
 * the builder side. If the API spec's expectations and this file's ever disagree,
 * the picker is offering links the report does not answer to.
 *
 * All of these sections are UNTITLED on purpose. Since `handleAddSection` stopped
 * stamping the palette label onto new sections, the default-title path through
 * SECTION_RENDER_TITLES is the ordinary case for a freshly built report, and it
 * was the one path `buildLinkTargets`' existing tests never exercised — every one
 * of them passed an explicit `title`.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { MarkdownField } from '@/components/reports/report-generation/MarkdownField';
import { buildLinkTargets } from '@/components/reports/report-generation/SectionConfigs';
import type { ReportSectionConfig } from '@/lib/api/reports';

describe('builder link anchors match the anchors the API stamps', () => {
  it('derives default titles and slugs for untitled sections', () => {
    // Same section list and same expected slugs as the API contract spec.
    const sections: ReportSectionConfig[] = [
      { type: 'header', order: 0 },
      { type: 'index', order: 1 },
      { type: 'slo', order: 2 },
      { type: 'graphs', order: 3 },
      { type: 'error_analysis', order: 4 },
    ];

    expect(buildLinkTargets(sections)).toEqual([
      { title: 'SLO Results', anchor: 'section-slo-results' },
      { title: 'Custom Graphs', anchor: 'section-custom-graphs' },
      { title: 'Error Analysis', anchor: 'section-error-analysis' },
    ]);
  });

  it('numbers two untitled sections of the same type the way the compiler does', () => {
    const sections: ReportSectionConfig[] = [
      { type: 'index', order: 0 },
      { type: 'graphs', order: 1 },
      { type: 'graphs', order: 2 },
    ];

    expect(buildLinkTargets(sections).map((t) => t.anchor)).toEqual([
      'section-custom-graphs',
      'section-custom-graphs-2',
    ]);
  });

  it('an explicit title overrides the default on both sides', () => {
    const sections: ReportSectionConfig[] = [
      { type: 'graphs', order: 0, title: 'Front-end Graphs' },
      { type: 'graphs', order: 1 },
    ];

    expect(buildLinkTargets(sections)).toEqual([
      { title: 'Front-end Graphs', anchor: 'section-front-end-graphs' },
      { title: 'Custom Graphs', anchor: 'section-custom-graphs' },
    ]);
  });

  it('inserts markdown whose fragment is the anchor verbatim', () => {
    // Closes the loop: picker markdown -> `#<anchor>` -> the id the compiler stamped.
    const onChange = jest.fn();
    const linkTargets = buildLinkTargets([
      { type: 'slo', order: 0 },
      { type: 'graphs', order: 1 },
    ]);

    render(
      <MarkdownField label="Text" value="" onChange={onChange} markdown linkTargets={linkTargets} />,
    );

    fireEvent.click(screen.getByLabelText('Link to section'));
    fireEvent.click(screen.getByText('Custom Graphs'));

    expect(onChange).toHaveBeenCalledWith('[Custom Graphs](#section-custom-graphs)');
  });
});
