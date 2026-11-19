import * as fs from 'fs';
import * as path from 'path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ImportSplunkDashboardDialog from '../ImportSplunkDashboardDialog';
import { createSplunkQuery } from '@/lib/splunk';

jest.mock('@/lib/splunk', () => ({ createSplunkQuery: jest.fn() }));
const mockCreate = createSplunkQuery as jest.Mock;

const fixture = fs.readFileSync(
  path.join(__dirname, '../../../../../../__tests__/lib/fixtures/splunk-studio-dashboard.json'),
  'utf8',
);
const scope = { systemUnderTestId: 'sut-1', testEnvironment: 'acc', workload: 'load' };

function setup(overrides: Partial<React.ComponentProps<typeof ImportSplunkDashboardDialog>> = {}) {
  const props = {
    open: true,
    configId: 'cfg-1',
    scope,
    existing: [],
    mappings: [],
    onClose: jest.fn(),
    onImported: jest.fn(),
    ...overrides,
  };
  render(<ImportSplunkDashboardDialog {...props} />);
  fireEvent.change(screen.getByLabelText('Dashboard JSON'), { target: { value: fixture } });
  fireEvent.click(screen.getByRole('button', { name: 'Review panels' }));
  return props;
}

beforeEach(() => mockCreate.mockReset().mockResolvedValue({}));

it('creates every ticked panel under the dashboard title, one at a time', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  mockCreate.mockImplementation(async () => {
    maxInFlight = Math.max(maxInFlight, ++inFlight);
    await Promise.resolve();
    inFlight--;
    return {};
  });
  const props = setup();
  const button = screen.getByRole('button', { name: /^Import \d+ panels$/ });
  const count = Number(/\d+/.exec(button.textContent!)![0]);
  fireEvent.click(button);

  await waitFor(() => expect(props.onClose).toHaveBeenCalled());
  expect(mockCreate).toHaveBeenCalledTimes(count);
  expect(maxInFlight).toBe(1);
  expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
    ...scope,
    splunkConfigId: 'cfg-1',
    dashboardLabel: 'BTE performancetest',
    panelTitle: 'VKB per minuut',
    splitBy: 'richting',
    aggregation: 'count',
  }));
  expect(props.onImported).toHaveBeenCalledWith(count);
});

it('starts a panel whose title already exists unticked', () => {
  setup({ existing: [{ panelTitle: 'VKB per minuut' } as never] });
  expect(screen.getByRole('checkbox', { name: 'Import VKB per minuut' })).not.toBeChecked();
  expect(screen.getByText('A panel with this title already exists')).toBeInTheDocument();
});

it('warns about an index that is not mapped, and not about one that is', () => {
  setup();
  expect(screen.getByRole('alert')).toHaveTextContent(/index=ecm-sts-appl.*not mapped/);
});

it('stays open on a failure, showing it on the row with only that row still ticked', async () => {
  mockCreate.mockImplementation(async (input: { panelTitle: string }) => {
    if (input.panelTitle === 'EWF per minuut') throw new Error('Splunk: nope');
    return {};
  });
  const props = setup({ mappings: [{ indexName: 'ecm-sts-appl' } as never] });
  expect(screen.queryByText(/is not mapped/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Import \d+ panels$/ }));

  expect(await screen.findByText('Splunk: nope')).toBeInTheDocument();
  expect(props.onClose).not.toHaveBeenCalled();
  expect(props.onImported).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Import 1 panel' })).toBeEnabled();
});

it('shows a readable error for something that is not a Studio dashboard', () => {
  render(<ImportSplunkDashboardDialog open configId="c" scope={scope} existing={[]} mappings={[]} onClose={jest.fn()} onImported={jest.fn()} />);
  fireEvent.change(screen.getByLabelText('Dashboard JSON'), { target: { value: '<dashboard></dashboard>' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review panels' }));
  expect(screen.getByText(/not valid JSON/)).toBeInTheDocument();
});
