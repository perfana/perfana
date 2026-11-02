import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import {
  SeriesGroupingNotices,
  dismissedSuggestionKey,
} from '@/app/test-runs/[id]/components/anomaly-detection/components/SeriesGroupingNotices';
import { authenticatedFetch } from '@/lib/api';
import type { TestRun } from '@/types/test-runs';

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

// The dialog has its own suite; here it only has to open with the right context.
jest.mock('@/components/series-grouping/SeriesGroupingDialog', () => ({
  __esModule: true,
  default: (props: { context: { panelId: number }; initialPreset?: string; origin: string; onSaved: (r: unknown) => void }) => (
    <div data-testid="series-grouping-dialog">
      dialog panel={props.context.panelId} preset={props.initialPreset} origin={props.origin}
      <button onClick={() => props.onSaved({ rule: {}, enqueued: 6, summary: 'ok' })}>save-dialog</button>
    </div>
  ),
}));

const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

const jsonResponse = (body: unknown, ok = true): Response =>
  ({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) } as unknown as Response);

const testRun = {
  id: 'uuid-1',
  test_run_id: 'run-1',
  system_under_test_id: 'sut-1',
  test_environment: 'prod',
  workload: 'peak',
} as unknown as TestRun;

const suggestion = (panelId: number, overrides: Record<string, unknown> = {}) => ({
  applicationDashboardId: 'dash-1',
  dashboardLabel: 'Kubernetes',
  panelId,
  panelTitle: `Panel ${panelId} title`,
  incomparableCount: 6,
  preset: 'k8s-pod',
  matchedBefore: 0,
  matchedAfter: 1,
  ...overrides,
});

function route(suggestions: unknown, status: unknown, apply: unknown = { enqueued: [], skipped: [] }) {
  mockFetch.mockImplementation((url: string) => {
    if (url.endsWith('/series-grouping-suggestions')) return Promise.resolve(jsonResponse(suggestions));
    if (url.endsWith('/series-grouping-status')) return Promise.resolve(jsonResponse(status));
    if (url === '/series-grouping-rules/apply') return Promise.resolve(jsonResponse(apply));
    return Promise.resolve(jsonResponse({}, false));
  });
}

const rows = [{ application_dashboard_id: 'dash-1', panel_id: '7', panel_title: 'Memory per pod' }];

function renderNotices(overrides: Partial<React.ComponentProps<typeof SeriesGroupingNotices>> = {}) {
  const showToast = jest.fn();
  const onShowRows = jest.fn();
  const utils = render(
    <SeriesGroupingNotices
      testRunId="run-1"
      testRun={testRun}
      anomalyRows={rows}
      onShowRows={onShowRows}
      showToast={showToast}
      {...overrides}
    />,
  );
  return { ...utils, showToast, onShowRows };
}

