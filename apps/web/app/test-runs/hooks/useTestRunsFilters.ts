'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { TestRun } from '@/types/test-runs';
import { FilterState, FilterOptions } from '../types';
import {
  filterTestRuns,
  sortTestRunsByEndTime,
  separateTestRuns,
  extractFilterOptions,
  parseFiltersFromParams,
  getSystemName,
  getEnvironment,
} from '../utils/test-runs-filters';

interface UseTestRunsFiltersProps {
  testRuns: TestRun[];
}

export function useTestRunsFilters({ testRuns }: UseTestRunsFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [systemFilter, setSystemFilter] = useState<string>('');
  const [environmentFilter, setEnvironmentFilter] = useState<string>('');
  const [workloadFilter, setWorkloadFilter] = useState<string>('');

  const filters: FilterState = useMemo(() => ({
    system: systemFilter,
    environment: environmentFilter,
    workload: workloadFilter,
  }), [systemFilter, environmentFilter, workloadFilter]);

  // Initialize filters from URL parameters on mount
  useEffect(() => {
    const parsed = parseFiltersFromParams(searchParams);
    setSystemFilter(parsed.system);
    setEnvironmentFilter(parsed.environment);
    setWorkloadFilter(parsed.workload);
  }, [searchParams]);

  // Update URL when filters change
  useEffect(() => {
    const params = new URLSearchParams();

    if (systemFilter) params.set('system', systemFilter);
    if (environmentFilter) params.set('environment', environmentFilter);
    if (workloadFilter) params.set('workload', workloadFilter);

    const newUrl = params.toString() ? `/test-runs?${params.toString()}` : '/test-runs';
    router.replace(newUrl, { scroll: false });
  }, [systemFilter, environmentFilter, workloadFilter, router]);

  // Extract filter options from test runs
  const filterOptions: FilterOptions = useMemo(
    () => extractFilterOptions(testRuns, filters),
    [testRuns, filters]
  );

  // Filter and sort test runs
  const filteredTestRuns = useMemo(() => {
    const filtered = filterTestRuns(testRuns, filters);
    return sortTestRunsByEndTime(filtered);
  }, [testRuns, filters]);

  // Separate running and completed tests
  const { running: runningTestRuns, completed: completedTestRuns } = useMemo(
    () => separateTestRuns(filteredTestRuns),
    [filteredTestRuns]
  );

  const hasActiveFilters = !!(systemFilter || environmentFilter || workloadFilter);

  const resetFilters = () => {
    setSystemFilter('');
    setEnvironmentFilter('');
    setWorkloadFilter('');
  };

  const shareFilters = async (): Promise<boolean> => {
    const currentUrl = window.location.href;
    try {
      await navigator.clipboard.writeText(currentUrl);
      return true;
    } catch (_err) {
      return false;
    }
  };

  // Set filters from a test run
  const setFiltersFromTestRun = (testRun: TestRun) => {
    const systemName = getSystemName(testRun);
    const environment = getEnvironment(testRun);
    const workloadValue = testRun.workload;

    if (systemName) setSystemFilter(systemName);
    if (environment) setEnvironmentFilter(environment);
    if (workloadValue) setWorkloadFilter(workloadValue);
  };

  return {
    systemFilter,
    setSystemFilter,
    environmentFilter,
    setEnvironmentFilter,
    workloadFilter,
    setWorkloadFilter,
    filters,
    filterOptions,
    filteredTestRuns,
    runningTestRuns,
    completedTestRuns,
    hasActiveFilters,
    resetFilters,
    shareFilters,
    setFiltersFromTestRun,
  };
}
