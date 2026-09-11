import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { JobProgressIndicator } from '@/components/job-progress/JobProgressIndicator';
import type { JobProgress } from '@perfana/shared/types';

const mockUseJobProgress = jest.fn();
jest.mock('@/hooks/useJobProgress', () => ({ useJobProgress: (...args: unknown[]) => mockUseJobProgress(...args) }));

const base: JobProgress = {
  jobId: 'analyze-1', testRunId: 'run-1', systemUnderTestId: 'sut', testEnvironment: 'env', workload: 'wl',
  jobType: 'analyze', stage: 'queued', stageName: 'Queued', stageIndex: 0, totalStages: 0,
  stageProgress: 0, overallProgress: 0, message: 'Queued: waiting for an analysis worker to become free',
  startedAt: new Date().toISOString(), lastProgressAt: new Date().toISOString(), status: 'waiting',
};

function hookState(progress: JobProgress) {
  return {
    progress, isRunning: true, isBlocked: false, isStuck: false, blockingInfo: null, lockInfo: null,
    error: null, loading: false, releaseLock: jest.fn(),
  };
}

describe('JobProgressIndicator queued state', () => {
  it('shows the Queued chip and the queue reason instead of a stage line', () => {
    mockUseJobProgress.mockReturnValue(hookState(base));
    render(<JobProgressIndicator testRunId="run-1" variant="detailed" />);
    expect(screen.getByText('Queued')).toBeInTheDocument();
    expect(screen.getByText(base.message)).toBeInTheDocument();
    expect(screen.queryByText(/Stage 0 of 0/)).not.toBeInTheDocument();
  });

  it('goes back to the stage line once the job is active', () => {
    mockUseJobProgress.mockReturnValue(hookState({ ...base, status: 'active', stage: 'statistics-calculation', stageName: 'Statistics', stageIndex: 6, totalStages: 11, message: 'Statistics (50%)' }));
    render(<JobProgressIndicator testRunId="run-1" variant="detailed" />);
    expect(screen.queryByText('Queued')).not.toBeInTheDocument();
    expect(screen.getByText('Stage 6 of 11: Statistics')).toBeInTheDocument();
  });

  it('modal variant swaps the stage block for the chip and reason', () => {
    mockUseJobProgress.mockReturnValue(hookState(base));
    render(<JobProgressIndicator testRunId="run-1" variant="modal" />);
    expect(screen.getByText('Queued')).toBeInTheDocument();
    expect(screen.getByText(base.message)).toBeInTheDocument();
    expect(screen.queryByText(/Stage 0 of 0/)).not.toBeInTheDocument();
  });

  it('compact variant says Queued instead of 0% and carries the reason in its tooltip', async () => {
    mockUseJobProgress.mockReturnValue(hookState(base));
    render(<JobProgressIndicator testRunId="run-1" variant="compact" />);
    expect(screen.getByText('Queued')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    fireEvent.mouseOver(screen.getByText('Queued'));
    expect(await screen.findByText(base.message)).toBeInTheDocument();
  });

  it('detailed variant shows the hourglass, one copy of the reason, and a warning-coloured bar', () => {
    mockUseJobProgress.mockReturnValue(hookState(base));
    render(<JobProgressIndicator testRunId="run-1" variant="detailed" />);
    expect(screen.getAllByTestId('HourglassEmptyIcon').length).toBeGreaterThanOrEqual(1); // status icon + chip icon
    expect(screen.getAllByText(base.message)).toHaveLength(1);
    expect(screen.getByRole('progressbar')).toHaveClass('MuiLinearProgress-colorWarning');
  });
});
