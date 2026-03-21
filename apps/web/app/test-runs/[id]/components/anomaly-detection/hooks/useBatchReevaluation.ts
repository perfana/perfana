import { TestRun } from '@/types/test-runs';
import { authenticatedFetch } from '@/lib/api';

interface UseBatchReevaluationOptions {
  testRun: TestRun | null;
  testRunId: string;
  showToast: (message: string) => void;
}

export function useBatchReevaluation({ testRun, testRunId, showToast }: UseBatchReevaluationOptions) {
  const triggerBatchReevaluation = async (customBaseTestRunId?: string) => {
    // Use test_run_id (string identifier) from testRun for re-evaluation API
    const baseTestRunId = customBaseTestRunId || testRun?.test_run_id || testRunId;
    if (!testRun?.system_under_test_id || !testRun?.test_environment || !testRun?.workload) {
      console.error('Missing system/environment/workload information for batch re-evaluation');
      showToast('Unable to trigger batch re-evaluation - missing test run information');
      return;
    }

    try {
      // First get the test runs more recent than the base test run
      const testRunsResponse = await authenticatedFetch(
        `/test-runs/test-runs-more-recent-than?systemUnderTestId=${encodeURIComponent(testRun.system_under_test_id)}&testEnvironment=${encodeURIComponent(testRun.test_environment)}&workload=${encodeURIComponent(testRun.workload)}&baseTestRunId=${encodeURIComponent(baseTestRunId)}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!testRunsResponse.ok) {
        console.error('API error getting more recent test runs:', {
          status: testRunsResponse.status,
          statusText: testRunsResponse.statusText,
        });

        if (testRunsResponse.status === 404) {
          // No more recent test runs found - this is expected for the most recent test run
          console.log(`No test runs found more recent than ${baseTestRunId} (this is the most recent)`);
          showToast(`This is the most recent test run - no newer test runs to re-evaluate`);
          return;
        }
        throw new Error(`Failed to get more recent test runs (HTTP ${testRunsResponse.status})`);
      }

      const testRunsData = await testRunsResponse.json();
      const recentTestRunIds = testRunsData.testRunIds || [];

      console.log(`Found ${recentTestRunIds.length} test runs more recent than ${baseTestRunId}:`, recentTestRunIds);

      if (recentTestRunIds.length === 0) {
        showToast(`No test runs found more recent than test run ${baseTestRunId}`);
        return;
      }

      // Trigger batch re-evaluation for all more recent test runs
      const response = await authenticatedFetch('/data/reevaluate/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          testRunIds: recentTestRunIds,
          checks: true,
          adapt: true
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to start batch re-evaluation');
      }

      const result = await response.json();
      console.log('Batch re-evaluation started for recent test runs:', result);

      showToast(`Batch re-evaluation started for ${recentTestRunIds.length} test runs more recent than ${baseTestRunId}`);

    } catch (error) {
      console.error('Failed to trigger batch re-evaluation:', error);
      showToast('Failed to trigger batch re-evaluation');
    }
  };

  return { triggerBatchReevaluation };
}