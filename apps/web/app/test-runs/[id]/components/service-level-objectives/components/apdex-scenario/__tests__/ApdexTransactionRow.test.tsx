import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { ApdexTransactionRow } from '../ApdexTransactionRow';
import type { ApdexTarget } from '../../../types';

const baseTarget: ApdexTarget = {
  target: 'login',
  value: 0.0,
  threshold_ms: 500,
  satisfied_count: 0,
  tolerating_count: 0,
  frustrated_count: 2,
  total_count: 2,
  avg_response_time_ms: 5000,
};

function renderRow(target: Partial<ApdexTarget>, minSamples?: number) {
  return render(
    <ApdexTransactionRow
      target={{ ...baseTarget, ...target }}
      minSamples={minSamples}
      transactionKey="default::login"
      isExpanded={false}
      isLastRow
      isEvenRow
      defaultThreshold={500}
      scenario="default"
      onToggle={jest.fn()}
      onOpenActionMenu={jest.fn()}
    />,
  );
}

describe('ApdexTransactionRow — result chip', () => {
  it('renders "Too few samples" when the transaction was below the SLO minimum', async () => {
    renderRow({ meets_requirement: null, below_min_samples: true, total_count: 2 }, 50);

    const chip = screen.getByText('Too few');
    expect(chip).toBeInTheDocument();
    expect(screen.queryByText('Pass')).not.toBeInTheDocument();
    expect(screen.queryByText('Fail')).not.toBeInTheDocument();

    // The tooltip explains the sample count so the user knows why there is no verdict
    const user = userEvent.setup();
    await user.hover(chip);
    expect(
      await screen.findByText('Only 2 samples — below the SLO minimum of 50, so not evaluated'),
    ).toBeInTheDocument();
  });

  it('prefers the too-few-samples chip even if a stale meets_requirement is set', () => {
    // Defensive: a target that is below the floor is never a Pass or a Fail
    renderRow({ meets_requirement: false, below_min_samples: true, total_count: 5 });

    expect(screen.getByText('Too few')).toBeInTheDocument();
    expect(screen.queryByText('Fail')).not.toBeInTheDocument();
  });

  it('renders Pass when the transaction met the requirement and had enough samples', () => {
    renderRow({ meets_requirement: true, below_min_samples: false, value: 0.95, total_count: 100 });

    expect(screen.getByText('Pass')).toBeInTheDocument();
    expect(screen.queryByText('Too few')).not.toBeInTheDocument();
  });

  it('renders Fail when the transaction missed the requirement and had enough samples', () => {
    renderRow({ meets_requirement: false, below_min_samples: false, value: 0.4, total_count: 100 });

    expect(screen.getByText('Fail')).toBeInTheDocument();
    expect(screen.queryByText('Too few')).not.toBeInTheDocument();
  });

  it('renders neither chip for a legacy target with no below_min_samples key and a null verdict', () => {
    // Rows written before this feature carry no below_min_samples; null must not become a warning
    renderRow({ meets_requirement: null, total_count: 0 });

    expect(screen.queryByText('Too few')).not.toBeInTheDocument();
    expect(screen.queryByText('Pass')).not.toBeInTheDocument();
    expect(screen.queryByText('Fail')).not.toBeInTheDocument();
  });
});
