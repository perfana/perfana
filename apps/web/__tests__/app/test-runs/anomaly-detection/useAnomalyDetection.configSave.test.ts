/**
 * useAnomalyDetection.handleConfigSave — the three scopes a compare-config save can take.
 *
 * `all-dashboards` is new: it fans out one POST per (dashboard, panel) that shares the
 * row's panel title, via `collectPanelTargets`. These pin the fan-out itself (request
 * count and payload per target, not just the pure helper), the toast singular/plural
 * wording, and the two error paths `metric`/`panel` already had with no test at all:
 * a rowKey that cannot be resolved to a row, and one request in the fan-out failing
 * while the others still fire.
 */

import { MutableRefObject } from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAnomalyDetection } from '@/app/test-runs/[id]/components/anomaly-detection/hooks/useAnomalyDetection';
import { authenticatedFetch } from '@/lib/api';
import type { AnomalyData, ConfigFormData } from '@/app/test-runs/[id]/components/anomaly-detection/types';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

jest.mock('@/lib/config-hash', () => ({
  generateConfigHash: jest.fn(() => 'mock-hash'),
}));

jest.mock('@/lib/anomaly-api', () => ({
  deleteAnomalyData: jest.fn(),
}));

const cardRef: MutableRefObject<HTMLDivElement | null> = { current: null };

const testRun = {
  system_under_test_id: 'sut-1',
  test_environment: 'production',
  workload: 'baseline',
} as never;

const row = (overrides: Partial<AnomalyData>): AnomalyData => ({
  dashboard_label: 'dash',
  panel_title: 'CPU usage',
  metric_name: 'cpu.used',
  unit: null,
  classification: 'use_utilization',
  conclusion_label: 'no_regression',
  test_value: '1',
  control_group_value: '1',
  difference: '0',
  application_dashboard_id: 'dash-a',
  panel_id: '10',
  ...overrides,
});

const configData: ConfigFormData = {
  ignore: false,
  metricClassification: { classification: 'use_utilization', higherIsBetter: false },
  thresholds: { aggregation: 'mean', percentageThreshold: 10, iqrThreshold: 2, absoluteThreshold: undefined },
  defaultValueIfControlGroupMissing: 0,
};

function mockAnomalyRows(rows: AnomalyData[]) {
  (authenticatedFetch as jest.Mock).mockImplementation(async (url: string) => {
    if (url.includes('/anomaly-detection/summary')) return { ok: true, json: async () => ({ total: 0, stale_count: 0, by_conclusion: {} }) };
    if (url.includes('/anomaly-detection')) return { ok: true, json: async () => rows };
    if (url.includes('/tracked-regressions/count')) return { ok: true, json: async () => ({ count: 0 }) };
    if (url.includes('/adapt/conclusion/')) return { ok: true, text: async () => '' };
    return { ok: true, json: async () => ({}) };
  });
}

/** Swap the mock after the initial load so POSTs to ds-compare-config can be asserted on their own. */
function mockComparConfigPost(handler: (payload: Record<string, unknown>) => { ok: boolean; status?: number; json?: () => Promise<unknown> }) {
  (authenticatedFetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/test-runs/ds-compare-config') {
      const payload = JSON.parse(init!.body as string);
      return handler(payload);
    }
    return { ok: true, json: async () => ({}) };
  });
}

async function setupExpanded(rows: AnomalyData[]) {
  mockAnomalyRows(rows);
  const showToast = jest.fn();
  const { result } = renderHook(() =>
    useAnomalyDetection({
      testRun,
      testRunId: 'run-1',
      anomalyExpanded: true,
      onAnomalyExpand: jest.fn(),
      conclusionFilter: 'all',
      setConclusionFilter: jest.fn(),
      showToast,
      cardRef,
    })
  );

  await waitFor(() => expect(result.current.anomalyData).toHaveLength(rows.length));
  return { result, showToast };
}

