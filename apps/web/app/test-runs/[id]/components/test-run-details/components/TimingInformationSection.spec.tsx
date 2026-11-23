/**
 * Value: protects=the start/end time edit form's request and error path; fails_when=an
 * unchanged field is sent anyway (the API then rewrites a time the user did not touch, with
 * the seconds the datetime-local input rounded away), the wrong route/method is used, or a
 * refused save closes the form and swallows the API's reason; why_new=the edit mode is new
 * and had no test; seam=none; no_claim=does not verify browser timezone handling beyond the
 * jsdom default, nor the AnalysisTimeRangeDialog half of this card.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TimingInformationSection } from './TimingInformationSection';
import { authenticatedFetch } from '@/lib/api';
import type { TestRun } from '@/types/test-runs';

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

const fetchMock = authenticatedFetch as jest.Mock;

/** The summary-timeseries probe on mount answers "nothing", so only the PUT matters. */
const routeFetch = (putResponse: unknown) => {
  fetchMock.mockImplementation((url: string) =>
    url.endsWith('/time-range')
      ? Promise.resolve(putResponse)
      : Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) }),
  );
};

beforeEach(() => fetchMock.mockReset());

const makeTestRun = (overrides?: Partial<TestRun>): TestRun =>
  ({
    id: 'uuid-1',
    test_run_id: 'run-001',
    start_time: '2026-11-20T10:00:00.000Z',
    end_time: '2026-11-20T11:00:00.000Z',
    duration: 3600,
    completed: true,
    ...overrides,
  }) as TestRun;

const putCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/time-range'));

it('sends only the field that changed and hands the updated run back', async () => {
  const updated = { ...makeTestRun(), duration: 3000 };
  routeFetch({ ok: true, status: 200, json: () => Promise.resolve(updated) });
  const onTestRunUpdate = jest.fn();
  const showToast = jest.fn();
  render(<TimingInformationSection testRun={makeTestRun()} onTestRunUpdate={onTestRunUpdate} showToast={showToast} />);

  fireEvent.click(screen.getByRole('button', { name: /change start \/ end time/i }));
  const endInput = screen.getByLabelText(/end time/i) as HTMLInputElement;
  // Ten minutes earlier than the stored end, as the browser-local value the input emits.
  const target = new Date('2026-11-20T10:50:00.000Z');
  const newEndLocal = new Date(target.getTime() - target.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
  fireEvent.change(endInput, { target: { value: newEndLocal } });
  fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

  await waitFor(() => expect(onTestRunUpdate).toHaveBeenCalledWith(updated));
  expect(putCalls()).toHaveLength(1);
  const [url, init] = putCalls()[0];
  expect(url).toBe('/test-runs/uuid-1/time-range');
  expect(init.method).toBe('PUT');
  expect(JSON.parse(init.body)).toEqual({ endTime: '2026-11-20T10:50:00.000Z' });
  expect(showToast).toHaveBeenCalled();
  expect(screen.queryByLabelText(/end time/i)).not.toBeInTheDocument();
});

it('keeps the form open and shows the API reason when the save is refused', async () => {
  routeFetch({ ok: false, status: 400, json: () => Promise.resolve({ message: 'End time cannot be in the future' }) });
  const onTestRunUpdate = jest.fn();
  render(<TimingInformationSection testRun={makeTestRun()} onTestRunUpdate={onTestRunUpdate} />);

  fireEvent.click(screen.getByRole('button', { name: /change start \/ end time/i }));
  const startInput = screen.getByLabelText(/start time/i);
  const start = new Date('2026-11-20T10:05:00.000Z');
  fireEvent.change(startInput, {
    target: { value: new Date(start.getTime() - start.getTimezoneOffset() * 60_000).toISOString().slice(0, 19) },
  });
  fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

  expect(await screen.findByText('End time cannot be in the future')).toBeInTheDocument();
  expect(onTestRunUpdate).not.toHaveBeenCalled();
  expect(screen.getByLabelText(/start time/i)).toBeInTheDocument();
});

/**
 * Value: protects=the no-op save short-circuit in the time edit form; fails_when=the
 * unchanged-fields check is removed, so a Save with nothing touched still PUTs and the API
 * re-collects and re-analyses the whole run for no change; why_new=pass 1 covered only saves
 * that changed a field; seam=none; no_claim=does not cover a value edited and then edited back.
 */
it('closes the form without a request when nothing changed', async () => {
  routeFetch({ ok: true, status: 200, json: () => Promise.resolve(makeTestRun()) });
  const onTestRunUpdate = jest.fn();
  render(<TimingInformationSection testRun={makeTestRun()} onTestRunUpdate={onTestRunUpdate} />);

  fireEvent.click(screen.getByRole('button', { name: /change start \/ end time/i }));
  fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

  await waitFor(() => expect(screen.queryByLabelText(/end time/i)).not.toBeInTheDocument());
  expect(putCalls()).toHaveLength(0);
  expect(onTestRunUpdate).not.toHaveBeenCalled();
});

/**
 * Value: protects=the client-side start-before-end guard; fails_when=the ordering check is
 * dropped or inverted, so an impossible window is sent to the API (or a valid one refused
 * locally); why_new=no test entered an inverted window in the form; seam=none;
 * no_claim=does not test equal start and end separately.
 */
it('refuses a start after the end locally and sends nothing', async () => {
  routeFetch({ ok: true, status: 200, json: () => Promise.resolve(makeTestRun()) });
  render(<TimingInformationSection testRun={makeTestRun()} />);

  fireEvent.click(screen.getByRole('button', { name: /change start \/ end time/i }));
  const lateStart = new Date('2026-11-20T12:00:00.000Z');
  fireEvent.change(screen.getByLabelText(/start time/i), {
    target: { value: new Date(lateStart.getTime() - lateStart.getTimezoneOffset() * 60_000).toISOString().slice(0, 19) },
  });
  fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

  expect(await screen.findByText('Start time must be before end time')).toBeInTheDocument();
  expect(putCalls()).toHaveLength(0);
  expect(screen.getByLabelText(/start time/i)).toBeInTheDocument();
});

/**
 * Value: protects=recovering the form after the PUT itself throws; fails_when=the catch is
 * removed (an unhandled rejection with no message) or the finally that clears savingTimes is
 * dropped, leaving Save disabled on a spinner after one network failure; why_new=only a
 * refused response was tested, never a rejected fetch; seam=none; no_claim=does not cover a
 * non-JSON error body.
 */
it('shows a generic error and re-enables Save when the request fails outright', async () => {
  fetchMock.mockImplementation((url: string) =>
    url.endsWith('/time-range')
      ? Promise.reject(new Error('network down'))
      : Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) }),
  );
  const onTestRunUpdate = jest.fn();
  render(<TimingInformationSection testRun={makeTestRun()} onTestRunUpdate={onTestRunUpdate} />);

  fireEvent.click(screen.getByRole('button', { name: /change start \/ end time/i }));
  const start = new Date('2026-11-20T10:05:00.000Z');
  fireEvent.change(screen.getByLabelText(/start time/i), {
    target: { value: new Date(start.getTime() - start.getTimezoneOffset() * 60_000).toISOString().slice(0, 19) },
  });
  fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

  expect(await screen.findByText('Failed to update times')).toBeInTheDocument();
  expect(onTestRunUpdate).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled();
});

