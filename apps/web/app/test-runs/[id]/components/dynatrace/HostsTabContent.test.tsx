import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useParams } from 'next/navigation';
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

const testRun = {
  id: 'tr-1',
  test_environment: 'acc',
  workload: 'loadTest',
  start_time: '2026-07-22T10:00:00Z',
  end_time: '2026-07-22T10:30:00Z',
} as never;
const configs = [{ id: 'c1', label: 'DT' }] as never;

describe('HostsTabContent', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue([]);
  });

  // A `sut`-level mapping carries NULL test_environment and workload by design, and
  // mappings arrive ordered createdAt DESC — so the first one in the list is whichever
  // was created last, not whichever is scoped like the run. Reading the scope off it sent
  // `environment=&workload=`, which the endpoint rejects with a 400 before it calls
  // Dynatrace at all: a blank table, once per host, on every poll.
  it('takes the scope from the run, not from a system-level first mapping', async () => {
    const hosts = [
      // system-level, and first in the list
      { ...hostEntities[0]!, id: 'm0', entityId: 'HOST-A', level: 'sut',
        testEnvironment: undefined, workload: undefined },
      { ...hostEntities[0]!, id: 'm1', entityId: 'HOST-B' },
    ];

    render(<HostsTabContent hostEntities={hosts} testRun={testRun} configs={configs} />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    for (const call of mockFetch.mock.calls) {
      expect(call[1]).toBe('acc');
      expect(call[2]).toBe('loadTest');
    }
  });

  it('asks for nothing when the run has no environment or workload to scope by', async () => {
    const scopeless = { ...(testRun as object), test_environment: '', workload: '' } as never;

    render(<HostsTabContent hostEntities={hostEntities} testRun={scopeless} configs={configs} />);

    // The endpoint requires all three; firing anyway is a guaranteed 400 per host per poll.
    await waitFor(() => expect(mockFetch).not.toHaveBeenCalled());
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

  it('offers the card links from the detail header too', async () => {
    (useParams as jest.Mock).mockReturnValue({ id: 'WERKNL-00011' });
    render(<HostsTabContent hostEntities={hostEntities} testRun={testRun} configs={configs} />);

    fireEvent.click(await screen.findByText('web-1'));
    fireEvent.click(screen.getByLabelText('Actions for web-1'));
    const href = screen.getByText('Open in Graphs').closest('a')?.getAttribute('href') ?? '';
    expect(new URL(href, 'http://x').searchParams.get('dashboard')).toBe('Dynatrace host metrics web-1');
  });
});
