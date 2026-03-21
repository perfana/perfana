import { authenticatedFetch } from '@/lib/api';
import { TestRun } from '@/types/test-runs';

export interface TestRunScope {
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
}

export interface AvailableSources {
  grafana: boolean;
  dynatrace: boolean;
}

/**
 * Extracts the scope (SUT, environment, workload) from a TestRun.
 */
export function getTestRunScope(testRun: TestRun): TestRunScope {
  return {
    systemUnderTestId: testRun.system_under_test_id || (testRun.systems_under_test as any)?.id || '',
    testEnvironment: testRun.test_environment || '',
    workload: testRun.workload || '',
  };
}

/**
 * Fetches which data sources (Grafana, Dynatrace) are configured for the given
 * test run scopes.  On error, returns all-true so the dialog falls back to
 * showing every checkbox (graceful degradation).
 */
export async function fetchAvailableSources(scopes: TestRunScope[]): Promise<AvailableSources> {
  try {
    const response = await authenticatedFetch('/data/refresh/available-sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scopes }),
    });

    if (!response.ok) {
      return { grafana: true, dynatrace: true };
    }

    return await response.json();
  } catch {
    return { grafana: true, dynatrace: true };
  }
}