/**
 * Value: protects=Cancel discarding an unsaved time edit; fails_when=Cancel sends the PUT, or
 * reopening the form shows the abandoned value instead of re-reading the stored times, so a
 * later Save submits an edit the user cancelled; why_new=no test pressed Cancel; seam=none;
 * no_claim=does not cover Cancel while a save is in flight.
 */
it('discards the edit on Cancel and reopens with the stored times', () => {
  routeFetch({ ok: true, status: 200, json: () => Promise.resolve(makeTestRun()) });
  render(<TimingInformationSection testRun={makeTestRun()} />);

  fireEvent.click(screen.getByRole('button', { name: /change start \/ end time/i }));
  const original = (screen.getByLabelText(/start time/i) as HTMLInputElement).value;
  const start = new Date('2026-11-20T10:05:00.000Z');
  fireEvent.change(screen.getByLabelText(/start time/i), {
    target: { value: new Date(start.getTime() - start.getTimezoneOffset() * 60_000).toISOString().slice(0, 19) },
  });
  fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

  expect(screen.queryByLabelText(/start time/i)).not.toBeInTheDocument();
  expect(putCalls()).toHaveLength(0);

  fireEvent.click(screen.getByRole('button', { name: /change start \/ end time/i }));
  expect((screen.getByLabelText(/start time/i) as HTMLInputElement).value).toBe(original);
});

/**
 * Value: protects=hiding the time edit entry point on a running run; fails_when=the
 * `testRun.completed` gate on the button is removed, offering an edit the API refuses and a
 * keep-alive would overwrite; why_new=pass 1 rendered only completed runs; seam=none;
 * no_claim=does not cover a run that completes while the card is mounted.
 */
it('offers the time edit only on a completed run', () => {
  routeFetch({ ok: true, status: 200, json: () => Promise.resolve(null) });
  const { unmount } = render(<TimingInformationSection testRun={makeTestRun({ completed: false })} />);
  expect(screen.queryByRole('button', { name: /change start \/ end time/i })).not.toBeInTheDocument();
  unmount();

  render(<TimingInformationSection testRun={makeTestRun()} />);
  expect(screen.getByRole('button', { name: /change start \/ end time/i })).toBeInTheDocument();
});
