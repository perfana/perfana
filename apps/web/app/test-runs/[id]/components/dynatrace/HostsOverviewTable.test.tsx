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

  it('filters rows by host name', () => {
    render(<HostsOverviewTable hosts={hosts} rows={rows} loading={false} onSelectHost={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Filter hosts'), { target: { value: 'web-2' } });
    expect(screen.queryByText('web-1')).not.toBeInTheDocument();
    expect(screen.getByText('web-2')).toBeInTheDocument();
  });

  it('sorts by CPU, keeping a host with no CPU reading last in both directions', () => {
    render(<HostsOverviewTable hosts={hosts} rows={rows} loading={false} onSelectHost={jest.fn()} />);
    const names = () => screen.getAllByRole('row').slice(1).map((r) => r.cells[0].textContent);

    fireEvent.click(screen.getByText('CPU avg'));      // desc
    expect(names()).toEqual(['web-1', 'web-2']);
    fireEvent.click(screen.getByText('CPU avg'));      // asc — null still sinks
    expect(names()).toEqual(['web-1', 'web-2']);
  });

  it('shows an empty state when there are no hosts', () => {
    render(<HostsOverviewTable hosts={[]} rows={[]} loading={false} onSelectHost={jest.fn()} />);
    expect(screen.getByText('No hosts found')).toBeInTheDocument();
  });
});
