import React from 'react';
import { render, screen } from '@testing-library/react';
import { ErrorSummaryCards } from './ErrorSummaryCards';
import type { ErrorSummary } from '../types';

const baseSummary: ErrorSummary = {
  totalErrors: 12,
  uniqueResponseCodes: 1,
  transactionsWithErrors: 3,
  uniqueErrorUrls: 3,
};

describe('ErrorSummaryCards', () => {
  it('renders the error rate with the request total as its caption', () => {
    render(<ErrorSummaryCards summary={{ ...baseSummary, errorRate: 1.4616, totalRequests: 821 }} />);

    expect(screen.getByText('1.46%')).toBeInTheDocument();
    expect(screen.getByText('of 821 requests')).toBeInTheDocument();
  });

  it('shows N/A when the API did not return an error rate', () => {
    render(<ErrorSummaryCards summary={baseSummary} />);

    expect(screen.getByText('N/A')).toBeInTheDocument();
    // No request total means no caption to hang off the rate tile.
    expect(screen.queryByText(/of .* requests/)).not.toBeInTheDocument();
  });

  it('treats a zero error rate as the non-error case', () => {
    render(<ErrorSummaryCards summary={{ ...baseSummary, errorRate: 0, totalRequests: 500 }} />);

    expect(screen.getByText('0.00%')).toBeInTheDocument();
  });
});
