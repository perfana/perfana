import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import EditDashboardDialog from '../EditDashboardDialog';
import { authenticatedFetch } from '@/lib/api';
import type { ApplicationDashboard } from '../types';

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

// The dialog has its own suite; here it only has to open in the right mode.
jest.mock('@/components/series-grouping/SeriesGroupingDialog', () => ({
  __esModule: true,
  default: (props: {
    context: { panelId: number | null; testRunId?: string };
    existingRule?: { id: string };
    onSaved: (r: unknown) => void;
  }) => (
    <div data-testid="series-grouping-dialog">
      mode={props.existingRule ? `edit:${props.existingRule.id}` : 'add'} panel={String(props.context.panelId)} run=
      {String(props.context.testRunId)}
      <button onClick={() => props.onSaved({ rule: {}, enqueued: 0, summary: 'Series grouping rule saved.' })}>
        save-dialog
      </button>
    </div>
  ),
}));

const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

const jsonResponse = (body: unknown, ok = true, status = ok ? 200 : 500): Response =>
  ({ ok, status, json: () => Promise.resolve(body) } as unknown as Response);

const dashboard = {
  id: 'dash-1',
  system_under_test_id: 'sut-1',
  test_environment: 'prod',
  dashboard_name: 'Kubernetes / Pods',
  dashboard_uid: 'k8s-pods',
  dashboard_label: 'Kubernetes',
  variables: [],
  created_at: '',
  updated_at: '',
} as ApplicationDashboard;

const rule = (id: string, panelId: number | null, extra: Record<string, unknown> = {}) => ({
  id,
  systemUnderTestId: 'sut-1',
  testEnvironment: 'prod',
  workload: 'peak',
  applicationDashboardId: 'dash-1',
  panelId,
  preset: 'k8s-pod',
  pattern: null,
  replacement: '',
  aggregation: 'avg',
  trackMemberCount: true,
  enabled: true,
  origin: 'manual',
  createdAt: '',
  updatedAt: '',
  ...extra,
});

function renderDialog(selectedWorkload: string, overrides: Partial<ApplicationDashboard> = {}) {
  return render(
    <EditDashboardDialog
      open
      onClose={jest.fn()}
      onSubmit={jest.fn()}
      dashboard={{ ...dashboard, ...overrides }}
      loading={false}
      systemName="my-sut"
      selectedEnvironment="prod"
      systemId="sut-1"
      selectedWorkload={selectedWorkload}
    />,
  );
}

const rulesUrl = '/series-grouping-rules?systemId=sut-1&environment=prod&workload=peak&applicationDashboardId=dash-1';

describe('EditDashboardDialog — series grouping section', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('asks for a workload before listing anything', () => {
    renderDialog('');
    expect(screen.getByText('Select a workload to configure series grouping.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add rule' })).not.toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('is not offered on a performance-test dashboard', () => {
    renderDialog('peak', { dashboard_uid: 'performance-test-metrics-abc' });
    expect(screen.queryByTestId('series-grouping-section')).not.toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('lists the rules of the dashboard in the selected workload', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse([
        rule('r-1', null),
        rule('r-2', 4, { preset: 'custom', pattern: '-[a-z0-9]{5}$', aggregation: 'max', trackMemberCount: false, enabled: false }),
      ]),
    );
    renderDialog('peak');

    const rows = await screen.findAllByTestId('series-grouping-rule-row');
    expect(mockFetch).toHaveBeenCalledWith(rulesUrl);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('All panels')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Kubernetes pod (Deployment / ReplicaSet)')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Average per pod')).toBeInTheDocument();
    expect(within(rows[0]).getByRole('switch')).toBeChecked();
    expect(within(rows[1]).getByText('Panel 4')).toBeInTheDocument();
    expect(within(rows[1]).getByText('-[a-z0-9]{5}$')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Highest pod')).toBeInTheDocument();
    expect(within(rows[1]).getByRole('switch')).not.toBeChecked();
  });

  it('opens the dialog without a run, for the whole dashboard or the rule being edited', async () => {
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(jsonResponse(url.startsWith('/series-grouping-rules') ? [rule('r-2', 4)] : { environments: [] })),
    );
    const user = userEvent.setup();
    renderDialog('peak');
    await screen.findAllByTestId('series-grouping-rule-row');

    await user.click(screen.getByRole('button', { name: 'Add rule' }));
    expect(screen.getByTestId('series-grouping-dialog')).toHaveTextContent('mode=add panel=null run=undefined');
    await user.click(screen.getByRole('button', { name: 'save-dialog' }));
    expect(await screen.findByText('Series grouping rule saved.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit rule' }));
    expect(screen.getByTestId('series-grouping-dialog')).toHaveTextContent('mode=edit:r-2 panel=4');
  });

  it('asks for confirmation, then deletes', async () => {
    let listed = [rule('r-1', null)];
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        listed = [];
        return Promise.resolve({ ok: true, status: 204 } as Response);
      }
      return Promise.resolve(jsonResponse(listed));
    });
    const user = userEvent.setup();
    renderDialog('peak');
    await screen.findAllByTestId('series-grouping-rule-row');

    await user.click(screen.getByRole('button', { name: 'Delete rule' }));
    expect(screen.getByText('Delete series grouping rule?')).toBeInTheDocument();
    expect(mockFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith('/series-grouping-rules/r-1', { method: 'DELETE' }),
    );
    expect(await screen.findByText(/No series grouping rules for prod \/ peak/)).toBeInTheDocument();
  });

  it('toggles a rule on and off', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(jsonResponse(init?.method === 'PATCH' ? rule('r-1', null, { enabled: false }) : [rule('r-1', null)])),
    );
    const user = userEvent.setup();
    renderDialog('peak');
    const [row] = await screen.findAllByTestId('series-grouping-rule-row');

    await user.click(within(row).getByRole('switch'));

    await waitFor(() => expect(within(row).getByRole('switch')).not.toBeChecked());
    const patch = mockFetch.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');
    expect(patch?.[0]).toBe('/series-grouping-rules/r-1');
    expect(JSON.parse((patch?.[1] as RequestInit).body as string)).toEqual({ enabled: false });
  });

  it('shows a refusal inline', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ message: 'Missing benchmark:manage' }, false, 403));
    renderDialog('peak');
    expect(await screen.findByText('Missing benchmark:manage')).toBeInTheDocument();
  });
});
