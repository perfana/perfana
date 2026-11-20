import React from 'react';
import { act, render } from '@testing-library/react';
import GraphsCard from '../GraphsCard';
import type { SeriesConfig } from '../types';

// Everything around the marker logic is mocked: the chart, the presets and the comments context.
const graphsData: Record<string, unknown> = {};
const commentsCtx: Record<string, unknown> = {};
let expandedProps: Record<string, unknown> = {};

jest.mock('../hooks', () => ({
  useGraphsData: () => graphsData,
  useGraphsPresets: () => ({ presets: [], presetsLoading: false, setSavePresetModalOpen: jest.fn() }),
}));
jest.mock('../components', () => ({
  GraphsCollapsedView: () => null,
  GraphsExpandedContent: (props: Record<string, unknown>) => {
    expandedProps = props;
    return null;
  },
}));
jest.mock('../SaveGraphPresetModal', () => () => null);
jest.mock('../../shared/ExpandableCardHeader', () => ({ __esModule: true, default: () => null, kickPlotlyResize: jest.fn() }));
jest.mock('../../comments/CommentsContext', () => ({
  useComments: () => commentsCtx,
  useGraphMarkers: () => [],
}));

const series = (i: number): SeriesConfig => ({
  id: `s${i}`, dashboardId: 'd', dashboardLabel: 'JVM', panelId: i, panelTitle: `P${i}`, metricName: `m${i}`, source: 'grafana',
});

const reset = (over: Record<string, unknown> = {}) => {
  for (const k of Object.keys(graphsData)) delete graphsData[k];
  Object.assign(graphsData, {
    addedSeries: [series(1)],
    zoomRange: null,
    axisMode: 'overlay',
    customChartName: null,
    chartName: 'x',
    seriesData: new Map(),
    getAllDashboardsMerged: () => [],
    loadView: jest.fn().mockResolvedValue(0),
    ...over,
  });
  for (const k of Object.keys(commentsCtx)) delete commentsCtx[k];
  Object.assign(commentsCtx, { startMarker: jest.fn(), openCard: null, viewRequest: null, registerViewCapture: jest.fn(() => () => undefined) });
};

const renderCard = (showToast = jest.fn()) => {
  const utils = render(
    <GraphsCard testRun={null} testRunId="run" graphsExpanded onGraphsExpand={jest.fn()} showToast={showToast} events={[]} />,
  );
  const rerender = () =>
    utils.rerender(
      <GraphsCard testRun={null} testRunId="run" graphsExpanded onGraphsExpand={jest.fn()} showToast={showToast} events={[]} />,
    );
  return { rerender, showToast };
};

const markerView = (key: string) => ({
  card: 'graphs' as const,
  key,
  comment: {
    id: 'm1', markerSeq: 4,
    chartContext: {
      series: [{ dashboardId: 'd', dashboardLabel: 'JVM', panelId: 9, panelTitle: 'Heap', metricName: 'used', source: 'grafana' }],
      xRange: ['2026-11-20T10:00:00Z', '2026-11-20T10:05:00Z'],
      axisMode: 'split',
      title: 'Heap spike',
    },
  },
});

// Value: protects=a marker's "Restore view" / ?comment= deep link replacing the Graphs chart once
// per request key, and its Undo restoring exactly the chart that was there before (series, zoom,
// axis mode, custom title); fails_when=GraphsCard drops the consumed-key set (any re-render replays
// again and clobbers user edits), captures `previous` after loadView instead of before, maps
// xRange/axisMode wrongly, or wires Undo to anything but loadView(previous); why_new=the comments
// suite stops at the viewRequest key, nothing rendered GraphsCard's effect; seam=none (module
// mocks of useGraphsData/useComments/children); no_claim=loadView's fetching (useGraphsData.loadView.test.ts)
// or the drawer's Restore button.
describe('GraphsCard marker view replay', () => {
  it('replays a view key once, then Undo loads the previous view', async () => {
    const before = [series(1), series(2)];
    reset({ addedSeries: before, zoomRange: { from: 'a', to: 'b' }, axisMode: 'overlay', customChartName: 'Mine' });
    commentsCtx.viewRequest = markerView('comment:m1:1');
    const { rerender, showToast } = renderCard();
    await act(async () => undefined);

    const loadView = graphsData.loadView as jest.Mock;
    expect(loadView).toHaveBeenCalledTimes(1);
    const view = loadView.mock.calls[0][0];
    expect(view.series.map((s: SeriesConfig) => [s.panelId, s.metricName])).toEqual([[9, 'used']]);
    expect(view.range).toEqual({ from: '2026-11-20T10:00:00Z', to: '2026-11-20T10:05:00Z' });
    expect(view.axisMode).toBe('split');
    expect(view.title).toBe('Heap spike');

    // A new object for the same key (a context re-render) must not replay again.
    commentsCtx.viewRequest = { ...markerView('comment:m1:1') };
    rerender();
    await act(async () => undefined);
    expect(loadView).toHaveBeenCalledTimes(1);

    expect(showToast).toHaveBeenCalledWith("Showing marker 4's view", expect.objectContaining({ label: 'Undo' }));
    const undo = showToast.mock.calls[0][1].onClick as () => void;
    act(() => undo());
    expect(loadView).toHaveBeenCalledTimes(2);
    expect(loadView.mock.calls[1][0]).toEqual({ series: before, range: { from: 'a', to: 'b' }, axisMode: 'overlay', title: 'Mine' });

    // A fresh key (Restore view pressed again) does replay.
    commentsCtx.viewRequest = markerView('comment:m1:2');
    rerender();
    await act(async () => undefined);
    expect(loadView).toHaveBeenCalledTimes(3);
  });

  it('says how many series have no data in the marker window', async () => {
    reset({ loadView: jest.fn().mockResolvedValue(1) });
    commentsCtx.viewRequest = markerView('comment:m1:1');
    const { showToast } = renderCard();
    await act(async () => undefined);
    expect(showToast).toHaveBeenCalledWith("Showing marker 4's view · 1 of 1 series have no data in this window", expect.anything());
  });

  // loadView swaps the chart before it fetches, so a failed replay has already replaced the user's view.
  it('still offers Undo when the replay fails', async () => {
    reset({ loadView: jest.fn().mockRejectedValue(new Error('down')) });
    commentsCtx.viewRequest = markerView('comment:m1:1');
    const { showToast } = renderCard();
    await act(async () => undefined);
    expect(showToast).toHaveBeenCalledWith('That view could not be loaded', expect.objectContaining({ label: 'Undo' }));
  });
});

