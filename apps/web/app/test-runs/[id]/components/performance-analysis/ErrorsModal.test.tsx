/**
 * The overview drill-down no longer renders its own response accordion — it fetches one error
 * instance and hands it to the Error Analysis tab's ErrorDetailsDialog. The details endpoint
 * requires transaction/sampler/url and matches `url` EXACTLY, so the url the list endpoint
 * handed back must go out untouched. Neither a miss nor a failure may be silent: the old
 * accordion only existed when it had content, so an icon that does nothing would be new.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import ErrorsModal from './ErrorsModal';
import { authenticatedFetch } from '@/lib/api';
import type { ErrorDetail } from './error-analysis/types';

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

const errorGroup = {
  error_type: 'HTTP 500',
  response_code: '500',
  response_message: 'Internal Server Error',
  sampler_name: 'HTTP Request',
  // A query string in the URL is what a hand-rolled template builder gets wrong.
  url: 'https://api.example.com/checkout?id=42&token=a b',
  url_hash: null,
  url_pattern: '/checkout',
  count: 3,
  first_occurrence: '2026-01-15T10:00:00.000Z',
  last_occurrence: '2026-01-15T10:05:00.000Z',
  total_requests: 100,
  apdex_score: 0.812,
};

const errorDetail: ErrorDetail = {
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

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
const notOk = () => ({ ok: false, status: 500, json: async () => ({}) }) as Response;

const showToast = jest.fn();

const renderModal = (props: Partial<React.ComponentProps<typeof ErrorsModal>> = {}) =>
  render(
    <ErrorsModal
      open
      onClose={() => {}}
      testRunId="run-1"
      transactionName="checkout"
      showToast={showToast}
      {...props}
    />,
  );

/** The Details icon's accessible name comes from its MUI Tooltip title. */
const detailsButton = () => screen.findByLabelText('View Error Details');

describe('ErrorsModal details drill-down', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    showToast.mockReset();
  });

  it('opens the shared dialog with the fetched instance and sends transaction/sampler/url', async () => {
    mockFetch.mockResolvedValueOnce(ok([errorGroup])).mockResolvedValueOnce(ok([errorDetail]));

    renderModal();
    fireEvent.click(await detailsButton());

    expect(await screen.findByText('Error Details')).toBeInTheDocument();

    const requested = mockFetch.mock.calls[1]?.[0] as string;
    const params = new URLSearchParams(requested.split('?')[1]);
    expect(requested).toContain('test-runs/run-1/error-analysis/details');
    expect(params.get('transaction')).toBe('checkout');
    expect(params.get('sampler')).toBe('HTTP Request');
    expect(params.get('url')).toBe(errorGroup.url);
  });

  // The whole point of the pending state: the old accordion only existed when it had content, so
  // an icon that looks inert for the length of a round trip would be a regression.
  it('shows the button working while the details fetch is in flight, and re-enables it after', async () => {
    let release: (r: Response) => void = () => {};
    mockFetch
      .mockResolvedValueOnce(ok([errorGroup]))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { release = resolve; }));

    renderModal();
    fireEvent.click(await detailsButton());

    const pending = await screen.findByLabelText('View Error Details');
    expect(within(pending).getByRole('progressbar')).toBeInTheDocument();
    expect(pending).toBeDisabled();

    await act(async () => {
      release(ok([errorDetail]));
    });

    expect(await screen.findByText('Error Details')).toBeInTheDocument();
    expect(await detailsButton()).toBeEnabled();
  });

  it('says so, rather than nothing, when the run holds no instance of that error', async () => {
    mockFetch.mockResolvedValueOnce(ok([errorGroup])).mockResolvedValueOnce(ok([]));

    renderModal();
    fireEvent.click(await detailsButton());

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('No stored occurrence found for this error'),
    );
    expect(screen.queryByText('Error Details')).not.toBeInTheDocument();
  });

  it('reports a failed details fetch and leaves the table intact', async () => {
    mockFetch.mockResolvedValueOnce(ok([errorGroup])).mockResolvedValueOnce(notOk());

    renderModal();
    fireEvent.click(await detailsButton());

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Could not load error details'));
    expect(screen.queryByText('Error Details')).not.toBeInTheDocument();
    // The drill-down's failure is not the table's own error state.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(await detailsButton()).toBeEnabled();
  });

  it('reports a rejected request the same way as a not-ok response', async () => {
    mockFetch
      .mockResolvedValueOnce(ok([errorGroup]))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    renderModal();
    fireEvent.click(await detailsButton());

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Could not load error details'));
    expect(await detailsButton()).toBeEnabled();
  });

  // fetchErrorDetails coerces a non-array body to [], so a malformed response reads as "no
  // occurrence" rather than opening an empty dialog on details[0] === undefined.
  it('treats a response that is not an array as no occurrence', async () => {
    mockFetch.mockResolvedValueOnce(ok([errorGroup])).mockResolvedValueOnce(ok({ message: 'nope' }));

    renderModal();
    fireEvent.click(await detailsButton());

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('No stored occurrence found for this error'),
    );
    expect(screen.queryByText('Error Details')).not.toBeInTheDocument();
  });

  it('names the occurrence count, because the row is an aggregate and the dialog is one sample', async () => {
    mockFetch.mockResolvedValueOnce(ok([errorGroup])).mockResolvedValueOnce(ok([errorDetail]));

    renderModal();
    fireEvent.click(await detailsButton());

    // Deliberately not "latest of this row": the details lookup keys only on
    // transaction/sampler/url, so it may return a sibling row's occurrence.
    expect(
      await screen.findByText('One of 3 occurrences on this sampler and URL'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Latest of/)).not.toBeInTheDocument();
  });

  it('clears the selected error on close, so a second row opens fresh', async () => {
    mockFetch.mockResolvedValueOnce(ok([errorGroup])).mockResolvedValue(ok([errorDetail]));

    renderModal();
    fireEvent.click(await detailsButton());

    const dialog = (await screen.findByText('Error Details')).closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    // selectedError going null unmounts the dialog outright — it renders nothing without one.
    await waitFor(() => expect(screen.queryByText('Error Details')).not.toBeInTheDocument());

    fireEvent.click(await detailsButton());
    expect(await screen.findByText('Error Details')).toBeInTheDocument();
  });

  it('offers no details button when no transaction name was passed', async () => {
    mockFetch.mockResolvedValueOnce(ok([errorGroup]));

    renderModal({ transactionName: undefined });

    await screen.findByText('HTTP Request');
    expect(screen.queryByLabelText('View Error Details')).not.toBeInTheDocument();
  });
});
