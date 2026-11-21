/**
 * Contract: for each anchor type, the item key the API builds equals the key the web row renders
 * (design: test-run-analysis-stories.md, "The builders are shared"). The web rows build their keys
 * with the same shared builders (pinned on the web side by
 * apps/web/__tests__/app/test-runs/comments/comment-item-key-contract.test.ts); here each resolved
 * key is also compared with the literal stored format, so a builder edit that changes the format
 * fails instead of silently orphaning stored comments.
 */
import { BadRequestException } from '@nestjs/common';
import {
  configCommentItemKey,
  dashboardCommentItemKey,
  sloCommentItemKey,
  transactionCommentItemKey,
} from '@perfana/shared/constants/comment-cards';
import { parseAnchor, resolveAnchor, seriesSource, type AnchorRun } from './comment-anchor.resolver';
import { validateChartContext } from './comments.service';

const RUN: AnchorRun = {
  id: '22222222-2222-4222-8222-222222222222',
  testRunId: 'shop-0042',
  systemUnderTestId: '66666666-6666-4666-8666-666666666666',
  testEnvironment: 'acc',
  workload: 'load',
  startTime: new Date('2026-11-20T10:00:00Z'),
  endTime: new Date('2026-11-20T11:00:00Z'),
};
const DASH = '77777777-7777-4777-8777-777777777777';
const DASH2 = '88888888-8888-4888-8888-888888888888';

/** An EntityManager whose query answers by the first matching SQL fragment. */
const emWith = (answers: Array<[string, unknown[] | ((params: unknown[]) => unknown[])]>) => ({
  query: jest.fn(async (sql: string, params: unknown[] = []) => {
    const hit = answers.find(([frag]) => sql.includes(frag));
    if (!hit) return [];
    return typeof hit[1] === 'function' ? hit[1](params) : hit[1];
  }),
});

const resolve = (em: ReturnType<typeof emWith>, raw: Record<string, unknown>) => resolveAnchor(em as never, RUN, parseAnchor(raw));

