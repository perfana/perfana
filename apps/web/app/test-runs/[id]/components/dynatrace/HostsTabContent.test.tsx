import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HostsTabContent from './HostsTabContent';
import { fetchHostsOverview } from '@/lib/dynatrace';

jest.mock('@/lib/dynatrace', () => ({
  fetchHostsOverview: jest.fn().mockResolvedValue([]),
}));

const mockFetch = fetchHostsOverview as jest.MockedFunction<typeof fetchHostsOverview>;

// Render a marker instead of the real detail panel (it fetches on mount).
jest.mock('./HostDetailPanel', () => ({
  __esModule: true,
  default: ({ host }: { host: { entityDisplayName: string } }) => (
    <div>detail-for-{host.entityDisplayName}</div>
  ),
}));

const hostEntities = [
  {
    id: 'm1', entityId: 'HOST-A', entityDisplayName: 'web-1', entityType: 'HOST',
    dynatraceConfigId: 'c1', systemUnderTestId: 'sys-1', testEnvironment: 'prod', workload: 'load',
    level: 'host', createdAt: '', updatedAt: '',
  },
];

const testRun = { id: 'tr-1', start_time: '2026-07-22T10:00:00Z', end_time: '2026-07-22T10:30:00Z' } as never;
const configs = [{ id: 'c1', label: 'DT' }] as never;

describe('HostsTabContent', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue([]);
  });

  it('queries each host separately and fills rows in as they arrive', async () => {
    const hosts = ['HOST-A', 'HOST-B', 'HOST-C'].map((entityId, i) => ({
      ...hostEntities[0]!, id: `m${i}`, entityId, entityDisplayName: `web-${i}`,
    }));
    // Resolve only HOST-B; the other two stay pending, so a row can only appear
    // if the fan-out is per host rather than one call for all of them.
    mockFetch.mockImplementation((_s, _e, _w, _st, _en, hostId) =>
      hostId === 'HOST-B'
        ? Promise.resolve([{ hostId: 'HOST-B', displayName: 'web-1', dynatraceConfigId: 'c1', cpuAvg: 42, memAvg: 10, problemCount: 0, worstSeverity: null }])
        : new Promise(() => {}),
    );

    render(<HostsTabContent hostEntities={hosts} testRun={testRun} configs={configs} />);

    expect(await screen.findByText('42.0%')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch.mock.calls.map((c) => c[5])).toEqual(['HOST-A', 'HOST-B', 'HOST-C']);
  });

  it('shows the overview table, then the host detail after clicking a row, then back', async () => {
    render(<HostsTabContent hostEntities={hostEntities} testRun={testRun} configs={configs} />);

    // master: table row present
    const row = await screen.findByText('web-1');
    expect(screen.queryByText('detail-for-web-1')).not.toBeInTheDocument();

    // drill in
    fireEvent.click(row);
    expect(screen.getByText('detail-for-web-1')).toBeInTheDocument();

    // back to master
    fireEvent.click(screen.getByRole('button', { name: /back to hosts/i }));
    await waitFor(() => expect(screen.getByText('web-1')).toBeInTheDocument());
    expect(screen.queryByText('detail-for-web-1')).not.toBeInTheDocument();
  });
});
