/**
 * Minimal typings for the bits of Plotly we touch directly.
 *
 * The charts render through react-plotly, but the "copy chart to clipboard"
 * modebar button reaches past it: it needs the graph div Plotly hands the
 * click handler, and the global Plotly object to call toImage. Both were
 * previously re-declared inline in every file that did this, or just left as
 * `unknown` and cast at the use site.
 */

/**
 * The graph div Plotly passes to modebar button handlers. `_fullLayout` is
 * Plotly's internal resolved layout — undocumented, but it is the only place
 * the rendered pixel size is available.
 */
export interface PlotlyGraphDiv extends HTMLElement {
  _fullLayout?: {
    width?: number;
    height?: number;
    [key: string]: unknown;
  };
}

/** The subset of the global Plotly API used for chart export. */
export interface PlotlyGlobal {
  toImage: (
    gd: PlotlyGraphDiv,
    opts: { format?: string; width?: number; height?: number; scale?: number },
  ) => Promise<string>;
}

/**
 * Read the Plotly global. Returns undefined when the bundle has not attached
 * it yet, so callers can skip the export rather than throw.
 */
export function getPlotly(): PlotlyGlobal | undefined {
  return (window as unknown as { Plotly?: PlotlyGlobal }).Plotly;
}
