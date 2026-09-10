/**
 * The bundle swap is only safe while three invariants hold, and every one of them
 * fails silently.
 *
 * `@/components/plotly-cartesian` builds the chart component from
 * `plotly.js/dist/plotly-cartesian` instead of the full `plotly.js/dist/plotly`,
 * dropping 37 of plotly's 49 trace families and `maplibre-gl` with them. Nothing
 * in TypeScript knows that: `@types/plotly.js` describes the FULL API, and every
 * call site imports its types from there. So all three of these compile, pass a
 * type-check, and break only in the browser:
 *
 *   1. A chart reaching for a dropped trace type (`scattergl` is the plausible
 *      one — the WebGL scatter someone adds for a very large series). Plotly logs
 *      nothing the user sees; the plot simply comes out empty.
 *   2. A new chart written the old way, `dynamic(() => import('react-plotly.js'))`.
 *      That pulls the full dist back into the chunk — 3.24 MB and the maplibre-gl
 *      advisory (GHSA-jrc7-96c5-q579) with it — and looks completely normal.
 *   3. A call site that drops `ssr: false`. Plotly touches `document` at module
 *      scope, so that is an SSR crash on a route that renders fine in dev.
 *
 * `plotly-cartesian.trace-coverage.test.tsx` pins the types the app draws TODAY
 * against a hand-maintained list. This file is the half that does not need
 * maintaining: it sweeps the source tree, so a call site added later is covered
 * without anyone remembering to extend a constant.
 */

import fs from 'fs';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — no type declarations ship for plotly's individual dist bundles.
import Plotly from 'plotly.js/dist/plotly-cartesian';

type PlotlySchema = { PlotSchema: { get: () => { traces: Record<string, unknown> } } };

const WEB_ROOT = path.resolve(__dirname, '../..');
const SOURCE_DIRS = ['app', 'components', 'lib', 'hooks'];

/** The twelve the cartesian bundle carries. Pinned, so a swap in either direction fails. */
const CARTESIAN_TRACE_TYPES = [
  'bar',
  'box',
  'contour',
  'heatmap',
  'histogram',
  'histogram2d',
  'histogram2dcontour',
  'image',
  'pie',
  'scatter',
  'scatterternary',
  'violin',
];

/**
 * Every trace type plotly ships, read from the schema that ships beside the dists.
 * Taking it from the package rather than a literal means a plotly upgrade that adds
 * a family is covered on the next `npm install`, not on the next time someone
 * remembers.
 */
const ALL_PLOTLY_TRACE_TYPES: string[] = Object.keys(
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  (require('plotly.js/dist/plot-schema.json') as { traces: Record<string, unknown> }).traces,
);

/** What the swap removed: the ones a chart can ask for and silently not get. */
const DROPPED_TRACE_TYPES = ALL_PLOTLY_TRACE_TYPES.filter(
  (t) => !CARTESIAN_TRACE_TYPES.includes(t),
);

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Test files legitimately name dropped types (this one does).
        if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === '.next')
          continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  for (const dir of SOURCE_DIRS) {
    const full = path.join(WEB_ROOT, dir);
    if (fs.existsSync(full)) walk(full);
  }
  return out;
}

const FILES = sourceFiles().map((file) => ({
  file,
  rel: path.relative(WEB_ROOT, file),
  text: fs.readFileSync(file, 'utf8'),
}));

describe('plotly cartesian bundle — registry', () => {
  // Every other assertion in this file imports the dist DIRECTLY, so all of them
  // stay green if the shared module is repointed at a different bundle. That is not
  // hypothetical: a mutation run during this file's own development left
  // `plotly-basic` in the module and nothing here failed. The module's import is
  // the thing the app actually loads, so it is asserted on its own.
  it('is the bundle the shared module actually imports', () => {
    const module = fs.readFileSync(
      path.join(WEB_ROOT, 'components', 'plotly-cartesian.ts'),
      'utf8',
    );
    expect(module).toMatch(/^import Plotly from 'plotly\.js\/dist\/plotly-cartesian';$/m);
  });

  it('registers exactly the twelve trace types the module documents', () => {
    // Pinned in both directions on purpose. Growing means the full dist is back and
    // maplibre-gl is in the shipped chunk again; shrinking means a narrower bundle
    // (plotly-basic carries only scatter/bar/pie) took types away without a failure
    // at any call site the app has today.
    expect(Object.keys((Plotly as PlotlySchema).PlotSchema.get().traces).sort()).toEqual(
      [...CARTESIAN_TRACE_TYPES].sort(),
    );
  });

  it('sets window.Plotly, which getPlotly() and every copy-to-clipboard button read', () => {
    // `@/lib/plotly`'s getPlotly() returns `window.Plotly` and returns undefined
    // rather than throwing, so a bundle that stopped assigning it would take out
    // ResponsivePlot's resize AND the modebar's copy-chart button with no error
    // anywhere. Both dists end with `window.Plotly = Plotly`; assert it, because
    // the UMD header alone would not (under webpack it takes the module.exports arm).
    const globalPlotly = (window as unknown as { Plotly?: unknown }).Plotly;
    expect(globalPlotly).toBeDefined();
    expect(typeof (globalPlotly as { Plots?: unknown }).Plots).toBe('object');
    expect(typeof (globalPlotly as { toImage?: unknown }).toImage).toBe('function');
  });

  it('carries no trace family that would drag maplibre-gl back in', () => {
    const registered = Object.keys((Plotly as PlotlySchema).PlotSchema.get().traces);
    for (const mapTrace of ['scattermap', 'scattermapbox', 'choroplethmap', 'densitymap']) {
      expect(registered).not.toContain(mapTrace);
    }
  });
});

