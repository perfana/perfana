/**
 * Two things v0.2.96.15 made load-bearing in the Edit SLO dialog:
 *
 *  - the new **Enabled** checkbox is the only way to bring a disabled Duplicate clone back to
 *    life, so `enabled` has to be in the PUT payload — including when it is `false`;
 *  - switching an unedited clone on gets a 409 from `uq_benchmarks_active_metric_target`, and
 *    that sentence has to reach `validationErrors.submit` or the Save button looks inert.
 */
import { renderHook, act } from '@testing-library/react';
import { useEditSLOHandlers } from '../useEditSLOHandlers';
import { initialSLOFormData, SLOFormData, UseEditSLOHandlersProps } from '../../types';
import type { Benchmark } from '../../../types';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
import { authenticatedFetch } from '@/lib/api';

const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

const benchmark = {
  id: 'bm-clone',
  application_dashboard_id: 'ad-1',
  config_title: 'Front end - Transaction Error Rate',
} as unknown as Benchmark;

const formData: SLOFormData = {
  ...initialSLOFormData,
  source: 'grafana',
  selectedDashboard: {
    id: 'ad-1',
    dashboard_label: 'Front end',
    dashboard_uid: 'uid-1',
  } as unknown as SLOFormData['selectedDashboard'],
  selectedPanel: { id: 105, title: 'Transaction Error Rate' } as unknown as SLOFormData['selectedPanel'],
  requirementValue: '5',
};

function setup(sloFormData: SLOFormData) {
  const setValidationErrors = jest.fn();
  const props: UseEditSLOHandlersProps = {
    benchmark,
    systemId: 'sut-1',
    environment: 'production',
    workload: 'loadTest',
    sloFormData,
    setSloFormData: jest.fn(),
    validationErrors: {},
    setValidationErrors,
    setSloFormLoading: jest.fn(),
    setShowSaveDialog: jest.fn(),
    saveDialogOption: 'none',
    setSaveDialogOption: jest.fn(),
    onSLOUpdated: jest.fn(),
    onClose: jest.fn(),
  };
  const { result } = renderHook(() => useEditSLOHandlers(props));
  return { result, props, setValidationErrors };
}

/** The last `submit` value the hook pushed through the setState updater. */
function submittedError(setValidationErrors: jest.Mock): string | undefined {
  const updaters = setValidationErrors.mock.calls
    .map((c) => c[0])
    .filter((a): a is (prev: Record<string, string>) => Record<string, string> => typeof a === 'function');
  const last = updaters[updaters.length - 1];
  return last ? last({})?.submit : undefined;
}

const okResponse = () =>
  ({ ok: true, status: 200, json: async () => ({ id: 'bm-clone' }) }) as unknown as Response;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

describe('the Enabled checkbox reaches the server', () => {
  it.each([true, false])('puts enabled=%s in the PUT body', async (enabled) => {
    mockFetch.mockResolvedValue(okResponse());

    const { result } = setup({ ...formData, enabled });
    await act(async () => {
      result.current.handleSaveDialogConfirm('none');
    });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/benchmarks/bm-clone');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toMatchObject({ enabled });
  });

  // A save with saveOption 'none' must issue exactly one request and then close.
  it('closes the dialog on success without triggering a re-evaluation', async () => {
    mockFetch.mockResolvedValue(okResponse());

    const { result, props } = setup({ ...formData, enabled: true });
    await act(async () => {
      result.current.handleSaveDialogConfirm('none');
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(props.onSLOUpdated).toHaveBeenCalledWith({ id: 'bm-clone' });
    expect(props.onClose).toHaveBeenCalled();
  });
});

describe('updateSlo surfaces a server refusal', () => {
  it("shows the 409's own sentence and leaves the dialog open", async () => {
    const message =
      'An enabled SLO for this panel already evaluates the same series with the same aggregation.';
    mockFetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ statusCode: 409, message }),
    } as unknown as Response);

    const { result, props, setValidationErrors } = setup({ ...formData, enabled: true });
    await act(async () => {
      result.current.handleSaveDialogConfirm('none');
    });

    expect(submittedError(setValidationErrors as jest.Mock)).toBe(message);
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onSLOUpdated).not.toHaveBeenCalled();
  });

  it('falls back to a status-bearing sentence when the body is not JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError('not json');
      },
    } as unknown as Response);

    const { result, setValidationErrors } = setup({ ...formData, enabled: true });
    await act(async () => {
      result.current.handleSaveDialogConfirm('none');
    });

    expect(submittedError(setValidationErrors as jest.Mock)).toBe(
      'Failed to update SLO configuration (500)',
    );
  });

  it('reports a thrown network failure', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const { result, setValidationErrors } = setup({ ...formData, enabled: true });
    await act(async () => {
      result.current.handleSaveDialogConfirm('none');
    });

    expect(submittedError(setValidationErrors as jest.Mock)).toBe('Failed to fetch');
  });
});
