/**
 * The cartesian plotly bundle must register — and actually draw — every trace type
 * the app uses.
 *
 * `@/components/plotly-cartesian` builds the chart component from
 * `plotly.js/dist/plotly-cartesian` rather than the full `plotly.js/dist/plotly`,
 * dropping the 3-D, map, polar and ternary families and `maplibre-gl` with them,
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

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — no type declarations ship for plotly's individual dist bundles.
import Plotly from 'plotly.js/dist/plotly-cartesian';

type PlotlySchema = { PlotSchema: { get: () => { traces: Record<string, unknown> } } };
const registered = (): string[] =>
  Object.keys((Plotly as PlotlySchema).PlotSchema.get().traces);

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
