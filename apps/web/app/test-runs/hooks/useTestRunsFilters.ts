'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authenticatedFetch } from '@/lib/api';
import { TestRun } from '@/types/test-runs';
import { FilterState, FilterOptions } from '../types';
import {
  parseFiltersFromParams,
  getSystemName,
  getEnvironment,
} from '../utils/test-runs-filters';

interface UseTestRunsFiltersProps {
  organizationId?: string | null;
}

export function useTestRunsFilters({ organizationId }: UseTestRunsFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Lazy-init from URL so the state-to-URL sync effect below doesn't wipe
  // incoming ?system=...&environment=...&workload=... params before the
  // URL-to-state effect can run.
  const [systemFilter, setSystemFilter] = useState<string>(() => searchParams?.get('system') || '');
  const [environmentFilter, setEnvironmentFilter] = useState<string>(() => searchParams?.get('environment') || '');
  const [workloadFilter, setWorkloadFilter] = useState<string>(() => searchParams?.get('workload') || '');
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    systems: [],
    environments: [],
    workloads: [],
  });

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

  // Update URL when filters change (guard against redundant replaces)
  useEffect(() => {
    const params = new URLSearchParams();

    if (systemFilter) params.set('system', systemFilter);
    if (environmentFilter) params.set('environment', environmentFilter);
    if (workloadFilter) params.set('workload', workloadFilter);

    const newSearch = params.toString() ? `?${params.toString()}` : '';
    const currentSearch = typeof window !== 'undefined' ? window.location.search : '';

    if (newSearch !== currentSearch) {
      router.replace(`/test-runs${newSearch}`, { scroll: false });
    }
  }, [systemFilter, environmentFilter, workloadFilter, router]);

  // Fetch filter options from the API. The current selections are passed along so
  // each dropdown only lists values that exist in combination with the other
  // selected filters (cascading dropdowns). The current selection of a dropdown is
  // always kept in its own list so it stays visible/switchable.
  const optionsFetchSeq = useRef(0);
  const loadFilterOptions = useCallback(async () => {
    const seq = ++optionsFetchSeq.current;
    try {
      const params = new URLSearchParams();
      if (organizationId) {
        params.set('organizationId', organizationId);
      }
      if (systemFilter) params.set('system', systemFilter);
      if (environmentFilter) params.set('environment', environmentFilter);
      if (workloadFilter) params.set('workload', workloadFilter);
      const url = params.toString()
        ? `/test-runs/filter-options?${params.toString()}`
        : '/test-runs/filter-options';
      const response = await authenticatedFetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        const data = await response.json();
        // Drop out-of-order responses so a slow stale request can't clobber
        // options — checked after the last await so nothing can interleave.
        if (seq !== optionsFetchSeq.current) return;
        const keepSelected = (options: string[], selected: string) =>
          selected && !options.includes(selected) ? [...options, selected] : options;
        setFilterOptions({
          systems: keepSelected(data.systems || [], systemFilter),
          environments: keepSelected(data.environments || [], environmentFilter),
          workloads: keepSelected(data.workloads || [], workloadFilter),
        });
      }
    } catch {
      // Filter options are non-critical; keep whatever we have
    }
  }, [organizationId, systemFilter, environmentFilter, workloadFilter]);

  useEffect(() => {
    loadFilterOptions();
  }, [loadFilterOptions]);

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
    hasActiveFilters,
    resetFilters,
    shareFilters,
    setFiltersFromTestRun,
  };
}