// Value: protects=the view a new marker records: at most MARKER_MAX_SERIES (50) series with a toast
// saying so, an xRange only while the chart is zoomed, and the custom title only when one was typed;
// fails_when=the cap or its toast is dropped (the API refuses >50 and the post fails), xRange is sent
// for an unzoomed chart (a replay would zoom into the whole run's explicit bounds), or the generated
// chartName is stored as a title; why_new=the placing test in comments.test.tsx stubs capture() with
// a fixed object; seam=none; no_claim=the API's own MARKER_MAX_SERIES validation (comment.dto.spec.ts).
describe('GraphsCard captureView', () => {
  const capture = () => {
    const onStartMarker = expandedProps.onStartMarker as (steps: string[], initial: string) => void;
    act(() => onStartMarker(['t1', 't2'], 't1'));
    const draft = (commentsCtx.startMarker as jest.Mock).mock.calls[0][0];
    expect(draft.time).toBe('t1');
    expect(draft.steps).toEqual(['t1', 't2']);
    return draft.capture();
  };

  it('caps the series at 50 with a toast, and records zoom and title', () => {
    reset({
      addedSeries: Array.from({ length: 53 }, (_, i) => series(i)),
      zoomRange: { from: 'f', to: 't' },
      axisMode: 'split',
      customChartName: 'Typed',
    });
    const { showToast } = renderCard();
    const ctx = capture();
    expect(ctx.series).toHaveLength(50);
    expect(ctx.series[49].panelId).toBe(49);
    expect(showToast).toHaveBeenCalledWith('Only the first 50 of 53 series are recorded with this comment');
    expect(ctx.xRange).toEqual(['f', 't']);
    expect(ctx.axisMode).toBe('split');
    expect(ctx.title).toBe('Typed');
  });

  it('records no xRange and no title for an unzoomed, untitled chart, and no toast under the cap', () => {
    reset({ addedSeries: Array.from({ length: 50 }, (_, i) => series(i)) });
    const { showToast } = renderCard();
    const ctx = capture();
    expect(ctx.series).toHaveLength(50);
    expect(showToast).not.toHaveBeenCalled();
    expect('xRange' in ctx).toBe(false);
    expect('title' in ctx).toBe(false);
  });
});

// Value: protects=a plain Graphs comment records the chart's view through the capture GraphsCard
// registers under 'graphs', and records nothing for an empty chart; fails_when=GraphsCard stops
// registering, registers under another card, or drops the empty-chart guard (the API refuses a
// view with no series, so every comment on an empty Graphs card would fail to post); why_new=the
// suite mocks registerViewCapture and never calls what it was handed, and the drawer test registers
// its own stub; seam=none; no_claim=the view's contents beyond series (GraphsCard captureView tests).
describe('GraphsCard plain-comment view capture', () => {
  const registered = () => {
    const calls = (commentsCtx.registerViewCapture as jest.Mock).mock.calls;
    const last = calls[calls.length - 1] as [string, () => unknown];
    expect(last[0]).toBe('graphs');
    return last[1];
  };

  it('records the chart view, and null once the chart is empty', () => {
    reset({ addedSeries: [series(1), series(2)], axisMode: 'split' });
    const { rerender } = renderCard();
    const capture = registered();
    expect(capture()).toEqual(expect.objectContaining({
      axisMode: 'split',
      series: [expect.objectContaining({ panelId: 1 }), expect.objectContaining({ panelId: 2 })],
    }));
    graphsData.addedSeries = [];
    rerender();
    expect(registered()()).toBeNull();
  });
});
