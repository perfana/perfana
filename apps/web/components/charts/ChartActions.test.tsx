/**
 * The card-header copy and download buttons.
 *
 * What is worth pinning is the figure they hand Plotly, not the icons. The live layout
 * deliberately carries neither a title nor a legend — the editable heading above the chart
 * is the title and `SeriesTable` below it is the legend, and both are HTML, so neither is
 * on the canvas Plotly rasterises. Without the restoration here a copied PNG is an
 * unlabelled chart with unnamed lines, which is exactly the kind of bug that only shows up
 * after the image has been pasted into someone else's document.
 *
 * The second rule: room for the legend is ADDED to the figure's height rather than taken
 * out of the plot area. Reserving it from a fixed height squeezes a nineteen-series chart
 * into a sliver.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import ChartActions from './ChartActions';
import type { PlotlyGraphDiv } from '@/lib/plotly';

const copyPlotToClipboard = jest.fn();
const plotlyPngBlob = jest.fn();
const downloadPng = jest.fn();

jest.mock('@/lib/plotly', () => ({
  copyPlotToClipboard: (...args: unknown[]) => copyPlotToClipboard(...args),
  downloadPng: (...args: unknown[]) => downloadPng(...args),
  plotlyPngBlob: (...args: unknown[]) => plotlyPngBlob(...args),
  // The real one reads the rendered size off the graph div; here the caller's fallback is
  // the interesting input, so this returns it verbatim.
  plotSize: (_graph: unknown, fallback: { width: number; height: number }) => fallback,
}));

type Figure = {
  data: unknown[];
  layout: {
    height: number;
    showlegend: boolean;
    title: { text: string; font: { color: string } };
    legend: { orientation: string; borderwidth: number; bgcolor: string };
    margin: { t: number; b: number; l?: number };
  };
};

const graphOf = (seriesCount: number, layout: Record<string, unknown> = {}): PlotlyGraphDiv =>
  ({
    data: Array.from({ length: seriesCount }, (_, i) => ({ name: `Heap - s${i}`, y: [1] })),
    layout: { showlegend: false, margin: { l: 46, r: 16, t: 20, b: 24 }, ...layout },
  }) as unknown as PlotlyGraphDiv;

beforeEach(() => {
  jest.clearAllMocks();
  plotlyPngBlob.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
});

/** Press Download and return the figure and size that reached `plotlyPngBlob`. */
async function exported(props: Partial<React.ComponentProps<typeof ChartActions>> = {}) {
  // Isolated, so a test may call this more than once without two charts on the page.
  cleanup();
  plotlyPngBlob.mockClear();
  render(<ChartActions graph={graphOf(2)} mode="light" chartName="Heap usage" {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Download chart as PNG' }));
  await waitFor(() => expect(plotlyPngBlob).toHaveBeenCalled());
  const [figure, size] = plotlyPngBlob.mock.calls[0] as [Figure, { width: number; height: number }];
  return { figure, size };
}

describe('the exported figure', () => {
  it('puts the title and the legend back on, for the image only', async () => {
    const { figure } = await exported();
    expect(figure.layout.showlegend).toBe(true);
    expect(figure.layout.title.text).toBe('Heap usage');
    expect(figure.layout.legend.orientation).toBe('h');
    // No box around the legend: the standard's legend is borderless and transparent.
    expect(figure.layout.legend.borderwidth).toBe(0);
    expect(figure.layout.legend.bgcolor).toBe('rgba(0,0,0,0)');
  });

  it('never touches the live layout — the on-screen chart keeps no title and no legend', async () => {
    const graph = graphOf(2);
    render(<ChartActions graph={graph} mode="light" chartName="Heap usage" />);
    fireEvent.click(screen.getByRole('button', { name: 'Download chart as PNG' }));
    await waitFor(() => expect(plotlyPngBlob).toHaveBeenCalled());

    const live = (graph as unknown as { layout: Record<string, unknown> }).layout;
    expect(live.showlegend).toBe(false);
    expect(live.title).toBeUndefined();
    expect(live.margin).toEqual({ l: 46, r: 16, t: 20, b: 24 });
  });

  it('names an untitled chart "Chart" rather than exporting a blank heading', async () => {
    expect((await exported({ chartName: undefined })).figure.layout.title.text).toBe('Chart');
    expect((await exported({ chartName: '   ' })).figure.layout.title.text).toBe('Chart');
  });

  it('ADDS room for the legend instead of taking it out of the plot area', async () => {
    const { figure, size } = await exported();
    // 2 series = 1 row = 18 + 12 pad, plus 24 for the title.
    expect(figure.layout.height).toBe(600 + 30 + 24);
    expect(size.height).toBe(654);
    expect(size.width).toBe(1200);
    // The bottom margin grows by the legend pad; the live one was 24.
    expect(figure.layout.margin.b).toBe(54);
    expect(figure.layout.margin.t).toBe(44);
  });

  it('grows by a row per three series, so nineteen names are not clipped', async () => {
    render(<ChartActions graph={graphOf(19)} mode="light" chartName="Wide" />);
    fireEvent.click(screen.getByRole('button', { name: 'Download chart as PNG' }));
    await waitFor(() => expect(plotlyPngBlob).toHaveBeenCalled());
    const [figure] = plotlyPngBlob.mock.calls[0] as [Figure];
    // ceil(19/3) = 7 rows.
    expect(figure.layout.height).toBe(600 + (7 * 18 + 12) + 24);
  });

  it('reserves one legend row even for a chart with no traces at all', async () => {
    render(<ChartActions graph={graphOf(0)} mode="light" />);
    fireEvent.click(screen.getByRole('button', { name: 'Download chart as PNG' }));
    await waitFor(() => expect(plotlyPngBlob).toHaveBeenCalled());
    const [figure] = plotlyPngBlob.mock.calls[0] as [Figure];
    expect(figure.layout.height).toBe(600 + 30 + 24);
    expect(figure.data).toEqual([]);
  });

  it('survives a graph div whose layout has not been populated yet', async () => {
    const bare = { data: undefined, layout: undefined } as unknown as PlotlyGraphDiv;
    render(<ChartActions graph={bare} mode="light" />);
    fireEvent.click(screen.getByRole('button', { name: 'Download chart as PNG' }));
    await waitFor(() => expect(plotlyPngBlob).toHaveBeenCalled());
    const [figure] = plotlyPngBlob.mock.calls[0] as [Figure];
    // The default bottom margin, not `NaN`.
    expect(figure.layout.margin.b).toBe(54);
  });

  it('takes the title colour from the mode it is given', async () => {
    const light = await exported({ mode: 'light' });
    const dark = await exported({ mode: 'dark' });
    expect(light.figure.layout.title.font.color).not.toBe(dark.figure.layout.title.font.color);
  });
});

describe('the buttons', () => {
  it('downloads under a filename derived from the chart name', async () => {
    await exported({ chartName: 'My Heap Chart' });
    await waitFor(() => expect(downloadPng).toHaveBeenCalled());
    expect(downloadPng.mock.calls[0]![1]).toBe('my_heap_chart.png');
  });

  it('falls back to chart.png when there is no name', async () => {
    await exported({ chartName: undefined });
    await waitFor(() => expect(downloadPng).toHaveBeenCalled());
    expect(downloadPng.mock.calls[0]![1]).toBe('chart.png');
  });

  it('hands the copy path the same renderer and the fallback filename', () => {
    render(<ChartActions graph={graphOf(1)} mode="light" chartName="Heap" notify={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy chart to clipboard' }));
    expect(copyPlotToClipboard).toHaveBeenCalledTimes(1);
    expect(copyPlotToClipboard.mock.calls[0]![1]).toMatchObject({ fallbackFilename: 'heap.png' });
  });

  it('is disabled until the first render hands over a graph div', () => {
    render(<ChartActions graph={null} mode="light" />);
    expect(screen.getByRole('button', { name: 'Copy chart to clipboard' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download chart as PNG' })).toBeDisabled();
  });

  it('toasts rather than throwing when the render fails', async () => {
    const notify = jest.fn();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    plotlyPngBlob.mockRejectedValue(new Error('Plotly is not loaded'));

    render(<ChartActions graph={graphOf(1)} mode="light" notify={notify} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download chart as PNG' }));

    await waitFor(() => expect(notify).toHaveBeenCalledWith('Could not download the chart'));
    expect(downloadPng).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
