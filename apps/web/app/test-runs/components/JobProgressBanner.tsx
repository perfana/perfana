'use client';

import { Box } from '@mui/material';
import { TestRun } from '@/types/test-runs';
import { JobProgressIndicator } from '@/components/job-progress/JobProgressIndicator';

interface JobProgressBannerProps {
  systemFilter: string;
  environmentFilter: string;
  workloadFilter: string;
  filteredTestRuns: TestRun[];
  onCompleted: () => void;
  onFailed: (error: string) => void;
}

/**
 * Job Progress Banner Component
 * Shows progress indicator when all filters are active and a job is running
 */
export function JobProgressBanner({
  systemFilter,
  environmentFilter,
  workloadFilter,
  filteredTestRuns,
  onCompleted,
  onFailed,
}: JobProgressBannerProps) {
  // Always log to verify component renders
  console.log('[JobProgressBanner] Render:', {
    systemFilter,
    environmentFilter,
    workloadFilter,
    filteredTestRunsCount: filteredTestRuns.length,
  });

  // Only show when all filters are active
  if (!systemFilter || !environmentFilter || !workloadFilter) {
    console.log('[JobProgressBanner] Not all filters active, hiding');
    return null;
  }

  // Find a test run in the filtered list to get the system ID
  const sampleTestRun = filteredTestRuns[0];
  const systemUnderTestId = sampleTestRun?.system_under_test_id || sampleTestRun?.systems_under_test?.id;

  console.log('[JobProgressBanner] System ID resolution:', {
    sampleTestRunId: sampleTestRun?.test_run_id,
    system_under_test_id: sampleTestRun?.system_under_test_id,
    systems_under_test_id: sampleTestRun?.systems_under_test?.id,
    resolved: systemUnderTestId,
  });

  if (!systemUnderTestId) {
    console.log('[JobProgressBanner] No systemUnderTestId found');
    return null;
  }

  return (
    <Box sx={{ mb: 2 }}>
      <JobProgressIndicator
        systemUnderTestId={systemUnderTestId}
        testEnvironment={environmentFilter}
        workload={workloadFilter}
        variant="detailed"
        onCompleted={onCompleted}
        onFailed={onFailed}
      />
    </Box>
  );
}
