// Value: protects=each card's recorded view is checked against that card's shape: a Graphs view
// holds the series a Graphs chart can actually hold (Splunk included), a Trends view carries its
// time range and aggregation, a Compare view its baseline; anything malformed or on the wrong card
// is a 400, and `kind` is stamped from the card; fails_when=SPLUNK leaves DataSource, the series cap
// drifts, a range stops requiring a readable forwards pair, the whitelist stops stripping unknown
// keys, or a card without a view shape starts accepting one; why_new=the request DTO types
// chartContext loosely, so validateChartContext is the only check; seam=none; no_claim=the
// request-level rules (marker/reply/anchor: comments.service.spec.ts, RLS spec).
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCommentDto, MARKER_MAX_SERIES, UpdateCommentDto } from './comment.dto';
import { COMMENT_TAGS } from '@perfana/shared/constants/comment-cards';
import { validateChartContext } from '../comments.service';

const s = (source = 'grafana') => ({ dashboardId: 'd1', dashboardLabel: 'JVM', panelId: 3, panelTitle: 'Heap', metricName: 'used', source });
const graphs = (over: Record<string, unknown> = {}) => ({ series: [s()], xRange: ['2026-11-20T10:00:00Z', '2026-11-20T11:00:00Z'], axisMode: 'split', ...over });
const trends = (over: Record<string, unknown> = {}) => ({ series: [{ ...s(), metricsSourceId: 'm1', isAggregated: false }], timeRange: 'Last week', evaluateType: 'p95', ...over });
const config = (over: Record<string, unknown> = {}) => ({ comparedToTestRunId: 'App-00006', status: 'changed', currentValue: '512m', previousValue: '2g', ...over });
const compare = (over: Record<string, unknown> = {}) => ({ series: [s()], baselineTestRunId: 'App-acc-loadTest-00007', ...over });

describe('validateChartContext', () => {
  it('accepts a Graphs view with grafana, dynatrace, perf-test and splunk series at the cap, stamped with its kind', () => {
    const series = Array.from({ length: MARKER_MAX_SERIES }, (_, i) => s(['grafana', 'dynatrace', 'performance-metrics', 'splunk'][i % 4]));
    expect(validateChartContext('graphs', undefined, graphs({ series }))).toMatchObject({ kind: 'graphs', axisMode: 'split' });
  });

  it('keeps a Trends view’s range and aggregation, and a Compare view’s baseline', () => {
    expect(validateChartContext('trends', undefined, trends({ timeRange: 'Custom', customRange: ['2026-11-01T00:00:00Z', '2026-11-20T00:00:00Z'] })))
      .toMatchObject({ kind: 'trends', timeRange: 'Custom', evaluateType: 'p95', series: [{ metricsSourceId: 'm1' }] });
    expect(validateChartContext('compare', undefined, compare({ baselineTestRunId: 'control-group' })))
      .toMatchObject({ kind: 'compare', baselineTestRunId: 'control-group' });
  });

  it('keeps a Configuration view, values at the cap and null for an absent side', () => {
    expect(validateChartContext('config', undefined, config({ currentValue: 'x'.repeat(2000), previousValue: null })))
      .toMatchObject({ kind: 'config', status: 'changed', comparedToTestRunId: 'App-00006', previousValue: null });
    expect(validateChartContext('config', undefined, config({ status: 'same', comparedToTestRunId: undefined }))).toMatchObject({ kind: 'config', status: 'same' });
  });

  it('keeps a Distributed tracing diff view with its baseline and result, and a Pyroscope one with its baseline', () => {
    expect(validateChartContext('distributed-tracing', undefined, { view: 'diff', baselineTestRunId: 'App-00007', resultSummary: 'x'.repeat(2000) }))
      .toMatchObject({ kind: 'distributed-tracing', view: 'diff', baselineTestRunId: 'App-00007' });
    expect(validateChartContext('pyroscope', undefined, { view: 'diff', baselineTestRunId: 'App-00007' })).toMatchObject({ kind: 'pyroscope', view: 'diff' });
    expect(validateChartContext('pyroscope', undefined, { view: 'diff', baselineWindowSeconds: [0, 600], currentWindowSeconds: [1200, 1800] }))
      .toMatchObject({ baselineWindowSeconds: [0, 600], currentWindowSeconds: [1200, 1800] });
  });

  it('strips keys outside the shape and ignores a kind the body claims', () => {
    const out = validateChartContext('trends', undefined, trends({ kind: 'graphs', extra: 'x' }));
    expect(out.kind).toBe('trends');
    expect(out).not.toHaveProperty('extra');
  });

  it.each([
    ['one series over the cap', 'graphs', graphs({ series: Array.from({ length: MARKER_MAX_SERIES + 1 }, () => s()) })],
    ['no series', 'graphs', graphs({ series: [] })],
    ['an unknown source', 'graphs', graphs({ series: [s('influx')] })],
    ['a one-sided zoom window', 'graphs', graphs({ xRange: ['2026-11-20T10:00:00Z'] })],
    ['a non-ISO zoom bound', 'graphs', graphs({ xRange: ['2026-11-20T10:00:00Z', 'later'] })],
    ['a week-date zoom bound', 'graphs', graphs({ xRange: ['2026-W01', '2026-W02'] })],
    ['a backwards zoom window', 'graphs', graphs({ xRange: ['2026-11-20T11:00:00Z', '2026-11-20T10:00:00Z'] })],
    ['an unknown axis mode', 'graphs', graphs({ axisMode: 'stacked' })],
    ['a Trends view with no aggregation', 'trends', trends({ evaluateType: undefined })],
    ['a backwards custom Trends window', 'trends', trends({ customRange: ['2026-11-20T00:00:00Z', '2026-11-01T00:00:00Z'] })],
    ['a Compare view with no series', 'compare', compare({ series: [] })],
    ['a Configuration value over 2,000 characters', 'config', config({ previousValue: 'x'.repeat(2001) })],
    ['a Configuration view with an unknown status', 'config', config({ status: 'different' })],
    ['a Configuration view with no status', 'config', config({ status: undefined })],
    ['a diff view naming another tab', 'pyroscope', { view: 'single' }],
    ['a one-sided time range', 'pyroscope', { view: 'diff', baselineWindowSeconds: [0] }],
    ['a negative time range', 'distributed-tracing', { view: 'diff', currentWindowSeconds: [-5, 10] }],
    ['a trace result over 2,000 characters', 'distributed-tracing', { view: 'diff', resultSummary: 'x'.repeat(2001) }],
    ['a view on a card that records none', 'slo', graphs()],
    ['a view on Dashboards, which records none', 'dashboards', config()],
  ])('refuses %s', (_label, card, raw) => {
    expect(() => validateChartContext(card, undefined, raw)).toThrow();
  });

  it('refuses a view on a reply', () => {
    expect(() => validateChartContext('graphs', 'parent-id', graphs())).toThrow(/root comment/);
    expect(() => validateChartContext('config', 'parent-id', config())).toThrow(/root comment/);
  });
});