describe('SeriesGroupingNotices', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  it('renders a suggestion and opens the dialog with its preset', async () => {
    route([suggestion(4, { preset: 'k8s-daemonset' })], { stale: [], misaligned: [] });
    const user = userEvent.setup();
    renderNotices();

    expect(await screen.findByText(/6 series on "Panel 4 title" have no baseline/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Group series…' }));
    expect(screen.getByTestId('series-grouping-dialog')).toHaveTextContent(
      'dialog panel=4 preset=k8s-daemonset origin=suggestion',
    );
  });

  it('shows the rows of the panel', async () => {
    route([suggestion(4)], { stale: [], misaligned: [] });
    const user = userEvent.setup();
    const { onShowRows } = renderNotices();
    await user.click(await screen.findByRole('button', { name: 'Show rows' }));
    expect(onShowRows).toHaveBeenCalledWith('Kubernetes', 'Panel 4 title');
  });

  it('remembers a dismissal, so a remount does not show it again', async () => {
    route([suggestion(4), suggestion(5)], { stale: [], misaligned: [] });
    const user = userEvent.setup();
    const { unmount } = renderNotices();

    await screen.findByText(/"Panel 4 title"/);
    const [firstDismiss] = screen.getAllByRole('button', { name: 'Dismiss' });
    await user.click(firstDismiss);
    expect(screen.queryByText(/"Panel 4 title"/)).not.toBeInTheDocument();
    expect(window.localStorage.getItem(dismissedSuggestionKey(testRun, 'dash-1', 4))).toBe('true');

    unmount();
    renderNotices();
    expect(await screen.findByText(/"Panel 5 title"/)).toBeInTheDocument();
    expect(screen.queryByText(/"Panel 4 title"/)).not.toBeInTheDocument();
  });

  it('shows at most three suggestions and summarises the rest', async () => {
    route([1, 2, 3, 4, 5].map((p) => suggestion(p)), { stale: [], misaligned: [] });
    renderNotices();
    await screen.findByText(/"Panel 1 title"/);
    expect(screen.getAllByRole('button', { name: 'Group series…' })).toHaveLength(3);
    expect(screen.getByText('and 2 more panels with series grouping suggestions')).toBeInTheDocument();
  });

  it('posts apply from the stale notice and toasts the count', async () => {
    route([], { stale: [{ applicationDashboardId: 'dash-1', panelId: 7, reason: 'rule-changed' }], misaligned: [] }, {
      enqueued: ['run-1', 'b1', 'b2'],
      skipped: [],
    });
    const user = userEvent.setup();
    const { showToast } = renderNotices();

    expect(await screen.findByText(/Grouping rules changed since this run's statistics were calculated \(1 panel\)/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Recalculate this run and its baseline/ }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Recalculating 3 runs'));
    const applyCall = mockFetch.mock.calls.find(([u]) => u === '/series-grouping-rules/apply');
    expect(JSON.parse((applyCall?.[1] as RequestInit).body as string)).toEqual({ testRunId: 'run-1', scope: 'baseline' });
    expect(screen.getByText(/Recalculation requested/)).toBeInTheDocument();
  });

  it('warns about a misaligned group, by its panel title', async () => {
    route([], { stale: [], misaligned: [{ applicationDashboardId: 'dash-1', panelId: 7, group: 'api', members: 3, avgMembers: 1 }] });
    renderNotices();
    expect(await screen.findByText(/"api" on Memory per pod: its 3 members report at/)).toBeInTheDocument();
  });

  it('renders nothing when both endpoints return empty', async () => {
    route([], { stale: [], misaligned: [] });
    const { container } = renderNotices();
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the endpoints fail', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockFetch.mockResolvedValue(jsonResponse({ message: 'boom' }, false));
    const { container } = renderNotices();
    await waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
    expect(container).toBeEmptyDOMElement();
    warn.mockRestore();
  });

  it('hides a saved suggestion and holds the stale notice while the recalculation runs', async () => {
    let status: unknown = { stale: [], misaligned: [] };
    mockFetch.mockImplementation((url: string) => {
      if (url.endsWith('/series-grouping-suggestions')) return Promise.resolve(jsonResponse([suggestion(4)]));
      if (url.endsWith('/series-grouping-status')) return Promise.resolve(jsonResponse(status));
      return Promise.resolve(jsonResponse({}, false));
    });
    const user = userEvent.setup();
    renderNotices();
    await user.click(await screen.findByRole('button', { name: 'Group series…' }));

    // Saved: the run's membership is now behind the rule until the re-evaluate lands.
    status = { stale: [{ applicationDashboardId: 'dash-1', panelId: 4, reason: 'not-applied' }], misaligned: [] };
    await user.click(screen.getByRole('button', { name: 'save-dialog' }));

    expect(await screen.findByText(/Recalculation requested/)).toBeInTheDocument();
    expect(screen.queryByText(/"Panel 4 title"/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Recalculate this run/ })).not.toBeInTheDocument();
  });

  it('refetches when the anomaly rows are replaced', async () => {
    route([], { stale: [], misaligned: [] });
    const { rerender } = renderNotices();
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    rerender(
      <SeriesGroupingNotices
        testRunId="run-1"
        testRun={testRun}
        anomalyRows={[...rows]}
        showToast={jest.fn()}
      />,
    );
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(4));
  });
});
