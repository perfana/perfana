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
    ).toBe('Scenarios: CheckoutFlow');
  });

  it('lists every selected scenario for response times', () => {
    expect(
      sectionSummary(section({
        type: 'transaction_response_times',
        config: { scenarios: ['CheckoutFlow', 'BrowseAndSearch'], includeChildRequests: true },
      })),
    ).toBe('Scenarios: CheckoutFlow, BrowseAndSearch · with child requests');
  });

  it('says all scenarios when response times selects none', () => {
    expect(
      sectionSummary(section({ type: 'transaction_response_times', config: {} })),
    ).toBe('All scenarios');
    // "all" was the legacy do-not-filter placeholder, not a scenario name
    expect(
      sectionSummary(section({ type: 'transaction_response_times', config: { scenario: 'all' } })),
    ).toBe('All scenarios');
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

  it('summarizes error analysis by scenario selection', () => {
    expect(
      sectionSummary(section({ type: 'error_analysis', config: {} })),
    ).toBe('All scenarios');
    expect(
      sectionSummary(section({
        type: 'error_analysis',
        config: { scenarios: ['Checkout'], includeChart: false },
      })),
    ).toBe('Scenarios: Checkout · no chart');
  });

  it('summarizes a comments section by its card filter, ignoring unknown keys', () => {
    expect(sectionSummary(section({ type: 'comments', config: {} }))).toBe('All cards');
    expect(sectionSummary(section({ type: 'comments', config: { cards: ['graphs', 'slo', 'bogus'] } }))).toBe(
      'Graphs, Service level objectives',
    );
    expect(sectionSummary(section({ type: 'comments', config: { cards: ['graphs', 'slo', 'trends'] } }))).toBe('3 cards');
  });

  // Added by the /ship test coverage audit.
  // Value: protects=the collapsed Loki Logs header says which tables the section draws and which
  // applications it is narrowed to; fails_when=a default flips (applications/patterns are on unless
  // false, samples/panels off unless true), onlyNewPatterns stops renaming the patterns part, or the
  // >2 applications count collapses wrongly; why_new=no loki_logs case in this spec; seam=none;
  // no_claim=what the API renderer draws for the same config.
  it('summarizes a loki_logs section by its tables and application filter', () => {
    expect(sectionSummary(section({ type: 'loki_logs', config: {} }))).toBe('error rate, applications, patterns');
    expect(
      sectionSummary(section({
        type: 'loki_logs',
        config: { includeApplications: false, onlyNewPatterns: true, includeSamples: true, includePanels: true, services: ['checkout', 'cart'] },
      })),
    ).toBe('error rate, new patterns, error lines, panels · checkout, cart');
    expect(
      sectionSummary(section({ type: 'loki_logs', config: { includePatterns: false, onlyNewPatterns: true, services: ['a', 'b', 'c'] } })),
    ).toBe('error rate, applications · 3 apps');
  });

  it('summarizes a comments section in the stories layout as such, whatever its card filter', () => {
    expect(sectionSummary(section({ type: 'comments', config: { layout: 'stories', cards: ['graphs'] } }))).toBe('Investigations');
    expect(sectionSummary(section({ type: 'comments', config: { layout: 'by-card' } }))).toBe('All cards');
  });
});
