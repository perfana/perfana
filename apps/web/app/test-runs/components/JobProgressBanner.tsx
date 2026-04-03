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
  // Only show when all filters are active
  if (!systemFilter || !environmentFilter || !workloadFilter) {
    return null;
  }

  // Find a test run in the filtered list to get the system ID
  const sampleTestRun = filteredTestRuns[0];
  const systemUnderTestId = sampleTestRun?.system_under_test_id || sampleTestRun?.systems_under_test?.id;

  if (!systemUnderTestId) {
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
