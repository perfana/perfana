import { Test, TestingModule } from '@nestjs/testing';
import { ReportHtmlCompilerService } from './report-html-compiler.service';
import { ReportUtilsService } from './report-utils.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ReportSectionConfig, TestRun, TestRunConfiguration } from '@perfana/shared';
import { HeaderRenderer } from '../renderers/header-renderer';
import { TextBlockRenderer } from '../renderers/text-block-renderer';
import { SloRenderer } from '../renderers/slo-renderer';
import { ApdexRenderer } from '../renderers/apdex-renderer';
import { TransactionResponseTimesRenderer } from '../renderers/transaction-response-times-renderer';
import { RegressionsRenderer } from '../renderers/regressions-renderer';
import { AwrRenderer } from '../renderers/awr-renderer';
import { TrendsRenderer } from '../renderers/trends-renderer';
import { ComparisonsRenderer } from '../renderers/comparisons-renderer';
import { GraphsRenderer } from '../renderers/graphs-renderer';
import { Top10ListsRenderer } from '../renderers/top-10-lists-renderer';
import { ErrorAnalysisRenderer } from '../renderers/error-analysis-renderer';
import { PlaceholderRenderer } from '../renderers/placeholder-renderer';
import { IndexRenderer } from '../renderers/index-renderer';

// The SLO renderer is a spy so the test can inspect the section object the
// compiler handed it — substitution happens before any renderer runs, which is
// the whole point of doing it in one place. TextBlockRenderer is the real one,
// so the text-block body path is asserted end to end.
const renderSlo = jest.fn().mockResolvedValue('<section class="slo"></section>');

// The two lookup queries the compiler makes for the variables it cannot read off
// the test run row: configuration keys, and the previous run's id.
const findConfigs = jest.fn().mockResolvedValue([]);
const findPreviousRun = jest.fn().mockResolvedValue(null);

const testRun = {
  id: 'uuid-42',
  systemUnderTestId: 'sut-1',
  testRunId: 'run-42',
  testEnvironment: 'acc',
  workload: 'peak',
  startTime: new Date('2026-08-25T14:03:00.000Z'),
  systemUnderTest: { name: 'Checkout' },
} as unknown as TestRun;

