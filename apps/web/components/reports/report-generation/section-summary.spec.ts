import { sectionSummary, SUMMARY_MAX_LENGTH } from './section-summary';
import type { ReportSectionConfig } from '@/lib/api/reports';

const section = (partial: Partial<ReportSectionConfig>): ReportSectionConfig =>
  ({ type: 'apdex', order: 0, ...partial }) as ReportSectionConfig;

describe('sectionSummary', () => {
  it('summarizes header text and level', () => {
    expect(sectionSummary(section({ type: 'header', config: { text: 'Results', level: 2 } }))).toBe('H2 — Results');
  });

  it('defaults header level to 1 and ignores invalid levels from hand-edited templates', () => {
    expect(sectionSummary(section({ type: 'header', config: { text: 'Intro' } }))).toBe('H1 — Intro');
    expect(sectionSummary(section({ type: 'header', config: { text: 'Intro', level: 99 } }))).toBe('H1 — Intro');
    expect(sectionSummary(section({ type: 'header', config: { text: 'Intro', level: '<script>' } }))).toBe(
      'H1 — Intro',
    );
  });

  it('falls back to the text for a header without a caption, then null', () => {
    expect(sectionSummary(section({ type: 'header', config: {}, text: 'intro block' }))).toBe('intro block');
    expect(sectionSummary(section({ type: 'header', config: {} }))).toBeNull();
  });

  it('keeps max-length content verbatim and truncates one char over', () => {
    const exact = 'x'.repeat(SUMMARY_MAX_LENGTH);
    expect(sectionSummary(section({ type: 'text_block', config: { content: exact } }))).toBe(exact);
    expect(sectionSummary(section({ type: 'text_block', config: { content: `${exact}x` } }))).toBe(`${exact}…`);
  });

  it('does not split surrogate pairs when truncating', () => {
    const content = `${'x'.repeat(SUMMARY_MAX_LENGTH - 1)}💥💥`;
    expect(sectionSummary(section({ type: 'text_block', config: { content } }))).toBe(
      `${'x'.repeat(SUMMARY_MAX_LENGTH - 1)}💥…`,
    );
  });

  it('returns null for non-string content', () => {
    expect(sectionSummary(section({ type: 'text_block', config: { content: 42 } }))).toBeNull();
  });

  it('shows scenario for response times', () => {
    expect(
      sectionSummary(section({ type: 'transaction_response_times', config: { scenario: 'CheckoutFlow' } })),
    ).toBe('Scenario: CheckoutFlow');
  });

  it('summarizes baseline-run comparisons with dashboard, panel count and text', () => {
    expect(
      sectionSummary(
        section({
          type: 'comparisons',
          config: {
            dashboardLabel: 'Perf Dashboard',
            panels: [{ id: 1, title: 'a' }, { id: 2, title: 'b' }],
          },
        }),
      ),
    ).toBe('Baseline run · Perf Dashboard · 2 panels');
    expect(
      sectionSummary(
        section({
          type: 'comparisons',
          config: { dashboardLabel: 'Perf', panels: [{ id: 1, title: 'a' }] },
          text: 'vs release 42',
        }),
      ),
    ).toBe('Baseline run · Perf · 1 panel · vs release 42');
  });

  it('handles half-configured baseline-run comparisons and garbage panels', () => {
    expect(sectionSummary(section({ type: 'comparisons', config: {} }))).toBe(
      'Baseline run',
    );
    expect(
      sectionSummary(section({ type: 'comparisons', config: { panels: 'oops' } })),
    ).toBe('Baseline run');
  });

  it('summarises a comparisons section saved before the mode switch was removed', () => {
    expect(
      sectionSummary(section({ type: 'comparisons', config: { comparisonMode: 'control_group' }, text: 'vs 8 CPUs' })),
    ).toBe('Baseline run · vs 8 CPUs');
  });

  it('falls back to the section text for config-less sections', () => {
    expect(sectionSummary(section({ type: 'apdex', text: '  peak load   run ' }))).toBe('peak load run');
    expect(sectionSummary(section({ type: 'apdex' }))).toBeNull();
  });

  it('falls back to a legacy comment when text is absent', () => {
    expect(sectionSummary(section({ type: 'apdex', comment: 'legacy note' }))).toBe('legacy note');
  });

  it('prefers text over a legacy comment', () => {
    expect(sectionSummary(section({ type: 'apdex', text: 'new note', comment: 'legacy note' }))).toBe(
      'new note',
    );
  });

  it('summarizes a top_10_lists section by scope and list count', () => {
    expect(
      sectionSummary({ type: 'top_10_lists', order: 0, config: { scope: 'requests', lists: ['slowest', 'impact'] } } as never),
    ).toBe('Requests · 2 lists');
  });

  it('defaults top_10_lists to all four lists when none selected', () => {
    expect(
      sectionSummary({ type: 'top_10_lists', order: 0, config: { scope: 'urls' } } as never),
    ).toBe('URLs · 4 lists');
  });
});
