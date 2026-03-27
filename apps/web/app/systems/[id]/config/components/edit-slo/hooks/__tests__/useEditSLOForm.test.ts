/**
 * Unit tests for useEditSLOForm hook
 *
 * The MOST IMPORTANT behaviour verified here is the "synthetic dashboard/panel
 * on init" path: when the dialog opens with a benchmark, the hook must
 * immediately set selectedDashboard and selectedPanel to non-null synthetic
 * objects built from the benchmark's own data.  Without that, the Save button
 * is permanently disabled because isFormValid returns false when either field
 * is null.
 *
 * Performance note: the hook's init useEffect depends on `benchmark` as an
 * object reference.  To avoid infinite re-render loops (and OOM), all fixture
 * objects that are passed as hook props MUST be defined once at describe/module
 * scope — never constructed inside a renderHook callback or beforeEach — so
 * their reference is stable across renders.
 */

import { renderHook, waitFor, act } from '@testing-library/react';
import { useEditSLOForm } from '../useEditSLOForm';
import { isFormValid } from '../../utils/slo-validators';
import { Benchmark } from '../../../types';
import { UseEditSLOFormProps } from '../../types';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

jest.mock('@/lib/dynatrace', () => ({
  fetchDynatraceDashboards: jest.fn(),
  fetchDynatraceMetrics: jest.fn(),
}));

import { authenticatedFetch } from '@/lib/api';
import { fetchDynatraceDashboards, fetchDynatraceMetrics } from '@/lib/dynatrace';

const mockAuthFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;
const mockFetchDynatraceDashboards = fetchDynatraceDashboards as jest.MockedFunction<
  typeof fetchDynatraceDashboards
>;
const mockFetchDynatraceMetrics = fetchDynatraceMetrics as jest.MockedFunction<
  typeof fetchDynatraceMetrics
>;

// ---------------------------------------------------------------------------
// Stable response helper (does NOT create closures per test)
// ---------------------------------------------------------------------------

