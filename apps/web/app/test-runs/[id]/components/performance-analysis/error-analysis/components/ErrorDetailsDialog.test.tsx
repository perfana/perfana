import React from 'react';
import { render, screen } from '@testing-library/react';
import { ErrorDetailsDialog } from './ErrorDetailsDialog';
import type { ErrorDetail } from '../types';

const baseError: ErrorDetail = {
  time: '2026-01-15T10:05:30.000Z',
  transactionName: 'checkout',
  samplerName: 'HTTP Request',
  responseCode: '500',
  responseTime: 1234,
  url: 'https://api.example.com/checkout',
  responseMessage: 'Internal Server Error',
  responseData: '',
  requestHeaders: '',
  responseHeaders: '',
  sessionVariables: null,
};

describe('ErrorDetailsDialog', () => {
  it('renders the session variables as key/value rows when present', () => {
    const selectedError: ErrorDetail = {
      ...baseError,
      sessionVariables: { userId: '48213', cartId: 'a1b2-c3d4' },
    };

    render(<ErrorDetailsDialog open onClose={() => {}} selectedError={selectedError} />);

    expect(screen.getByText('Session Variables')).toBeInTheDocument();
    expect(screen.getByText('userId')).toBeInTheDocument();
    expect(screen.getByText('48213')).toBeInTheDocument();
    expect(screen.getByText('cartId')).toBeInTheDocument();
    expect(screen.getByText('a1b2-c3d4')).toBeInTheDocument();
  });

  it('omits the session variables section when the object is empty', () => {
    const selectedError: ErrorDetail = { ...baseError, sessionVariables: {} };

    render(<ErrorDetailsDialog open onClose={() => {}} selectedError={selectedError} />);

    expect(screen.queryByText('Session Variables')).not.toBeInTheDocument();
  });

  it('omits the session variables section when null', () => {
    render(<ErrorDetailsDialog open onClose={() => {}} selectedError={baseError} />);

    expect(screen.queryByText('Session Variables')).not.toBeInTheDocument();
  });
});
