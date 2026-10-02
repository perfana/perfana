/**
 * The Performance Analysis charts in the Analyst standard.
 *
 * These assertions are about the three things the conversion is FOR, each of which a
 * well-meaning edit puts back:
 *
 * - no colour literal of its own: the dark `#121212` paper and `#1e1e1e` plot used to sit
 *   inside a `#1e293b` dialog, three greys on one surface;
 * - no vertical gridlines, because they fight the dotted crosshair spike, which is the
 *   vertical line that means something;
 * - no in-plot title, because the dialog header already names the transaction and metric —
 *   and the 80px top margin that was reserving room for it goes with it.
 */
import { buildPlotLayout, samplerColor } from '../chart-config';
import { generatePlotlyData } from '../trace-builders';
import { chartTheme } from '@/lib/charts';
import type { Theme } from '@mui/material';

const muiTheme = (mode: 'light' | 'dark') => ({ palette: { mode } }) as Theme;

type Axis = { showgrid?: boolean; showspikes?: boolean; spikedash?: string; gridcolor?: string;
  tickfont?: { family?: string }; title?: { text?: string } };
type Layout = { title?: unknown; xaxis: Axis; yaxis: Axis; yaxis2: Axis; hovermode: string;
  plot_bgcolor: string; paper_bgcolor: string; margin: { t: number }; legend: { bgcolor: string; borderwidth: number } };

describe('buildPlotLayout', () => {
  it('takes its surfaces from the chart theme, in both modes', () => {
    for (const mode of ['light', 'dark'] as const) {
      const layout = buildPlotLayout('Average', muiTheme(mode)) as unknown as Layout;
      const theme = chartTheme(mode);
      expect(layout.plot_bgcolor).toBe(theme.plotBg);
      expect(layout.paper_bgcolor).toBe(theme.paper);
      expect(layout.yaxis.gridcolor).toBe(theme.grid);
    }
  });

  it('draws no vertical gridlines and spikes the x axis instead', () => {
    const layout = buildPlotLayout('Average', muiTheme('dark')) as unknown as Layout;
    expect(layout.xaxis.showgrid).toBe(false);
    expect(layout.xaxis.showspikes).toBe(true);
    expect(layout.xaxis.spikedash).toBe('dot');
  });

  it('has no in-plot title, and does not reserve room for one', () => {
    const layout = buildPlotLayout('Average', muiTheme('light')) as unknown as Layout;
    expect(layout.title).toBeUndefined();
    expect(layout.margin.t).toBeLessThan(40);
  });

  it('labels every axis in the mono face', () => {
    const layout = buildPlotLayout('Average', muiTheme('light')) as unknown as Layout;
    for (const axis of [layout.xaxis, layout.yaxis, layout.yaxis2]) {
      expect(axis.tickfont?.family).toContain('Mono');
    }
  });

  it('hovers on x alone, not unified — the stack can hold nineteen samplers', () => {
    expect((buildPlotLayout('Average', muiTheme('light')) as unknown as Layout).hovermode).toBe('x');
  });

  it('keeps the legend but drops its box', () => {
    // There is no series table beside this chart, so the names have to come from somewhere.
    const layout = buildPlotLayout('Average', muiTheme('dark')) as unknown as Layout;
    expect(layout.legend.borderwidth).toBe(0);
    expect(layout.legend.bgcolor).toBe('rgba(0,0,0,0)');
  });
});

describe('samplerColor', () => {
  it('is the categorical palette by slot, as a fill and a border', () => {
    const { fill, border } = samplerColor(0, 'light');
    // alpha() on an opaque hex is safe; these are CAT entries, not translucent tokens.
    expect(fill).toBe('rgba(37, 99, 235, 0.25)');
    expect(border).toBe('rgba(37, 99, 235, 0.6)');
  });

  it('differs by mode — the old fixed table went muddy over the dark plot', () => {
    expect(samplerColor(0, 'dark').fill).not.toBe(samplerColor(0, 'light').fill);
  });

  it('wraps rather than returning undefined past the end of the palette', () => {
    expect(samplerColor(99, 'light').fill).toMatch(/^rgba\(/);
  });
});

describe('generatePlotlyData', () => {
  const data = {
    transaction_data: [
      { time_bucket: '2026-10-02T10:00:00Z', avg_response_time: 100, total_requests: 10, failed_requests: 0 },
    ],
    sampler_data: {
      'S1': [{ time_bucket: '2026-10-02T10:00:00Z', avg_response_time: 50 }],
    },
  } as never;

  it('colours the sampler stack for the mode it is given', () => {
    const light = generatePlotlyData(data, 'T01', 'avg_response_time', 5, 'light');
    const dark = generatePlotlyData(data, 'T01', 'avg_response_time', 5, 'dark');
    const fillOf = (traces: unknown[]) =>
      (traces.find((t) => (t as { name?: string }).name === 'S1') as { fillcolor?: string }).fillcolor;
    expect(fillOf(light)).toBe(samplerColor(0, 'light').fill);
    expect(fillOf(dark)).toBe(samplerColor(0, 'dark').fill);
  });
});
