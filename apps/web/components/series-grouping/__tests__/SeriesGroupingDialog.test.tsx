import React from 'react';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import SeriesGroupingDialog, {
  type SeriesGroupingDialogProps,
} from '@/components/series-grouping/SeriesGroupingDialog';
import { authenticatedFetch } from '@/lib/api';
import type { SeriesGroupingRuleResponse } from '@/lib/api/series-grouping';

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

const jsonResponse = (body: unknown, ok = true, status = ok ? 200 : 400): Response =>
  ({ ok, status, json: () => Promise.resolve(body) } as unknown as Response);

const PREVIEW_URL = '/series-grouping-rules/preview';

/** Routes are `"METHOD /prefix"`; the longest matching prefix wins, so `/preview` beats the collection. */
function routeFetch(routes: Record<string, unknown>) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const match = Object.keys(routes)
      .filter((key) => {
        const [m, prefix] = key.split(' ');
        return m === method && url.startsWith(prefix);
      })
      .sort((a, b) => b.length - a.length)[0];
    if (match) return Promise.resolve(jsonResponse(routes[match]));
    return Promise.resolve(jsonResponse({ message: `Unstubbed ${method} ${url}` }, false, 404));
  });
}

function callsTo(url: string, method: string) {
  return mockFetch.mock.calls.filter(
    ([u, init]) => u === url && ((init as RequestInit | undefined)?.method ?? 'GET') === method,
  );
}

function findBodyFor(url: string, method: string): Record<string, unknown> | undefined {
  const call = callsTo(url, method)[0];
  if (!call) return undefined;
  return JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
}

const podPanel = {
  panelId: 4,
  panelTitle: 'CPU usage per pod',
  currentNames: ['api-7d9f8c6b5-x2k4p', 'api-7d9f8c6b5-z9w2t', 'worker-6b8f7d9c4-h5k2l'],
  baselineNames: ['api-5c4d9b7f8-m4nb6', 'api-5c4d9b7f8-q8r2m', 'worker-8d7c6b5f9-p2r4s'],
};

const preview = (panels = [podPanel], extra: Record<string, unknown> = {}) => ({
  testRunId: 'run-1',
  baselineRunIds: ['b1', 'b2', 'b3', 'b4', 'b5'],
  panels,
  sloWarnings: [],
  rawNameCollisions: [],
  alignment: [],
  ...extra,
});

const rule = (overrides: Partial<SeriesGroupingRuleResponse> = {}): SeriesGroupingRuleResponse => ({
  id: 'rule-1',
  systemUnderTestId: 'sut-1',
  testEnvironment: 'prod',
  workload: 'peak',
  applicationDashboardId: 'dash-1',
  panelId: 4,
  preset: 'k8s-pod',
  pattern: null,
  replacement: '',
  aggregation: 'avg',
  trackMemberCount: true,
  enabled: true,
  origin: 'manual',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  ...overrides,
});

function renderDialog(props: Partial<SeriesGroupingDialogProps> = {}) {
  const onSaved = jest.fn();
  const onClose = jest.fn();
  const showToast = jest.fn();
  const utils = render(
    <SeriesGroupingDialog
      open
      onClose={onClose}
      context={{
        systemId: 'sut-1',
        environment: 'prod',
        workload: 'peak',
        applicationDashboardId: 'dash-1',
        dashboardLabel: 'Kubernetes',
        panelId: 4,
        panelTitle: 'CPU usage per pod',
      }}
      origin="manual"
      copyTargets={[]}
      onSaved={onSaved}
      showToast={showToast}
      {...props}
    />,
  );
  return { ...utils, onSaved, onClose, showToast };
}

const groupCells = () =>
  screen.getAllByTestId('series-grouping-preview-row').map((row) => within(row).getAllByRole('cell')[2].textContent);

