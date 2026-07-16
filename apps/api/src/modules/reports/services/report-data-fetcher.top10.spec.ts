import { mapRawToTop10Rows } from './report-data-fetcher.service';

describe('mapRawToTop10Rows', () => {
  it('computes errorRate, throughput and impact and normalizes scenario/secondary', () => {
    const rows = mapRawToTop10Rows(
      [
        {
          label: 'GET /api/users',
          secondary_label: '/api/users',
          scenario_name: 'Browse',
          avg_response_time: '200',
          total_count: '100',
          failed_count: '5',
        },
        {
          label: 'POST /login',
          secondary_label: null,
          scenario_name: '',
          avg_response_time: null,
          total_count: '0',
          failed_count: '0',
        },
      ],
      50, // testDuration seconds
    );

    expect(rows[0]).toEqual({
      label: 'GET /api/users',
      secondaryLabel: '/api/users',
      scenarioName: 'Browse',
      avgResponseTime: 200,
      callCount: 100,
      errorCount: 5,
      errorRate: 5,
      throughput: 2, // 100 / 50
      impact: 20000, // 200 * 100
    });
    // empty scenario -> 'No Scenario', null secondary -> undefined, zero count -> 0 rate/throughput
    expect(rows[1].scenarioName).toBe('No Scenario');
    expect(rows[1].secondaryLabel).toBeUndefined();
    expect(rows[1].errorRate).toBe(0);
    expect(rows[1].throughput).toBe(0);
    expect(rows[1].impact).toBe(0);
  });

  it('guards a non-positive duration by treating it as 1', () => {
    const [row] = mapRawToTop10Rows(
      [{ label: 'x', secondary_label: null, scenario_name: 'S', avg_response_time: '10', total_count: '3', failed_count: '0' }],
      0,
    );
    expect(row.throughput).toBe(3); // 3 / 1
  });
});
