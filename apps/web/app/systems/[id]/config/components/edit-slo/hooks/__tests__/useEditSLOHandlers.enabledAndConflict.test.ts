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

function setup(sloFormData: SLOFormData, bm: Benchmark = benchmark) {
  const setValidationErrors = jest.fn();
  const props: UseEditSLOHandlersProps = {
    benchmark: bm,
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

// #720: a no-change save set grafana_instance to 'Default' and prefixed the title with the
// dashboard label. Dashboard and Metric are locked in Edit, so those fields are not sent at all.
describe('fields Edit cannot change are left to the server', () => {
  it.each(['grafana', 'dynatrace'])('omits grafanaInstance, configTitle and panelTitle for a %s SLO', async (source) => {
    mockFetch.mockResolvedValue(okResponse());

    const { result } = setup({ ...formData, source, enabled: true });
    await act(async () => {
      result.current.handleSaveDialogConfirm('none');
    });

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body).not.toHaveProperty('grafanaInstance');
    expect(body).not.toHaveProperty('configTitle');
    expect(body).not.toHaveProperty('panelTitle');
    expect(body).toMatchObject({ requirementValue: '5', applicationDashboardId: expect.any(String) });
  });
});

// Value: protects=the save converts into the form's ONE thresholdUnit and labels the result with
// that same unit, whatever the selected panel object carries; fails_when=updateSlo reads the
// record or the panel for either half again, so the stored number and its label disagree (an SLO
// that always passes or always fails); why_new=v0.2.97.58 converted in the record's unit and
// labelled with the panel's; seam=none; no_claim=how the form decides thresholdUnit (useEditSLOForm
// and adoptPanelUnit tests) and the API copying yAxesFormat into metric_unit (server-side).
describe('the save converts into and labels with thresholdUnit alone', () => {
  async function save(sloFormData: SLOFormData, bm: Benchmark = benchmark) {
    mockFetch.mockResolvedValue(okResponse());
    const { result } = setup(sloFormData, bm);
    await act(async () => {
      result.current.handleSaveDialogConfirm('none');
    });
    return JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
  }
  const panel = (yAxesFormat?: string) =>
    ({ id: 7, title: 'Some panel', yAxesFormat }) as unknown as SLOFormData['selectedPanel'];

  it('stores "0.5s" as 500 when thresholdUnit is ms', async () => {
    const body = await save({ ...formData, selectedPanel: panel('ms'), thresholdUnit: 'ms', requirementValue: '0.5s' });
    expect(body.requirementValue).toBe('500');
    expect(body.configuration).toMatchObject({ yAxesFormat: 'ms', requirement: { value: '500' } });
  });

  // A Grafana panel whose unit changed since the SLO was made: the record (and so thresholdUnit)
  // is ms, the live panel s. Converting in one and labelling with the other mis-scales by 1000x.
  it('labels with thresholdUnit, not the live panel unit, when they differ', async () => {
    const body = await save({ ...formData, selectedPanel: panel('s'), thresholdUnit: 'ms', requirementValue: '0.5s' });
    expect(body.requirementValue).toBe('500');
    expect(body.configuration.yAxesFormat).toBe('ms');
  });

  // A bare number on a percentunit SLO was shown as 0-100 (useEditSLOForm), so it is scaled back.
  // That includes a Duplicate re-pointed at a percentunit panel, whose record was not percentunit.
  it('scales a bare number on a percentunit thresholdUnit back to 0-1', async () => {
    const withMs = { ...benchmark, metric_unit: 'ms' } as unknown as Benchmark;
    const body = await save({ ...formData, selectedPanel: panel('percentunit'), thresholdUnit: 'percentunit', requirementValue: '90' }, withMs);
    expect(body.requirementValue).toBe('0.9');
    expect(body.configuration.yAxesFormat).toBe('percentunit');
  });

  // #719: no thresholdUnit means the value was shown as stored, so a bare 0.9 stays 0.9 even on a
  // percentunit panel (adoptPanelUnit declined the unit because the user had typed over it).
  it('stores a bare number unscaled when there is no thresholdUnit', async () => {
    const body = await save({ ...formData, selectedPanel: panel('percentunit'), requirementValue: '0.9' });
    expect(body.requirementValue).toBe('0.9');
    expect(body.configuration.yAxesFormat).toBeNull();
  });

  // A typed suffix is unambiguous and converts.
  it.each([
    ['90%', 'percentunit', '0.9'],
    ['500ms', 's', '0.5'],
  ])('converts a typed %p into %s', async (requirementValue, thresholdUnit, stored) => {
    const body = await save({ ...formData, selectedPanel: panel(thresholdUnit), thresholdUnit, requirementValue });
    expect(body.requirementValue).toBe(stored);
  });

  // Dynatrace: the synthetic and unmatched metric carry no unit, the record does. The revert of
  // 48646fc6 was this case converting with no unit, "1s" stored as 1 on a ms SLO.
  it('converts a Dynatrace SLO whose metric carries no unit in thresholdUnit', async () => {
    const body = await save({
      ...formData,
      source: 'dynatrace',
      selectedPanel: { panelTitle: 'Response time' } as unknown as SLOFormData['selectedPanel'],
      thresholdUnit: 'ms',
      requirementValue: '1s',
    });
    expect(body.requirementValue).toBe('1000');
    expect(body.configuration.yAxesFormat).toBe('ms');
  });

  // A trend is %/h: nothing converts, but the base unit is kept for a later edit back to avg.
  it('does not convert a trend but keeps its base unit', async () => {
    const body = await save({ ...formData, evaluateType: 'trend', selectedPanel: panel('percentunit'), thresholdUnit: 'percentunit', requirementValue: '5' });
    expect(body.requirementValue).toBe('5');
    expect(body.configuration.yAxesFormat).toBe('percentunit');
  });
});
