import { describeKey, forcedFields, panelIsPattern, panelText } from '../template-display';

describe('template display', () => {
  it('lists only the fields a template forces, in export order', () => {
    expect(
      forcedFields({
        panelId: 1,
        metricClassification: 'x',
        higherIsBetter: null,
        absThreshold: null,
        percentageThreshold: 0.15,
        aggregation: 'q95',
        minSampleCount: 1,
      }),
    ).toEqual(['No direction', 'No absolute threshold', 'Percentage 15 %', '95th Percentile', 'At least 1 sample']);
    expect(forcedFields({ panelId: 1, metricClassification: 'x' })).toEqual([]);
  });

  it('reads a panel id with its label, and a title pattern only without an id', () => {
    expect(panelText({ panelId: 7, panelTitle: 'Heap', metricClassification: 'x' })).toBe('#7 Heap');
    expect(panelIsPattern({ regex: true, panelId: 7, panelTitle: 'Heap', metricClassification: 'x' })).toBe(false);
    expect(panelIsPattern({ regex: true, panelTitle: 'Heap.*', metricClassification: 'x' })).toBe(true);
  });

  it('describes the identity in one line', () => {
    expect(describeKey({ dashboardUid: '^dynatrace-', regex: true, panelTitle: 'CPU.*', metricClassification: 'x' })).toBe(
      'Dashboards matching ^dynatrace- · panel titles matching "CPU.*" · Whole panel',
    );
    expect(describeKey({ panelId: 201, metricName: 'api', metricClassification: 'x' })).toBe('Every dashboard · panel #201 · api');
  });
});
