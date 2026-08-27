import { triggerSloReEvaluation } from './slo-reevaluation';
import { authenticatedFetch } from './api';

jest.mock('./api', () => ({ authenticatedFetch: jest.fn() }));

const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

const ctx = {
  testRunId: 'run-1',
  systemUnderTestId: 'sut-1',
  testEnvironment: 'acc',
  workload: 'load',
};

const jsonResponse = (body: unknown) =>
  ({ ok: true, json: async () => body }) as Response;

describe('triggerSloReEvaluation', () => {
  beforeEach(() => mockFetch.mockReset());

  it('does nothing for "none"', async () => {
    await triggerSloReEvaluation('none', ctx);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('queues only this run for "current"', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}));
    await triggerSloReEvaluation('current', ctx);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe('/data/reevaluate/batch');
    expect(JSON.parse(init!.body as string)).toEqual({
      testRunIds: ['run-1'],
      checks: true,
      adapt: true,
    });
  });

  it('resolves the changepoint window for "all"', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ testRunIds: ['run-1', 'run-2'] }))
      .mockResolvedValueOnce(jsonResponse({}));

    await triggerSloReEvaluation('all', ctx);

    expect(mockFetch.mock.calls[0]![0]).toContain('/test-runs/test-runs-after-changepoint');
    expect(JSON.parse(mockFetch.mock.calls[1]![1]!.body as string).testRunIds).toEqual([
      'run-1',
      'run-2',
    ]);
  });

  it('skips "all" when the workload context is missing', async () => {
    await triggerSloReEvaluation('all', { testRunId: 'run-1' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('swallows failures so a saved threshold is not reported as failed', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));
    await expect(triggerSloReEvaluation('current', ctx)).resolves.toBeUndefined();
  });
});
