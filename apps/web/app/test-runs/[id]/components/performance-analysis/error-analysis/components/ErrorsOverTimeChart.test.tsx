import React from 'react';
import { render } from '@testing-library/react';
import { ErrorsOverTimeChart } from './ErrorsOverTimeChart';
import type { ErrorByCode, ErrorOverTime, ErrorOverTimeByCode } from '../types';

// Capture the traces handed to Plotly. next/dynamic resolves the loader
// eagerly in tests, so stub it the same way SLOMetricsChart.test.tsx does.
const plotProps: { data?: unknown } = {};

jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => {
    const Component = (props: { data?: unknown }) => {
      plotProps.data = props.data;
      return <div data-testid="plotly-chart" />;
    };
    Component.displayName = 'Plot';
    return Component;
  },
}));

type Trace = { name: string; y: number[] };

const traces = (): Trace[] => (plotProps.data as Trace[]) ?? [];

const errorsByCode: ErrorByCode[] = [
  { responseCode: '500', errorCount: 3, avgResponseTime: 100, minResponseTime: 90, maxResponseTime: 110 },
];

describe('ErrorsOverTimeChart', () => {
  beforeEach(() => {
    delete plotProps.data;
  });

  it('builds one trace per response code and reads a bucket with no errors as zero', () => {
    // The 22:01 bucket has no 404 key at all — the API only emits codes that
    // occurred. That must plot as 0, not as a hole in the line.
    const byCode: ErrorOverTimeByCode[] = [
      { timeBucket: '2026-01-15T22:00:00.000Z', '500': 2, '404': 1 },
      { timeBucket: '2026-01-15T22:01:00.000Z', '500': 3 },
    ];

    render(
      <ErrorsOverTimeChart errorsOverTime={[]} errorsOverTimeByCode={byCode} errorsByCode={errorsByCode} />,
    );

    expect(traces().map((t) => t.name)).toEqual(['Error 404', 'Error 500']);
    expect(traces().find((t) => t.name === 'Error 404')?.y).toEqual([1, 0]);
    expect(traces().find((t) => t.name === 'Error 500')?.y).toEqual([2, 3]);
  });

  it('falls back to a single total-errors trace when the grouped endpoint returns nothing', () => {
    const overTime: ErrorOverTime[] = [
      { timeBucket: '2026-01-15T22:00:00.000Z', errorsPerMinute: 4 },
      { timeBucket: '2026-01-15T22:01:00.000Z', errorsPerMinute: 1 },
    ];

    render(
      <ErrorsOverTimeChart errorsOverTime={overTime} errorsOverTimeByCode={[]} errorsByCode={errorsByCode} />,
    );

    expect(traces()).toHaveLength(1);
    expect(traces()[0]?.name).toBe('Total errors per minute');
    expect(traces()[0]?.y).toEqual([4, 1]);
  });
});
