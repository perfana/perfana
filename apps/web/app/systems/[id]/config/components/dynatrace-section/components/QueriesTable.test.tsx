import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueriesTable } from './QueriesTable';
import { DynatraceQueryLocal } from '../types';

jest.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ can: () => true }),
}));

const query = (over: Partial<DynatraceQueryLocal> & { id: string }): DynatraceQueryLocal => ({
  application: 'app',
  testEnvironment: 'acc',
  dashboardLabel: 'Dynatrace host metrics web-1',
  applicationDashboardId: 'ad-1',
  panelTitle: 'CPU Usage',
  query: 'builtin:host.cpu.usage',
  dynatraceConfigLabel: 'prod-instance',
  enabled: true,
  ...over,
});

const queries = [
  query({ id: 'q1' }),
  query({ id: 'q2', dashboardLabel: 'Dynatrace host metrics web-2', panelTitle: 'Memory Usage' }),
];

const props = {
  selectedQueryIds: new Set<string>(),
  onSelectAll: jest.fn(),
  onSelectOne: jest.fn(),
  onEditQuery: jest.fn(),
  onDeleteQuery: jest.fn(),
  onToggleEnabled: jest.fn(),
};

const bodyRows = () => screen.getAllByRole('row').slice(1);

beforeEach(() => jest.clearAllMocks());

describe('QueriesTable', () => {
  it('filters rows by host/dashboard', () => {
    render(<QueriesTable queries={queries} {...props} />);
    expect(bodyRows()).toHaveLength(2);

    fireEvent.mouseDown(screen.getByLabelText('Host / Dashboard'));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Dynatrace host metrics web-2'));

    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByText('Memory Usage')).toBeInTheDocument();
  });

  it('select-all offers only the visible ids, so a filtered-out query is never batch-selected', () => {
    render(<QueriesTable queries={queries} {...props} />);

    fireEvent.mouseDown(screen.getByLabelText('Panel Title'));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Memory Usage'));
    fireEvent.click(screen.getByLabelText('Select all queries'));

    expect(props.onSelectAll).toHaveBeenCalledWith(['q2']);
  });

  it('sorts by panel title', () => {
    render(<QueriesTable queries={queries} {...props} />);
    const titles = () => bodyRows().map((r) => r.cells[3].textContent);
    // "Panel Title" is also a filter label — anchor on the column header.
    const sortByTitle = () =>
      fireEvent.click(within(screen.getAllByRole('row')[0]).getByText('Panel Title'));

    sortByTitle();                                               // asc
    expect(titles()).toEqual(['CPU Usage', 'Memory Usage']);
    sortByTitle();                                               // desc
    expect(titles()).toEqual(['Memory Usage', 'CPU Usage']);
  });

  it('shows status and toggles a query from the row action', () => {
    render(<QueriesTable queries={[query({ id: 'q1' }), query({ id: 'q2', enabled: false })]} {...props} />);
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Disable query'));
    expect(props.onToggleEnabled).toHaveBeenCalledWith(expect.objectContaining({ id: 'q1' }));
  });

  it('hides a filter dropdown that has nothing to filter', () => {
    render(<QueriesTable queries={[query({ id: 'q1' })]} {...props} />);
    expect(screen.queryByLabelText('Panel Title')).not.toBeInTheDocument();
  });
});