function makeResponse(data: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Internal Server Error',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: { get: () => null } as any,
    clone: function () { return this; },
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Stable fixture objects — defined ONCE at module scope.
// Passing these directly as hook props keeps the benchmark reference stable
// across renders so the init useEffect does not fire in an infinite loop.
// ---------------------------------------------------------------------------

const GRAFANA_BENCHMARK: Benchmark = {
  id: 'bench-grafana-1',
  system_under_test_id: 'sys-1',
  test_environment: 'production',
  workload: 'normal',
  source: 'grafana',
  grafana_instance: 'prod-grafana',
  dashboard_label: 'JVM Overview',
  dashboard_id: 7,
  dashboard_uid: 'abc123',
  application_dashboard_id: 'app-dash-id',
  configuration: { panelId: 42, yAxesFormat: 'ms' },
  config_title: 'JVM Overview - Response Time',
  evaluate_type: 'avg',
  requirement_operator: 'lt',
  requirement_value: 500,
  enabled: true,
  valid: true,
  tags: ['perf'],
  panel_title: 'Response Time',
  exclude_ramp_up_time: true,
  metric_name: 'http_server_requests_seconds',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const DYNATRACE_BENCHMARK: Benchmark = {
  id: 'bench-dyn-1',
  system_under_test_id: 'sys-1',
  test_environment: 'production',
  workload: 'normal',
  source: 'dynatrace',
  configuration: {},
  config_title: 'Error Rate Dashboard - Error Rate (%)',
  evaluate_type: 'avg',
  requirement_operator: 'lt',
  requirement_value: 5,
  enabled: true,
  valid: true,
  tags: [],
  exclude_ramp_up_time: true,
  metric_name: 'Error Rate',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const PERCENTUNIT_BENCHMARK: Benchmark = {
  ...GRAFANA_BENCHMARK,
  id: 'bench-percentunit',
  requirement_value: 0.95,
  configuration: { panelId: 1, yAxesFormat: 'percentunit' },
};

const NO_DASHBOARD_LABEL_BENCHMARK: Benchmark = {
  ...GRAFANA_BENCHMARK,
  id: 'bench-no-label',
  dashboard_label: undefined,
  config_title: 'Derived Label - Panel Name',
};

const NO_LABELS_BENCHMARK: Benchmark = {
  ...GRAFANA_BENCHMARK,
  id: 'bench-no-labels',
  dashboard_label: undefined,
  config_title: undefined,
  panel_title: undefined,
  metric_name: undefined,
};

const NO_GRAFANA_INSTANCE_BENCHMARK: Benchmark = {
  ...GRAFANA_BENCHMARK,
  id: 'bench-no-grafana-inst',
  grafana_instance: undefined,
};

const CUSTOM_SOURCE_BENCHMARK: Benchmark = {
  ...GRAFANA_BENCHMARK,
  id: 'bench-custom',
  source: 'custom',
};

const DYN_NO_CONFIG_TITLE: Benchmark = {
  ...DYNATRACE_BENCHMARK,
  id: 'bench-dyn-no-title',
  config_title: undefined,
  panel_title: undefined,
  metric_name: undefined,
  dashboard_label: undefined,
};

// This benchmark has a config_title whose first segment matches a real dashboard,
// but whose second segment is absent — forcing metric lookup by metric_name.
const DYN_METRIC_NAME_FALLBACK: Benchmark = {
  ...DYNATRACE_BENCHMARK,
  id: 'bench-dyn-metric-fallback',
  // config_title with only one segment → split gives ['Perf Dashboard'] → no panel title extracted
  config_title: 'Perf Dashboard',
  metric_name: 'Error Rate (%)',
};

// Stable props objects — created once so benchmark reference never changes
const BASE_CONTEXT = { systemId: 'sys-1', systemName: 'My System', environment: 'production', workload: 'normal' };

const GRAFANA_PROPS: UseEditSLOFormProps = { open: true, benchmark: GRAFANA_BENCHMARK, ...BASE_CONTEXT };
const DYNATRACE_PROPS: UseEditSLOFormProps = { open: true, benchmark: DYNATRACE_BENCHMARK, ...BASE_CONTEXT };
const PERCENTUNIT_PROPS: UseEditSLOFormProps = { open: true, benchmark: PERCENTUNIT_BENCHMARK, ...BASE_CONTEXT };
const CUSTOM_SOURCE_PROPS: UseEditSLOFormProps = { open: true, benchmark: CUSTOM_SOURCE_BENCHMARK, ...BASE_CONTEXT };
const CLOSED_PROPS: UseEditSLOFormProps = { open: false, benchmark: GRAFANA_BENCHMARK, ...BASE_CONTEXT };
const NULL_BENCHMARK_PROPS: UseEditSLOFormProps = { open: true, benchmark: null, ...BASE_CONTEXT };

// ---------------------------------------------------------------------------
// Default mock setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthFetch.mockResolvedValue(makeResponse([]));
  mockFetchDynatraceDashboards.mockResolvedValue([]);
  mockFetchDynatraceMetrics.mockResolvedValue([]);
});

// ===========================================================================
// 1. Synthetic Grafana dashboard and panel on init
//    One renderHook — all field assertions share the same instance.
// ===========================================================================

describe('Synthetic Grafana dashboard and panel on init', () => {
  it('selectedDashboard is non-null, selectedPanel is non-null, and isFormValid returns true', async () => {
    // Arrange
    const { result, unmount } = renderHook(() => useEditSLOForm(GRAFANA_PROPS));

    // Act — wait for the init effect
    await waitFor(() => expect(result.current.sloFormData.selectedDashboard).not.toBeNull());

    // Assert — dashboard fields
    expect(result.current.sloFormData.selectedDashboard).not.toBeNull();
    expect(result.current.sloFormData.selectedDashboard.dashboard_label).toBe('JVM Overview');
    expect(result.current.sloFormData.selectedDashboard.dashboard_uid).toBe('abc123');
    expect(result.current.sloFormData.selectedDashboard.id).toBe('app-dash-id');
    expect(result.current.sloFormData.selectedDashboard.dashboard_id).toBe(7);
    expect(result.current.sloFormData.selectedDashboard.grafanaInstance).toEqual({ label: 'prod-grafana' });

    // Assert — panel fields
    expect(result.current.sloFormData.selectedPanel).not.toBeNull();
    expect(result.current.sloFormData.selectedPanel.id).toBe(42);
    expect(result.current.sloFormData.selectedPanel.title).toBe('Response Time');
    expect(result.current.sloFormData.selectedPanel.type).toBe('timeseries');
    expect(result.current.sloFormData.selectedPanel.yAxesFormat).toBe('ms');

    // Assert — the Save button regression guard
    expect(isFormValid('sys-1', 'production', 'normal', result.current.sloFormData)).toBe(true);

    unmount();
  });
});

// ===========================================================================
// 2. Synthetic Dynatrace dashboard and panel on init
// ===========================================================================

describe('Synthetic Dynatrace dashboard and panel on init', () => {
  it('selectedDashboard and selectedPanel are non-null with correct fields, isFormValid returns true', async () => {
    // Arrange
    const { result, unmount } = renderHook(() => useEditSLOForm(DYNATRACE_PROPS));

    // Act
    await waitFor(() => expect(result.current.sloFormData.selectedDashboard).not.toBeNull());

    // Assert — dashboard
    expect(result.current.sloFormData.selectedDashboard.dashboardLabel).toBe('Error Rate Dashboard');

    // Assert — panel
    expect(result.current.sloFormData.selectedPanel).not.toBeNull();
    expect(result.current.sloFormData.selectedPanel.panelTitle).toBe('Error Rate (%)');

    // Assert — Save button regression guard
    expect(isFormValid('sys-1', 'production', 'normal', result.current.sloFormData)).toBe(true);

    unmount();
  });
});

// ===========================================================================
// 3. Custom/unknown source — uses the Grafana branch
// ===========================================================================

describe('Custom source synthetic objects', () => {
  it('should produce non-null synthetic dashboard and panel, and isFormValid is true', async () => {
    const { result, unmount } = renderHook(() => useEditSLOForm(CUSTOM_SOURCE_PROPS));

    await waitFor(() => expect(result.current.sloFormData.selectedDashboard).not.toBeNull());

    expect(result.current.sloFormData.selectedDashboard).not.toBeNull();
    expect(result.current.sloFormData.selectedPanel).not.toBeNull();
    // Grafana branch sets dashboard_label not dashboardLabel
    expect(result.current.sloFormData.selectedDashboard.dashboard_label).toBeTruthy();
    expect(isFormValid('sys-1', 'production', 'normal', result.current.sloFormData)).toBe(true);

    unmount();
  });
});

// ===========================================================================
// 4. dashboard_label derived from config_title
// ===========================================================================

describe('dashboard_label fallback from config_title', () => {
  it('should derive dashboard_label from first segment of config_title when dashboard_label is absent', async () => {
    const props: UseEditSLOFormProps = {
      open: true,
      benchmark: NO_DASHBOARD_LABEL_BENCHMARK,
      ...BASE_CONTEXT,
    };
    const { result, unmount } = renderHook(() => useEditSLOForm(props));

    await waitFor(() => expect(result.current.sloFormData.selectedDashboard).not.toBeNull());

    expect(result.current.sloFormData.selectedDashboard.dashboard_label).toBe('Derived Label');
    unmount();
  });

  it('should default dashboard_label to "Dashboard" when all label sources are absent', async () => {
    const props: UseEditSLOFormProps = {
      open: true,
      benchmark: NO_LABELS_BENCHMARK,
      ...BASE_CONTEXT,
    };
    const { result, unmount } = renderHook(() => useEditSLOForm(props));

    await waitFor(() => expect(result.current.sloFormData.selectedDashboard).not.toBeNull());

    expect(result.current.sloFormData.selectedDashboard.dashboard_label).toBe('Dashboard');
    unmount();
  });

  it('should default panel title to "Metric" when all name sources are absent', async () => {
    const props: UseEditSLOFormProps = {
      open: true,
      benchmark: NO_LABELS_BENCHMARK,
      ...BASE_CONTEXT,
    };
    const { result, unmount } = renderHook(() => useEditSLOForm(props));

    await waitFor(() => expect(result.current.sloFormData.selectedPanel).not.toBeNull());

    expect(result.current.sloFormData.selectedPanel.title).toBe('Metric');
    unmount();
  });

  it('should set grafanaInstance to undefined when grafana_instance is absent', async () => {
    const props: UseEditSLOFormProps = {
      open: true,
      benchmark: NO_GRAFANA_INSTANCE_BENCHMARK,
      ...BASE_CONTEXT,
    };
    const { result, unmount } = renderHook(() => useEditSLOForm(props));

    await waitFor(() => expect(result.current.sloFormData.selectedDashboard).not.toBeNull());

    expect(result.current.sloFormData.selectedDashboard.grafanaInstance).toBeUndefined();
    unmount();
  });
});

// ===========================================================================
// 5. Dynatrace label/title fallbacks
// ===========================================================================

describe('Dynatrace label/title fallbacks', () => {
  it('should default dashboardLabel and panelTitle to "Dashboard"/"Metric" when all sources absent', async () => {
    const props: UseEditSLOFormProps = {
      open: true,
      benchmark: DYN_NO_CONFIG_TITLE,
      ...BASE_CONTEXT,
    };
    const { result, unmount } = renderHook(() => useEditSLOForm(props));

    await waitFor(() => expect(result.current.sloFormData.selectedDashboard).not.toBeNull());

    expect(result.current.sloFormData.selectedDashboard.dashboardLabel).toBe('Dashboard');
    expect(result.current.sloFormData.selectedPanel.panelTitle).toBe('Metric');
    unmount();
  });
});

// ===========================================================================
// 6. Percentunit conversion on init
// ===========================================================================

describe('Percentunit conversion on init', () => {
  it('should convert requirement_value 0.95 to "95" when yAxesFormat is percentunit', async () => {
    const { result, unmount } = renderHook(() => useEditSLOForm(PERCENTUNIT_PROPS));

    await waitFor(() => expect(result.current.sloFormData.requirementValue).toBe('95'));

    unmount();
  });

  it('should NOT convert requirement_value when format is ms', async () => {
    // GRAFANA_BENCHMARK has yAxesFormat: 'ms' and requirement_value: 500
    const { result, unmount } = renderHook(() => useEditSLOForm(GRAFANA_PROPS));

    await waitFor(() => expect(result.current.sloFormData.requirementValue).toBe('500'));

    unmount();
  });
});

// ===========================================================================
// 7. API URL correctness — ?systemId= not ?system=
// ===========================================================================

describe('API URL correctness', () => {
  it('should call authenticatedFetch with ?systemId= (not ?system=) for Grafana', async () => {
    const { unmount } = renderHook(() => useEditSLOForm(GRAFANA_PROPS));

    await waitFor(() => expect(mockAuthFetch).toHaveBeenCalled());

    const calledUrl = mockAuthFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('systemId=');
    expect(calledUrl).not.toMatch(/[?&]system=[^I]/);
    unmount();
  });

  it('should include systemId value and environment in the fetch URL', async () => {
    const { unmount } = renderHook(() => useEditSLOForm(GRAFANA_PROPS));

    await waitFor(() => expect(mockAuthFetch).toHaveBeenCalled());

    const calledUrl = mockAuthFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('sys-1');
    expect(calledUrl).toContain('production');
    unmount();
  });
});

// ===========================================================================
// 8. Background fetch triggers
// ===========================================================================

describe('Background fetch triggers', () => {
  it('should call authenticatedFetch for Grafana application-dashboards', async () => {
    const { unmount } = renderHook(() => useEditSLOForm(GRAFANA_PROPS));

    await waitFor(() => expect(mockAuthFetch).toHaveBeenCalled());
    unmount();
  });

  it('should call fetchDynatraceDashboards for Dynatrace source', async () => {
    const { unmount } = renderHook(() => useEditSLOForm(DYNATRACE_PROPS));

    await waitFor(() =>
      expect(mockFetchDynatraceDashboards).toHaveBeenCalledWith('sys-1', 'production', 'normal')
    );
    unmount();
  });

  it('should NOT call grafana dashboards fetch when source is dynatrace', async () => {
    const { unmount } = renderHook(() => useEditSLOForm(DYNATRACE_PROPS));

    await waitFor(() => expect(mockFetchDynatraceDashboards).toHaveBeenCalled());

    const grafanaCalls = mockAuthFetch.mock.calls.filter(([url]) =>
      (url as string).includes('/grafana/application-dashboards')
    );
    expect(grafanaCalls).toHaveLength(0);
    unmount();
  });

  it('should NOT call any fetch when open is false', async () => {
    const { unmount } = renderHook(() => useEditSLOForm(CLOSED_PROPS));

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockAuthFetch).not.toHaveBeenCalled();
    expect(mockFetchDynatraceDashboards).not.toHaveBeenCalled();
    unmount();
  });

  it('should NOT call any fetch when benchmark is null', async () => {
    const { unmount } = renderHook(() => useEditSLOForm(NULL_BENCHMARK_PROPS));

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockAuthFetch).not.toHaveBeenCalled();
    expect(mockFetchDynatraceDashboards).not.toHaveBeenCalled();
    unmount();
  });
});

