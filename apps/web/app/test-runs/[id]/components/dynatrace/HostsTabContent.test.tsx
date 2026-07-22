import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HostsTabContent from './HostsTabContent';

jest.mock('@/lib/dynatrace', () => ({
  fetchHostsOverview: jest.fn().mockResolvedValue([]),
}));

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
