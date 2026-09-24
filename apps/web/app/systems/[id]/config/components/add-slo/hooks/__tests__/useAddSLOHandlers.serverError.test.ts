/**
 * The Add SLO dialog stays open when the POST fails. Before v0.2.96.15 the reason went only
 * to `console.error`, so a 409 from `uq_benchmarks_active_metric_target` looked to the user
 * like the Create button had simply stopped working. These assert that the server's own
 * sentence reaches `validationErrors.submit`, which is what the dialog's Alert renders.
 */
import { renderHook, act } from '@testing-library/react';
import { useAddSLOHandlers } from '../useAddSLOHandlers';
import { initialSLOFormData, SLOFormData, UseAddSLOHandlersProps } from '../../types';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
import { authenticatedFetch } from '@/lib/api';

const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

// A form that passes validateSLOForm, so createSlo actually reaches the network.
const validFormData: SLOFormData = {
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

function setup(formData: SLOFormData = validFormData) {
  const setValidationErrors = jest.fn();
  const props: UseAddSLOHandlersProps = {
    systemId: 'sut-1',
    systemName: 'SUT',
    environment: 'production',
    workload: 'loadTest',
    sloFormData: formData,
    setValidationErrors,
    setSloFormLoading: jest.fn(),
    onSLOCreated: jest.fn(),
    onClose: jest.fn(),
  };
  const { result } = renderHook(() => useAddSLOHandlers(props));
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

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('createSlo surfaces a server refusal', () => {
  it('puts a 409 duplicate-target message into validationErrors.submit and keeps the dialog open', async () => {
    const message =
      'An enabled SLO for this panel already evaluates the same series with the same aggregation.';
    mockFetch.mockResolvedValue({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: async () => ({ statusCode: 409, message }),
    } as unknown as Response);

    const { result, props, setValidationErrors } = setup();
    await act(async () => {
      await result.current.createSlo();
    });

    expect(submittedError(setValidationErrors as jest.Mock)).toBe(message);
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onSLOCreated).not.toHaveBeenCalled();
  });

  it('falls back to a status-bearing sentence when the body is not JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: async () => {
        throw new SyntaxError('not json');
      },
    } as unknown as Response);

    const { setValidationErrors } = setup();
    const { result } = renderHook(() =>
      useAddSLOHandlers({
        systemId: 'sut-1',
        systemName: 'SUT',
        environment: 'production',
        workload: 'loadTest',
        sloFormData: validFormData,
        setValidationErrors,
        setSloFormLoading: jest.fn(),
        onSLOCreated: jest.fn(),
        onClose: jest.fn(),
      }),
    );
    await act(async () => {
      await result.current.createSlo();
    });

    expect(submittedError(setValidationErrors as jest.Mock)).toBe('Failed to create SLO (502)');
  });

  it('reports a thrown network failure rather than swallowing it', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const { result, props, setValidationErrors } = setup();
    await act(async () => {
      await result.current.createSlo();
    });

    expect(submittedError(setValidationErrors as jest.Mock)).toBe('Failed to fetch');
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('closes the dialog and hands the new SLO up on success', async () => {
    const created = { id: 'bm-new' };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => created,
    } as unknown as Response);

    const { result, props } = setup();
    await act(async () => {
      await result.current.createSlo();
    });

    expect(props.onSLOCreated).toHaveBeenCalledWith(created);
    expect(props.onClose).toHaveBeenCalled();
  });

  // The guard in front of the network call: an invalid form must not POST at all, and the
  // whole-object setValidationErrors from validateForm is what clears a stale submit error.
  it('does not call the API when the form is invalid', async () => {
    const { result, setValidationErrors } = setup({ ...validFormData, requirementValue: '' });
    await act(async () => {
      await result.current.createSlo();
    });

    expect(mockFetch).not.toHaveBeenCalled();
    const [firstArg] = (setValidationErrors as jest.Mock).mock.calls[0];
    expect(firstArg).toMatchObject({ requirementValue: expect.any(String) });
  });
});
