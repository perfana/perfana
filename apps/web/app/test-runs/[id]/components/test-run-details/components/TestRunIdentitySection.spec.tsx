import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TestRunIdentitySection } from './TestRunIdentitySection';
import { authenticatedFetch } from '@/lib/api';
import type { TestRun } from '@/types/test-runs';

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })),
}));

beforeEach(() => {
  (authenticatedFetch as jest.Mock).mockClear();
  (authenticatedFetch as jest.Mock).mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
});

const makeTestRun = (overrides?: Partial<TestRun>): TestRun =>
  ({
    id: 'uuid-1',
    test_run_id: 'PerfanaWebshop-acc-loadTest-00018',
    application_release: '2.4.3',
    completed: true,
    ...overrides,
  }) as TestRun;

it('saves an edited version and hands the new value back to the card', async () => {
  const onTestRunUpdate = jest.fn();
  const showToast = jest.fn();
  render(
    <TestRunIdentitySection testRun={makeTestRun()} onTestRunUpdate={onTestRunUpdate} showToast={showToast} />
  );

  fireEvent.click(screen.getByRole('button', { name: /edit version/i }));
  const input = screen.getByPlaceholderText(/e\.g\. 2\.4\.3/i);
  fireEvent.change(input, { target: { value: '2.5.0' } });
  fireEvent.click(screen.getByRole('button', { name: /save version/i }));

  await waitFor(() => expect(authenticatedFetch).toHaveBeenCalledWith(
    '/test-runs/uuid-1/application-release',
    expect.objectContaining({ method: 'PUT', body: JSON.stringify({ applicationRelease: '2.5.0' }) }),
  ));
  await waitFor(() => expect(onTestRunUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ application_release: '2.5.0' }),
  ));
  expect(showToast).toHaveBeenCalledWith('Version updated successfully');
});

it('does not call the API when the value is unchanged', async () => {
  render(<TestRunIdentitySection testRun={makeTestRun()} />);

  fireEvent.click(screen.getByRole('button', { name: /edit version/i }));
  fireEvent.click(screen.getByRole('button', { name: /save version/i }));

  await waitFor(() => expect(screen.queryByPlaceholderText(/e\.g\./i)).not.toBeInTheDocument());
  expect(authenticatedFetch).not.toHaveBeenCalled();
});

it('keeps the old value on screen when the save fails', async () => {
  (authenticatedFetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500 });
  const onTestRunUpdate = jest.fn();
  const showToast = jest.fn();
  render(
    <TestRunIdentitySection testRun={makeTestRun()} onTestRunUpdate={onTestRunUpdate} showToast={showToast} />
  );

  fireEvent.click(screen.getByRole('button', { name: /edit version/i }));
  fireEvent.change(screen.getByPlaceholderText(/e\.g\./i), { target: { value: 'broken' } });
  fireEvent.click(screen.getByRole('button', { name: /save version/i }));

  await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to update version'));
  expect(onTestRunUpdate).not.toHaveBeenCalled();
});
