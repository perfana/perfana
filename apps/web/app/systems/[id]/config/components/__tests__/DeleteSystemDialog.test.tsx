/**
 * The delete preview renders one row per NON-ZERO key of `counts`, labelled from a local
 * `RESOURCE_LABELS` map. A key the API sends that the map does not know renders a row with a
 * blank label and nothing in the console — the dialog still reads as "N resources will be
 * deleted" with an unnamed line in it. The API gained `seriesGroupingRules` and `seriesGroups`
 * (series grouping, migration 1819), both hidden at zero, so the label only matters from the
 * first saved rule onwards.
 */
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import DeleteSystemDialog from '../DeleteSystemDialog';
import { authenticatedFetch } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

/** Every key `DeleteSystemUnderTestHandler.getDeletePreview` returns, all zero. */
const ZERO_COUNTS = {
  testRuns: 0,
  applicationDashboards: 0,
  benchmarks: 0,
  deepLinks: 0,
  events: 0,
  expectedConfigChanges: 0,
  tracingServices: 0,
  notificationChannels: 0,
  dynatraceEntityMappings: 0,
  dsMetrics: 0,
  dsChangePoints: 0,
  dsControlGroups: 0,
  checkResults: 0,
  testRunConfigs: 0,
  requestsRaw: 0,
  transactions: 0,
  transactionStats: 0,
  apdexThresholds: 0,
  graphPresets: 0,
  filterPresets: 0,
  seriesGroupingRules: 0,
  seriesGroups: 0,
};

function stubPreview(counts: Partial<typeof ZERO_COUNTS>) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ systemName: 'webshop', counts: { ...ZERO_COUNTS, ...counts } }),
  } as unknown as Response);
}

function renderDialog() {
  return render(<DeleteSystemDialog open onClose={jest.fn()} systemId="sut-1" systemName="webshop" />);
}

/** The label and count text of every row in the preview table. */
async function previewRows(): Promise<Array<[string, string]>> {
  const dialog = await screen.findByRole('dialog');
  const table = await within(dialog).findByRole('table');
  return within(table)
    .getAllByRole('row')
    .map((row) => {
      const cells = within(row).getAllByRole('cell');
      return [cells[0]!.textContent ?? '', cells[1]!.textContent ?? ''] as [string, string];
    });
}

describe('DeleteSystemDialog preview', () => {
  beforeEach(() => mockFetch.mockReset());

  it('names the series grouping rows it is told about', async () => {
    stubPreview({ seriesGroupingRules: 3, seriesGroups: 1204 });
    renderDialog();

    const rows = await previewRows();

    expect(rows).toContainEqual(['Series Grouping Rules', '3']);
    expect(rows).toContainEqual(['Series Group Memberships', '1,204']);
  });

  it('never renders a row with a blank label, whatever combination is non-zero', async () => {
    // Every key at once: a key the dialog has no label for would show up as ''.
    stubPreview(Object.fromEntries(Object.keys(ZERO_COUNTS).map((k) => [k, 2])));
    renderDialog();

    const rows = await previewRows();

    expect(rows).toHaveLength(Object.keys(ZERO_COUNTS).length);
    expect(rows.filter(([label]) => label.trim() === '')).toEqual([]);
  });

  it('hides the series grouping rows while they are zero, as it does every other count', async () => {
    stubPreview({ testRuns: 4 });
    renderDialog();

    const rows = await previewRows();

    expect(rows).toEqual([['Test Runs', '4']]);
  });

  it('falls back to the empty-state line when only zero counts come back', async () => {
    stubPreview({});
    renderDialog();

    await waitFor(() => {
      expect(screen.getByText(/No related resources found/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