describe('CreateCommentDto', () => {
  it('passes a view through the global pipe untouched, for the service to check per card', async () => {
    const dto = plainToInstance(CreateCommentDto, { card: 'trends', body: 'b', chartContext: trends() });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    expect(dto.chartContext).toMatchObject({ timeRange: 'Last week', evaluateType: 'p95' });
  });

  it('refuses a non-ISO marker time', async () => {
    const dto = plainToInstance(CreateCommentDto, { card: 'graphs', body: 'b', markerTime: '10:37', chartContext: graphs() });
    expect((await validate(dto, { whitelist: true })).length).toBeGreaterThan(0);
  });

  // Value: protects=only the six stored tag keys pass the pipe, and null means untagged;
  // fails_when=the @IsIn list drifts from COMMENT_TAGS or a label ('Root cause') is accepted as a
  // key; why_new=the service trusts the DTO for the vocabulary; seam=none; no_claim=the CHECK.
  it.each([...COMMENT_TAGS, null])('accepts tag %p', async (tag) => {
    const dto = plainToInstance(CreateCommentDto, { card: 'slo', body: 'b', tag });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
  });

  it.each(['Root cause', 'rootcause', 'cause', 3])('refuses tag %p', async (tag) => {
    const dto = plainToInstance(CreateCommentDto, { card: 'slo', body: 'b', tag });
    expect((await validate(dto, { whitelist: true })).map((e) => e.property)).toEqual(['tag']);
  });
});

describe('UpdateCommentDto', () => {
  it.each([
    ['a body', { body: 'fixed' }],
    ['a tag', { tag: 'root-cause' }],
    ['a cleared tag', { tag: null }],
    ['both', { body: 'fixed', tag: 'action' }],
  ])('accepts %s', async (_label, raw) => {
    expect(await validate(plainToInstance(UpdateCommentDto, raw), { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
  });

  it.each([
    ['a null body', { body: null }, 'body'],
    ['an empty body', { body: '' }, 'body'],
    ['an unknown tag', { tag: 'Root cause' }, 'tag'],
  ])('refuses %s', async (_label, raw, property) => {
    expect((await validate(plainToInstance(UpdateCommentDto, raw), { whitelist: true })).map((e) => e.property)).toEqual([property]);
  });
});