// ===========================================================================
// 9. Upgrade: real Grafana dashboard replaces synthetic on application_dashboard_id match
// ===========================================================================

describe('Upgrade: real Grafana dashboard replaces synthetic', () => {
  it('should replace synthetic with matching real dashboard by application_dashboard_id', async () => {
    const realDashboard = {
      id: 'app-dash-id',            // matches GRAFANA_BENCHMARK.application_dashboard_id
      dashboard_uid: 'abc123',
      dashboard_label: 'JVM Overview (Full)',
    };
    mockAuthFetch.mockResolvedValue(makeResponse([realDashboard]));

    const { result, unmount } = renderHook(() => useEditSLOForm(GRAFANA_PROPS));

    await waitFor(() =>
      expect(result.current.sloFormData.selectedDashboard).toEqual(realDashboard)
    );
    unmount();
  });

  it('should keep synthetic dashboard when no real dashboard matches', async () => {
    mockAuthFetch.mockResolvedValue(
      makeResponse([{ id: 'other-id', dashboard_uid: 'zzz999', dashboard_label: 'Unrelated' }])
    );

    const { result, unmount } = renderHook(() => useEditSLOForm(GRAFANA_PROPS));

    await waitFor(() => expect(result.current.loadingStates.dashboardsLoading).toBe(false));

    expect(result.current.sloFormData.selectedDashboard.dashboard_uid).toBe('abc123');
    unmount();
  });
});

