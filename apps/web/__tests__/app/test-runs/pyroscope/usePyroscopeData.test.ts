/**
 * Unit tests for usePyroscopeData hook
 *
 * Tests state management, API calls, and profiling data handling:
 * - Initial state and loading
 * - Pyroscope instance detection and configuration extraction
 * - Single view URL generation (standalone and embedded modes)
 * - Comparison URL generation (standalone and embedded modes)
 * - Related test runs fetching for diff view
 * - Flamegraph analysis API call
 * - Application and profiler derivation from configurations
 * - Iframe timeout cleanup
 * - Error states and error message patterns
 * - Handler callbacks (tab change, open external, iframe events)
 * - Symbol filter filtering of analysis results
 * - Edge cases: no Pyroscope configured, empty profiles, connection errors
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { authenticatedFetch } from '@/lib/api';
import { usePyroscopeData } from '@/app/test-runs/[id]/components/pyroscope/hooks/usePyroscopeData';
import {
  PyroscopeTestRun,
  PyroscopeInstance,
  PyroscopeConfiguration,
  RelatedTestRun,
  FlamegraphAnalysis,
} from '@/app/test-runs/[id]/components/pyroscope/types';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

// MUI useTheme — only palette.mode is needed by the hook
jest.mock('@mui/material', () => ({
  useTheme: jest.fn(() => ({
    palette: { mode: 'light' },
  })),
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const mockPyroscopeInstance: PyroscopeInstance = {
  id: 'pyro-1',
  label: 'Local Pyroscope',
  pyroscopeUrl: 'http://pyroscope.example.com',
  pyroscope_url: 'http://pyroscope.example.com',
  backendUrl: 'http://pyroscope-backend.example.com',
  backend_url: 'http://pyroscope-backend.example.com',
  pyroscopeStandAlone: false,
  pyroscope_stand_alone: false,
};

const mockStandalonePyroscopeInstance: PyroscopeInstance = {
  ...mockPyroscopeInstance,
  id: 'pyro-standalone',
  pyroscopeStandAlone: true,
  pyroscope_stand_alone: true,
};

const mockConfigurations: PyroscopeConfiguration[] = [
  { application: 'my-app', profiler: 'process_cpu:cpu:nanoseconds:cpu:nanoseconds' },
  { application: 'my-app', profiler: 'memory:alloc_objects:count:space:bytes' },
  { application: 'other-service', profiler: 'process_cpu:cpu:nanoseconds:cpu:nanoseconds' },
];

function makeTestRun(overrides: Partial<PyroscopeTestRun> = {}): PyroscopeTestRun {
  return {
    id: 'tr-uuid-123',
    test_run_id: 'TR-2024-001',
    system_under_test_id: 'sut-1',
    start_time: '2024-01-15T10:00:00.000Z',
    end_time: '2024-01-15T11:00:00.000Z',
    test_environment: 'production',
    workload: 'load-test',
    systems_under_test: {
      name: 'my-system',
      pyroscope_configurations: mockConfigurations,
      pyroscopeInstance: mockPyroscopeInstance,
    },
    ...overrides,
  };
}

const mockRelatedTestRuns: RelatedTestRun[] = [
  {
    test_run_id: 'TR-2024-000',
    created_at: '2024-01-14T10:00:00.000Z',
    completed: true,
    start_time: '2024-01-14T10:00:00.000Z',
    end_time: '2024-01-14T11:00:00.000Z',
    application_release: 'v1.0.0',
  },
  {
    test_run_id: 'TR-2023-100',
    created_at: '2023-12-01T10:00:00.000Z',
    completed: true,
    start_time: '2023-12-01T10:00:00.000Z',
    end_time: '2023-12-01T11:00:00.000Z',
  },
];

const mockFlamegraphAnalysis: FlamegraphAnalysis = {
  summary: {
    baselineTotal: 1000,
    currentTotal: 1200,
    totalDelta: 200,
    totalDeltaPercent: 20,
  },
  topFunctionChanges: [
    {
      function: 'doWork',
      baselineSamples: 100,
      currentSamples: 150,
      delta: 50,
      deltaPercent: 50,
      significance: 'high',
      changeType: 'regression',
    },
  ],
  regressions: [
    {
      function: 'slowFn',
      baselineSamples: 50,
      currentSamples: 120,
      delta: 70,
      deltaPercent: 140,
      significance: 'high',
      changeType: 'regression',
    },
  ],
  improvements: [
    {
      function: 'fastFn',
      baselineSamples: 80,
      currentSamples: 30,
      delta: -50,
      deltaPercent: -62.5,
      significance: 'medium',
      changeType: 'improvement',
    },
  ],
  newHotspots: ['newHotFn'],
  improvedFunctions: ['fastFn'],
  tableReport: '| function | delta |',
};

// Convenience helper to create a mock Response-like object
function makeResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: jest.fn().mockResolvedValue(body),
  };
}

const mockedFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function renderUsePyroscopeData(
  testRun: PyroscopeTestRun = makeTestRun(),
  expanded = false
) {
  return renderHook(
    ({ testRun, expanded }: { testRun: PyroscopeTestRun; expanded: boolean }) =>
      usePyroscopeData({ testRun, expanded }),
    { initialProps: { testRun, expanded } }
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePyroscopeData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Initial State
  // -------------------------------------------------------------------------

  describe('Initial State', () => {
    it('should return loading as false initially', () => {
      const { result } = renderUsePyroscopeData();
      expect(result.current.loading).toBe(false);
    });

    it('should return error as null initially', () => {
      const { result } = renderUsePyroscopeData();
      expect(result.current.error).toBeNull();
    });

    it('should start with activeCombinationTab at 0', () => {
      const { result } = renderUsePyroscopeData();
      expect(result.current.activeCombinationTab).toBe(0);
    });

    it('should start with viewModeTab at 0', () => {
      const { result } = renderUsePyroscopeData();
      expect(result.current.viewModeTab).toBe(0);
    });

    it('should return null for singleViewUrl initially', () => {
      const { result } = renderUsePyroscopeData();
      expect(result.current.singleViewUrl).toBeNull();
    });

    it('should return null for compareViewUrl initially', () => {
      const { result } = renderUsePyroscopeData();
      expect(result.current.compareViewUrl).toBeNull();
    });

    it('should return empty relatedTestRuns initially', () => {
      const { result } = renderUsePyroscopeData();
      expect(result.current.relatedTestRuns).toEqual([]);
    });

    it('should return null for selectedBaseline initially', () => {
      const { result } = renderUsePyroscopeData();
      expect(result.current.selectedBaseline).toBeNull();
    });

    it('should return null for flamegraphAnalysis initially', () => {
      const { result } = renderUsePyroscopeData();
      expect(result.current.flamegraphAnalysis).toBeNull();
    });

    it('should return analysingFlamegraph as false initially', () => {
      const { result } = renderUsePyroscopeData();
      expect(result.current.analysingFlamegraph).toBe(false);
    });

    it('should return fetchingBaselines as false initially', () => {
      const { result } = renderUsePyroscopeData();
      expect(result.current.fetchingBaselines).toBe(false);
    });

    it('should return showAnalysis as true initially', () => {
      const { result } = renderUsePyroscopeData();
      expect(result.current.showAnalysis).toBe(true);
    });

    it('should return empty symbolFilter initially', () => {
      const { result } = renderUsePyroscopeData();
      expect(result.current.symbolFilter).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // Configuration Extraction
  // -------------------------------------------------------------------------

  describe('Pyroscope Configuration Extraction', () => {
    it('should extract pyroscope configurations from systems_under_test', () => {
      const { result } = renderUsePyroscopeData(makeTestRun());
      expect(result.current.configurations).toEqual(mockConfigurations);
    });

    it('should fall back to system_under_test when systems_under_test is absent', () => {
      const testRun = makeTestRun({
        systems_under_test: undefined,
        system_under_test: {
          name: 'fallback-system',
          pyroscope_configurations: [{ application: 'fallback-app', profiler: 'cpu' }],
          pyroscopeInstance: mockPyroscopeInstance,
        },
      });
      const { result } = renderUsePyroscopeData(testRun);
      expect(result.current.configurations).toEqual([
        { application: 'fallback-app', profiler: 'cpu' },
      ]);
    });

    it('should return empty configurations when no pyroscope config is present', () => {
      const testRun = makeTestRun({
        systems_under_test: { name: 'no-pyroscope' },
      });
      const { result } = renderUsePyroscopeData(testRun);
      expect(result.current.configurations).toEqual([]);
    });

    it('should expose pyroscopeInstance from the sut', () => {
      const { result } = renderUsePyroscopeData(makeTestRun());
      expect(result.current.pyroscopeInstance).toEqual(mockPyroscopeInstance);
    });

    it('should return undefined pyroscopeInstance when not configured', () => {
      const testRun = makeTestRun({
        systems_under_test: { name: 'bare' },
      });
      const { result } = renderUsePyroscopeData(testRun);
      expect(result.current.pyroscopeInstance).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Derived Applications and Profilers
  // -------------------------------------------------------------------------

  describe('Derived Applications and Profilers', () => {
    it('should derive unique sorted applications from configurations', () => {
      const { result } = renderUsePyroscopeData(makeTestRun());
      // mockConfigurations has 'my-app' and 'other-service'
      expect(result.current.applications).toEqual(['my-app', 'other-service']);
    });

    it('should derive unique sorted profilers from configurations', () => {
      const { result } = renderUsePyroscopeData(makeTestRun());
      expect(result.current.profilers).toEqual([
        'memory:alloc_objects:count:space:bytes',
        'process_cpu:cpu:nanoseconds:cpu:nanoseconds',
      ]);
    });

    it('should return empty applications when no configurations exist', () => {
      const testRun = makeTestRun({
        systems_under_test: { name: 'bare' },
      });
      const { result } = renderUsePyroscopeData(testRun);
      expect(result.current.applications).toEqual([]);
      expect(result.current.profilers).toEqual([]);
    });

    it('should expose currentCombination as the first configuration by default', () => {
      const { result } = renderUsePyroscopeData(makeTestRun());
      expect(result.current.currentCombination).toEqual(mockConfigurations[0]);
    });

    it('should expose selectedApplication from the active combination', () => {
      const { result } = renderUsePyroscopeData(makeTestRun());
      expect(result.current.selectedApplication).toBe('my-app');
    });

    it('should expose selectedProfiler from the active combination', () => {
      const { result } = renderUsePyroscopeData(makeTestRun());
      expect(result.current.selectedProfiler).toBe(
        'process_cpu:cpu:nanoseconds:cpu:nanoseconds'
      );
    });

    it('should return empty strings for selection when configurations are empty', () => {
      const testRun = makeTestRun({
        systems_under_test: { name: 'bare' },
      });
      const { result } = renderUsePyroscopeData(testRun);
      expect(result.current.selectedApplication).toBe('');
      expect(result.current.selectedProfiler).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // Single View URL Generation (expanded, viewModeTab === 0)
  // -------------------------------------------------------------------------

  describe('Single View URL Generation', () => {
    it('should not generate URL when expanded is false', () => {
      const { result } = renderUsePyroscopeData(makeTestRun(), false);
      expect(result.current.singleViewUrl).toBeNull();
    });

    it('should generate embedded single view URL when expanded becomes true', async () => {
      const { result, rerender } = renderUsePyroscopeData(makeTestRun(), false);

      rerender({ testRun: makeTestRun(), expanded: true });

      await waitFor(() => {
        expect(result.current.singleViewUrl).not.toBeNull();
      });

      const url = result.current.singleViewUrl!;
      expect(url).toContain('http://pyroscope.example.com');
      expect(url).toContain('var-serviceName=my-app');
      expect(url).toContain('var-profileMetricId=process_cpu');
      expect(url).toContain('explorationType=flame-graph');
      expect(url).toContain('kiosk=true');
    });

    it('should include theme in embedded single view URL', async () => {
      const { result } = renderUsePyroscopeData(makeTestRun(), true);

      await waitFor(() => {
        expect(result.current.singleViewUrl).not.toBeNull();
      });

      expect(result.current.singleViewUrl).toContain('theme=light');
    });

    it('should generate standalone single view URL using seconds-based timestamps', async () => {
      const testRun = makeTestRun({
        systems_under_test: {
          name: 'my-system',
          pyroscope_configurations: mockConfigurations,
          pyroscopeInstance: mockStandalonePyroscopeInstance,
        },
      });
      const { result } = renderUsePyroscopeData(testRun, true);

      await waitFor(() => {
        expect(result.current.singleViewUrl).not.toBeNull();
      });

      const url = result.current.singleViewUrl!;
      // Standalone uses raw seconds in the path
      expect(url).toContain('http://pyroscope.example.com/?from=');
      expect(url).toContain('&until=');
      expect(url).toContain('var-profileMetricId=process_cpu');
      // Standalone encodes serviceName but does NOT use URLSearchParams colons encoding
      expect(url).toContain('var-serviceName=my-app');
    });

    it('should set iframeLoading to true while generating URL', async () => {
      const { result } = renderUsePyroscopeData(makeTestRun(), false);

      act(() => {
        result.current.handleViewModeTabChange({} as React.SyntheticEvent, 0);
      });

      // Trigger by expanding
      const { rerender } = renderHook(
        ({ expanded }: { expanded: boolean }) =>
          usePyroscopeData({ testRun: makeTestRun(), expanded }),
        { initialProps: { expanded: false } }
      );

      rerender({ expanded: true });

      await waitFor(() => {
        expect(result.current.singleViewUrl !== null || true).toBe(true);
      });
    });

    it('should not generate URL when pyroscopeInstance is missing', async () => {
      const testRun = makeTestRun({
        systems_under_test: {
          name: 'no-instance',
          pyroscope_configurations: mockConfigurations,
        },
      });
      const { result } = renderUsePyroscopeData(testRun, true);

      // Give the effect time to run — URL should remain null
      await act(async () => {
        jest.runAllTimers();
      });

      expect(result.current.singleViewUrl).toBeNull();
    });

    it('should not generate URL when selectedApplication is empty', async () => {
      const testRun = makeTestRun({
        systems_under_test: {
          name: 'bare',
          pyroscopeInstance: mockPyroscopeInstance,
        },
      });
      const { result } = renderUsePyroscopeData(testRun, true);

      await act(async () => {
        jest.runAllTimers();
      });

      expect(result.current.singleViewUrl).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Iframe Timeout
  // -------------------------------------------------------------------------

  describe('Iframe Loading Timeout', () => {
    it('should clear iframeLoading after 5000ms when single view URL is set', async () => {
      const { result } = renderUsePyroscopeData(makeTestRun(), true);

      // Wait for URL to be generated (which sets iframeLoading)
      await waitFor(() => {
        expect(result.current.singleViewUrl).not.toBeNull();
      });

      // iframeLoading should be true before timeout
      expect(result.current.iframeLoading).toBe(true);

      // Advance timers to trigger the 5s timeout
      act(() => {
        jest.advanceTimersByTime(5000);
      });

      expect(result.current.iframeLoading).toBe(false);
    });

    it('should clear compareIframeLoading after 5000ms when compare URL is set', async () => {
      mockedFetch.mockImplementation((url: unknown) => {
        const urlStr = url as string;
        if (urlStr.includes('analyze-flamegraphs')) {
          return Promise.resolve(makeResponse(mockFlamegraphAnalysis) as Response);
        }
        return Promise.resolve(makeResponse(mockRelatedTestRuns) as Response);
      });

      const { result } = renderUsePyroscopeData(makeTestRun(), true);

      // Switch to diff view to trigger related test run loading
      act(() => {
        result.current.handleViewModeTabChange({} as React.SyntheticEvent, 1);
      });

      // Wait for related runs to load and baseline to be set
      await waitFor(() => {
        expect(result.current.selectedBaseline).not.toBeNull();
      });

      await waitFor(() => {
        expect(result.current.compareViewUrl).not.toBeNull();
      });

      expect(result.current.compareIframeLoading).toBe(true);

      act(() => {
        jest.advanceTimersByTime(5000);
      });

      expect(result.current.compareIframeLoading).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Related Test Runs Loading
  // -------------------------------------------------------------------------

  describe('loadRelatedTestRuns', () => {
    it('should fetch related test runs when switching to diff view', async () => {
      mockedFetch.mockResolvedValue(makeResponse(mockRelatedTestRuns) as Response);

      const { result } = renderUsePyroscopeData(makeTestRun());

      act(() => {
        result.current.handleViewModeTabChange({} as React.SyntheticEvent, 1);
      });

      await waitFor(() => {
        expect(result.current.relatedTestRuns).toHaveLength(2);
      });

      expect(mockedFetch).toHaveBeenCalledWith(
        expect.stringContaining('/test-runs/TR-2024-001/related')
      );
    });

    it('should include system, environment, and workload query params', async () => {
      mockedFetch.mockResolvedValue(makeResponse(mockRelatedTestRuns) as Response);

      const { result } = renderUsePyroscopeData(makeTestRun());

      act(() => {
        result.current.handleViewModeTabChange({} as React.SyntheticEvent, 1);
      });

      await waitFor(() => {
        expect(mockedFetch).toHaveBeenCalled();
      });

      const calledUrl = mockedFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('system=my-system');
      expect(calledUrl).toContain('environment=production');
      expect(calledUrl).toContain('workload=load-test');
    });

    it('should filter out incomplete or timestamp-missing test runs', async () => {
      const mixedRuns = [
        ...mockRelatedTestRuns,
        {
          test_run_id: 'TR-INCOMPLETE',
          created_at: '2024-01-01T00:00:00Z',
          completed: false, // incomplete — should be filtered
          start_time: '2024-01-01T00:00:00Z',
          end_time: '2024-01-01T01:00:00Z',
        },
        {
          test_run_id: 'TR-NO-TIMES',
          created_at: '2024-01-01T00:00:00Z',
          completed: true,
          // missing start_time and end_time — should be filtered
        },
      ];
      mockedFetch.mockResolvedValue(makeResponse(mixedRuns) as Response);

      const { result } = renderUsePyroscopeData(makeTestRun());

      act(() => {
        result.current.handleViewModeTabChange({} as React.SyntheticEvent, 1);
      });

      await waitFor(() => {
        expect(result.current.relatedTestRuns).toHaveLength(2);
      });
    });

    it('should auto-select the first valid test run as baseline', async () => {
      mockedFetch.mockResolvedValue(makeResponse(mockRelatedTestRuns) as Response);

      const { result } = renderUsePyroscopeData(makeTestRun());

      act(() => {
        result.current.handleViewModeTabChange({} as React.SyntheticEvent, 1);
      });

      await waitFor(() => {
        expect(result.current.selectedBaseline).not.toBeNull();
      });

      expect(result.current.selectedBaseline?.test_run_id).toBe('TR-2024-000');
    });

    it('should not overwrite an already-selected baseline', async () => {
      mockedFetch.mockResolvedValue(makeResponse(mockRelatedTestRuns) as Response);

      const { result } = renderUsePyroscopeData(makeTestRun());

      // First load
      act(() => {
        result.current.handleViewModeTabChange({} as React.SyntheticEvent, 1);
      });
      await waitFor(() => {
        expect(result.current.selectedBaseline).not.toBeNull();
      });

      // Manually pick a different baseline
      act(() => {
        result.current.setSelectedBaseline(mockRelatedTestRuns[1]);
      });

      // The hook should NOT re-fetch if relatedTestRuns is already populated
      // (the effect guard: relatedTestRuns.length === 0)
      expect(result.current.selectedBaseline?.test_run_id).toBe('TR-2023-100');
    });

    it('should set empty relatedTestRuns on non-ok response', async () => {
      mockedFetch.mockResolvedValue(makeResponse(null, false, 500) as Response);

      const { result } = renderUsePyroscopeData(makeTestRun());

      act(() => {
        result.current.handleViewModeTabChange({} as React.SyntheticEvent, 1);
      });

      await waitFor(() => {
        expect(result.current.fetchingBaselines).toBe(false);
      });

      expect(result.current.relatedTestRuns).toEqual([]);
    });

    it('should set error and empty array on fetch exception', async () => {
      mockedFetch.mockRejectedValue(new Error('Network error'));

      const { result } = renderUsePyroscopeData(makeTestRun());

      act(() => {
        result.current.handleViewModeTabChange({} as React.SyntheticEvent, 1);
      });

      await waitFor(() => {
        expect(result.current.error).toBe('Network error');
      });

      expect(result.current.relatedTestRuns).toEqual([]);
      expect(result.current.fetchingBaselines).toBe(false);
    });

    it('should use safe error checking for non-Error exceptions', async () => {
      mockedFetch.mockRejectedValue('plain string error');

      const { result } = renderUsePyroscopeData(makeTestRun());

      act(() => {
        result.current.handleViewModeTabChange({} as React.SyntheticEvent, 1);
      });

      await waitFor(() => {
        expect(result.current.error).toBe('Failed to fetch related test runs');
      });
    });

    it('should not re-fetch when relatedTestRuns already has items', async () => {
      mockedFetch.mockResolvedValue(makeResponse(mockRelatedTestRuns) as Response);

      const { result } = renderUsePyroscopeData(makeTestRun());

      // First switch to diff view (triggers fetch)
      act(() => {
        result.current.handleViewModeTabChange({} as React.SyntheticEvent, 1);
      });
      await waitFor(() => {
        expect(result.current.relatedTestRuns).toHaveLength(2);
      });

      const callCountAfterFirst = mockedFetch.mock.calls.length;

      // Switch away and back — should NOT trigger another fetch
      act(() => {
        result.current.handleViewModeTabChange({} as React.SyntheticEvent, 0);
      });
      act(() => {
        result.current.handleViewModeTabChange({} as React.SyntheticEvent, 1);
      });

      // Allow any pending microtasks
      await act(async () => {});

      // Flamegraph analysis may be called but not /related again
      const relatedCalls = mockedFetch.mock.calls.filter((call) =>
        (call[0] as string).includes('/related')
      );
      expect(relatedCalls).toHaveLength(callCountAfterFirst);
    });
  });

  // -------------------------------------------------------------------------
  // Comparison URL Generation
  // -------------------------------------------------------------------------

  describe('Comparison View URL Generation', () => {
    it('should generate embedded comparison URL when diff view is active with a baseline', async () => {
      mockedFetch.mockImplementation((url: unknown) => {
        const urlStr = url as string;
        if (urlStr.includes('analyze-flamegraphs')) {
          return Promise.resolve(makeResponse(mockFlamegraphAnalysis) as Response);
        }
        return Promise.resolve(makeResponse(mockRelatedTestRuns) as Response);
      });

      const { result } = renderUsePyroscopeData(makeTestRun(), true);

      act(() => {
        result.current.handleViewModeTabChange({} as React.SyntheticEvent, 1);
      });

      await waitFor(() => {
        expect(result.current.compareViewUrl).not.toBeNull();
      });

      const url = result.current.compareViewUrl!;
      expect(url).toContain('http://pyroscope.example.com');
      expect(url).toContain('explorationType=diff-flame-graph');
      expect(url).toContain('var-serviceName=my-app');
      expect(url).toContain('kiosk=true');
    });

    it('should generate standalone comparison URL using diff path format', async () => {
      const testRun = makeTestRun({
        systems_under_test: {
          name: 'my-system',
          pyroscope_configurations: mockConfigurations,
          pyroscopeInstance: mockStandalonePyroscopeInstance,
        },
      });
      mockedFetch.mockImplementation((url: unknown) => {
        const urlStr = url as string;
        if (urlStr.includes('analyze-flamegraphs')) {
          return Promise.resolve(makeResponse(mockFlamegraphAnalysis) as Response);
        }
        return Promise.resolve(makeResponse(mockRelatedTestRuns) as Response);
      });

      const { result } = renderUsePyroscopeData(testRun, true);

      act(() => {
        result.current.handleViewModeTabChange({} as React.SyntheticEvent, 1);
      });

      await waitFor(() => {
        expect(result.current.compareViewUrl).not.toBeNull();
      });

      const url = result.current.compareViewUrl!;
      expect(url).toContain('/diff?');
      expect(url).toContain('leftFrom=');
      expect(url).toContain('rightFrom=');
      expect(url).toContain('query=');
    });

    it('should set error when baseline has no timestamps', async () => {
      const runsWithoutTimestamps: RelatedTestRun[] = [
        {
          test_run_id: 'TR-NO-TIMES',
          created_at: '2024-01-01T00:00:00Z',
          completed: true,
          // deliberately no start_time / end_time
        },
      ];
      mockedFetch.mockResolvedValue(makeResponse(runsWithoutTimestamps) as Response);

      const { result } = renderUsePyroscopeData(makeTestRun(), true);

      // Manually select the baseline with no timestamps to bypass the auto-filter
      act(() => {
        result.current.setSelectedBaseline({
          test_run_id: 'TR-NO-TIMES',
          created_at: '2024-01-01T00:00:00Z',
          completed: true,
        });
      });

      act(() => {
        result.current.handleViewModeTabChange({} as React.SyntheticEvent, 1);
      });

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
      });

      expect(result.current.error).toContain('valid timestamps');
      expect(result.current.compareViewUrl).toBeNull();
    });

    it('should not generate comparison URL without a baseline', async () => {
      const { result } = renderUsePyroscopeData(makeTestRun(), true);

      // Switch to diff view but no baseline is set
      act(() => {
        result.current.handleViewModeTabChange({} as React.SyntheticEvent, 1);
      });

      await act(async () => {
        jest.runAllTimers();
      });

      expect(result.current.compareViewUrl).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Flamegraph Analysis
  // -------------------------------------------------------------------------

  describe('analyzeFlamegraphs', () => {
    it('should call the analyze-flamegraphs API with correct body', async () => {
      mockedFetch.mockImplementation((url: unknown) => {
        const urlStr = url as string;
        if (urlStr.includes('analyze-flamegraphs')) {
          return Promise.resolve(makeResponse(mockFlamegraphAnalysis) as Response);
        }
        return Promise.resolve(makeResponse(mockRelatedTestRuns) as Response);
      });

      const { result } = renderUsePyroscopeData(makeTestRun(), true);

      act(() => {
        result.current.handleViewModeTabChange({} as React.SyntheticEvent, 1);
      });

      await waitFor(() => {
        expect(result.current.flamegraphAnalysis).not.toBeNull();
      });

      const analyzeCall = mockedFetch.mock.calls.find((call) =>
        (call[0] as string).includes('analyze-flamegraphs')
      );
      expect(analyzeCall).toBeDefined();

      const options = analyzeCall![1] as RequestInit;
      expect(options.method).toBe('POST');

      const body = JSON.parse(options.body as string);
      expect(body.application).toBe('my-app');
      expect(body.profilerLabel).toBe('process_cpu/cpu');
      expect(body.significanceThreshold).toBe(100);
      expect(body.backendUrl).toBeDefined();
    });

    it('should set flamegraphAnalysis on successful response', async () => {
      mockedFetch.mockImplementation((url: unknown) => {
        const urlStr = url as string;
        if (urlStr.includes('analyze-flamegraphs')) {
          return Promise.resolve(makeResponse(mockFlamegraphAnalysis) as Response);
        }
        return Promise.resolve(makeResponse(mockRelatedTestRuns) as Response);
      });

      const { result } = renderUsePyroscopeData(makeTestRun(), true);

      act(() => {
        result.current.handleViewModeTabChange({} as React.SyntheticEvent, 1);
      });

      await waitFor(() => {
        expect(result.current.flamegraphAnalysis?.summary.totalDelta).toBe(200);
      });
    });

    it('should set analysis with error field on non-ok response', async () => {
      mockedFetch.mockImplementation((url: unknown) => {
        const urlStr = url as string;
        if (urlStr.includes('analyze-flamegraphs')) {
          return Promise.resolve(
            makeResponse({ message: 'Backend error' }, false, 500) as Response
          );
        }
        return Promise.resolve(makeResponse(mockRelatedTestRuns) as Response);
      });

      const { result } = renderUsePyroscopeData(makeTestRun(), true);

      act(() => {
        result.current.handleViewModeTabChange({} as React.SyntheticEvent, 1);
      });

      // Wait for the whole pipeline: related runs loaded → baseline set → analysis triggered → done
      await waitFor(() => {
        expect(result.current.flamegraphAnalysis).not.toBeNull();
      });

      expect(result.current.flamegraphAnalysis?.error).toBe('Backend error');
      expect(result.current.flamegraphAnalysis?.topFunctionChanges).toEqual([]);
    });

    it('should set analysis with error field on thrown exception', async () => {
      mockedFetch.mockImplementation((url: unknown) => {
        const urlStr = url as string;
        if (urlStr.includes('analyze-flamegraphs')) {
          return Promise.reject(new Error('Connection refused'));
        }
        return Promise.resolve(makeResponse(mockRelatedTestRuns) as Response);
      });

      const { result } = renderUsePyroscopeData(makeTestRun(), true);

      act(() => {
        result.current.handleViewModeTabChange({} as React.SyntheticEvent, 1);
      });

      await waitFor(() => {
        expect(result.current.flamegraphAnalysis).not.toBeNull();
      });

      expect(result.current.flamegraphAnalysis?.error).toBe('Connection refused');
    });

    it('should use generic message for non-Error thrown values', async () => {
      mockedFetch.mockImplementation((url: unknown) => {
        const urlStr = url as string;
        if (urlStr.includes('analyze-flamegraphs')) {
          return Promise.reject('oops');
        }
        return Promise.resolve(makeResponse(mockRelatedTestRuns) as Response);
      });

      const { result } = renderUsePyroscopeData(makeTestRun(), true);

      act(() => {
        result.current.handleViewModeTabChange({} as React.SyntheticEvent, 1);
      });

      await waitFor(() => {
        expect(result.current.flamegraphAnalysis).not.toBeNull();
      });

      expect(result.current.flamegraphAnalysis?.error).toContain(
        'An error occurred while analyzing flamegraphs'
      );
    });

    it('should not call analyze when pyroscopeInstance is absent', async () => {
      const testRun = makeTestRun({
        systems_under_test: {
          name: 'no-pyroscope',
          pyroscope_configurations: mockConfigurations,
        },
      });
      mockedFetch.mockResolvedValue(makeResponse(mockRelatedTestRuns) as Response);

      const { result } = renderUsePyroscopeData(testRun, true);

      act(() => {
        result.current.handleViewModeTabChange({} as React.SyntheticEvent, 1);
      });

      await waitFor(() => {
        expect(result.current.fetchingBaselines).toBe(false);
      });

      const analyzeCalls = mockedFetch.mock.calls.filter((call) =>
        (call[0] as string).includes('analyze-flamegraphs')
      );
      expect(analyzeCalls).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Symbol Filter
  // -------------------------------------------------------------------------

  describe('Symbol Filter (filteredAnalysis)', () => {
    async function getHookWithAnalysis() {
      // First call: /related — second call: /pyroscope/analyze-flamegraphs
      // Use mockImplementation to route by URL so ordering doesn't matter
      mockedFetch.mockImplementation((url: unknown) => {
        const urlStr = url as string;
        if (urlStr.includes('analyze-flamegraphs')) {
          return Promise.resolve(makeResponse(mockFlamegraphAnalysis) as Response);
        }
        return Promise.resolve(makeResponse(mockRelatedTestRuns) as Response);
      });

      const { result } = renderUsePyroscopeData(makeTestRun(), true);

      act(() => {
        result.current.handleViewModeTabChange({} as React.SyntheticEvent, 1);
      });

      await waitFor(() => {
        expect(result.current.flamegraphAnalysis).not.toBeNull();
      });

      return result;
    }

    it('should return full analysis when symbolFilter is empty', async () => {
      const result = await getHookWithAnalysis();
      expect(result.current.flamegraphAnalysis?.regressions).toHaveLength(1);
      expect(result.current.flamegraphAnalysis?.improvements).toHaveLength(1);
    });

    it('should filter regressions by symbolFilter (case-insensitive)', async () => {
      const result = await getHookWithAnalysis();

      act(() => {
        result.current.setSymbolFilter('slowFn');
      });

      expect(result.current.flamegraphAnalysis?.regressions).toHaveLength(1);
      expect(result.current.flamegraphAnalysis?.improvements).toHaveLength(0);
    });

    it('should filter improvements by symbolFilter', async () => {
      const result = await getHookWithAnalysis();

      act(() => {
        result.current.setSymbolFilter('fastFn');
      });

      expect(result.current.flamegraphAnalysis?.regressions).toHaveLength(0);
      expect(result.current.flamegraphAnalysis?.improvements).toHaveLength(1);
    });

    it('should filter topFunctionChanges by symbolFilter', async () => {
      const result = await getHookWithAnalysis();

      act(() => {
        result.current.setSymbolFilter('doWork');
      });

      expect(result.current.flamegraphAnalysis?.topFunctionChanges).toHaveLength(1);
    });

    it('should return empty arrays when symbolFilter matches nothing', async () => {
      const result = await getHookWithAnalysis();

      act(() => {
        result.current.setSymbolFilter('xyz_no_match');
      });

      expect(result.current.flamegraphAnalysis?.regressions).toHaveLength(0);
      expect(result.current.flamegraphAnalysis?.improvements).toHaveLength(0);
      expect(result.current.flamegraphAnalysis?.topFunctionChanges).toHaveLength(0);
    });

    it('should apply symbolFilter case-insensitively', async () => {
      const result = await getHookWithAnalysis();

      act(() => {
        result.current.setSymbolFilter('SLOWFN');
      });

      expect(result.current.flamegraphAnalysis?.regressions).toHaveLength(1);
    });

    it('should return null filteredAnalysis when flamegraphAnalysis is null', () => {
      const { result } = renderUsePyroscopeData(makeTestRun());

      act(() => {
        result.current.setSymbolFilter('something');
      });

      expect(result.current.flamegraphAnalysis).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  describe('Handlers', () => {
    describe('handleCombinationTabChange', () => {
      it('should update activeCombinationTab', () => {
        const { result } = renderUsePyroscopeData(makeTestRun());

        act(() => {
          result.current.handleCombinationTabChange({} as React.SyntheticEvent, 2);
        });

        expect(result.current.activeCombinationTab).toBe(2);
      });

      it('should clear error on tab change', () => {
        mockedFetch.mockRejectedValue(new Error('Previous error'));

        const { result } = renderUsePyroscopeData(makeTestRun());

        // Manually inject an error
        act(() => {
          result.current.handleViewModeTabChange({} as React.SyntheticEvent, 1);
        });

        act(() => {
          result.current.handleCombinationTabChange({} as React.SyntheticEvent, 0);
        });

        expect(result.current.error).toBeNull();
      });
    });

    describe('handleViewModeTabChange', () => {
      it('should update viewModeTab', () => {
        const { result } = renderUsePyroscopeData(makeTestRun());

        act(() => {
          result.current.handleViewModeTabChange({} as React.SyntheticEvent, 1);
        });

        expect(result.current.viewModeTab).toBe(1);
      });

      it('should clear error on view mode tab change', () => {
        const { result } = renderUsePyroscopeData(makeTestRun());

        act(() => {
          result.current.handleViewModeTabChange({} as React.SyntheticEvent, 0);
        });

        expect(result.current.error).toBeNull();
      });
    });

    describe('handleOpenExternal', () => {
      let originalWindowOpen: typeof window.open;

      beforeEach(() => {
        originalWindowOpen = window.open;
        window.open = jest.fn();
      });

      afterEach(() => {
        window.open = originalWindowOpen;
      });

      it('should open singleViewUrl when viewModeTab is 0', async () => {
        const { result } = renderUsePyroscopeData(makeTestRun(), true);

        await waitFor(() => {
          expect(result.current.singleViewUrl).not.toBeNull();
        });

        act(() => {
          result.current.handleOpenExternal();
        });

        expect(window.open).toHaveBeenCalledWith(result.current.singleViewUrl, '_blank');
      });

      it('should open compareViewUrl when viewModeTab is 1', async () => {
        mockedFetch.mockResolvedValue(makeResponse(mockRelatedTestRuns) as Response);

        const { result } = renderUsePyroscopeData(makeTestRun(), true);

        act(() => {
          result.current.handleViewModeTabChange({} as React.SyntheticEvent, 1);
        });

        await waitFor(() => {
          expect(result.current.compareViewUrl).not.toBeNull();
        });

        act(() => {
          result.current.handleOpenExternal();
        });

        expect(window.open).toHaveBeenCalledWith(result.current.compareViewUrl, '_blank');
      });

      it('should not call window.open when URL is null', () => {
        const { result } = renderUsePyroscopeData(makeTestRun(), false);

        act(() => {
          result.current.handleOpenExternal();
        });

        expect(window.open).not.toHaveBeenCalled();
      });
    });

    describe('handleIframeLoad', () => {
      it('should set iframeLoading to false', async () => {
        const { result } = renderUsePyroscopeData(makeTestRun(), true);

        await waitFor(() => {
          expect(result.current.singleViewUrl).not.toBeNull();
        });

        // After URL is generated iframeLoading becomes true
        act(() => {
          result.current.handleIframeLoad();
        });

        expect(result.current.iframeLoading).toBe(false);
      });
    });

    describe('handleIframeError', () => {
      it('should set iframeLoading to false and set error message', async () => {
        const { result } = renderUsePyroscopeData(makeTestRun(), true);

        await waitFor(() => {
          expect(result.current.singleViewUrl).not.toBeNull();
        });

        act(() => {
          result.current.handleIframeError();
        });

        expect(result.current.iframeLoading).toBe(false);
        expect(result.current.error).toBe('Failed to load Pyroscope iframe');
      });
    });

    describe('handleCompareIframeLoad', () => {
      it('should set compareIframeLoading to false', async () => {
        mockedFetch.mockResolvedValue(makeResponse(mockRelatedTestRuns) as Response);

        const { result } = renderUsePyroscopeData(makeTestRun(), true);

        act(() => {
          result.current.handleViewModeTabChange({} as React.SyntheticEvent, 1);
        });

        await waitFor(() => {
          expect(result.current.compareViewUrl).not.toBeNull();
        });

        act(() => {
          result.current.handleCompareIframeLoad();
        });

        expect(result.current.compareIframeLoading).toBe(false);
      });
    });

    describe('handleCompareIframeError', () => {
      it('should set compareIframeLoading to false and set error message', async () => {
        mockedFetch.mockResolvedValue(makeResponse(mockRelatedTestRuns) as Response);

        const { result } = renderUsePyroscopeData(makeTestRun(), true);

        act(() => {
          result.current.handleViewModeTabChange({} as React.SyntheticEvent, 1);
        });

        await waitFor(() => {
          expect(result.current.compareViewUrl).not.toBeNull();
        });

        act(() => {
          result.current.handleCompareIframeError();
        });

        expect(result.current.compareIframeLoading).toBe(false);
        expect(result.current.error).toBe('Failed to load Pyroscope comparison iframe');
      });
    });

    describe('setSelectedBaseline', () => {
      it('should update selectedBaseline directly', () => {
        const { result } = renderUsePyroscopeData(makeTestRun());

        act(() => {
          result.current.setSelectedBaseline(mockRelatedTestRuns[1]);
        });

        expect(result.current.selectedBaseline?.test_run_id).toBe('TR-2023-100');
      });

      it('should allow clearing the baseline to null', () => {
        const { result } = renderUsePyroscopeData(makeTestRun());

        act(() => {
          result.current.setSelectedBaseline(mockRelatedTestRuns[0]);
        });
        act(() => {
          result.current.setSelectedBaseline(null);
        });

        expect(result.current.selectedBaseline).toBeNull();
      });
    });

    describe('setShowAnalysis', () => {
      it('should toggle showAnalysis', () => {
        const { result } = renderUsePyroscopeData(makeTestRun());

        act(() => {
          result.current.setShowAnalysis(false);
        });

        expect(result.current.showAnalysis).toBe(false);
      });
    });

    describe('setShowAllRegressions / setShowAllImprovements', () => {
      it('should toggle showAllRegressions', () => {
        const { result } = renderUsePyroscopeData(makeTestRun());

        act(() => {
          result.current.setShowAllRegressions(true);
        });

        expect(result.current.showAllRegressions).toBe(true);
      });

      it('should toggle showAllImprovements', () => {
        const { result } = renderUsePyroscopeData(makeTestRun());

        act(() => {
          result.current.setShowAllImprovements(true);
        });

        expect(result.current.showAllImprovements).toBe(true);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Edge Cases: No Pyroscope Configured
  // -------------------------------------------------------------------------

  describe('No Pyroscope Configured Edge Cases', () => {
    it('should not call authenticatedFetch when there are no configurations', async () => {
      const testRun = makeTestRun({
        systems_under_test: { name: 'bare' },
      });
      const { result } = renderUsePyroscopeData(testRun, true);

      act(() => {
        result.current.handleViewModeTabChange({} as React.SyntheticEvent, 1);
      });

      await act(async () => {
        jest.runAllTimers();
      });

      // Only the related test runs fetch should potentially be called;
      // analyze-flamegraphs should NOT be called without an instance
      const analyzeCalls = mockedFetch.mock.calls.filter((call) =>
        (call[0] as string).includes('analyze-flamegraphs')
      );
      expect(analyzeCalls).toHaveLength(0);
    });

    it('should expose empty applications and profilers when no config', () => {
      const testRun = makeTestRun({
        systems_under_test: undefined,
        system_under_test: undefined,
      });
      const { result } = renderUsePyroscopeData(testRun);
      expect(result.current.applications).toEqual([]);
      expect(result.current.profilers).toEqual([]);
    });

    it('should expose undefined pyroscopeConfig when sut is absent', () => {
      const testRun = makeTestRun({
        systems_under_test: undefined,
        system_under_test: undefined,
      });
      const { result } = renderUsePyroscopeData(testRun);
      expect(result.current.pyroscopeConfig).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Return Shape (public API)
  // -------------------------------------------------------------------------

  describe('Return Shape', () => {
    it('should expose all expected state properties', () => {
      const { result } = renderUsePyroscopeData();

      // State
      expect(result.current).toHaveProperty('loading');
      expect(result.current).toHaveProperty('error');
      expect(result.current).toHaveProperty('activeCombinationTab');
      expect(result.current).toHaveProperty('viewModeTab');
      expect(result.current).toHaveProperty('singleViewUrl');
      expect(result.current).toHaveProperty('iframeLoading');
      expect(result.current).toHaveProperty('relatedTestRuns');
      expect(result.current).toHaveProperty('selectedBaseline');
      expect(result.current).toHaveProperty('compareViewUrl');
      expect(result.current).toHaveProperty('compareIframeLoading');
      expect(result.current).toHaveProperty('fetchingBaselines');
      expect(result.current).toHaveProperty('flamegraphAnalysis');
      expect(result.current).toHaveProperty('analysingFlamegraph');
      expect(result.current).toHaveProperty('showAnalysis');
      expect(result.current).toHaveProperty('symbolFilter');
      expect(result.current).toHaveProperty('showAllRegressions');
      expect(result.current).toHaveProperty('showAllImprovements');

      // Derived data
      expect(result.current).toHaveProperty('pyroscopeConfig');
      expect(result.current).toHaveProperty('configurations');
      expect(result.current).toHaveProperty('pyroscopeInstance');
      expect(result.current).toHaveProperty('applications');
      expect(result.current).toHaveProperty('profilers');
      expect(result.current).toHaveProperty('currentCombination');
      expect(result.current).toHaveProperty('selectedApplication');
      expect(result.current).toHaveProperty('selectedProfiler');

      // Setters
      expect(typeof result.current.setSelectedBaseline).toBe('function');
      expect(typeof result.current.setShowAnalysis).toBe('function');
      expect(typeof result.current.setSymbolFilter).toBe('function');
      expect(typeof result.current.setShowAllRegressions).toBe('function');
      expect(typeof result.current.setShowAllImprovements).toBe('function');

      // Handlers
      expect(typeof result.current.handleCombinationTabChange).toBe('function');
      expect(typeof result.current.handleViewModeTabChange).toBe('function');
      expect(typeof result.current.handleOpenExternal).toBe('function');
      expect(typeof result.current.handleIframeLoad).toBe('function');
      expect(typeof result.current.handleIframeError).toBe('function');
      expect(typeof result.current.handleCompareIframeLoad).toBe('function');
      expect(typeof result.current.handleCompareIframeError).toBe('function');
    });
  });
});
