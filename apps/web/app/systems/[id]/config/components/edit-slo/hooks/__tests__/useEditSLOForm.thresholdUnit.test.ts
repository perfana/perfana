/**
 * How Edit decides its ONE threshold unit (`sloFormData.thresholdUnit`): once at open from the
 * record, once more when the live panel or Dynatrace metric arrives. The save converts into and
 * labels with that value alone (useEditSLOHandlers.enabledAndConflict.test.ts), so these cases
 * are where a stored number and its label could come apart.
 *
 * Fixtures are module-scope on purpose: the init effect keys on the benchmark reference.
 */
import { renderHook, waitFor, act } from '@testing-library/react';
import { useEditSLOForm } from '../useEditSLOForm';
import { Benchmark } from '../../../types';
import { UseEditSLOFormProps } from '../../types';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('@/lib/grafana-dashboards', () => ({ fetchGrafanaDashboardByUid: jest.fn() }));
jest.mock('@/lib/dynatrace', () => ({ fetchDynatraceDashboards: jest.fn(), fetchDynatraceMetrics: jest.fn() }));

import { authenticatedFetch } from '@/lib/api';
import { fetchGrafanaDashboardByUid } from '@/lib/grafana-dashboards';
import { fetchDynatraceDashboards, fetchDynatraceMetrics } from '@/lib/dynatrace';

const mockAuthFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;
const mockByUid = fetchGrafanaDashboardByUid as jest.MockedFunction<typeof fetchGrafanaDashboardByUid>;
const mockDtDashboards = fetchDynatraceDashboards as jest.MockedFunction<typeof fetchDynatraceDashboards>;
const mockDtMetrics = fetchDynatraceMetrics as jest.MockedFunction<typeof fetchDynatraceMetrics>;

const json = (data: unknown) => ({ ok: true, status: 200, json: async () => data }) as unknown as Response;

const BASE = {
  id: 'bm',
  system_under_test_id: 'sys-1',
  test_environment: 'production',
  workload: 'normal',
  source: 'grafana',
  dashboard_uid: 'uid-1',
  application_dashboard_id: 'ad-1',
  config_title: 'Board - Latency',
  panel_title: 'Latency',
  evaluate_type: 'avg',
  requirement_operator: 'lt',
  requirement_value: 0.9,
  enabled: true,
  valid: true,
  tags: [],
  exclude_ramp_up_time: true,
  created_at: '',
  updated_at: '',
} as unknown as Benchmark;

const props = (benchmark: Benchmark): UseEditSLOFormProps => ({
  open: true,
  benchmark,
  systemId: 'sys-1',
  environment: 'production',
  workload: 'normal',
});

// A Grafana panel whose unit changed since the SLO was made.
const RECORD_MS = props({ ...BASE, requirement_value: 500, configuration: { panelId: 3, yAxesFormat: 'ms' } } as Benchmark);
// A perf-test SLO saved before its panel carried a unit (metric_unit NULL).
const UNITLESS = props({ ...BASE, configuration: { panelId: 3 } } as Benchmark);
// A former trend now edited as avg: metric_unit still '%/h', the real unit in configuration.
const FORMER_TREND = props({ ...BASE, requirement_value: 2, metric_unit: '%/h', configuration: { panelId: 3, yAxesFormat: 's' } } as Benchmark);
// A trend with no usable unit at all.
const TREND_NO_UNIT = props({ ...BASE, evaluate_type: 'trend', requirement_value: 5, metric_unit: '%/h', configuration: { panelId: 3 } } as Benchmark);
// Dynatrace: the synthetic panel carries no unit; the record does.
const DYNATRACE = props({
  ...BASE,
  source: 'dynatrace',
  requirement_value: 1000,
  metric_unit: 'ms',
  configuration: {},
  config_title: 'DT board - Response time',
} as Benchmark);
const DYNATRACE_UNITLESS = props({ ...BASE, source: 'dynatrace', requirement_value: 5, configuration: {}, config_title: 'DT board - Response time' } as Benchmark);

/** Serve one Grafana application dashboard whose panel 3 has `unit`. */
function serveGrafanaPanel(unit: string) {
  mockAuthFetch.mockResolvedValue(json([{ id: 'ad-1', dashboard_uid: 'uid-1', grafana_instance_id: 'gi' }]));
  mockByUid.mockResolvedValue({ panels: [{ id: 3, title: 'Latency', type: 'timeseries', yAxesFormat: unit }] } as never);
}

const panelUnit = (p: unknown) => (p as { yAxesFormat?: string } | null)?.yAxesFormat;

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthFetch.mockResolvedValue(json([]));
  mockByUid.mockResolvedValue(null as never);
  mockDtDashboards.mockResolvedValue([]);
  mockDtMetrics.mockResolvedValue([]);
});

