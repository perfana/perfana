/**
 * Regression tests for two bugs that shipped in TimeModelChart.
 *
 * Both came from an underscore-prefixed identifier that did not do what it
 * looked like it did, and both were invisible because nothing type-checked or
 * rendered this file:
 *
 * 1. `data.map((_entry, index) => <Cell fill={entry.color} />)` — `entry` is
 *    not defined in that scope, so drawing the pie or donut view threw a
 *    ReferenceError and took the card down with it.
 * 2. `getTimeModelColor(_name)` read `name`, which resolves to the global
 *    `window.name`, so every segment fell through to the "Other" grey.
 *
 * recharts needs a non-zero container in jsdom or ResponsiveContainer renders
 * nothing and the Cell map never runs — which would make these tests pass
 * against the broken code. The ResponsiveContainer mock below forces a fixed
 * size so the chart body actually executes.
 */

import { render, screen } from '@testing-library/react';
import { TimeModelChart } from './TimeModelChart';
import type { TimeModelChartData } from '../types';

// jsdom has no ResizeObserver, which recharts' ResponsiveContainer requires.
// Report a fixed box so the chart body renders instead of bailing at 0x0.
class ResizeObserverStub {
  constructor(private cb: ResizeObserverCallback) {}
  observe(target: Element) {
    this.cb(
      [{ target, contentRect: { width: 600, height: 300 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

jest.mock('recharts', () => {
  const actual = jest.requireActual('recharts');
  return {
    ...actual,
    // Give the chart a real box; the default 0x0 in jsdom short-circuits render.
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <actual.ResponsiveContainer width={600} height={300}>
        {children}
      </actual.ResponsiveContainer>
    ),
  };
});

const DATA: TimeModelChartData = {
  dbTime: 100,
  dbCpu: 40,
  sqlExecute: 30,
  parseTime: 20,
};

describe('TimeModelChart', () => {
  it('renders the pie view without throwing', () => {
    // Before the fix this threw: ReferenceError: entry is not defined
    expect(() => render(<TimeModelChart data={DATA} chartType="pie" />)).not.toThrow();
  });

  it('renders the donut view without throwing', () => {
    expect(() => render(<TimeModelChart data={DATA} chartType="donut" />)).not.toThrow();
  });

  it('renders the bar view without throwing', () => {
    expect(() => render(<TimeModelChart data={DATA} chartType="bar" />)).not.toThrow();
  });

  it('gives each segment its own colour rather than the Other fallback', () => {
    const { container } = render(<TimeModelChart data={DATA} chartType="pie" />);
    const fills = Array.from(container.querySelectorAll('path[fill]'))
      .map(p => p.getAttribute('fill'))
      .filter((f): f is string => !!f && f !== 'none');

    // getTimeModelColor previously read the global `window.name`, so every
    // segment resolved to the same 'Other' grey.
    const distinct = new Set(fills);
    expect(fills.length).toBeGreaterThan(0);
    expect(distinct.size).toBeGreaterThan(1);
    expect(distinct.has('#9e9e9e') && distinct.size === 1).toBe(false);
  });

  it('shows the empty state when there is no time model data', () => {
    render(<TimeModelChart data={{ dbTime: 0 }} chartType="pie" />);
    expect(screen.getByText(/no time model data available/i)).toBeInTheDocument();
  });
});
