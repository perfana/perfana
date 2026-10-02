import React from 'react';
import { render } from '@testing-library/react';
import { ErrorsOverTimeChart } from './ErrorsOverTimeChart';
import type { ErrorByCode, ErrorOverTime, ErrorOverTimeByCode } from '../types';
import { catColor, chartTheme } from '@/lib/charts';

// Capture the traces handed to Plotly. next/dynamic resolves the loader
// eagerly in tests, so stub it the same way SLOMetricsChart.test.tsx does.
const plotProps: { data?: unknown; layout?: unknown } = {};

jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => {
    const Component = (props: { data?: unknown; layout?: unknown }) => {
      plotProps.data = props.data;
      plotProps.layout = props.layout;
      return <div data-testid="plotly-chart" />;
    };
    Component.displayName = 'Plot';
    return Component;
  },
}));

type Trace = { name: string; y: number[]; line: { color: string; width: number } };

const traces = (): Trace[] => (plotProps.data as Trace[]) ?? [];
const layout = () => plotProps.layout as {
  xaxis: { showgrid: boolean; showspikes: boolean; spikedash: string };
  plot_bgcolor: string;
  hovermode: string;
  showlegend: boolean;
  legend: { borderwidth: number; bgcolor: string };
};

const errorsByCode: ErrorByCode[] = [
  { responseCode: '500', errorCount: 3, avgResponseTime: 100, minResponseTime: 90, maxResponseTime: 110 },
];

describe('ErrorsOverTimeChart', () => {
  beforeEach(() => {
    delete plotProps.data;
    delete plotProps.layout;
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

  /**
   * Colours come from the one categorical palette BY SLOT off the sorted code list. They
   * used to be hashed out of a private twelve-entry `CHART_COLORS` array in
   * `error-formatters.ts`, which had two problems a reader would never see: two response
   * codes could hash to the same colour and render as one indistinguishable pair, and the
   * palette ignored the theme entirely.
   */
  it('colours each response code from the shared palette by slot, never by a hash', () => {
    const byCode: ErrorOverTimeByCode[] = [
      { timeBucket: '2026-01-15T22:00:00.000Z', '500': 2, '404': 1, '503': 1 },
    ];

    render(
      <ErrorsOverTimeChart errorsOverTime={[]} errorsOverTimeByCode={byCode} errorsByCode={errorsByCode} />,
    );

    // Sorted: 404, 500, 503 → slots 0, 1, 2.
    expect(traces().map((t) => t.line.color)).toEqual([
      catColor(0, 'light'), catColor(1, 'light'), catColor(2, 'light'),
    ]);
    // The point of the change: three codes, three distinct colours, guaranteed.
    expect(new Set(traces().map((t) => t.line.color)).size).toBe(3);
  });

  it('keeps the verdict colour for the total, which is the one series that IS a verdict', () => {
    render(
      <ErrorsOverTimeChart
        errorsOverTime={[{ timeBucket: '2026-01-15T22:00:00.000Z', errorsPerMinute: 4 }]}
        errorsOverTimeByCode={[]}
        errorsByCode={errorsByCode}
      />,
    );
    expect(traces()[0]!.line.color).toBe(chartTheme('light').error);
  });

  it('is in the Analyst standard: themed surfaces, no vertical gridlines, a crosshair', () => {
    render(
      <ErrorsOverTimeChart
        errorsOverTime={[{ timeBucket: '2026-01-15T22:00:00.000Z', errorsPerMinute: 4 }]}
        errorsOverTimeByCode={[]}
        errorsByCode={errorsByCode}
      />,
    );
    const l = layout();
    expect(l.plot_bgcolor).toBe(chartTheme('light').plotBg);
    expect(l.xaxis.showgrid).toBe(false);
    expect(l.xaxis.showspikes).toBe(true);
    expect(l.xaxis.spikedash).toBe('dot');
    // `x`, not `x unified`.
    expect(l.hovermode).toBe('x');
  });

  it('keeps its Plotly legend, unlike the Analyst cards — nothing else names a code', () => {
    const byCode: ErrorOverTimeByCode[] = [{ timeBucket: '2026-01-15T22:00:00.000Z', '500': 2 }];
    render(
      <ErrorsOverTimeChart errorsOverTime={[]} errorsOverTimeByCode={byCode} errorsByCode={errorsByCode} />,
    );
    expect(layout().showlegend).toBe(true);
    // ...but drops its box, as the standard does everywhere.
    expect(layout().legend.borderwidth).toBe(0);
    expect(layout().legend.bgcolor).toBe('rgba(0,0,0,0)');
  });
});