// ===========================================================================
// 10. Upgrade: real Dynatrace dashboard replaces synthetic
// ===========================================================================

describe('Upgrade: real Dynatrace dashboard replaces synthetic', () => {
  it('should replace synthetic when dashboardLabel matches config_title prefix', async () => {
    const realDashboard = { dashboardLabel: 'Error Rate Dashboard', id: 'dyn-1' };
    mockFetchDynatraceDashboards.mockResolvedValue([realDashboard]);

    const { result, unmount } = renderHook(() => useEditSLOForm(DYNATRACE_PROPS));

    await waitFor(() =>
      expect(result.current.sloFormData.selectedDashboard).toEqual(realDashboard)
    );
    unmount();
  });

  it('should fetch Dynatrace metrics for the upgraded dashboard', async () => {
    const realDashboard = { dashboardLabel: 'Error Rate Dashboard' };
    mockFetchDynatraceDashboards.mockResolvedValue([realDashboard]);

    const { unmount } = renderHook(() => useEditSLOForm(DYNATRACE_PROPS));

    await waitFor(() =>
      expect(mockFetchDynatraceMetrics).toHaveBeenCalledWith(
        'sys-1', 'production', 'normal', 'Error Rate Dashboard'
      )
    );
    unmount();
  });
});

// ===========================================================================
// 11. Upgrade: real Dynatrace metrics replace synthetic panel
// ===========================================================================