describe('the record decides thresholdUnit at open', () => {
  it("keeps the record's unit when the live panel's has changed since", async () => {
    serveGrafanaPanel('s');
    const { result } = renderHook(() => useEditSLOForm(RECORD_MS));
    await waitFor(() => expect(panelUnit(result.current.sloFormData.selectedPanel)).toBe('s'));
    expect(result.current.sloFormData.thresholdUnit).toBe('ms');
    expect(result.current.sloFormData.requirementValue).toBe('500');
  });

  it("skips a former trend's stale '%/h' and finds the real unit", async () => {
    const { result } = renderHook(() => useEditSLOForm(FORMER_TREND));
    await waitFor(() => expect(result.current.sloFormData.thresholdUnit).toBe('s'));
  });
});

describe('the live panel decides thresholdUnit when the record has none', () => {
  // The field showed the raw 0.9; on a percentunit panel it is re-shown as 90 so the save's
  // scaling (90 -> 0.9) gives back the stored number, and the label is percentunit.
  it('adopts percentunit and re-shows the untouched value scaled', async () => {
    serveGrafanaPanel('percentunit');
    const { result } = renderHook(() => useEditSLOForm(UNITLESS));
    await waitFor(() => expect(result.current.sloFormData.thresholdUnit).toBe('percentunit'));
    expect(result.current.sloFormData.requirementValue).toBe('90');
  });

  it('adopts a unit that does not change how the value is shown', async () => {
    serveGrafanaPanel('ms');
    const { result } = renderHook(() => useEditSLOForm(UNITLESS));
    await waitFor(() => expect(result.current.sloFormData.thresholdUnit).toBe('ms'));
    expect(result.current.sloFormData.requirementValue).toBe('0.9');
  });

  // A trend's number is %/h, not a panel value: the base unit is adopted for an edit to avg,
  // but the value is not rescaled.
  it('adopts the base unit for a trend without rescaling its %/h value', async () => {
    serveGrafanaPanel('percentunit');
    const { result } = renderHook(() => useEditSLOForm(TREND_NO_UNIT));
    await waitFor(() => expect(result.current.sloFormData.thresholdUnit).toBe('percentunit'));
    expect(result.current.sloFormData.requirementValue).toBe('5');
  });
});

describe('Dynatrace', () => {
  it("keeps the record's unit when the matched metric carries none", async () => {
    mockDtDashboards.mockResolvedValue([{ dashboardLabel: 'DT board' }] as never);
    mockDtMetrics.mockResolvedValue([{ panelTitle: 'Response time', panelId: 9, applicationDashboardId: 'ad-1' }]);
    const { result } = renderHook(() => useEditSLOForm(DYNATRACE));
    await waitFor(() => expect((result.current.sloFormData.selectedPanel as { panelId?: number }).panelId).toBe(9));
    expect(result.current.sloFormData.thresholdUnit).toBe('ms');
  });

  // The reverted 48646fc6 lost the unit here: no metric matches, so nothing upgrades.
  it("keeps the record's unit when no metric matches", async () => {
    mockDtDashboards.mockResolvedValue([{ dashboardLabel: 'DT board' }] as never);
    mockDtMetrics.mockResolvedValue([{ panelTitle: 'Something else', panelId: 1, applicationDashboardId: 'ad-1' }]);
    const { result } = renderHook(() => useEditSLOForm(DYNATRACE));
    await waitFor(() => expect(mockDtMetrics).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current.sloFormData.thresholdUnit).toBe('ms');
    expect(result.current.sloFormData.requirementValue).toBe('1000');
  });

  it("adopts the matched metric's unit when the record has none", async () => {
    mockDtDashboards.mockResolvedValue([{ dashboardLabel: 'DT board' }] as never);
    mockDtMetrics.mockResolvedValue([{ panelTitle: 'Response time', panelId: 9, applicationDashboardId: 'ad-1', metricUnit: 'ms' }]);
    const { result } = renderHook(() => useEditSLOForm(DYNATRACE_UNITLESS));
    await waitFor(() => expect(result.current.sloFormData.thresholdUnit).toBe('ms'));
  });
});

// Review finding: in Duplicate a late panel fetch for the original dashboard re-matched the
// benchmark's panel id and swapped back a panel the user had already picked, leaving the old
// panel id under the picked panel's unit.
describe('Duplicate', () => {
  it('does not swap back a panel the user picked when the original panels arrive late', async () => {
    let release: (v: unknown) => void = () => {};
    mockAuthFetch.mockResolvedValue(json([{ id: 'ad-1', dashboard_uid: 'uid-1', grafana_instance_id: 'gi' }]));
    mockByUid.mockReturnValue(new Promise((r) => { release = r; }) as never);
    const { result } = renderHook(() => useEditSLOForm(RECORD_MS));
    await waitFor(() => expect(mockByUid).toHaveBeenCalled());
    act(() => {
      result.current.setSloFormData((prev) => ({
        ...prev,
        selectedPanel: { id: 8, title: 'Pool in use', yAxesFormat: 'percentunit' },
        thresholdUnit: 'percentunit',
      }));
    });
    await act(async () => {
      release({ panels: [{ id: 3, title: 'Latency', type: 'timeseries', yAxesFormat: 'ms' }] });
    });
    expect((result.current.sloFormData.selectedPanel as { id?: number }).id).toBe(8);
    expect(result.current.sloFormData.thresholdUnit).toBe('percentunit');
  });
});
