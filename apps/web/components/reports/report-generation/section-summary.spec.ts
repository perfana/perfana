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

  it('falls back to the comment for a header without text, then null', () => {
    expect(sectionSummary(section({ type: 'header', config: {}, comment: 'intro block' }))).toBe('intro block');
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

  it('summarizes baseline-run comparisons with dashboard, panel count and comment', () => {
    expect(
      sectionSummary(
        section({
          type: 'comparisons',
          config: {
            comparisonMode: 'baseline_run',
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
          config: { comparisonMode: 'baseline_run', dashboardLabel: 'Perf', panels: [{ id: 1, title: 'a' }] },
          comment: 'vs release 42',
        }),
      ),
    ).toBe('Baseline run · Perf · 1 panel · vs release 42');
  });

  it('handles half-configured baseline-run comparisons and garbage panels', () => {
    expect(sectionSummary(section({ type: 'comparisons', config: { comparisonMode: 'baseline_run' } }))).toBe(
      'Baseline run',
    );
    expect(
      sectionSummary(section({ type: 'comparisons', config: { comparisonMode: 'baseline_run', panels: 'oops' } })),
    ).toBe('Baseline run');
  });

  it('falls back to comment for control-group comparisons', () => {
    expect(
      sectionSummary(section({ type: 'comparisons', config: { comparisonMode: 'control_group' }, comment: 'vs 8 CPUs' })),
    ).toBe('vs 8 CPUs');
  });

  it('falls back to the section comment for config-less sections', () => {
    expect(sectionSummary(section({ type: 'apdex', comment: '  peak load   run ' }))).toBe('peak load run');
    expect(sectionSummary(section({ type: 'apdex' }))).toBeNull();
  });

  it('consults config.comment when section.comment is empty or missing', () => {
    expect(sectionSummary(section({ type: 'apdex', comment: '', config: { comment: 'from config' } }))).toBe(
      'from config',
    );
    expect(sectionSummary(section({ type: 'apdex', config: { comment: 'from config' } }))).toBe('from config');
  });
});