describe('Upgrade: real Dynatrace metrics replace synthetic panel', () => {
  it('should replace synthetic panel with matching Dynatrace metric by panelTitle', async () => {
    const realDashboard = { dashboardLabel: 'Error Rate Dashboard' };
    const realMetric = { panelTitle: 'Error Rate (%)', metricKey: 'err_rate', id: 'm-1' };
    mockFetchDynatraceDashboards.mockResolvedValue([realDashboard]);
    mockFetchDynatraceMetrics.mockResolvedValue([realMetric]);

    const { result, unmount } = renderHook(() => useEditSLOForm(DYNATRACE_PROPS));

    await waitFor(() =>
      expect(result.current.sloFormData.selectedPanel).toEqual(realMetric)
    );
    unmount();
  });

  it('should match Dynatrace metric by metric_name fallback when config_title has no panel segment', async () => {
    const propsWithMetricName: UseEditSLOFormProps = {
      open: true,
      benchmark: DYN_METRIC_NAME_FALLBACK,
      ...BASE_CONTEXT,
    };
    // DYN_METRIC_NAME_FALLBACK.config_title = 'Perf Dashboard' (single segment)
    // → dashboardLabel = 'Perf Dashboard', no panelTitle extracted from config_title
    // → metric match falls through to metric_name comparison
    const realDashboard = { dashboardLabel: 'Perf Dashboard' };
    // panelTitle matches benchmark.metric_name for the fallback
    const realMetric = { panelTitle: 'Error Rate (%)', id: 'm-2' };
    mockFetchDynatraceDashboards.mockResolvedValue([realDashboard]);
    mockFetchDynatraceMetrics.mockResolvedValue([realMetric]);

    const { result, unmount } = renderHook(() => useEditSLOForm(propsWithMetricName));

    // The panel upgrade is a 3-step async chain:
    // 1. Dynatrace dashboards load → dashboard upgrade
    // 2. Metrics fetch fires for 'Perf Dashboard'
    // 3. Metrics load → panel matched by metric_name
    await waitFor(
      () => expect(result.current.sloFormData.selectedPanel).toEqual(realMetric),
      { timeout: 3000 }
    );
    unmount();
  });
});

