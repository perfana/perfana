/**
 * The Plotly component, built from plotly.js's CARTESIAN bundle.
 *
 * `react-plotly.js`'s own entry point imports `plotly.js/dist/plotly` — the full
 * bundle, which carries every trace family plotly ships: 3D (gl3d), geographic
 * maps, and with them `maplibre-gl`. This app draws `scatter` and nothing else,
 * so all of that is dead weight in the largest route's chunk, and its CVEs are
 * ours to answer for anyway. `maplibre-gl` alone has produced one critical
 * advisory (GHSA-jrc7-96c5-q579) that could only be answered with a dependency
 * override, because the vulnerable code is inlined in that prebuilt dist and an
 * override does not change what ships.
 *
 * The cartesian bundle registers exactly twelve trace types — bar, box, contour,
 * heatmap, histogram, histogram2d, histogram2dcontour, image, pie, scatter,
 * scatterternary, violin — which covers everything drawn here (`scatter`, and
 * `bar` for the SLO single-value chart). Note what is NOT in it: `scattergl`, the
 * WebGL scatter used for very large series, alongside every 3-D, map and polar
 * family. Reaching for one of those means moving to a different bundle, or a
 * custom one via `plotly.js/lib/core` plus explicit `Plotly.register` calls — not
 * adding the trace type to a chart and wondering why it renders empty, which is
 * the whole failure mode, and it is silent.
 * `plotly-cartesian.trace-coverage.test.tsx` pins that list against the types the
 * app actually draws.
 *
 * Both dists are the same UMD wrapper and both assign `window.Plotly`, so
 * `getPlotly()` in `@/lib/plotly` keeps resolving — that is what the modebar's
 * copy-to-clipboard button and ResponsivePlot's resize both depend on.
 *
 * Import this through `next/dynamic` with `ssr: false`, exactly as
 * `react-plotly.js` was imported: plotly touches `document` at module scope.
 */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plotly.js ships no type declarations for its individual dist bundles;
// the `plotly.js` types describe the full API and are what every call site imports.
import Plotly from 'plotly.js/dist/plotly-cartesian';
import createPlotlyComponent from 'react-plotly.js/factory';

export default createPlotlyComponent(Plotly);
