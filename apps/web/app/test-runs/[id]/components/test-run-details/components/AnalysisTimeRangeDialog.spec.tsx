import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AnalysisTimeRangeDialog } from './AnalysisTimeRangeDialog';
import { authenticatedFetch } from '@/lib/api';
import type { TestRun } from '@/types/test-runs';

/**
 * The "Apply to all test runs of this workload" checkbox.
 *
 * It is the only control that turns a single-run offset edit into a workload-wide
 * write: the API fans the same ramp_up / ramp_down out over every sibling run and
 * re-evaluates all of them. Three failure modes are worth a test:
 *
 *  - the flag never reaching the request body (the edit then applies to one run,
 *    which is exactly the apples-to-oranges comparison the checkbox exists to
 *    prevent — a trimmed run measured against an untrimmed baseline),
 *  - it defaulting to ON, which would silently rewrite a workload's whole history
 *    for a user who only meant to trim the run in front of them, and
 *  - a single click rewriting a workload's history with no statement of how many
 *    runs that is. The dialog now asks the server for the real count and takes a
 *    second, deliberate click before it sends. The single-run path keeps its ONE
 *    click — a confirmation on the common case trains people to click through it.
 */

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

// Recharts needs a measured container, which jsdom never provides. The chart is not
// what this test is about.
jest.mock('recharts', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ComposedChart: Stub,
    Area: Stub,
    Line: Stub,
    XAxis: Stub,
    YAxis: Stub,
    CartesianGrid: Stub,
    Tooltip: Stub,
    ReferenceLine: Stub,
    ReferenceArea: Stub,
    ResponsiveContainer: Stub,
    Legend: Stub,
  };
});

const testRun = {
  id: 'uuid-1',
  test_run_id: 'PerfanaWebshop-acc-loadTest-00018',
  test_environment: 'acc',
  workload: 'loadTest',
  analysis_start_offset: 30,
  analysis_end_offset: 60,
} as unknown as TestRun;

const timeseriesData = {
  duration: 600,
  bucketSizeSeconds: 60,
  buckets: Array.from({ length: 10 }, (_, i) => ({
    timeSeconds: i * 60,
    throughput: 10,
    avgResponseTime: 200,
    errorsPerSecond: 0,
  })),
};

const scopePreview = {
  total: 7,
  applicable: 5,
  skipped: [
    { testRunId: 'run-006', completed: false, skipped: 'running' as const },
    { testRunId: 'run-007', completed: true, skipped: 'too-short' as const },
  ],
};

/** Responses are routed by URL: the preview is a GET, the save is a PUT. */
let saveResponse: { ok: boolean; status?: number; json?: () => Promise<unknown> };
let scopeResponse: { ok: boolean; status?: number; json?: () => Promise<unknown> };

const renderDialog = (overrides?: { onSaved?: jest.Mock }) => {
  const onSaved = overrides?.onSaved ?? jest.fn();
  render(
    <AnalysisTimeRangeDialog
      open
      testRun={testRun}
      timeseriesData={timeseriesData}
      onClose={jest.fn()}
      onSaved={onSaved}
    />,
  );
  return { onSaved };
};

const calls = () => (authenticatedFetch as jest.Mock).mock.calls;
const scopeCalls = () => calls().filter(([url]) => String(url).includes('/analysis-time-range/scope'));
const putCalls = () => calls().filter(([, init]) => (init as { method?: string } | undefined)?.method === 'PUT');
const bodyOfLastPut = (): Record<string, unknown> =>
  JSON.parse((putCalls().at(-1)?.[1] as { body: string }).body);

const checkbox = () => screen.getByRole('checkbox');
// The label flips to "Confirm — change N runs" once the warning is armed.
const saveButton = () => screen.getByRole('button', { name: /save & re-analyse|confirm —/i });
const sliders = () => screen.getAllByRole('slider');

/**
 * The Save button is disabled while the scope preview is in flight, so clicking before
 * it settles is a no-op — and a silent one, which is exactly how these tests would rot
 * into passing for the wrong reason.
 */
const waitForScopeSettled = async () => {
  await waitFor(() => expect(saveButton()).toBeEnabled());
};

beforeEach(() => {
  saveResponse = {
    ok: true,
    json: () => Promise.resolve({ ...testRun, analysis_start_offset: 30, analysis_end_offset: 60 }),
  };
  scopeResponse = { ok: true, json: () => Promise.resolve(scopePreview) };

  (authenticatedFetch as jest.Mock).mockReset();
  (authenticatedFetch as jest.Mock).mockImplementation((url: string) =>
    Promise.resolve(String(url).includes('/analysis-time-range/scope') ? scopeResponse : saveResponse),
  );
});

it('defaults to a single-run edit, so opening and saving cannot rewrite a workload', async () => {
  renderDialog();

  expect(checkbox()).not.toBeChecked();

  fireEvent.click(saveButton());

  // ONE click. The confirmation is for the workload-wide write only; adding it here
  // would train people to click through it.
  await waitFor(() => expect(putCalls()).toHaveLength(1));
  expect(putCalls()[0]![0]).toBe('/test-runs/uuid-1/analysis-time-range');
  expect(bodyOfLastPut()).toEqual({
    analysisStartOffset: 30,
    analysisEndOffset: 60,
    applyToAll: false,
  });
  // A single-run save must not ask the server for a workload preview it never uses.
  expect(scopeCalls()).toHaveLength(0);
});

