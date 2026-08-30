import { getUrlPanel, isUrlPanel } from './url-perf-panels';
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