describe('useAnomalyDetection — handleConfigSave', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('all-dashboards: POSTs one panel-level config per dashboard sharing the panel title', async () => {
    const rows = [
      row({ application_dashboard_id: 'dash-a', panel_id: '10', metric_name: 'cpu.used' }),
      row({ application_dashboard_id: 'dash-a', panel_id: '10', metric_name: 'cpu.idle' }), // same panel, second metric
      row({ application_dashboard_id: 'dash-b', panel_id: '20', metric_name: 'cpu.used', metrics_source_id: 'ms-2' }),
      row({ application_dashboard_id: 'dash-c', panel_id: '30', panel_title: 'Memory usage', metric_name: 'mem.used' }),
    ];
    const { result, showToast } = await setupExpanded(rows);

    const posted: Record<string, unknown>[] = [];
    mockComparConfigPost((payload) => {
      posted.push(payload);
      return { ok: true };
    });

    await act(async () => {
      await result.current.handleConfigSave('row_0', configData, 'all-dashboards');
    });

    // Two targets: dash-a/panel 10 and dash-b/panel 20 — "Memory usage" on dash-c is excluded,
    // and the second metric on dash-a/panel 10 does not produce a second request.
    expect(posted).toHaveLength(2);
    expect(posted.map((p) => p.applicationDashboardId).sort()).toEqual(['dash-a', 'dash-b']);
    for (const payload of posted) {
      expect(payload.metricName).toBeUndefined();
      expect((payload as { configData: { source: string } }).configData.source).toBe('panel');
    }
    const dashB = posted.find((p) => p.applicationDashboardId === 'dash-b')!;
    expect(dashB.metricsSourceId).toBe('ms-2');

    expect(showToast).toHaveBeenCalledWith('Configuration saved for panel "CPU usage" on 2 dashboards');
  });

  it('all-dashboards: singular wording when only the row\'s own dashboard matches', async () => {
    const rows = [row({ application_dashboard_id: 'dash-a', panel_id: '10' })];
    const { result, showToast } = await setupExpanded(rows);
    mockComparConfigPost(() => ({ ok: true }));

    await act(async () => {
      await result.current.handleConfigSave('row_0', configData, 'all-dashboards');
    });

    expect(showToast).toHaveBeenCalledWith('Configuration saved for panel "CPU usage" on 1 dashboard');
  });

  it('metric scope: a single POST carries the row\'s metric name', async () => {
    const rows = [row({ metric_name: 'cpu.used' })];
    const { result, showToast } = await setupExpanded(rows);

    const posted: Record<string, unknown>[] = [];
    mockComparConfigPost((payload) => {
      posted.push(payload);
      return { ok: true };
    });

    await act(async () => {
      await result.current.handleConfigSave('row_0', configData, 'metric');
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]!.metricName).toBe('cpu.used');
    expect((posted[0] as { configData: { source: string } }).configData.source).toBe('metric');
    expect(showToast).toHaveBeenCalledWith('Configuration saved successfully (metric level)');
  });

  it('panel scope: a single POST with no metric name, even with other matching-title panels present', async () => {
    const rows = [
      row({ application_dashboard_id: 'dash-a', panel_id: '10' }),
      row({ application_dashboard_id: 'dash-b', panel_id: '20' }),
    ];
    const { result, showToast } = await setupExpanded(rows);

    const posted: Record<string, unknown>[] = [];
    mockComparConfigPost((payload) => {
      posted.push(payload);
      return { ok: true };
    });

    await act(async () => {
      await result.current.handleConfigSave('row_0', configData, 'panel');
    });

    // Scope 'panel' targets only the row's own (dashboard, panel) — the fan-out is
    // exclusive to 'all-dashboards'.
    expect(posted).toHaveLength(1);
    expect(posted[0]!.applicationDashboardId).toBe('dash-a');
    expect(posted[0]!.metricName).toBeUndefined();
    expect(showToast).toHaveBeenCalledWith('Configuration saved successfully (panel level)');
  });

  it('a rowKey that resolves to no row reports an error and posts nothing', async () => {
    const rows = [row({})];
    const { result, showToast } = await setupExpanded(rows);

    const post = jest.fn();
    mockComparConfigPost((payload) => {
      post(payload);
      return { ok: true };
    });

    await act(async () => {
      await result.current.handleConfigSave('row_99', configData, 'panel');
    });

    expect(post).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('Error: Could not find metric data for configuration');
  });

  it('all-dashboards: a partial fan-out failure names what landed and what did not', async () => {
    const rows = [
      row({ application_dashboard_id: 'dash-a', panel_id: '10' }),
      row({ application_dashboard_id: 'dash-b', panel_id: '20' }),
    ];
    const { result, showToast } = await setupExpanded(rows);

    const posted: string[] = [];
    mockComparConfigPost((payload) => {
      posted.push(payload.applicationDashboardId as string);
      if (payload.applicationDashboardId === 'dash-b') {
        return { ok: false, status: 500, json: async () => ({ message: 'panel locked' }) };
      }
      return { ok: true };
    });

    await act(async () => {
      await result.current.handleConfigSave('row_0', configData, 'all-dashboards');
    });

    // Both targets were requested, and the partial write is reported as such: the server writes
    // each target independently with no rollback, so an all-or-nothing error toast would hide that
    // one dashboard already has the new config.
    expect(posted.sort()).toEqual(['dash-a', 'dash-b']);
    expect(showToast).toHaveBeenCalledWith(
      'Configuration saved on 1 of 2 dashboards — 1 failed: panel locked',
    );
  });

  it('all-dashboards: every target failing is an error, not a partial success', async () => {
    const rows = [
      row({ application_dashboard_id: 'dash-a', panel_id: '10' }),
      row({ application_dashboard_id: 'dash-b', panel_id: '20' }),
    ];
    const { result, showToast } = await setupExpanded(rows);

    mockComparConfigPost(() => ({
      ok: false,
      status: 500,
      json: async () => ({ message: 'panel locked' }),
    }));

    await act(async () => {
      await result.current.handleConfigSave('row_0', configData, 'all-dashboards');
    });

    // Nothing landed, so the server's own message surfaces rather than "saved on 0 of 2".
    expect(showToast).toHaveBeenCalledWith('Error: panel locked');
  });
});
