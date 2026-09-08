import { getUrlPanel, isUrlPanel, presetAggregateSpec } from './url-perf-panels';
import { unitLabel } from '../renderers/unit-format';

/**
 * The URL panels are the one comparison source whose unit is hard-coded rather than read
 * from ds_metric_statistics — the numbers come from the sampler rollup, which stores no
 * unit column. A wrong entry here is silent: the report prints "42 ms" over a throughput
 * and nothing errors.
 */
describe('getUrlPanel units', () => {
  it('gives each URL panel the unit its column is actually measured in', () => {
    expect(getUrlPanel(210)).toMatchObject({ metric: 'response_time', unit: 'ms' });
    expect(getUrlPanel(214)).toMatchObject({ metric: 'error_percentage', unit: 'percent' });
    expect(getUrlPanel(215)).toMatchObject({ metric: 'throughput', unit: 'reqps' });
    expect(getUrlPanel(217)).toMatchObject({ metric: 'latency', unit: 'ms' });
    expect(getUrlPanel(218)).toMatchObject({ metric: 'connect_time', unit: 'ms' });
  });

  it('stores the error rate as `percent`, not `percentunit`', () => {
    // url_patterns.error_percentage is already 0-100. `percentunit` would multiply it by
    // 100 on the way into the report and turn a 2% error rate into 200%.
    const unit = getUrlPanel(214)!.unit;
    expect(unit).toBe('percent');
    expect(unitLabel(unit)).toBe('%');
  });

  it('resolves every panel unit to a real label the report can print', () => {
    // unitLabel returns '' for a code the table does not know, so a typo here (e.g. 'reqs'
    // for 'reqps') shows up as a missing unit chip rather than as a plausible-looking one.
    const rendered = [210, 214, 215, 217, 218].map((id) => unitLabel(getUrlPanel(id)!.unit));
    expect(rendered).toEqual(['ms', '%', 'req/s', 'ms', 'ms']);
  });

  it('has no unit for a panel id it does not own', () => {
    expect(getUrlPanel(216)).toBeNull();
    expect(getUrlPanel(201)).toBeNull();
    expect(isUrlPanel(216)).toBe(false);
    expect(isUrlPanel(undefined)).toBe(false);
  });
});

describe('presetAggregateSpec', () => {
  const series = (over: Record<string, unknown> = {}) => ({
    metricName: 'All aggregated — Transaction RT P95',
    dashboardLabel: 'Performance test metrics BrowseAndSearch',
    panelId: 103,
    ...over,
  });

  it('recognises the composed name a graph preset stores', () => {
    expect(presetAggregateSpec(series())).toEqual({
      metric: 'transaction_response_time', stat: 'p95', unit: 'ms',
    });
  });

  it('leaves an ordinary series alone', () => {
    expect(presetAggregateSpec(series({ metricName: 'T01_Homepage_Load' }))).toBeNull();
  });

  it('reads the all-aggregated dashboard as stored rows, not the synthetic aggregate', () => {
    expect(presetAggregateSpec(series({
      dashboardLabel: 'Performance test metrics all aggregated',
    }))).toBeNull();
  });

  it('has no aggregate for a panel that is not aggregatable', () => {
    expect(presetAggregateSpec(series({ panelId: 301 }))).toBeNull();
  });
});

/**
 * AGGREGATED_PERF_SPECS is a hand copy of AGGREGATABLE_PERF_PANELS in
 * apps/web/lib/aggregated-perf-series.ts — the graphs card writes those panel ids into a
 * preset and the report reads them back, so a one-sided edit silently makes the report draw
 * a different statistic than the card. apps/api cannot import from apps/web, so the literals
 * are pinned here the way all-aggregated-dashboard.test.ts pins the dashboard strings.
 */
describe('presetAggregateSpec panel table (drift guard vs apps/web)', () => {
  const spec = (panelId: number) => presetAggregateSpec({
    metricName: 'All aggregated — whatever', dashboardLabel: 'Performance test metrics Checkout', panelId,
  });

  it.each([
    [101, 'transaction_response_time', 'avg', 'ms'],
    [102, 'transaction_response_time', 'p90', 'ms'],
    [103, 'transaction_response_time', 'p95', 'ms'],
    [104, 'transaction_response_time', 'p99', 'ms'],
    [105, 'error_percentage', 'avg', 'percent'],
    [201, 'request_response_time', 'avg', 'ms'],
    [202, 'request_response_time', 'p90', 'ms'],
    [203, 'request_response_time', 'p95', 'ms'],
    [204, 'request_response_time', 'p99', 'ms'],
    [205, 'error_percentage', 'avg', 'percent'],
  ])('panel %i resolves to %s/%s in %s', (panelId, metric, stat, unit) => {
    expect(spec(panelId as number)).toEqual({ metric, stat, unit });
  });

  it('claims no panel the web table does not', () => {
    for (const panelId of [100, 106, 200, 206, 210, 301]) {
      expect(spec(panelId)).toBeNull();
    }
  });
});
