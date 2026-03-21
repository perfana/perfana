import { TestRun } from '@/types/test-runs';

export interface SnackbarState {
  open: boolean;
  message: string;
}

export interface FilterState {
  system: string;
  environment: string;
  workload: string;
}

export interface TestRunsDataState {
  testRuns: TestRun[];
  loading: boolean;
  error: string | null;
  currentTime: number;
}

export interface SelectionState {
  selectedTestRunIds: Set<string>;
  batchDeleteDialogOpen: boolean;
}

export interface RefreshDialogState {
  open: boolean;
  targetTestRunId: string | null;
}

export interface FilterOptions {
  systems: string[];
  environments: string[];
  workloads: string[];
}