// ===========================================================================
// 12. Other form fields populated on init (shared hook instance)
// ===========================================================================

describe('Other form fields populated on init', () => {
  let result: ReturnType<typeof renderHook<ReturnType<typeof useEditSLOForm>, UseEditSLOFormProps>>['result'];
  let unmount: () => void;

  beforeAll(async () => {
    // Use beforeAll so this single hook instance is shared across all "it" blocks
    const rendered = renderHook(() => useEditSLOForm(GRAFANA_PROPS));
    result = rendered.result;
    unmount = rendered.unmount;
    await waitFor(() => expect(result.current.sloFormData.selectedDashboard).not.toBeNull());
  });

  afterAll(() => unmount());

  it('source is set from benchmark.source', () => {
    expect(result.current.sloFormData.source).toBe('grafana');
  });

  it('evaluateType is set from benchmark.evaluate_type', () => {
    expect(result.current.sloFormData.evaluateType).toBe('avg');
  });

  it('requirementOperator is set from benchmark.requirement_operator', () => {
    expect(result.current.sloFormData.requirementOperator).toBe('lt');
  });

  it('tags are set from benchmark.tags', () => {
    expect(result.current.sloFormData.tags).toEqual(['perf']);
  });

  it('excludeRampUpTime is true by default', () => {
    expect(result.current.sloFormData.excludeRampUpTime).toBe(true);
  });

  it('showSaveDialog initialises as false', () => {
    expect(result.current.showSaveDialog).toBe(false);
  });

  it('saveDialogOption initialises as "none"', () => {
    expect(result.current.saveDialogOption).toBe('none');
  });

  it('validationErrors initialises as empty object', () => {
    expect(result.current.validationErrors).toEqual({});
  });

  it('availableOptions initialises with empty arrays', () => {
    const { availableOptions } = result.current;
    expect(availableOptions.availableDashboards).toEqual([]);
    expect(availableOptions.availablePanels).toEqual([]);
    expect(availableOptions.availableDynatraceDashboards).toEqual([]);
    expect(availableOptions.availableDynatraceMetrics).toEqual([]);
  });
});

