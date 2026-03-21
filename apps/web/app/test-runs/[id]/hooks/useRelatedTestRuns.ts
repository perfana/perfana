import { useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { authenticatedFetch } from '@/lib/api';
import { TestRun } from '@/types/test-runs';
import { RelatedTestRun } from '../types';

interface UseRelatedTestRunsReturn {
  relatedTestRuns: RelatedTestRun[];
  previousTestRun: RelatedTestRun | undefined;
  nextTestRun: RelatedTestRun | undefined;
  loadRelatedTestRuns: (testRun: TestRun) => Promise<void>;
}

/**
 * Hook for managing related test runs navigation
 */
export function useRelatedTestRuns(testRunId: string): UseRelatedTestRunsReturn {
  const searchParams = useSearchParams();

  const [relatedTestRuns, setRelatedTestRuns] = useState<RelatedTestRun[]>([]);
  const [previousTestRun, setPreviousTestRun] = useState<RelatedTestRun | undefined>();
  const [nextTestRun, setNextTestRun] = useState<RelatedTestRun | undefined>();

  const loadRelatedTestRuns = useCallback(async (testRun: TestRun) => {
    try {
      // Prioritize testRun object data over potentially stale query parameters
      const system = testRun.systems_under_test?.name || searchParams.get('system');
      const environment = testRun.test_environment || searchParams.get('environment');
      const workload = testRun.workload || searchParams.get('workload');

      let url = `/test-runs/${testRunId}/related`;
      if (system && environment && workload) {
        const queryParams = new URLSearchParams({ system, environment, workload });
        url += `?${queryParams.toString()}`;
      }

      const response = await authenticatedFetch(url);
      if (!response.ok) {
        console.warn('Failed to fetch related test runs');
        return;
      }

      const relatedRuns = (await response.json()) as RelatedTestRun[];
      setRelatedTestRuns(relatedRuns);

      // Find previous and next test runs based on created_at timestamps
      const currentTestRunDate = new Date(testRun.created_at);

      // Related test runs are sorted by created_at DESC (newest first)

      // For next test run: find runs newer than current, then get the oldest (chronologically next)
      const newerRuns = relatedRuns.filter(run => new Date(run.created_at) > currentTestRunDate);
      const nextRun = newerRuns.length > 0 ? newerRuns[newerRuns.length - 1] : undefined;

      // For previous test run: find runs older than current, then get the newest (chronologically previous)
      const olderRuns = relatedRuns.filter(run => new Date(run.created_at) < currentTestRunDate);
      const previousRun = olderRuns.length > 0 ? olderRuns[0] : undefined;

      setNextTestRun(nextRun);
      setPreviousTestRun(previousRun);
    } catch (error) {
      console.error('Failed to load related test runs:', error);
    }
  }, [testRunId, searchParams]);

  return {
    relatedTestRuns,
    previousTestRun,
    nextTestRun,
    loadRelatedTestRuns,
  };
}
