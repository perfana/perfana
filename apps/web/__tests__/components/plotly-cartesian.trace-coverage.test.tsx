/**
 * The cartesian plotly bundle must register — and actually draw — every trace type
 * the app uses.
 *
 * `@/components/plotly-cartesian` builds the chart component from
 * `plotly.js/dist/plotly-cartesian` rather than the full `plotly.js/dist/plotly`,
 * dropping the 3-D, map and polar families and `maplibre-gl` with them,
 * which is the reason for the switch.
 *
 * The failure mode if a chart reaches for a type the bundle does not carry is
 * silent: plotly logs nothing the user sees and the plot simply comes out empty.
 * So this asserts against the real bundle rather than trusting a comment — both
 * that the type is registered, and that it puts marks in the SVG.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import Plot from '@/components/plotly-cartesian';

type PlotlySchema = { PlotSchema: { get: () => { traces: Record<string, unknown> } } };

/**
 * The trace types of the bundle THE COMPONENT loaded — read off `window.Plotly`,
 * which plotly's factory body assigns when the component's own import evaluates.
 *
 * This file used to `import Plotly from 'plotly.js/dist/plotly-cartesian'` directly
 * and assert against that — decoupled from `components/plotly-cartesian.ts`, so it
 * described a bundle the component need not have been loading. Reading the global
 * makes these assertions true of the real thing.
 *
 * It does NOT, on its own, catch the component being repointed, and measuring that
 * is the only way to know: a swap to `plotly-basic` still passes every test here
 * (basic carries `scatter` and `bar` and lacks the excluded types, so both halves
 * hold), and a swap to the full `plotly.js/dist/plotly` kills the suite at
 * `Tests: 0` with a jsdom "getContext not implemented" error that reads as a
 * missing `canvas` package rather than as a regression. What actually catches both
 * is the exact-import assertion in `plotly-cartesian.bundle-contract.test.tsx`,
 * which is mutation-verified against both swaps. Keep the two together.
 *
 * Requires a render first: no component, no global.
 */
const registered = (): string[] => {
  const plotly = (window as unknown as { Plotly?: PlotlySchema }).Plotly;
  if (!plotly) throw new Error('window.Plotly unset — render a Plot before reading the registry');
  return Object.keys(plotly.PlotSchema.get().traces);
};

/** Mount once so the component's bundle evaluates and sets window.Plotly. */
beforeAll(async () => {
  const { container } = render(
    React.createElement(Plot as never, {
      data: [{ type: 'scatter', x: [1], y: [1] }],
      layout: { width: 200, height: 150 },
    } as never),
  );
  await waitFor(() => expect(container.querySelector('.js-plotly-plot')).toBeTruthy());
});

/** Every `type:` the app passes to a plot. Extend with the commit that adds one. */
const USED_TRACE_TYPES = ['scatter', 'bar'];

/** What the bundle exists to leave out. */
const EXCLUDED_TRACE_TYPES = ['scatter3d', 'scattergeo', 'scattermap', 'choropleth'];

describe('plotly cartesian bundle', () => {
  it.each(USED_TRACE_TYPES)('registers %s, which the app draws', (traceType) => {
    expect(registered()).toContain(traceType);
  });

  // Not idle assertions: if one of these appears, the bundle has been swapped back
  // to the full build and maplibre-gl is in the shipped chunk again.
  it.each(EXCLUDED_TRACE_TYPES)('does not carry %s', (traceType) => {
    expect(registered()).not.toContain(traceType);
  });

  // Registration alone would not catch a bundle that loads but cannot draw.
  it.each(USED_TRACE_TYPES)('renders marks for a %s trace', async (traceType) => {
    const { container } = render(
      React.createElement(Plot as never, {
        data: [{ type: traceType, x: [1, 2, 3], y: [4, 5, 6] }],
        layout: { width: 400, height: 300 },
      } as never),
    );

    await waitFor(() => expect(container.querySelector('.js-plotly-plot')).toBeTruthy());
    expect(container.querySelector('svg')).toBeTruthy();
    // The layer plotly names after the trace family, with something drawn in it.
    const marks = container.querySelectorAll(`.${traceType}layer path`);
    expect(marks.length).toBeGreaterThan(0);
  });
});