describe('anchor contract: server-built key equals the web row key', () => {
  it('transaction: [scenario group, name] as JSON, with the scenario group the card lists it under', async () => {
    const em = emWith([['test_run_transaction_stats', [{ scenario_name: 'checkout' }]]]);
    const r = await resolve(em, { type: 'transaction', name: 'T01_Login' });
    expect(r.card).toBe('performance');
    expect(r.itemKey).toBe('["checkout","T01_Login"]');
    expect(r.itemKey).toBe(transactionCommentItemKey('checkout', 'T01_Login'));
    expect(r.itemLabel).toBe('checkout · T01_Login');
  });

  it('transaction without a scenario lands in the "No Scenario" group, as the card lists it', async () => {
    const em = emWith([['test_run_transaction_stats', [{ scenario_name: '' }]]]);
    expect((await resolve(em, { type: 'transaction', name: 'T' })).itemKey).toBe('["No Scenario","T"]');
  });

  it('config: config:<key>, with the kind:config view the card would record', async () => {
    const em = emWith([
      ['FROM test_runs', [{ id: 'cmp-uuid' }]],
      ['test_run_configs', (p) => (p[0] === RUN.id ? [{ value: '512m' }] : [{ value: '2g' }])],
    ]);
    const r = await resolve(em, { type: 'config', key: 'heap.max', comparedToTestRunId: 'shop-0041' });
    expect(r.card).toBe('config');
    expect(r.itemKey).toBe('config:heap.max');
    expect(r.itemKey).toBe(configCommentItemKey('heap.max'));
    expect(r.itemLabel).toBe('heap.max');
    expect(r.chartContext).toEqual({ comparedToTestRunId: 'shop-0041', status: 'changed', currentValue: '512m', previousValue: '2g' });
    // It passes the same validation a person's config view does, and is stamped kind:'config'.
    expect(validateChartContext('config', undefined, r.chartContext!)).toMatchObject({ kind: 'config', status: 'changed' });
  });

  it('dashboard: dashboard:<application dashboard id>, labelled by its label', async () => {
    const em = emWith([['FROM application_dashboards', [{ id: DASH, dashboard_label: 'JVM overview', dashboard_name: 'jvm' }]]]);
    const r = await resolve(em, { type: 'dashboard', applicationDashboardId: DASH });
    expect(r.card).toBe('dashboards');
    expect(r.itemKey).toBe(`dashboard:${DASH}`);
    expect(r.itemKey).toBe(dashboardCommentItemKey(DASH));
    expect(r.itemLabel).toBe('JVM overview');
  });

  it('slo: the SLO row key built from the check result', async () => {
    const result = {
      panel_type: 'graph', evaluate_type: 'avg', benchmark_id: 'b-1', panel_title: 'RT',
      application_dashboard_id: DASH, panel_id: 4, metric_name: 'p95', dashboard_label: 'Perf',
    };
    const em = emWith([['FROM check_results', [result]]]);
    const r = await resolve(em, { type: 'slo', checkResultId: '99999999-9999-4999-8999-999999999999' });
    expect(r.card).toBe('slo');
    expect(r.itemKey).toBe(`${DASH}_4_p95_b-1`);
    expect(r.itemKey).toBe(sloCommentItemKey(result));
    expect(r.itemLabel).toBe('Perf · RT · p95');
  });

  it('slo: an Apdex row keys on the benchmark and panel title', async () => {
    const em = emWith([['FROM check_results', [{ panel_type: 'apdex', evaluate_type: 'apdex', benchmark_id: 'b-2', panel_title: 'Checkout' }]]]);
    const r = await resolve(em, { type: 'slo', checkResultId: '99999999-9999-4999-8999-999999999999' });
    expect(r.itemKey).toBe('apdex_b-2_Checkout');
    expect(r.itemLabel).toBe('Apdex SLO · Checkout');
  });

  it('marker: a Graphs marker with series in the graph-preset shape the replay reads, range defaulting to the run', async () => {
    const em = emWith([
      ['FROM application_dashboards', [{ id: DASH, dashboard_label: 'Perf', source_type: 'performance_test' }]],
      ['FROM ds_metrics', [{ panel_title: 'Response times', unit: 'ms' }]],
    ]);
    const r = await resolve(em, {
      type: 'marker', time: '2026-11-20T10:32:00Z', series: [{ dashboardLabel: 'Perf', panelId: 201, metricName: 'T01' }],
    });
    expect(r.card).toBe('graphs');
    expect(r.itemKey).toBeNull();
    expect(r.markerTime).toBe('2026-11-20T10:32:00.000Z');
    expect(r.chartContext).toEqual({
      series: [{
        dashboardId: DASH, dashboardLabel: 'Perf', panelId: 201, panelTitle: 'Response times', metricName: 'T01',
        source: 'performance-metrics', yAxisFormat: 'ms', colorSlot: 0,
      }],
      axisMode: 'overlay',
      xRange: ['2026-11-20T10:00:00.000Z', '2026-11-20T11:00:00.000Z'],
    });
    expect(validateChartContext('graphs', undefined, r.chartContext!)).toMatchObject({ kind: 'graphs' });
    // The ds_metrics probe is bounded by the run window (root CLAUDE.md #56).
    const probe = em.query.mock.calls.find(([sql]) => String(sql).includes('FROM ds_metrics'))!;
    expect(String(probe[0])).toMatch(/time >= \$5::timestamptz AND time <= \$6::timestamptz/);
  });

  it('card: a card-level comment with no item', async () => {
    const r = await resolve(emWith([]), { type: 'card', card: 'dynatrace' });
    expect(r).toEqual({ card: 'dynatrace', itemKey: null, itemLabel: null, markerTime: null, chartContext: null });
  });
});