describe('SeriesGroupingDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches the names once and regroups client-side when the preset changes', async () => {
    routeFetch({ [`POST ${PREVIEW_URL}`]: preview() });
    const user = userEvent.setup();
    renderDialog();

    await waitFor(() => expect(screen.getAllByTestId('series-grouping-preview-row')).toHaveLength(2));
    expect(groupCells()[0]).toContain('api');
    expect(screen.getByTestId('series-grouping-before-after')).toHaveTextContent(
      'Before: 0 of 3 series match the baseline · After: 2 of 2 groups match',
    );
    expect(callsTo(PREVIEW_URL, 'POST')).toHaveLength(1);

    await user.click(screen.getByLabelText(/DaemonSet/));

    // The table answers at once, from the names already in hand.
    expect(groupCells()[0]).toContain('api-7d9f8c6b5');
    expect(screen.getByTestId('series-grouping-before-after')).toHaveTextContent('After: 0 of 2 groups match');
    expect(callsTo(PREVIEW_URL, 'POST')).toHaveLength(1);

    // Only the SLO check is asked again, once the rule has settled, for the new rule.
    await waitFor(() => expect(callsTo(PREVIEW_URL, 'POST')).toHaveLength(2), { timeout: 2000 });
    const recheck = JSON.parse((callsTo(PREVIEW_URL, 'POST')[1][1] as RequestInit).body as string);
    expect(recheck.rule.preset).toBe('k8s-daemonset');
  });

  it('sends the workload instead of a run when there is no run in hand', async () => {
    routeFetch({ [`POST ${PREVIEW_URL}`]: preview() });
    renderDialog();
    await waitFor(() => expect(callsTo(PREVIEW_URL, 'POST')).toHaveLength(1));
    const body = findBodyFor(PREVIEW_URL, 'POST');
    expect(body).toMatchObject({ systemId: 'sut-1', environment: 'prod', workload: 'peak', applicationDashboardId: 'dash-1', panelId: 4 });
    expect(body).not.toHaveProperty('testRunId');
  });

  it('preselects the preset that lines the names up and marks it detected', async () => {
    routeFetch({
      [`POST ${PREVIEW_URL}`]: preview([
        {
          panelId: 4,
          panelTitle: 'Log shipper CPU',
          currentNames: ['fluentd-x2k4p', 'node-exporter-h5k2l'],
          baselineNames: ['fluentd-q8r2m', 'node-exporter-p2r4s'],
        },
      ]),
    });
    renderDialog();

    await waitFor(() => expect(screen.getByLabelText(/DaemonSet/)).toBeChecked());
    expect(screen.getByText('(detected)')).toBeInTheDocument();
    expect(screen.getByLabelText(/Deployment \/ ReplicaSet/)).not.toBeChecked();
  });

  it('keeps a suggested preset and labels it suggested', async () => {
    routeFetch({ [`POST ${PREVIEW_URL}`]: preview() });
    renderDialog({ initialPreset: 'trailing-id', origin: 'suggestion' });
    await waitFor(() => expect(screen.getAllByTestId('series-grouping-preview-row').length).toBeGreaterThan(0));
    expect(screen.getByLabelText(/Trailing ID/)).toBeChecked();
    expect(screen.getByText('(suggested)')).toBeInTheDocument();
    expect(screen.queryByText('(detected)')).not.toBeInTheDocument();
  });

  it('shows the guard message and disables Save for an unsafe custom regex', async () => {
    routeFetch({ [`POST ${PREVIEW_URL}`]: preview() });
    const user = userEvent.setup();
    renderDialog();
    await waitFor(() => expect(callsTo(PREVIEW_URL, 'POST')).toHaveLength(1));

    await user.click(screen.getByLabelText('Custom regex'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Regular expression' }), { target: { value: '(a+)+' } });

    expect(screen.getByText(/dangerous ReDoS pattern/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: 'Regular expression' }), { target: { value: '-[a-z0-9]{5}$' } });
    expect(screen.queryByText(/dangerous ReDoS pattern/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('posts origin and copyTo, and reports the copies', async () => {
    routeFetch({
      [`POST ${PREVIEW_URL}`]: preview(),
      'POST /series-grouping-rules': {
        rule: rule({ origin: 'suggestion' }),
        copies: {
          created: [rule({ id: 'rule-2', testEnvironment: 'acc', origin: 'copy' })],
          skipped: [{ testEnvironment: 'test', workload: 'peak', reason: 'no-dashboard' }],
        },
      },
    });
    const user = userEvent.setup();
    const { onSaved, showToast } = renderDialog({
      origin: 'suggestion',
      copyTargets: [
        { testEnvironment: 'acc', workload: 'peak' },
        { testEnvironment: 'test', workload: 'peak' },
      ],
    });
    await waitFor(() => expect(callsTo(PREVIEW_URL, 'POST')).toHaveLength(1));

    await user.click(screen.getByLabelText('Also create for other workloads of this system'));
    await user.click(screen.getByLabelText('acc / peak'));
    await user.click(screen.getByLabelText('test / peak'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const body = findBodyFor('/series-grouping-rules', 'POST');
    expect(body).toEqual({
      systemUnderTestId: 'sut-1',
      testEnvironment: 'prod',
      workload: 'peak',
      applicationDashboardId: 'dash-1',
      panelId: 4,
      preset: 'k8s-pod',
      aggregation: 'avg',
      trackMemberCount: true,
      origin: 'suggestion',
      copyTo: [
        { testEnvironment: 'acc', workload: 'peak' },
        { testEnvironment: 'test', workload: 'peak' },
      ],
    });
    const summary = onSaved.mock.calls[0][0].summary as string;
    expect(summary).toContain('Created for 1 more workload; skipped test / peak (no such dashboard)');
    expect(showToast).toHaveBeenCalledWith(summary);
    // No run in hand: nothing to recalculate.
    expect(callsTo('/series-grouping-rules/apply', 'POST')).toHaveLength(0);
  });

  it('applies to the whole dashboard when "All panels" is chosen', async () => {
    routeFetch({ [`POST ${PREVIEW_URL}`]: preview(), 'POST /series-grouping-rules': { rule: rule({ panelId: null }), copies: { created: [], skipped: [] } } });
    const user = userEvent.setup();
    const { onSaved } = renderDialog();
    await waitFor(() => expect(callsTo(PREVIEW_URL, 'POST')).toHaveLength(1));

    await user.click(screen.getByLabelText('All panels on this dashboard'));
    // A different name list: the dashboard-wide names are fetched.
    await waitFor(() => expect(callsTo(PREVIEW_URL, 'POST')).toHaveLength(2));
    expect(JSON.parse((callsTo(PREVIEW_URL, 'POST')[1][1] as RequestInit).body as string).panelId).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(findBodyFor('/series-grouping-rules', 'POST')?.panelId).toBeNull();
  });

  it('recalculates the run and its baseline after creating the rule', async () => {
    routeFetch({
      [`POST ${PREVIEW_URL}`]: preview(),
      'POST /series-grouping-rules': { rule: rule(), copies: { created: [], skipped: [] } },
      'POST /series-grouping-rules/apply': { enqueued: ['run-1', 'b1', 'b2', 'b3', 'b4', 'b5'], skipped: [] },
    });
    const user = userEvent.setup();
    const { onSaved, showToast } = renderDialog({
      context: {
        systemId: 'sut-1',
        environment: 'prod',
        workload: 'peak',
        applicationDashboardId: 'dash-1',
        dashboardLabel: 'Kubernetes',
        panelId: 4,
        testRunId: 'run-1',
      },
    });
    await waitFor(() => expect(screen.getByText(/Recalculate this run and its 5 baseline runs now/)).toBeInTheDocument());
    expect(findBodyFor(PREVIEW_URL, 'POST')?.testRunId).toBe('run-1');

    await user.click(screen.getByRole('button', { name: 'Save and recalculate' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(findBodyFor('/series-grouping-rules/apply', 'POST')).toEqual({ testRunId: 'run-1', scope: 'baseline' });
    const createIndex = mockFetch.mock.calls.findIndex(
      ([u, init]) => u === '/series-grouping-rules' && (init as RequestInit).method === 'POST',
    );
    const applyIndex = mockFetch.mock.calls.findIndex(([u]) => u === '/series-grouping-rules/apply');
    expect(createIndex).toBeGreaterThanOrEqual(0);
    expect(applyIndex).toBeGreaterThan(createIndex);
    expect(onSaved.mock.calls[0][0].enqueued).toBe(6);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Recalculating 6 runs'));
  });

  it('reads Save, and does not recalculate, when recalculation is switched off', async () => {
    routeFetch({
      [`POST ${PREVIEW_URL}`]: preview(),
      'POST /series-grouping-rules': { rule: rule(), copies: { created: [], skipped: [] } },
    });
    const user = userEvent.setup();
    const { onSaved } = renderDialog({
      context: {
        systemId: 'sut-1',
        environment: 'prod',
        workload: 'peak',
        applicationDashboardId: 'dash-1',
        dashboardLabel: 'Kubernetes',
        panelId: 4,
        testRunId: 'run-1',
      },
    });
    await user.click(await screen.findByLabelText(/Recalculate this run/));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(callsTo('/series-grouping-rules/apply', 'POST')).toHaveLength(0);
  });

  it('edits by PATCH and never sends the slot', async () => {
    routeFetch({
      [`POST ${PREVIEW_URL}`]: preview(),
      'PATCH /series-grouping-rules/rule-1': rule({ aggregation: 'sum' }),
    });
    const user = userEvent.setup();
    const { onSaved } = renderDialog({ existingRule: rule(), copyTargets: [{ testEnvironment: 'acc', workload: 'peak' }] });
    await waitFor(() => expect(callsTo(PREVIEW_URL, 'POST')).toHaveLength(1));

    // The slot cannot change, so neither the scope radios nor the copy option are offered.
    expect(screen.queryByLabelText('All panels on this dashboard')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Also create for other workloads of this system')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Total'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(callsTo('/series-grouping-rules', 'POST')).toHaveLength(0);
    expect(findBodyFor('/series-grouping-rules/rule-1', 'PATCH')).toEqual({
      preset: 'k8s-pod',
      aggregation: 'sum',
      trackMemberCount: true,
    });
  });

  it('shows the server refusal and stays open', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url === PREVIEW_URL) return Promise.resolve(jsonResponse(preview()));
      if (url === '/series-grouping-rules' && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({ message: 'A series grouping rule already exists for this panel' }, false, 409),
        );
      }
      return Promise.resolve(jsonResponse({}, false, 404));
    });
    const user = userEvent.setup();
    const { onSaved } = renderDialog();
    await waitFor(() => expect(callsTo(PREVIEW_URL, 'POST')).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('A series grouping rule already exists for this panel')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('starts from the props again when reopened', async () => {
    routeFetch({ [`POST ${PREVIEW_URL}`]: preview() });
    const user = userEvent.setup();
    const { rerender, onSaved, onClose, showToast } = renderDialog();
    await waitFor(() => expect(callsTo(PREVIEW_URL, 'POST')).toHaveLength(1));
    await user.click(screen.getByLabelText('Highest pod'));
    expect(screen.getByLabelText('Highest pod')).toBeChecked();

    const props = {
      onClose,
      onSaved,
      showToast,
      origin: 'manual' as const,
      copyTargets: [],
      context: {
        systemId: 'sut-1',
        environment: 'prod',
        workload: 'peak',
        applicationDashboardId: 'dash-1',
        dashboardLabel: 'Kubernetes',
        panelId: 4,
      },
    };
    rerender(<SeriesGroupingDialog open={false} {...props} />);
    rerender(<SeriesGroupingDialog open {...props} />);

    await waitFor(() => expect(screen.getByLabelText('Average per pod')).toBeChecked());
    // The names are fetched afresh rather than reused from the last open.
    await waitFor(() => expect(callsTo(PREVIEW_URL, 'POST').length).toBeGreaterThanOrEqual(2));
  });

  it('renders the warnings the preview reports', async () => {
    routeFetch({
      [`POST ${PREVIEW_URL}`]: preview(
        [{ ...podPanel, baselineNames: [...podPanel.baselineNames, 'api'] }],
        {
          sloWarnings: [{ benchmarkId: 'b-1', name: 'API pod CPU < 80%', matchPattern: '^api-' }],
          alignment: [{ panelId: 4, group: 'worker', members: 3, avgMembers: 1 }],
        },
      ),
    });
    renderDialog();
    expect(await screen.findByText(/API pod CPU < 80%/)).toBeInTheDocument();
    expect(screen.getByText(/is also a series name in a baseline run/)).toBeInTheDocument();
    expect(screen.getByText(/report at different\s+timestamps/)).toBeInTheDocument();
  });
});
