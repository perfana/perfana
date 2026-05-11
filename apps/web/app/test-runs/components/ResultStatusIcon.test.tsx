import React from 'react';
import { render, screen } from '@testing-library/react';
import { ResultStatusIcon } from './ResultStatusIcon';
import type { TestRun } from '@/types/test-runs';

const baseTestRun: TestRun = {
  id: 'tr-1',
  test_run_id: 'run-001',
  system_under_test_id: 'sut-1',
  test_environment: 'production',
  workload: 'load-test',
  completed: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const activeJobFixture = {
  jobId: 'job-1',
  jobType: 'analyze',
  stage: 'transaction-stats-rollup',
  stageName: 'Transaction stats rollup',
  stageIndex: 4,
  totalStages: 10,
  stageProgress: 50,
  overallProgress: 35,
  startedAt: '2026-01-01T00:00:00Z',
  lastProgressAt: '2026-01-01T00:00:05Z',
};

describe('ResultStatusIcon', () => {
  it('shows spinner when activeJob is set on a completed test run', () => {
    const testRun = {
      ...baseTestRun,
      status: { phase: 'completed' as const, activeJob: activeJobFixture },
      consolidated_result: { passed: true, overall: true },
    } as TestRun;

    render(<ResultStatusIcon testRun={testRun} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('still shows spinner when evaluatingChecks is IN_PROGRESS and activeJob is absent', () => {
    const testRun = {
      ...baseTestRun,
      status: { phase: 'running' as const, evaluatingChecks: 'IN_PROGRESS' as const },
      consolidated_result: { passed: false, overall: false },
    } as TestRun;

    render(<ResultStatusIcon testRun={testRun} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('does NOT show spinner when activeJob is null and no evaluation flags are set', () => {
    const testRun = {
      ...baseTestRun,
      status: { phase: 'completed' as const, activeJob: null },
      consolidated_result: { passed: true, overall: true },
    } as TestRun;

    render(<ResultStatusIcon testRun={testRun} />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
