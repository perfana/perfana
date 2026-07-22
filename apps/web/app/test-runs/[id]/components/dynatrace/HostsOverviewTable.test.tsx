import { render, screen, fireEvent } from '@testing-library/react';
import HostsOverviewTable from './HostsOverviewTable';

const hosts = [
  { id: 'm1', entityId: 'HOST-A', entityDisplayName: 'web-1', dynatraceConfigId: 'c1' },
  { id: 'm2', entityId: 'HOST-B', entityDisplayName: 'web-2', dynatraceConfigId: 'c1' },
];

const rows = [
  { hostId: 'HOST-A', displayName: 'web-1', dynatraceConfigId: 'c1', cpuAvg: 42.34, memAvg: 60.1, problemCount: 2, worstSeverity: 'AVAILABILITY' },
  { hostId: 'HOST-B', displayName: 'web-2', dynatraceConfigId: 'c1', cpuAvg: null, memAvg: 17, problemCount: 0, worstSeverity: null },
];

describe('HostsOverviewTable', () => {
  it('renders a row per host with formatted CPU/mem and problem indicators', () => {
    render(<HostsOverviewTable hosts={hosts} rows={rows} loading={false} onSelectHost={jest.fn()} />);
    expect(screen.getByText('web-1')).toBeInTheDocument();
    expect(screen.getByText('web-2')).toBeInTheDocument();
    expect(screen.getByText('42.3%')).toBeInTheDocument(); // rounded to 1 dp
    expect(screen.getByText('—')).toBeInTheDocument();       // HOST-B cpuAvg null
    expect(screen.getByText('2')).toBeInTheDocument();        // problem count chip
    expect(screen.getByText('healthy')).toBeInTheDocument();  // HOST-B no problems
  });

  it('calls onSelectHost with the entityId when a row is clicked', () => {
    const onSelect = jest.fn();
    render(<HostsOverviewTable hosts={hosts} rows={rows} loading={false} onSelectHost={onSelect} />);
    fireEvent.click(screen.getByText('web-1'));
    expect(onSelect).toHaveBeenCalledWith('HOST-A');
  });

  it('shows an empty state when there are no hosts', () => {
    render(<HostsOverviewTable hosts={[]} rows={[]} loading={false} onSelectHost={jest.fn()} />);
    expect(screen.getByText('No hosts found')).toBeInTheDocument();
  });
});
