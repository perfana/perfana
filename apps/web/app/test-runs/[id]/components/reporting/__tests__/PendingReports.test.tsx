import React from 'react';
import { render, screen, act } from '@testing-library/react';
import PendingReports from '../PendingReports';

jest.mock('@/lib/api/reports', () => ({ getReport: jest.fn() }));
import { getReport } from '@/lib/api/reports';

const report = (id: string, status: string, progress?: object) => ({ id, status, progress });

beforeEach(() => {
  jest.useFakeTimers();
  (getReport as jest.Mock).mockReset();
});
afterEach(() => jest.useRealTimers());

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const tick = async () => { await act(async () => { jest.advanceTimersByTime(1000); }); await flush(); };

it('polls every pending report on its own and settles each one once', async () => {
  // One slot used to hold one id: a second report replaced the first, whose completion then
  // never opened the viewer.
  (getReport as jest.Mock).mockImplementation(async (id: string) =>
    id === 'a' ? report('a', 'html_complete') : report('b', 'processing', { stage: 'rendering', percent: 40, done: 2, total: 5, section: 'Custom Graphs' }));
  const onReady = jest.fn(); const onSettled = jest.fn(); const showToast = jest.fn();

  render(<PendingReports ids={['a', 'b']} onReady={onReady} onSettled={onSettled} showToast={showToast} />);
  await flush();

  expect(onReady).toHaveBeenCalledWith('a');
  expect(onSettled).toHaveBeenCalledWith('a');
  expect(showToast).toHaveBeenCalledWith('Report ready');
  expect(onSettled).not.toHaveBeenCalledWith('b');
  expect(screen.getByText('Rendering section 3 of 5: Custom Graphs')).toBeInTheDocument();

  // b keeps polling once a second; a is done and never asked again
  await tick();
  expect((getReport as jest.Mock).mock.calls.filter(([id]) => id === 'b')).toHaveLength(2);
  expect((getReport as jest.Mock).mock.calls.filter(([id]) => id === 'a')).toHaveLength(1);
});

it('stops polling a report the page stopped tracking', async () => {
  (getReport as jest.Mock).mockResolvedValue(report('b', 'pending'));
  const { rerender } = render(<PendingReports ids={['b']} onReady={jest.fn()} onSettled={jest.fn()} showToast={jest.fn()} />);
  await flush();
  expect(screen.getByText('Waiting for a worker…')).toBeInTheDocument();

  rerender(<PendingReports ids={[]} onReady={jest.fn()} onSettled={jest.fn()} showToast={jest.fn()} />);
  await tick();
  await tick();

  expect(getReport).toHaveBeenCalledTimes(1);
});
