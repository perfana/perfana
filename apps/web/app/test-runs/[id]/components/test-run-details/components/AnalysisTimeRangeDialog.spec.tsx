import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AnalysisTimeRangeDialog } from './AnalysisTimeRangeDialog';
import { authenticatedFetch } from '@/lib/api';
import type { TestRun } from '@/types/test-runs';

/**
 * The "Apply to all test runs of this workload" checkbox.
 *
 * It is the only control that turns a single-run offset edit into a workload-wide
 * write: the API fans the same ramp_up / ramp_down out over every sibling run and
 * re-evaluates all of them. Two failure modes are worth a test:
 *
 *  - the flag never reaching the request body (the edit then applies to one run,
 *    which is exactly the apples-to-oranges comparison the checkbox exists to
 *    prevent — a trimmed run measured against an untrimmed baseline), and
 *  - it defaulting to ON, which would silently rewrite a workload's whole history
 *    for a user who only meant to trim the run in front of them.
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

const bodyOfLastRequest = (): Record<string, unknown> => {
  const call = (authenticatedFetch as jest.Mock).mock.calls.at(-1);
  return JSON.parse((call?.[1] as { body: string }).body);
};

const checkbox = () => screen.getByRole('checkbox');
const saveButton = () => screen.getByRole('button', { name: /save & re-analyse/i });

beforeEach(() => {
  (authenticatedFetch as jest.Mock).mockReset();
  (authenticatedFetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ ...testRun, analysis_start_offset: 30, analysis_end_offset: 60 }),
  });
});

it('defaults to a single-run edit, so opening and saving cannot rewrite a workload', async () => {
  renderDialog();

  expect(checkbox()).not.toBeChecked();

  fireEvent.click(saveButton());

  await waitFor(() => expect(authenticatedFetch).toHaveBeenCalled());
  expect((authenticatedFetch as jest.Mock).mock.calls[0][0]).toBe(
    '/test-runs/uuid-1/analysis-time-range',
  );
  expect(bodyOfLastRequest()).toEqual({
    analysisStartOffset: 30,
    analysisEndOffset: 60,
    applyToAll: false,
  });
});

it('sends applyToAll: true once the checkbox is ticked', async () => {
  const { onSaved } = renderDialog();

  fireEvent.click(checkbox());
  expect(checkbox()).toBeChecked();

  fireEvent.click(saveButton());

  await waitFor(() => expect(authenticatedFetch).toHaveBeenCalled());
  expect(bodyOfLastRequest()).toMatchObject({ applyToAll: true });
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
});

it('names the environment and workload it is about to change, so the blast radius is visible', () => {
  renderDialog();

  // Unticked: the warning is about the comparison spanning two windows.
  expect(screen.getByText(/only this run changes/i)).toBeInTheDocument();

  fireEvent.click(checkbox());

  // Ticked: the affected scope is spelled out rather than left as "all runs".
  expect(screen.getByText(/every run of acc \/ loadTest/i)).toBeInTheDocument();
});

it('surfaces a failed save instead of reporting success, and keeps the checkbox state', async () => {
  const { onSaved } = renderDialog();
  (authenticatedFetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });

  fireEvent.click(checkbox());
  fireEvent.click(saveButton());

  expect(await screen.findByText(/failed to save analysis time range \(http 500\)/i)).toBeInTheDocument();
  expect(onSaved).not.toHaveBeenCalled();
  // The user can retry without re-ticking — losing the tick here would quietly
  // downgrade the retry to a single-run write.
  expect(checkbox()).toBeChecked();
  expect(saveButton()).toBeEnabled();
});