describe('ReportHtmlCompilerService variable substitution', () => {
  let service: ReportHtmlCompilerService;
  let moduleRef: TestingModule;

  const section = (over: Partial<ReportSectionConfig>): ReportSectionConfig =>
    ({ type: 'slo', order: 0, ...over }) as ReportSectionConfig;

  beforeEach(async () => {
    renderSlo.mockClear();
    findConfigs.mockClear().mockResolvedValue([]);
    findPreviousRun.mockClear().mockResolvedValue(null);
    moduleRef = await Test.createTestingModule({
      providers: [
        ReportHtmlCompilerService,
        ReportUtilsService,
        TextBlockRenderer,
        { provide: getRepositoryToken(TestRunConfiguration), useValue: { find: findConfigs } },
        { provide: getRepositoryToken(TestRun), useValue: { findOne: findPreviousRun } },
      ],
    })
      .useMocker((token) => {
        if (token === ReportUtilsService || token === TextBlockRenderer) return undefined;
        if (token === SloRenderer) return { renderSloSection: renderSlo };
        if (token === HeaderRenderer) return { renderHeaderSection: jest.fn().mockResolvedValue('') };
        if (token === ApdexRenderer) return { renderApdexSection: jest.fn().mockResolvedValue('') };
        if (token === TransactionResponseTimesRenderer)
          return { renderTransactionResponseTimesSection: jest.fn().mockResolvedValue('') };
        if (token === RegressionsRenderer) return { renderRegressionsSection: jest.fn().mockResolvedValue('') };
        if (token === AwrRenderer) return { renderAwrSection: jest.fn().mockResolvedValue('') };
        if (token === TrendsRenderer) return { renderTrendsSection: jest.fn().mockResolvedValue('') };
        if (token === ComparisonsRenderer) return { renderComparisonsSection: jest.fn().mockResolvedValue('') };
        if (token === GraphsRenderer) return { renderGraphsSection: jest.fn().mockResolvedValue('') };
        if (token === Top10ListsRenderer) return { renderTop10ListsSection: jest.fn().mockResolvedValue('') };
        if (token === ErrorAnalysisRenderer) return { renderErrorAnalysisSection: jest.fn().mockResolvedValue('') };
        if (token === IndexRenderer) return { renderIndexSection: jest.fn().mockReturnValue('') };
        if (token === PlaceholderRenderer)
          return {
            renderPlaceholderSection: jest.fn().mockReturnValue(''),
            renderErrorSection: jest.fn().mockReturnValue('<section class="error"></section>'),
          };
        return { render: jest.fn() };
      })
      .compile();

    service = moduleRef.get(ReportHtmlCompilerService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('resolves variables in a text block body', async () => {
    const html = await service.renderSections(
      [section({ type: 'text_block', config: { content: 'Ran {perfana-workload} on {perfana-system-under-test}.' } })],
      testRun,
      null,
    );
    expect(html).toContain('Ran peak on Checkout.');
  });

  it('resolves variables in a section text before the renderer sees it', async () => {
    await service.renderSections(
      [section({ type: 'slo', text: 'Run {perfana-test-run-id}' })],
      testRun,
      null,
    );
    expect(renderSlo.mock.calls[0][0].text).toBe('Run run-42');
  });

  it('leaves a legacy comment-only section without an empty text that would mask it', async () => {
    await service.renderSections(
      [section({ type: 'slo', comment: 'Legacy {perfana-workload}' })],
      testRun,
      null,
    );
    const seen = renderSlo.mock.calls[0][0];
    expect(seen.text).toBeUndefined();
    expect(seen.comment).toBe('Legacy peak');
  });

  it('leaves placeholders visible when there is no test run', async () => {
    const html = await service.renderSections(
      [section({ type: 'text_block', config: { content: 'Ran {perfana-workload}.' } })],
      null,
      null,
    );
    expect(html).toContain('Ran {perfana-workload}.');
  });

  it('resolves a test run configuration key under the author\'s own key name', async () => {
    findConfigs.mockResolvedValue([{ key: 'build.number', value: '4711' }]);
    const html = await service.renderSections(
      [section({ type: 'text_block', config: { content: 'Build {build.number}.' } })],
      testRun,
      null,
    );
    expect(html).toContain('Build 4711.');
  });

  it('never lets a config key shadow a catalogue key', async () => {
    findConfigs.mockResolvedValue([{ key: 'perfana-workload', value: 'HIJACKED' }]);
    const html = await service.renderSections(
      [section({ type: 'text_block', config: { content: '{perfana-workload}' } })],
      testRun,
      null,
    );
    expect(html).toContain('peak');
    expect(html).not.toContain('HIJACKED');
  });

  it('resolves the previous test run id only when it is asked for', async () => {
    await service.renderSections(
      [section({ type: 'text_block', config: { content: 'No variables here.' } })],
      testRun,
      null,
    );
    expect(findPreviousRun).not.toHaveBeenCalled();

    findPreviousRun.mockResolvedValue({ testRunId: 'run-41' });
    const html = await service.renderSections(
      [section({ type: 'text_block', config: { content: 'vs {perfana-previous-test-run-id}' } })],
      testRun,
      null,
    );
    expect(html).toContain('vs run-41');
    // Strictly earlier — a later run must never be named as the previous one.
    expect(findPreviousRun.mock.calls[0][0].where.startTime).toBeDefined();
  });

  it('leaves the previous-run placeholder when the previous run is this one', async () => {
    findPreviousRun.mockResolvedValue({ testRunId: 'run-42' });
    const html = await service.renderSections(
      [section({ type: 'text_block', config: { content: 'vs {perfana-previous-test-run-id}' } })],
      testRun,
      null,
    );
    expect(html).toContain('{perfana-previous-test-run-id}');
  });

  it('renders the section anyway when a lookup fails', async () => {
    findConfigs.mockRejectedValue(new Error('db down'));
    const html = await service.renderSections(
      [section({ type: 'text_block', config: { content: 'Ran {perfana-workload}, build {build.number}.' } })],
      testRun,
      null,
    );
    expect(html).toContain('Ran peak, build {build.number}.');
  });

  it('skips the lookups entirely when no text carries a placeholder', async () => {
    await service.renderSections(
      [section({ type: 'text_block', config: { content: 'Plain prose.' } })],
      testRun,
      null,
    );
    expect(findConfigs).not.toHaveBeenCalled();
  });

  it('does not mutate the caller\'s sections', async () => {
    const sections = [section({ type: 'slo', text: 'Run {perfana-test-run-id}' })];
    await service.renderSections(sections, testRun, null);
    expect(sections[0].text).toBe('Run {perfana-test-run-id}');
  });

  it('never resolves a placeholder in a title — the title is the anchor', async () => {
    // Resolving here would make every anchor, index entry and prose link pointing
    // at this section depend on which test run the report was generated from.
    await service.renderSections(
      [section({ type: 'slo', title: 'SLO for {perfana-workload}' })],
      testRun,
      null,
    );
    expect(renderSlo.mock.calls[0][0].title).toBe('SLO for {perfana-workload}');
  });

  it('renders the section anyway when the previous-run lookup fails', async () => {
    findPreviousRun.mockRejectedValue(new Error('db down'));
    const html = await service.renderSections(
      [section({ type: 'text_block', config: { content: 'vs {perfana-previous-test-run-id}' } })],
      testRun,
      null,
    );
    expect(html).toContain('vs {perfana-previous-test-run-id}');
  });

  it('leaves a secret-shaped config key literal — reports are served unauthenticated', async () => {
    findConfigs.mockResolvedValue([
      { key: 'db.password', value: 'hunter2' },
      { key: 'build.number', value: '4711' },
    ]);
    const html = await service.renderSections(
      [section({ type: 'text_block', config: { content: 'Build {build.number} pw {db.password}' } })],
      testRun,
      null,
    );
    expect(html).toContain('Build 4711');
    expect(html).toContain('{db.password}');
    expect(html).not.toContain('hunter2');
  });

  it('refuses a credential hiding in a benignly-named value', async () => {
    // The key-name filter sees nothing wrong with DATABASE_URL.
    findConfigs.mockResolvedValue([
      { key: 'DATABASE_URL', value: 'postgres://svc:hunter2@db.internal/app' },
      { key: 'build.number', value: '4711' },
    ]);
    const html = await service.renderSections(
      [section({ type: 'text_block', config: { content: 'db {DATABASE_URL} build {build.number}' } })],
      testRun,
      null,
    );
    expect(html).toContain('{DATABASE_URL}');
    expect(html).not.toContain('hunter2');
    expect(html).toContain('4711');
  });

  it('cannot let a config value plant a link in a publicly-served report', async () => {
    findConfigs.mockResolvedValue([
      { key: 'build.note', value: 'Click [here](https://elsewhere.example) to view' },
    ]);
    const html = await service.renderSections(
      [section({ type: 'text_block', config: { content: 'Note: {build.note}' } })],
      testRun,
      null,
    );
    // The text survives; the link does not.
    expect(html).toContain('here');
    expect(html).not.toContain('elsewhere.example"');
    expect(html).not.toMatch(/<a [^>]*href="https:\/\/elsewhere\.example/);
  });

  it('resolves a duplicated config key deterministically', async () => {
    // One key can legally exist several times on a run with different tag sets,
    // so the query orders and the resolver must not depend on row arrival order.
    await service.renderSections(
      [section({ type: 'text_block', config: { content: '{build.number}' } })],
      testRun,
      null,
    );
    expect(findConfigs.mock.calls[0][0].order).toEqual({ key: 'ASC', id: 'ASC' });
  });

  it('fixes anchors from the authored template, not from what the run resolves to', async () => {
    // A body of only placeholders resolves to '' on a run with no tags. If
    // linkability were decided after substitution, this block would drop out of
    // the target set for THAT run only, renumbering every later duplicate slug —
    // so a stored [label](#section-summary-2) link would land somewhere else, and
    // the anchor-problem validator (which reads the authored sections) would
    // disagree with what actually got emitted.
    const html = await service.renderSections(
      [
        section({ type: 'text_block', order: 0, title: 'Summary', config: { content: '{perfana-tags}' } }),
        section({ type: 'slo', order: 1, title: 'Summary' }),
      ],
      { ...testRun, tags: [] } as unknown as TestRun,
      null,
    );

    // Both are targets, and the duplicate keeps its positional suffix.
    expect(html).toContain('id="section-summary"');
    expect(html).toContain('id="section-summary-2"');
  });

  it('keeps a deliberately cleared text as an empty string, not as absent', async () => {
    // getSectionText treats a PRESENT '' as "the author cleared this", which beats
    // a stale legacy `comment`. Writing undefined here would resurrect the comment.
    await service.renderSections(
      [section({ type: 'slo', text: '', comment: 'legacy' })],
      testRun,
      null,
    );
    const seen = renderSlo.mock.calls[0][0];
    expect(seen.text).toBe('');
    expect(seen.comment).toBe('legacy');
  });

  it('does not fire the config lookup for a multi-line brace block', async () => {
    // A pasted JSON or CSS block spans lines, and the placeholder shape stops at a
    // newline — so a fenced snippet costs no query. A single-line `{ "a": 1 }` DOES
    // look like a placeholder and is accepted as such: the shape allows spaces
    // because a test run configuration key is whatever the CI pipeline posted.
    await service.renderSections(
      [section({ type: 'text_block', config: { content: 'json:\n{\n  "a": 1\n}' } })],
      testRun,
      null,
    );
    expect(findConfigs).not.toHaveBeenCalled();
  });

  it('resolves nothing for a brace-shaped token that is not a known key', async () => {
    findConfigs.mockResolvedValue([]);
    const html = await service.renderSections(
      [section({ type: 'text_block', config: { content: 'css: a { color: red }' } })],
      testRun,
      null,
    );
    expect(html).toContain('a { color: red }');
  });
});