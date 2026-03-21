import { TestRun } from '@/types/test-runs';
import { authenticatedFetch } from '@/lib/api';

interface UseUpdateAdaptConfigOptions {
  testRun: TestRun | null;
  showToast: (message: string) => void;
  onTestRunUpdate?: (testRun: TestRun) => void;
}

export function useUpdateAdaptConfig({ testRun, showToast, onTestRunUpdate }: UseUpdateAdaptConfigOptions) {
  const updateAdaptConfig = async (
    testRunId: string,
    differencesAccepted: 'ACCEPTED' | 'DENIED' | 'TBD'
  ) => {
    if (!testRun) return;

    try {
      const queryParams = new URLSearchParams();
      if (testRun.system_under_test_id) queryParams.set('systemUnderTestId', testRun.system_under_test_id);
      if (testRun.test_environment) queryParams.set('environment', testRun.test_environment);
      if (testRun.workload) queryParams.set('workload', testRun.workload);

      const response = await authenticatedFetch(
        `/test-runs/${testRunId}/adapt-config?${queryParams.toString()}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ differencesAccepted }),
        }
      );

      if (response.ok) {
        const updatedTestRun = await response.json();
        const message = differencesAccepted === 'DENIED'
          ? 'Marked as regression'
          : differencesAccepted === 'ACCEPTED'
          ? 'Marked as variability'
          : 'Updated successfully';
        showToast(message);

        if (onTestRunUpdate && updatedTestRun) {
          onTestRunUpdate(updatedTestRun);
        }

        return true;
      } else {
        showToast('Failed to update differences acceptance status');
        return false;
      }
    } catch (error) {
      console.error('Error updating adapt config:', error);
      showToast('Error updating differences acceptance status');
      return false;
    }
  };

  return { updateAdaptConfig };
}