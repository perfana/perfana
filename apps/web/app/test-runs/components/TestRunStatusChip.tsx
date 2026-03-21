'use client';

import { Chip } from '@mui/material';
import { TestRun } from '@/types/test-runs';
import { isRecentlyActive } from '../utils';

interface TestRunStatusChipProps {
  testRun: TestRun;
  currentTime?: number;
}

export function TestRunStatusChip({ testRun, currentTime }: TestRunStatusChipProps): JSX.Element {
  const isActive = isRecentlyActive(testRun, currentTime);

  if (testRun.abort) {
    return <Chip label="Aborted" color="error" size="small" />;
  }
  if (testRun.completed) {
    return <Chip label="Completed" color="success" size="small" />;
  }
  if (!testRun.completed && isActive) {
    return <Chip label="Running" color="primary" size="small" />;
  }
  if (!testRun.completed && !isActive) {
    return <Chip label="Stale" color="warning" size="small" />;
  }
  return <Chip label="Running" color="primary" size="small" />;
}