it('asks the server for the real scope when the box is ticked, for the offsets on screen', async () => {
  renderDialog();

  fireEvent.click(checkbox());

  await waitFor(() => expect(scopeCalls()).toHaveLength(1));
  expect(scopeCalls()[0]![0]).toBe(
    '/test-runs/uuid-1/analysis-time-range/scope?analysisStartOffset=30&analysisEndOffset=60',
  );
});

it('renders the applicable-of-total count the server reported', async () => {
  renderDialog();

  fireEvent.click(checkbox());

  // "every run of this workload" is prose; 5 of 7 is a number the user can act on.
  const line = await screen.findByText(/of 7 runs in acc \/ loadTest/i);
  expect(line.textContent?.replace(/\s+/g, ' ')).toContain('5 of 7 runs');
});

it('says which runs it is leaving alone, and why', async () => {
  renderDialog();

  fireEvent.click(checkbox());

  const line = await screen.findByText(/Leaving 2 unchanged/i);
  const text = line.textContent?.replace(/\s+/g, ' ') ?? '';
  expect(text).toContain('1 still running');
  expect(text).toContain('1 shorter than these offsets');
});

it('does not send anything on the first Save when applyToAll is on', async () => {
  renderDialog();

  fireEvent.click(checkbox());
  await waitForScopeSettled();

  fireEvent.click(saveButton());

  // The first click arms the warning; it must not be the click that rewrites history.
  expect(putCalls()).toHaveLength(0);
  expect(await screen.findByText(/press save again to confirm/i)).toBeInTheDocument();
});

it('sends applyToAll: true on the second Save', async () => {
  const { onSaved } = renderDialog();

  fireEvent.click(checkbox());
  await waitForScopeSettled();

  fireEvent.click(saveButton());
  await screen.findByText(/press save again to confirm/i);
  fireEvent.click(saveButton());

  await waitFor(() => expect(putCalls()).toHaveLength(1));
  expect(bodyOfLastPut()).toEqual({
    analysisStartOffset: 30,
    analysisEndOffset: 60,
    applyToAll: true,
  });
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
});

it('re-arms the confirmation after the box is un-ticked and ticked again', async () => {
  renderDialog();

  fireEvent.click(checkbox());
  await waitForScopeSettled();
  fireEvent.click(saveButton());
  await screen.findByText(/press save again to confirm/i);

  fireEvent.click(checkbox());
  expect(screen.queryByText(/press save again to confirm/i)).not.toBeInTheDocument();

  fireEvent.click(checkbox());
  await waitFor(() => expect(scopeCalls().length).toBeGreaterThan(1));
  await waitForScopeSettled();

  // The user confirmed a specific blast radius before un-ticking. Re-ticking must not
  // inherit that confirmation and turn the next click into a workload-wide write.
  fireEvent.click(saveButton());
  expect(putCalls()).toHaveLength(0);
  expect(await screen.findByText(/press save again to confirm/i)).toBeInTheDocument();
});

it('drops the confirmation when the offsets move, and re-previews the new window', async () => {
  renderDialog();

  fireEvent.click(checkbox());
  await waitForScopeSettled();
  fireEvent.click(saveButton());
  await screen.findByText(/press save again to confirm/i);

  // A different window has a different scope — "too short for these offsets" depends on
  // the offsets — so the count the user agreed to no longer describes what would happen.
  fireEvent.change(sliders()[0]!, { target: { value: '120' } });

  await waitFor(() =>
    expect(scopeCalls().some(([url]) => String(url).includes('analysisStartOffset=120'))).toBe(true),
  );
  await waitForScopeSettled();
  expect(screen.queryByText(/press save again to confirm/i)).not.toBeInTheDocument();

  fireEvent.click(saveButton());
  expect(putCalls()).toHaveLength(0);
});

it('surfaces a failed save instead of reporting success, and keeps the checkbox state', async () => {
  const { onSaved } = renderDialog();
  saveResponse = { ok: false, status: 500 };

  fireEvent.click(checkbox());
  await waitForScopeSettled();
  fireEvent.click(saveButton());
  await screen.findByText(/press save again to confirm/i);
  fireEvent.click(saveButton());

  expect(await screen.findByText(/failed to save analysis time range \(http 500\)/i)).toBeInTheDocument();
  expect(onSaved).not.toHaveBeenCalled();
  // The user can retry without re-ticking — losing the tick here would quietly
  // downgrade the retry to a single-run write.
  expect(checkbox()).toBeChecked();
  expect(saveButton()).toBeEnabled();
});

it('still lets the user proceed when the scope preview fails', async () => {
  renderDialog();
  scopeResponse = { ok: false, status: 500 };

  fireEvent.click(checkbox());

  // A broken preview must not block the write — it is an aid, not a gate.
  expect(await screen.findByText(/could not determine how many runs this affects/i)).toBeInTheDocument();
  fireEvent.click(saveButton());
  expect(putCalls()).toHaveLength(0);
  fireEvent.click(saveButton());
  await waitFor(() => expect(putCalls()).toHaveLength(1));
  expect(bodyOfLastPut()).toMatchObject({ applyToAll: true });
});

it('names the environment and workload it is about to change, so the blast radius is visible', async () => {
  renderDialog();

  // Unticked: the warning is about the comparison spanning two windows.
  expect(screen.getByText(/only this run changes/i)).toBeInTheDocument();

  fireEvent.click(checkbox());

  // Ticked: the affected scope is spelled out rather than left as "all runs".
  expect(await screen.findByText(/in acc \/ loadTest/i)).toBeInTheDocument();
});