describe('anchor verification: a missing thing is a 400 naming it', () => {
  it.each([
    ['transaction', { type: 'transaction', name: 'Nope' }, /Transaction "Nope" not found/],
    ['config key', { type: 'config', key: 'nope.key' }, /Configuration key "nope.key" not found/],
    ['dashboard', { type: 'dashboard', applicationDashboardId: DASH }, new RegExp(`${DASH} is not a dashboard of this run`)],
    ['check result', { type: 'slo', checkResultId: '99999999-9999-4999-8999-999999999999' }, /does not belong to this test run/],
  ])('%s', async (_n, raw, msg) => {
    await expect(resolve(emWith([]), raw)).rejects.toThrow(msg);
  });

  it('a series with no data in the run', async () => {
    const em = emWith([['FROM application_dashboards', [{ id: DASH, dashboard_label: 'Perf', source_type: null }]]]);
    await expect(
      resolve(em, { type: 'marker', time: '2026-11-20T10:30:00Z', series: [{ dashboardLabel: 'Perf', panelId: 1, metricName: 'ghost' }] }),
    ).rejects.toThrow(/series "ghost" on panel 1 of "Perf" has no data/);
  });

  it('an unknown dashboard label', async () => {
    await expect(
      resolve(emWith([]), { type: 'marker', time: '2026-11-20T10:30:00Z', series: [{ dashboardLabel: 'Nope', panelId: 1, metricName: 'm' }] }),
    ).rejects.toThrow(/no dashboard labelled "Nope"/);
  });

  it('an ambiguous dashboard label lists the candidates with their applicationDashboardId', async () => {
    const em = emWith([
      ['FROM application_dashboards', [
        { id: DASH, dashboard_label: 'JVM', source_type: null },
        { id: DASH2, dashboard_label: 'JVM', source_type: null },
      ]],
      ['FROM ds_metrics', [{ panel_title: 'Heap', unit: 'bytes' }]],
    ]);
    const err = await resolve(em, { type: 'marker', time: '2026-11-20T10:30:00Z', series: [{ dashboardLabel: 'JVM', panelId: 3, metricName: 'used' }] })
      .catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain(DASH);
    expect(err.message).toContain(DASH2);
    expect(err.message).toContain('applicationDashboardId');
  });

  it('an applicationDashboardId in the series picks one of two dashboards sharing a label', async () => {
    const em = emWith([
      ['FROM application_dashboards', [
        { id: DASH, dashboard_label: 'JVM', source_type: null },
        { id: DASH2, dashboard_label: 'JVM', source_type: null },
      ]],
      ['FROM ds_metrics', [{ panel_title: 'Heap', unit: 'bytes' }]],
    ]);
    const r = await resolve(em, {
      type: 'marker', time: '2026-11-20T10:30:00Z',
      series: [{ dashboardLabel: 'JVM', panelId: 3, metricName: 'used', applicationDashboardId: DASH2 }],
    });
    expect((r.chartContext!.series as Array<{ dashboardId: string }>)[0]!.dashboardId).toBe(DASH2);
  });

  it('a marker time outside the run', async () => {
    await expect(
      resolve(emWith([]), { type: 'marker', time: '2026-11-20T12:00:00Z', series: [{ dashboardLabel: 'P', panelId: 1, metricName: 'm' }] }),
    ).rejects.toThrow(/must lie inside the run/);
  });

  it('a transaction in two scenarios needs the scenario, and lists them', async () => {
    const em = emWith([['test_run_transaction_stats', [{ scenario_name: 'a' }, { scenario_name: 'b' }]]]);
    await expect(resolve(em, { type: 'transaction', name: 'T' })).rejects.toThrow(/more than one scenario.*a, b/);
    expect((await resolve(em, { type: 'transaction', name: 'T', scenario: 'b' })).itemKey).toBe('["b","T"]');
  });

  it('a compared run outside the system, environment and workload', async () => {
    const em = emWith([['test_run_configs', [{ value: 'x' }]]]);
    await expect(resolve(em, { type: 'config', key: 'k', comparedToTestRunId: 'other-1' })).rejects.toThrow(/not a run of this system/);
  });
});

describe('parseAnchor', () => {
  it.each([
    [{ type: 'nope' }, /anchor.type must be one of/],
    [{ type: 'dashboard', applicationDashboardId: 'not-a-uuid' }, /anchor.applicationDashboardId/],
    [{ type: 'marker', time: '2026-11-20T10:30:00Z', series: [] }, /anchor.series/],
    [{ type: 'card', card: 'nope' }, /anchor.card/],
  ])('refuses %j', (raw, msg) => {
    expect(() => parseAnchor(raw)).toThrow(msg);
  });

  it('maps a metrics source to the series source the Graphs card uses', () => {
    expect(seriesSource('performance_test')).toBe('performance-metrics');
    expect(seriesSource('dynatrace')).toBe('dynatrace');
    expect(seriesSource(null)).toBe('grafana');
  });
});

