/**
 * Unit tests for TestRunDataContext
 *
 * Tests the data context provider and hook:
 * - Provider renders children correctly
 * - Hook provides data, loading, and error states
 * - Hook throws error when used outside provider
 * - Context updates propagate correctly
 */

import React from 'react';
import { render, renderHook } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TestRunDataProvider, useTestRunData, CompleteTestRunData } from '@/app/test-runs/[id]/context/TestRunDataContext';
import { TestRun } from '@/types/test-runs';

describe('TestRunDataContext', () => {
  const mockTestRun: TestRun = {
    id: '123',
    test_run_id: 'TR-2024-001',
    system_under_test_id: 'system-123',
    systems_under_test: {
      id: 'system-123',
      name: 'My Application',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
    test_environment: 'production',
    workload: 'load-test-1',
    application_release: 'v1.2.3',
    start_time: '2024-01-15T10:00:00Z',
    end_time: '2024-01-15T11:00:00Z',
    duration: 3600,
    completed: true,
    abort: false,
    tags: [],
    annotations: [],
    consolidated_result: {
      overall: true,
      passed: true,
      meetsRequirement: true,
      adaptTestRunOK: true,
    },
    status: {
      evaluatingChecks: 'COMPLETED',
      evaluatingComparisons: 'COMPLETED',
      evaluatingAdapt: 'COMPLETED',
    },
    valid: true,
    created_at: '2024-01-15T09:00:00Z',
    updated_at: '2024-01-15T11:00:00Z',
  };

  const mockCompleteData: CompleteTestRunData = {
    testRun: mockTestRun,
    relatedTestRuns: [],
    configs: [],
    expectedConfigChanges: [],
    applicationDashboards: [],
    anomalyDetection: null,
    checkResults: null,
  };

  describe('TestRunDataProvider', () => {
    it('should render children correctly', () => {
      const { container } = render(
        <TestRunDataProvider data={mockCompleteData} loading={false} error={null}>
          <div data-testid="child-component">Test Child</div>
        </TestRunDataProvider>
      );

      expect(container.querySelector('[data-testid="child-component"]')).toBeInTheDocument();
      expect(container.textContent).toContain('Test Child');
    });

    it('should render multiple children', () => {
      const { container } = render(
        <TestRunDataProvider data={mockCompleteData} loading={false} error={null}>
          <div data-testid="child-1">Child 1</div>
          <div data-testid="child-2">Child 2</div>
        </TestRunDataProvider>
      );

      expect(container.querySelector('[data-testid="child-1"]')).toBeInTheDocument();
      expect(container.querySelector('[data-testid="child-2"]')).toBeInTheDocument();
    });

    it('should provide data through context', () => {
      const TestComponent = () => {
        const { data } = useTestRunData();
        return <div>{data?.testRun.test_run_id}</div>;
      };

      const { container } = render(
        <TestRunDataProvider data={mockCompleteData} loading={false} error={null}>
          <TestComponent />
        </TestRunDataProvider>
      );

      expect(container.textContent).toContain('TR-2024-001');
    });
  });

  describe('useTestRunData Hook', () => {
    it('should throw error when used outside provider', () => {
      // Suppress console.error for this test
      const originalError = console.error;
      console.error = jest.fn();

      expect(() => {
        renderHook(() => useTestRunData());
      }).toThrow('useTestRunData must be used within a TestRunDataProvider');

      console.error = originalError;
    });

    it('should provide data state when loading is false', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TestRunDataProvider data={mockCompleteData} loading={false} error={null}>
          {children}
        </TestRunDataProvider>
      );

      const { result } = renderHook(() => useTestRunData(), { wrapper });

      expect(result.current.data).toEqual(mockCompleteData);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should provide loading state correctly', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TestRunDataProvider data={null} loading={true} error={null}>
          {children}
        </TestRunDataProvider>
      );

      const { result } = renderHook(() => useTestRunData(), { wrapper });

      expect(result.current.data).toBeNull();
      expect(result.current.loading).toBe(true);
      expect(result.current.error).toBeNull();
    });

    it('should provide error state correctly', () => {
      const errorMessage = 'Failed to fetch test run data';
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TestRunDataProvider data={null} loading={false} error={errorMessage}>
          {children}
        </TestRunDataProvider>
      );

      const { result } = renderHook(() => useTestRunData(), { wrapper });

      expect(result.current.data).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe(errorMessage);
    });

    it('should provide null data when data is null', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TestRunDataProvider data={null} loading={false} error={null}>
          {children}
        </TestRunDataProvider>
      );

      const { result } = renderHook(() => useTestRunData(), { wrapper });

      expect(result.current.data).toBeNull();
    });

    it('should provide access to test run details', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TestRunDataProvider data={mockCompleteData} loading={false} error={null}>
          {children}
        </TestRunDataProvider>
      );

      const { result } = renderHook(() => useTestRunData(), { wrapper });

      expect(result.current.data?.testRun.test_run_id).toBe('TR-2024-001');
      expect(result.current.data?.testRun.system_under_test_id).toBe('system-123');
      expect(result.current.data?.testRun.test_environment).toBe('production');
      expect(result.current.data?.testRun.workload).toBe('load-test-1');
    });

    it('should provide access to related data arrays', () => {
      const dataWithArrays: CompleteTestRunData = {
        ...mockCompleteData,
        relatedTestRuns: [{ id: '456', test_run_id: 'TR-2024-002' }],
        configs: [{ key: 'config1', value: 'value1' }],
        expectedConfigChanges: [{ id: '789', key: 'expected1' }],
        applicationDashboards: [{ id: 'dash-1', name: 'Dashboard 1' }],
      };

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TestRunDataProvider data={dataWithArrays} loading={false} error={null}>
          {children}
        </TestRunDataProvider>
      );

      const { result } = renderHook(() => useTestRunData(), { wrapper });

      expect(result.current.data?.relatedTestRuns).toHaveLength(1);
      expect(result.current.data?.configs).toHaveLength(1);
      expect(result.current.data?.expectedConfigChanges).toHaveLength(1);
      expect(result.current.data?.applicationDashboards).toHaveLength(1);
    });

    it('should provide access to anomaly detection and check results', () => {
      const dataWithAnalytics: CompleteTestRunData = {
        ...mockCompleteData,
        anomalyDetection: { detected: true, score: 0.85 },
        checkResults: { passed: 10, failed: 2 },
      };

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TestRunDataProvider data={dataWithAnalytics} loading={false} error={null}>
          {children}
        </TestRunDataProvider>
      );

      const { result } = renderHook(() => useTestRunData(), { wrapper });

      expect(result.current.data?.anomalyDetection).toEqual({ detected: true, score: 0.85 });
      expect(result.current.data?.checkResults).toEqual({ passed: 10, failed: 2 });
    });
  });

  describe('Context State Updates', () => {
    it('should update when data changes', () => {
      const TestComponent = () => {
        const { data } = useTestRunData();
        return <div>{data?.testRun.test_run_id || 'No ID'}</div>;
      };

      const { container, rerender } = render(
        <TestRunDataProvider data={mockCompleteData} loading={false} error={null}>
          <TestComponent />
        </TestRunDataProvider>
      );

      expect(container.textContent).toContain('TR-2024-001');

      // Update with different test run
      const updatedTestRun = { ...mockTestRun, test_run_id: 'TR-2024-999' };
      const updatedData = { ...mockCompleteData, testRun: updatedTestRun };

      rerender(
        <TestRunDataProvider data={updatedData} loading={false} error={null}>
          <TestComponent />
        </TestRunDataProvider>
      );

      expect(container.textContent).toContain('TR-2024-999');
    });

    it('should update when loading state changes', () => {
      const TestComponent = () => {
        const { loading } = useTestRunData();
        return <div>{loading ? 'Loading' : 'Loaded'}</div>;
      };

      const { container, rerender } = render(
        <TestRunDataProvider data={null} loading={true} error={null}>
          <TestComponent />
        </TestRunDataProvider>
      );

      expect(container.textContent).toContain('Loading');

      rerender(
        <TestRunDataProvider data={mockCompleteData} loading={false} error={null}>
          <TestComponent />
        </TestRunDataProvider>
      );

      expect(container.textContent).toContain('Loaded');
    });

    it('should update when error state changes', () => {
      const TestComponent = () => {
        const { error } = useTestRunData();
        return <div>{error || 'No Error'}</div>;
      };

      const { container, rerender } = render(
        <TestRunDataProvider data={mockCompleteData} loading={false} error={null}>
          <TestComponent />
        </TestRunDataProvider>
      );

      expect(container.textContent).toContain('No Error');

      rerender(
        <TestRunDataProvider data={null} loading={false} error="API Error">
          <TestComponent />
        </TestRunDataProvider>
      );

      expect(container.textContent).toContain('API Error');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty arrays gracefully', () => {
      const emptyData: CompleteTestRunData = {
        testRun: mockTestRun,
        relatedTestRuns: [],
        configs: [],
        expectedConfigChanges: [],
        applicationDashboards: [],
        anomalyDetection: null,
        checkResults: null,
      };

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TestRunDataProvider data={emptyData} loading={false} error={null}>
          {children}
        </TestRunDataProvider>
      );

      const { result } = renderHook(() => useTestRunData(), { wrapper });

      expect(result.current.data?.relatedTestRuns).toEqual([]);
      expect(result.current.data?.configs).toEqual([]);
      expect(result.current.data?.expectedConfigChanges).toEqual([]);
      expect(result.current.data?.applicationDashboards).toEqual([]);
    });

    it('should handle transition from loading to error', () => {
      const TestComponent = () => {
        const { loading, error } = useTestRunData();
        if (loading) return <div>Loading</div>;
        if (error) return <div>Error: {error}</div>;
        return <div>Success</div>;
      };

      const { container, rerender } = render(
        <TestRunDataProvider data={null} loading={true} error={null}>
          <TestComponent />
        </TestRunDataProvider>
      );

      expect(container.textContent).toContain('Loading');

      rerender(
        <TestRunDataProvider data={null} loading={false} error="Network error">
          <TestComponent />
        </TestRunDataProvider>
      );

      expect(container.textContent).toContain('Error: Network error');
    });

    it('should handle transition from error to success', () => {
      const TestComponent = () => {
        const { data, error } = useTestRunData();
        if (error) return <div>Error: {error}</div>;
        if (data) return <div>Success: {data.testRun.test_run_id}</div>;
        return <div>No data</div>;
      };

      const { container, rerender } = render(
        <TestRunDataProvider data={null} loading={false} error="Failed to load">
          <TestComponent />
        </TestRunDataProvider>
      );

      expect(container.textContent).toContain('Error: Failed to load');

      rerender(
        <TestRunDataProvider data={mockCompleteData} loading={false} error={null}>
          <TestComponent />
        </TestRunDataProvider>
      );

      expect(container.textContent).toContain('Success: TR-2024-001');
    });
  });
});
