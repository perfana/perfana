import { transformGrafanaResponseToMetrics } from '../formatter';
import type { ProcessedPanelResult } from '../batching';

/**
 * Regression: Grafana InfluxDB-v2 / Flux responses name the timestamp column
 * "_time" (schema type "time"), not "time". The formatter must identify the
 * time column by its schema type, otherwise "_time" is treated as a metric,
 * every real value inherits the current timestamp, and dedup collapses the
 * whole series to a single stale point (panel appears empty).
 */
describe('transformGrafanaResponseToMetrics - Flux _time column', () => {
  const times = [1784016945000, 1784016960000, 1784016975000, 1784016990000];
  const usage = [11.39, 11.93, 6.66, 6.04];

  const fluxResult = (): ProcessedPanelResult =>
    ({
      panel: {
        test_run_id: 'tr-1',
        application_dashboard_id: 'ad-1',
        dashboard_uid: 'rn8_KJEnk',
        panel_id: 1,
        panel_title: 'CPU',
        dashboard_label: 'Host',
        benchmark_ids: [],
      } as unknown as ProcessedPanelResult['panel'],
      data: {
        results: {
          A: {
            status: 200,
            frames: [
              {
                schema: {
                  refId: 'A',
                  fields: [
                    { name: '_time', type: 'time', typeInfo: { frame: 'time.Time' } },
                    { name: '_usage', type: 'number', typeInfo: { frame: 'float64' }, labels: {} },
                  ],
                },
                data: { values: [times, usage] },
              },
            ],
            refId: 'A',
          },
        },
      },
      errors: null,
    });

  it('parses every point, uses _time as the timestamp, and does not emit _time as a metric', async () => {
    const docs = await transformGrafanaResponseToMetrics([fluxResult()]);

    expect(docs).toHaveLength(1);
    const records = docs[0].data;

    // Only the real metric, never the timestamp column masquerading as a metric.
    const metricNames = [...new Set(records.map((r) => r.metric_name))];
    expect(metricNames).toEqual(['_usage']);

    // All points survive dedup (last point kept: its value is non-null).
    expect(records).toHaveLength(times.length);

    // Timestamps come from _time, not "now".
    const recordMs = records.map((r) => r.time.getTime()).sort((a, b) => a - b);
    expect(recordMs).toEqual(times);
  });
});