describe('Adapt, tracing and Pyroscope anchors', () => {
  const TS = '99999999-9999-4999-8999-999999999990';
  const TS_ENV = '99999999-9999-4999-8999-999999999991';
  const pyroscopeSut = [{ pyroscope_instance_id: 'p1', pyroscope_configurations: [{ application: 'shop', profiler: 'process_cpu:cpu:nanoseconds:cpu:nanoseconds' }] }];

  it('adapt: <dashboard>|<panel>|<series>, labelled like the Anomaly detection row', async () => {
    const em = emWith([['FROM ds_adapt_results', [{ dashboard_label: 'JVM', panel_title: 'Heap' }]]]);
    const r = await resolve(em, { type: 'adapt', applicationDashboardId: DASH, panelId: 7, metricName: 'order_confirmation_pdf_gen' });
    expect(r.card).toBe('anomaly');
    expect(r.itemKey).toBe(`${DASH}|7|order_confirmation_pdf_gen`);
    expect(r.itemLabel).toBe('JVM · Heap · order_confirmation_pdf_gen');
    expect(r.chartContext).toBeNull();
  });

  it('adapt: no result for the series lists what the panel has; no result for the panel says so', async () => {
    const em = emWith([['SELECT DISTINCT metric_name FROM ds_adapt_results', [{ metric_name: 'a' }, { metric_name: 'b' }]]]);
    await expect(resolve(em, { type: 'adapt', applicationDashboardId: DASH, panelId: 7, metricName: 'ghost' })).rejects.toThrow(
      /No Adapt result for series "ghost" on panel 7 .* that panel has: a, b/,
    );
    await expect(resolve(emWith([]), { type: 'adapt', applicationDashboardId: DASH, panelId: 7, metricName: 'ghost' })).rejects.toThrow(
      new RegExp(`No Adapt result for panel 7 of application dashboard ${DASH} in this test run`),
    );
  });

  it('tracing: [service id, name, scenario, transaction, sampler] from the most specific tracing service', async () => {
    const em = emWith([['FROM tracing_services', [
      { id: TS, service_names: ['orders', 'matrix-multiply'], level: 0 },
      { id: TS_ENV, service_names: ['matrix-multiply'], level: 1 },
    ]]]);
    const r = await resolve(em, { type: 'tracing', serviceName: 'matrix-multiply', scenario: 'Checkout', transaction: 'T04_Pay' });
    expect(r.card).toBe('distributed-tracing');
    expect(r.itemKey).toBe(`["${TS}","matrix-multiply","Checkout","T04_Pay",null]`);
    expect(r.itemLabel).toBe('matrix-multiply · Checkout / T04_Pay');
    // The run's scope is bound, never interpolated.
    expect(em.query.mock.calls[0]![1]).toEqual([RUN.systemUnderTestId, RUN.testEnvironment, RUN.workload]);
  });

  it('tracing: a service only a less specific level configures is not the one the card shows', async () => {
    const em = emWith([['FROM tracing_services', [
      { id: TS, service_names: ['orders'], level: 0 },
      { id: TS_ENV, service_names: ['matrix-multiply'], level: 1 },
    ]]]);
    await expect(resolve(em, { type: 'tracing', serviceName: 'matrix-multiply' })).rejects.toThrow(
      /Service "matrix-multiply" is not configured in this run's tracing service; it traces: orders/,
    );
  });

  it('tracing: no tracing service at all', async () => {
    await expect(resolve(emWith([]), { type: 'tracing', serviceName: 'orders' })).rejects.toThrow(/No tracing service is configured/);
  });

  it('pyroscope: [application, profiler, view], diff when asked and a comparison run exists', async () => {
    const em = emWith([
      ['FROM systems_under_test', pyroscopeSut],
      ['FROM test_runs', [{ '?column?': 1 }]],
    ]);
    const r = await resolve(em, { type: 'pyroscope', application: 'shop', profiler: 'process_cpu:cpu:nanoseconds:cpu:nanoseconds', view: 'diff' });
    expect(r.card).toBe('pyroscope');
    expect(r.itemKey).toBe('["shop","process_cpu:cpu:nanoseconds:cpu:nanoseconds","diff"]');
    expect(r.itemLabel).toBe('shop / process_cpu · Diff view');
  });

  it('pyroscope: single view needs no comparison run', async () => {
    const em = emWith([['FROM systems_under_test', pyroscopeSut]]);
    const r = await resolve(em, { type: 'pyroscope', application: 'shop', profiler: 'process_cpu:cpu:nanoseconds:cpu:nanoseconds', view: 'single' });
    expect(r.itemKey).toBe('["shop","process_cpu:cpu:nanoseconds:cpu:nanoseconds","single"]');
    expect(em.query.mock.calls.some(([sql]) => String(sql).includes('FROM test_runs'))).toBe(false);
  });

  it('pyroscope: diff with no comparison run, an unconfigured pair, and no Pyroscope at all', async () => {
    const diff = { type: 'pyroscope', application: 'shop', profiler: 'process_cpu:cpu:nanoseconds:cpu:nanoseconds', view: 'diff' };
    await expect(resolve(emWith([['FROM systems_under_test', pyroscopeSut]]), diff)).rejects.toThrow(/diff view needs a completed earlier run/);
    await expect(
      resolve(emWith([['FROM systems_under_test', pyroscopeSut]]), { ...diff, profiler: 'memory:alloc' }),
    ).rejects.toThrow(/profiler "memory:alloc" is not configured.*configured: shop \(process_cpu/);
    await expect(resolve(emWith([['FROM systems_under_test', [{ pyroscope_instance_id: null, pyroscope_configurations: [] }]]]), diff)).rejects.toThrow(
      /Pyroscope is not configured/,
    );
  });

  it.each([
    [{ type: 'adapt', applicationDashboardId: 'x', panelId: 1, metricName: 'm' }, /anchor.applicationDashboardId/],
    [{ type: 'adapt', applicationDashboardId: DASH, panelId: -1, metricName: 'm' }, /anchor.panelId/],
    [{ type: 'tracing', serviceName: '' }, /anchor.serviceName/],
    [{ type: 'pyroscope', application: 'a', profiler: 'p', view: 'side' }, /anchor.view/],
  ])('parseAnchor refuses %j', (raw, msg) => {
    expect(() => parseAnchor(raw)).toThrow(msg);
  });
});
