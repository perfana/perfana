import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { authenticatedFetch } from '@/lib/api';
import { ReportVariablesProvider } from '@/components/reports/report-generation/ReportVariablesProvider';
import { MarkdownField } from '@/components/reports/report-generation/MarkdownField';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));

const mockFetch = authenticatedFetch as jest.Mock;

function renderPicker(props: { testRunId?: string; enabled?: boolean } = {}) {
  // `'testRunId' in props` rather than a destructuring default: passing an explicit
  // undefined is the case under test, and a default would swallow it.
  const testRunId = 'testRunId' in props ? props.testRunId : 'run-1';
  const enabled = props.enabled ?? true;
  render(
    <ReportVariablesProvider testRunId={testRunId} enabled={enabled}>
      <MarkdownField label="Text" value="" onChange={jest.fn()} markdown />
    </ReportVariablesProvider>,
  );
}

describe('ReportVariablesProvider', () => {
  beforeEach(() => mockFetch.mockReset());

  it("offers this run's config keys, deduped and sorted", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [{ key: 'zeta' }, { key: 'alpha' }, { key: 'alpha' }, {}],
    });
    renderPicker();

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText('Insert value'));

    expect(await screen.findByText('Test run configuration')).toBeInTheDocument();
    const keys = screen.getAllByText(/^(alpha|zeta)$/).map((n) => n.textContent);
    expect(keys).toEqual(['alpha', 'zeta']);
  });

  it('never offers a secret-shaped key — the resolver would not substitute it anyway', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        { key: 'build.number' },
        { key: 'db.password' },
        { key: 'API_TOKEN' },
        { key: 'private_key' },
      ],
    });
    renderPicker();

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText('Insert value'));

    expect(await screen.findByText('build.number')).toBeInTheDocument();
    expect(screen.queryByText('db.password')).toBeNull();
    expect(screen.queryByText('API_TOKEN')).toBeNull();
    expect(screen.queryByText('private_key')).toBeNull();
  });

  it('degrades to the built-ins when the lookup returns an error status', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    renderPicker();

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText('Insert value'));

    expect(screen.queryByText('Test run configuration')).toBeNull();
    expect(screen.getByText('Workload')).toBeInTheDocument();
  });

  it('degrades to the built-ins when the lookup rejects outright', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));
    renderPicker();

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText('Insert value'));

    expect(screen.queryByText('Test run configuration')).toBeNull();
    expect(screen.getByText('Workload')).toBeInTheDocument();
  });

  it('fires no request while the surface is closed', async () => {
    // The report dialog is mounted as soon as a test run resolves and only `open`
    // decides whether it renders. Without this gate every test-run page view paid
    // for an unbounded config fetch nobody asked for.
    renderPicker({ enabled: false });
    await Promise.resolve();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fires no request without a test run — the template builder has none', async () => {
    renderPicker({ testRunId: undefined });
    await Promise.resolve();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('encodes the test run id into the path', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => [] });
    renderPicker({ testRunId: 'run/with spaces' });

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(mockFetch.mock.calls[0][0]).toBe('/test-runs/run%2Fwith%20spaces/configs');
  });
});