describe('plotly cartesian bundle — source sweep', () => {
  // This is the half the hand-maintained USED_TRACE_TYPES list cannot do: it covers
  // a call site nobody thought to add to a constant.
  it('has no source file asking for a trace type the bundle dropped', () => {
    const offenders: string[] = [];
    for (const { rel, text } of FILES) {
      for (const dropped of DROPPED_TRACE_TYPES) {
        // `type: 'x'`, `type: "x"`, and the `as const` spelling every builder here uses.
        const re = new RegExp(`\\btype\\s*:\\s*['"\`]${dropped}['"\`]`);
        if (re.test(text)) offenders.push(`${rel} uses type: '${dropped}'`);
      }
    }
    // If a NON-plot literal ever collides (a `type: 'table'` on something unrelated),
    // the fix is to scope this sweep, not to weaken it — the failure it guards is a
    // chart that renders blank with nothing in the console.
    expect(offenders).toEqual([]);
  });

  it('loads the plot component only through the cartesian module', () => {
    const offenders: string[] = [];
    for (const { rel, text } of FILES) {
      // A value import of react-plotly.js pulls plotly.js/dist/plotly — the full
      // bundle — back into the chunk. `react-plotly.js/factory` is the one allowed
      // form: it takes a Plotly object and imports none itself.
      // `require(...)` is in here too: it is a live spelling in this repo's own test
      // files, and a sweep that misses it would wave through the exact regression.
      const valueImport = /(?:from|import\(|require\()\s*['"]react-plotly\.js['"]/g;
      // matchAll, not match+indexOf: indexOf returns the FIRST occurrence every
      // iteration, so a file with two offending imports reported the first one twice
      // and named the wrong line.
      for (const match of text.matchAll(valueImport)) {
        const line = text.slice(0, match.index).split('\n').pop() ?? '';
        // `import type { PlotParams } from 'react-plotly.js'` is erased at compile
        // time and costs nothing at runtime.
        if (/\bimport\s+type\b/.test(line)) continue;
        offenders.push(`${rel}: ${line.trim()}`);
      }
      if (/['"]plotly\.js\/dist\/plotly['"]/.test(text)) {
        offenders.push(`${rel} imports the full plotly dist directly`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('imports the plot component with ssr: false at every call site', () => {
    // plotly touches `document` at module scope, so an SSR render of the route
    // throws. dev renders client-side and hides it.
    const offenders: string[] = [];
    for (const { rel, text } of FILES) {
      const re =
        /dynamic\(\s*\(\)\s*=>\s*import\(\s*['"]@\/components\/plotly-cartesian['"]\s*\)([^\n]*)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        if (!/ssr\s*:\s*false/.test(m[1] ?? '')) offenders.push(`${rel}: ${m[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has no chart declaring a subplot type the bundle cannot lay out', () => {
    // Trace types are only half of it: a `layout.polar` / `.geo` / `.scene` /
    // `.mapbox` / `.smith` block needs its base plot module, and cartesian ships
    // none of them (`ternary` is the only non-xy subplot it carries). Same silent
    // failure — the block is ignored and the chart draws on a default xy axis.
    const droppedSubplots = ['geo', 'mapbox', 'map', 'polar', 'scene', 'smith'];
    const offenders: string[] = [];
    for (const { rel, text } of FILES) {
      for (const key of droppedSubplots) {
        // Only a layout key at the start of a line — `scene:` as a property, not
        // `scene` inside prose or an identifier like `sceneRef`.
        if (new RegExp(`^\\s*${key}\\s*:\\s*\\{`, 'm').test(text)) {
          offenders.push(`${rel} declares layout.${key}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('finds the call sites it claims to be sweeping', () => {
    // A sweep that silently matches nothing passes forever. Anchor it.
    const withPlot = FILES.filter((f) => /@\/components\/plotly-cartesian/.test(f.text));
    expect(withPlot.length).toBeGreaterThanOrEqual(10);

    const withTraceTypes = FILES.filter((f) => /\btype\s*:\s*['"](scatter|bar)['"]/.test(f.text));
    expect(withTraceTypes.length).toBeGreaterThanOrEqual(10);

    expect(DROPPED_TRACE_TYPES).toContain('scattergl');
    expect(DROPPED_TRACE_TYPES).toContain('scatter3d');
    expect(DROPPED_TRACE_TYPES.length).toBeGreaterThan(30);
  });
});
