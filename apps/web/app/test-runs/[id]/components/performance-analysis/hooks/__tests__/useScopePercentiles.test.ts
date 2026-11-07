import { renderHook, waitFor, act } from '@testing-library/react';
import { useScopePercentiles, ScopePercentiles } from '../useScopePercentiles';
import { authenticatedFetch } from '@/lib/api';
import { TransactionStat } from '../../types/performance-analysis.types';

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

const respond = (body: unknown, status = 200) => ({ status, json: async () => body }) as Response;
const figures = (p95: number) => ({ p95_response_time: p95, p99_response_time: p95 + 1 });
const answer = (p95: number) => respond({ overall: figures(p95), by_scenario: [] });

/** A fresh array is what a settled `/transactions` read hands the hook. */
const rows = () => [{ transaction_name: 'checkout' }] as unknown as TransactionStat[];

/** A request the test answers by hand, for ordering. */
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

interface Props {
  selected: string[];
  transactions: TransactionStat[];
  since: number | null;
}

const render = (initial: Partial<Props> = {}) =>
  renderHook(
    ({ selected, transactions, since }: Props) =>
      useScopePercentiles('run-1', true, since, selected, transactions),
    { initialProps: { selected: [], transactions: rows(), since: null, ...initial } },
  );

const overallOf = (scope: ScopePercentiles | null | undefined) => scope?.overall?.p95_response_time;

beforeEach(() => {
  mockFetch.mockReset();
});

describe('what it asks for', () => {
  it('names the whole run when nothing is selected', async () => {
    mockFetch.mockResolvedValue(answer(1));
    render();
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(mockFetch.mock.calls[0][0]).toBe('/test-runs/run-1/transactions/percentiles?excludeRampUp=true');
  });

  it('repeats the selected scenarios and sends No Scenario as an empty value', async () => {
    mockFetch.mockResolvedValue(answer(1));
    render({ selected: ['Check out', 'No Scenario'], since: 5 });
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const url = new URL(mockFetch.mock.calls[0][0] as string, 'http://x');
    expect(url.searchParams.getAll('scenario')).toEqual(['Check out', '']);
    expect(url.searchParams.get('sinceMinutes')).toBe('5');
  });

  it('asks nothing while there are no rows to go with the figures', async () => {
    const { result } = render({ transactions: [] });
    await act(async () => {});
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current).toBeUndefined();
  });
});

describe('what it returns', () => {
  it('is undefined until the answer, then keys each scenario on the label the card groups by', async () => {
    mockFetch.mockResolvedValue(
      respond({
        overall: figures(100),
        by_scenario: [
          { scenario_name: 'Checkout', ...figures(200) },
          { scenario_name: null, ...figures(300) },
        ],
      }),
    );
    const { result } = render();
    expect(result.current).toBeUndefined();

    await waitFor(() => expect(result.current).toBeTruthy());
    expect(overallOf(result.current)).toBe(100);
    expect(result.current?.byScenario.get('Checkout')?.p95_response_time).toBe(200);
    expect(result.current?.byScenario.get('No Scenario')?.p95_response_time).toBe(300);
  });

  it.each([
    ['a rollup still being built', () => respond({ status: 'rollup-pending' }, 202)],
    ['an API older than this client', () => respond({ message: 'Not Found' }, 404)],
    ['a failure', () => respond({ message: 'Boom' }, 500)],
  ])('is null for %s', async (_name, response) => {
    mockFetch.mockResolvedValue(response());
    const { result } = render();
    await waitFor(() => expect(result.current).toBeNull());
  });

  it('is null when the request itself fails', async () => {
    mockFetch.mockRejectedValue(new Error('Failed to fetch'));
    const { result } = render();
    await waitFor(() => expect(result.current).toBeNull());
  });
});

describe('over time', () => {
  it('asks again for each new set of rows, keeping the figure on screen meanwhile', async () => {
    mockFetch.mockResolvedValueOnce(answer(100));
    const { result, rerender } = render();
    await waitFor(() => expect(overallOf(result.current)).toBe(100));

    const next = deferred();
    mockFetch.mockReturnValueOnce(next.promise);
    rerender({ selected: [], transactions: rows(), since: null });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(overallOf(result.current)).toBe(100);

    await act(async () => next.resolve(answer(200)));
    expect(overallOf(result.current)).toBe(200);
  });

  it('does not ask again when the rows did not change', async () => {
    mockFetch.mockResolvedValue(answer(100));
    const transactions = rows();
    const { result, rerender } = render({ transactions });
    await waitFor(() => expect(overallOf(result.current)).toBe(100));

    rerender({ selected: [], transactions, since: null });
    await act(async () => {});
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the last figure when a refresh fails', async () => {
    mockFetch.mockResolvedValueOnce(answer(100));
    const { result, rerender } = render();
    await waitFor(() => expect(overallOf(result.current)).toBe(100));

    mockFetch.mockRejectedValueOnce(new Error('Failed to fetch'));
    rerender({ selected: [], transactions: rows(), since: null });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(overallOf(result.current)).toBe(100);
  });

  it('shows nothing for a new selection until it answers, never the old selection\'s figure', async () => {
    mockFetch.mockResolvedValueOnce(answer(100));
    const transactions = rows();
    const { result, rerender } = render({ transactions });
    await waitFor(() => expect(overallOf(result.current)).toBe(100));

    const next = deferred();
    mockFetch.mockReturnValueOnce(next.promise);
    rerender({ selected: ['Checkout'], transactions, since: null });
    expect(result.current).toBeUndefined();

    await act(async () => next.resolve(answer(200)));
    expect(overallOf(result.current)).toBe(200);
  });

  it('does not carry a figure across a failed new selection', async () => {
    mockFetch.mockResolvedValueOnce(answer(100));
    const transactions = rows();
    const { result, rerender } = render({ transactions });
    await waitFor(() => expect(overallOf(result.current)).toBe(100));

    mockFetch.mockRejectedValueOnce(new Error('Failed to fetch'));
    rerender({ selected: ['Checkout'], transactions, since: null });
    await waitFor(() => expect(result.current).toBeNull());
  });

  it('drops an answer that lands after a newer one', async () => {
    const older = deferred();
    const newer = deferred();
    mockFetch.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const { result, rerender } = render();
    rerender({ selected: [], transactions: rows(), since: null });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

    await act(async () => newer.resolve(answer(200)));
    await act(async () => older.resolve(answer(100)));
    expect(overallOf(result.current)).toBe(200);
  });

  it('still applies an answer overtaken by a newer request, so slow answers cannot starve the tile', async () => {
    const older = deferred();
    const newer = deferred();
    mockFetch.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const { result, rerender } = render();
    rerender({ selected: [], transactions: rows(), since: null });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

    await act(async () => older.resolve(answer(100)));
    expect(overallOf(result.current)).toBe(100);
    await act(async () => newer.resolve(answer(200)));
    expect(overallOf(result.current)).toBe(200);
  });
});