// ===========================================================================
// 13. Return value shape
// ===========================================================================

describe('Return value structure', () => {
  it('should expose all required properties', async () => {
    const { result, unmount } = renderHook(() => useEditSLOForm(GRAFANA_PROPS));

    await waitFor(() => expect(result.current.sloFormData).toBeDefined());

    const expected = [
      'sloFormData', 'setSloFormData', 'validationErrors', 'setValidationErrors',
      'loadingStates', 'availableOptions', 'showSaveDialog', 'setShowSaveDialog',
      'saveDialogOption', 'setSaveDialogOption', 'fetchDashboardPanels',
      'fetchSloApplicationDashboards', 'fetchDynatraceDashboardsForSlo',
      'fetchDynatraceMetricsForSlo',
    ];
    expected.forEach((key) => expect(result.current).toHaveProperty(key));
    unmount();
  });
});

// ===========================================================================
// 14. Manual state updates
// ===========================================================================

describe('Manual state updates', () => {
  it('setSloFormData updates requirementValue', async () => {
    const { result, unmount } = renderHook(() => useEditSLOForm(GRAFANA_PROPS));

    await waitFor(() => expect(result.current.sloFormData.selectedDashboard).not.toBeNull());

    act(() => {
      result.current.setSloFormData((prev) => ({ ...prev, requirementValue: '999' }));
    });

    expect(result.current.sloFormData.requirementValue).toBe('999');
    unmount();
  });

  it('setValidationErrors updates validationErrors', async () => {
    const { result, unmount } = renderHook(() => useEditSLOForm(GRAFANA_PROPS));

    act(() => {
      result.current.setValidationErrors({ requirementValue: 'Too large' });
    });

    expect(result.current.validationErrors.requirementValue).toBe('Too large');
    unmount();
  });
});

// ===========================================================================
// 15. fetchDashboardPanels manual call
// ===========================================================================

describe('fetchDashboardPanels manual call', () => {
  it('should populate availablePanels with supported panel types only', async () => {
    const panelsResponse = [{
      panels: [
        { id: 1, title: 'CPU Usage', type: 'timeseries' },
        { id: 2, title: 'Logs', type: 'logs' },     // unsupported — must be filtered
      ],
    }];
    // First call = application-dashboards empty list, second = panels
    mockAuthFetch
      .mockResolvedValueOnce(makeResponse([]))
      .mockResolvedValueOnce(makeResponse(panelsResponse));

    const { result, unmount } = renderHook(() => useEditSLOForm(GRAFANA_PROPS));

    await waitFor(() => expect(result.current.loadingStates.dashboardsLoading).toBe(false));

    await act(async () => { await result.current.fetchDashboardPanels('uid-xyz'); });

    await waitFor(() => expect(result.current.availableOptions.availablePanels.length).toBe(1));
    expect(result.current.availableOptions.availablePanels[0].title).toBe('CPU Usage');
    unmount();
  });

  it('should not fetch when dashboardUid is empty string', async () => {
    const { result, unmount } = renderHook(() => useEditSLOForm(GRAFANA_PROPS));

    await waitFor(() => expect(result.current.loadingStates.dashboardsLoading).toBe(false));
    mockAuthFetch.mockClear();

    await act(async () => { await result.current.fetchDashboardPanels(''); });

    expect(mockAuthFetch).not.toHaveBeenCalled();
    unmount();
  });

  it('should set availablePanels to empty when fetch returns non-ok response', async () => {
    mockAuthFetch
      .mockResolvedValueOnce(makeResponse([]))
      .mockResolvedValueOnce(makeResponse(null, false));

    const { result, unmount } = renderHook(() => useEditSLOForm(GRAFANA_PROPS));

    await waitFor(() => expect(result.current.loadingStates.dashboardsLoading).toBe(false));

    await act(async () => { await result.current.fetchDashboardPanels('uid-xyz'); });

    expect(result.current.availableOptions.availablePanels).toEqual([]);
    unmount();
  });
});
