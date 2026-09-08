import React from 'react';
import { render, screen } from '@testing-library/react';
import ResponsivePlot from '@/components/ResponsivePlot';

// Capture what reaches the real Plot, and render the class ResponsivePlot looks for.
// Each instance gets its own testid so a two-chart test can tell them apart.
const plotProps: Array<Record<string, unknown>> = [];
let plotSeq = 0;
jest.mock('react-plotly.js', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    plotProps.push(props);
    return (
      <div
        className="js-plotly-plot"
        data-testid={`plot-${++plotSeq}`}
        data-use-resize={String(props.useResizeHandler)}
      />
    );
  },
}));

// jsdom has no ResizeObserver; capture each instance's callback so tests can fire it.
let observers: Array<{ el: Element | null; cb: ResizeObserverCallback }> = [];
const disconnect = jest.fn();
const resize = jest.fn(() => Promise.resolve());

const entry = (width: number, height = 400) =>
  [{ contentRect: { width, height } } as ResizeObserverEntry];

function installResizeObserver() {
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver = class {
    cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.cb = cb; }
    observe(el: Element) { observers.push({ el, cb: this.cb }); }
    unobserve() {}
    disconnect = disconnect;
  };
}

beforeEach(() => {
  plotProps.length = 0;
  plotSeq = 0;
  observers = [];
  disconnect.mockClear();
  resize.mockClear();
  installResizeObserver();
  (window as unknown as { Plotly?: unknown }).Plotly = { Plots: { resize } };
});

afterEach(() => {
  delete (window as unknown as { Plotly?: unknown }).Plotly;
});

it('forwards every prop, including useResizeHandler, to the underlying Plot', async () => {
  const layout = { title: 'trend' };
  render(<ResponsivePlot data={[{ x: [1] }]} layout={layout} useResizeHandler />);

  expect(await screen.findByTestId('plot-1')).toHaveAttribute('data-use-resize', 'true');
  expect(plotProps[0]).toMatchObject({ data: [{ x: [1] }], layout, useResizeHandler: true });
});

it('observes its own wrapper div', async () => {
  render(<ResponsivePlot data={[]} layout={{}} useResizeHandler />);
  const gd = await screen.findByTestId('plot-1');

  expect(observers).toHaveLength(1);
  expect(observers[0].el).toBe(gd.parentElement);
});

it('resizes only its own graph div when two charts share a page', async () => {
  const onWindowResize = jest.fn();
  window.addEventListener('resize', onWindowResize);

  render(
    <>
      <ResponsivePlot data={[]} layout={{}} useResizeHandler />
      <ResponsivePlot data={[]} layout={{}} useResizeHandler />
    </>,
  );
  const first = await screen.findByTestId('plot-1');
  const second = await screen.findByTestId('plot-2');
  expect(observers).toHaveLength(2);

  observers[1].cb(entry(800), {} as ResizeObserver);

  expect(resize).toHaveBeenCalledTimes(1);
  expect(resize).toHaveBeenCalledWith(second);
  expect(resize).not.toHaveBeenCalledWith(first);
  // A global window kick would relayout every other chart on the page.
  expect(onWindowResize).not.toHaveBeenCalled();
  window.removeEventListener('resize', onWindowResize);
});

it('skips a zero-width entry (chart in a hidden tab panel)', async () => {
  render(<ResponsivePlot data={[]} layout={{}} useResizeHandler />);
  await screen.findByTestId('plot-1');

  observers[0].cb(entry(0, 0), {} as ResizeObserver);

  expect(resize).not.toHaveBeenCalled();
});

it('swallows the rejection Plotly throws for a hidden graph div', async () => {
  resize.mockImplementationOnce(() =>
    Promise.reject(new Error('Resize must be passed a displayed plot div element.')));
  const onUnhandled = jest.fn();
  process.on('unhandledRejection', onUnhandled);

  render(<ResponsivePlot data={[]} layout={{}} useResizeHandler />);
  await screen.findByTestId('plot-1');
  observers[0].cb(entry(800), {} as ResizeObserver);
  await Promise.resolve();
  await Promise.resolve();

  expect(onUnhandled).not.toHaveBeenCalled();
  process.off('unhandledRejection', onUnhandled);
});

it('renders without a resize observer rather than throwing', () => {
  delete (global as unknown as { ResizeObserver?: unknown }).ResizeObserver;
  expect(() => render(<ResponsivePlot data={[]} layout={{}} useResizeHandler />)).not.toThrow();
  installResizeObserver();
});

it('creates exactly one observer across re-renders with new props', () => {
  const { rerender } = render(<ResponsivePlot data={[]} layout={{ height: 400 }} useResizeHandler />);
  rerender(<ResponsivePlot data={[]} layout={{ height: 500 }} useResizeHandler />);

  expect(observers).toHaveLength(1);
});

it('disconnects the observer on unmount', () => {
  const { unmount } = render(<ResponsivePlot data={[]} layout={{}} useResizeHandler />);
  unmount();
  expect(disconnect).toHaveBeenCalled();
});
