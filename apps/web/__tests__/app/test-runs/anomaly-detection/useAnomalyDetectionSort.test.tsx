/**
 * Regression tests for useAnomalyDetection sort behavior.
 *
 * Specifically guards against the bug where handleSortChange called
 * setSortDirection inside a setSortBy updater — React bailed out of
 * re-rendering when sortBy didn't change, so repeated clicks on the
 * same column header had no effect after the first.
 */

import React, { MutableRefObject } from 'react';
import { renderHook, act } from '@testing-library/react';
import { useAnomalyDetection } from '@/app/test-runs/[id]/components/anomaly-detection/hooks/useAnomalyDetection';
import { authenticatedFetch } from '@/lib/api';

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

const baseProps = {
  testRun: null,
  testRunId: 'test-run-1',
  anomalyExpanded: true,
  onAnomalyExpand: jest.fn(),
  conclusionFilter: 'all',
  setConclusionFilter: jest.fn(),
  showToast: jest.fn(),
  cardRef,
};

beforeEach(() => {
  jest.clearAllMocks();
  (authenticatedFetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => [],
    text: async () => '',
  });
});

describe('useAnomalyDetection — handleSortChange', () => {
  it('toggles sort direction on repeated clicks of the same column', async () => {
    const { result } = renderHook(() => useAnomalyDetection(baseProps));

    // First click: sets sortBy and direction to asc
    act(() => { result.current.handleSortChange('difference'); });
    expect(result.current.sortBy).toBe('difference');
    expect(result.current.sortDirection).toBe('asc');

    // Second click on same column: must toggle to desc (was broken before fix)
    act(() => { result.current.handleSortChange('difference'); });
    expect(result.current.sortBy).toBe('difference');
    expect(result.current.sortDirection).toBe('desc');

    // Third click: toggles back to asc
    act(() => { result.current.handleSortChange('difference'); });
    expect(result.current.sortBy).toBe('difference');
    expect(result.current.sortDirection).toBe('asc');
  });

  it('resets to asc when switching to a different column', async () => {
    const { result } = renderHook(() => useAnomalyDetection(baseProps));

    act(() => { result.current.handleSortChange('difference'); });
    act(() => { result.current.handleSortChange('difference'); }); // now desc
    expect(result.current.sortDirection).toBe('desc');

    // Switch to a different column — should reset to asc
    act(() => { result.current.handleSortChange('metric_name'); });
    expect(result.current.sortBy).toBe('metric_name');
    expect(result.current.sortDirection).toBe('asc');
  });

  it('resets page to 0 on sort change', async () => {
    const { result } = renderHook(() => useAnomalyDetection(baseProps));

    act(() => { result.current.setPage(3); });
    expect(result.current.page).toBe(3);

    act(() => { result.current.handleSortChange('difference'); });
    expect(result.current.page).toBe(0);
  });
});
