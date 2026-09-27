import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  // jsdom ships no clipboard, so a stub installed per-test and never removed would be inherited
  // by every later test in the file.
  const writeText = jest.fn();
  beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
  });

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

  it('copies a field to the clipboard from its label copy button', async () => {
    render(<ErrorDetailsDialog open onClose={() => {}} selectedError={baseError} />);

    fireEvent.click(screen.getByLabelText('Copy url'));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(baseError.url));
  });

  it('gives every field a copy button, named after its label', () => {
    render(<ErrorDetailsDialog open onClose={() => {}} selectedError={baseError} />);

    // The accessible name is derived as `Copy ${label.toLowerCase()}`.
    expect(screen.getByLabelText('Copy transaction')).toBeInTheDocument();
    expect(screen.getByLabelText('Copy sampler')).toBeInTheDocument();
    expect(screen.getByLabelText('Copy response code')).toBeInTheDocument();
    expect(screen.getByLabelText('Copy response time')).toBeInTheDocument();
    expect(screen.getByLabelText('Copy url')).toBeInTheDocument();
  });

  it('names the occurrence when the caller drilled in from an aggregate row', () => {
    const { rerender } = render(
      <ErrorDetailsDialog open onClose={() => {}} selectedError={baseError} />,
    );
    expect(screen.queryByText('Latest of 4,812 occurrences')).not.toBeInTheDocument();

    rerender(
      <ErrorDetailsDialog
        open
        onClose={() => {}}
        selectedError={baseError}
        occurrenceNote="Latest of 4,812 occurrences"
      />,
    );
    expect(screen.getByText('Latest of 4,812 occurrences')).toBeInTheDocument();
  });

  // The screen shows the local format, but the clipboard carries ISO 8601: this value is pasted
  // into Grafana time ranges, SQL predicates and log queries, none of which take toLocaleString().
  it('copies the timestamp as ISO 8601, not the localised string it displays', async () => {
    render(<ErrorDetailsDialog open onClose={() => {}} selectedError={baseError} />);

    expect(
      screen.getByText(new Date(baseError.time).toLocaleString()),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Copy timestamp (ISO 8601)'));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(new Date(baseError.time).toISOString()),
    );
    expect(writeText).not.toHaveBeenCalledWith(new Date(baseError.time).toLocaleString());
  });

  // Response Data is the one field whose copy text is derived, so copy and display can diverge.
  it('copies the response data byte-for-byte as the block renders it', async () => {
    const selectedError: ErrorDetail = { ...baseError, responseData: '{"a":1}' };
    const pretty = '{\n  "a": 1\n}';

    render(<ErrorDetailsDialog open onClose={() => {}} selectedError={selectedError} />);

    // Identity normalizer: the default one collapses the newlines that ARE the formatting.
    expect(screen.getByText(pretty, { normalizer: (t) => t })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Copy response data'));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(pretty));
  });

  it('copies the session variables as the pretty-printed JSON', async () => {
    const selectedError: ErrorDetail = { ...baseError, sessionVariables: { userId: '48213' } };

    render(<ErrorDetailsDialog open onClose={() => {}} selectedError={selectedError} />);

    fireEvent.click(screen.getByLabelText('Copy session variables'));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('{\n  "userId": "48213"\n}'));
  });

  it('omits the session variables section when null', () => {
    render(<ErrorDetailsDialog open onClose={() => {}} selectedError={baseError} />);

    expect(screen.queryByText('Session Variables')).not.toBeInTheDocument();
  });
});
