# CLAUDE.md — apps/web

Next.js App Router, MUI + Radix + Tailwind. Root [CLAUDE.md](../../CLAUDE.md) has the stack, env
vars and the symptom index ("Common Issues") that points back here.
Coding rules: [CODING_RULES.md](CODING_RULES.md).

### Frontend API Client Requirements

**MANDATORY**: All frontend API calls MUST include authentication headers. Use `authenticatedFetch()` from `lib/api.ts` — it handles token injection, 401 refresh, and base URL prepending automatically.

```typescript
// PREFERRED: authenticatedFetch (handles everything)
import { authenticatedFetch } from '@/lib/api';

const response = await authenticatedFetch('/test-runs', { method: 'GET' });

// FALLBACK: manual headers (only when authenticatedFetch doesn't fit)
import { getAuthHeaders } from '@/lib/api';

const response = await fetch(`${env.API_URL}/endpoint`, {
  headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
});
```

**Never** import from `@/lib/keycloak-auth` directly or read tokens from `sessionStorage`/`localStorage` — always go through `lib/api.ts`.

### The transaction time-series route pads one series and deliberately not the other

`GET /test-runs/:id/transactions/:name/timeseries` returns two things: `transaction_data`, one series for the whole transaction, and `sampler_data`, one series per sampler. **`transaction_data` is padded against a `generate_series` bucket grid; `sampler_data` is not, and must not be.** Padding the sampler side costs buckets x samplers rows — on a 3 h run with 19 samplers that was 41,420 rows carrying 560 rows of data, an 11.8 MB response instead of 173 KB.

The padding is still required for the **render**, just not on the wire, and the two halves only work as a pair:

1. **Plotly will not fill a bucket that no trace has.** The sampler chart is a stacked area (`stackgroup` with `stackgaps: 'infer zero'`), and `infer zero` only fills a bucket some *other* trace in the stackgroup carries. A bucket where every sampler was silent is absent from the group's x-union entirely, so the filled band interpolates straight across it — an idle window or a real outage renders as a solid coloured band.
2. **So the client re-grids instead.** `buildSamplerTraces` (`apps/web/app/test-runs/[id]/components/performance-analysis/transaction-graph-modal/utils/trace-builders.ts`) rebuilds every sampler series against the buckets in `transaction_data`, which *is* still padded, inserting `null` where that sampler has nothing. It costs nothing on the wire.

Do not "simplify" either half. Removing the server-side padding, or the client re-grid, draws outages as solid bands; restoring the sampler-side LEFT JOIN brings back the 11.8 MB response.

**`aggregationSeconds` is optional on this route** (it stays required-with-a-default on the sibling single-sampler route). Omitted means the server picks the bucket size from the run duration via `AGGREGATION_LADDER` in `apps/api/src/modules/test-runs/services/test-runs-timeseries-query.service.ts`, aiming at roughly 360 points per series. Two consequences:

- **The response echoes `aggregation_seconds`, and a client must divide throughput counts by that, never by an assumed 5.** The counts are per bucket, so a client that hardcodes 5 against a 300 s bucket draws throughput 60x too low.
- **A rung added to the ladder must be added to BOTH web option lists** — `transaction-graph-modal/utils/chart-config.ts` and `RequestTimeSeriesModal.tsx` — or the MUI `Select` is handed a value with no matching `MenuItem` and renders blank.

Related: responses now differ in size by ~60x across bucket choices, so `useTransactionGraphData` tags each request with a sequence number and drops stale ones. A small 300 s response routinely lands before a large 5 s one issued earlier, and last-write-wins on arrival pairs one response's data with another response's divisor.

### A one-point series drawn `mode: 'lines'` renders as nothing

A scatter trace with a single point has no segment, so Plotly draws it and shows nothing — while
the axes still scale to its value. The chart therefore looks *loaded and empty*, which reads as
"no data" rather than as a point, and nothing is logged. The perf-test scenario panels (301 Error
Count, 302/303 Avg/Max Active Threads) hold exactly one point per run by construction, so every
series on them was invisible in the Graphs card: nine blank traces with a y-axis topping out at
the max value. `GraphsChart` switches a `sorted.length === 1` trace to `lines+markers` with an
explicit `marker.color` (a trace without `marker` inherits the line colour, but setting it keeps
the exported PNG's legend swatch in step).

Beside it, `min`/`mean`/`max` in the series table read `–` for the same run, and that is a
*different* bug with the same symptom: those columns are the analysis window only, and before
v0.2.97.17 the worker wrote that point at `end_time`, outside it. A blank chart whose stats are
also empty is the worker bug; a blank chart whose stats are populated is this one.

### The Graphs "analysis range only" toggle clips points, it does not range the x axis

`GraphsChart`'s **analysis range only** view (v0.2.97.18, the web twin of the report's Custom
graphs "Show analysis time range only") cannot be built by just narrowing the x-axis `range`:
**Plotly autoranges y over every point in a trace whether it is visible or not**, so a line
drawn outside a merely-ranged window still sets the y scale and the ramp-up spike the view
exists to hide keeps flattening everything inside it. `analysisRangeClip`
(`apps/web/app/test-runs/[id]/components/graphs/utils/chart-utils.ts`) returns an index range
with a 2.5% margin, and `GraphsChart` filters each series' points to it (`inClip`) before the
axis scale is computed — so the autorange that Plotly would compute follows the clipped data,
not the whole run.

Clipping is **necessary but was not sufficient** until v0.2.97.22: `yAxis` handed every
non-negative group an explicit `[0, topTick]` range, which overrides autorange outright, so the
clipped view narrowed horizontally and kept the whole run's vertical scale anyway. See "A
narrowed view drops the y-axis zero pin" below.

Two things ride along with filtering the points instead of the axis:

1. **X-axis ticks must come from the clipped slice, not the whole run.** `calculateXAxisTicks`
   spaces ticks evenly over whatever timestamp array it is given; feeding it the full run and
   then narrowing the axis leaves most of those ticks outside the visible domain, so a short
   window on a long run renders with one time label or none. `GraphsChart` builds the tick
   source from `sortedTimestamps.slice(clip.lo, clip.hi + 1)` and offsets the resulting
   `tickvals` back by `clip.lo`. The report's SVG chart builder has the same guard under a
   different name (`labelPoints` in `chart-svg.service.ts`).
2. **The axis range is padded to at least one index wide.** The perf-test scenario panels (301
   Error Count, 302/303 Avg/Max Active Threads) hold exactly one point per run, so a window on
   one of those runs clips `startIndex === endIndex`. `analysisRangeClip`'s margin is
   `Math.max(1, round(...))`, and the axis range itself is `[clip.lo, Math.max(clip.hi, clip.lo
   + 1)]` rather than a bare `[clip.lo, clip.hi]` — otherwise Plotly is handed a zero-width
   range, the same failure mode the un-clipped branch's `Math.max(sortedTimestamps.length - 1,
   1)` already guards against for a run with a single timestamp.

The 2.5% margin is hard-coded here and separately in the report's `ANALYSIS_ONLY_MARGIN`
(`apps/api/src/modules/reports/renderers/chart-svg.service.ts`) with nothing asserting the two
stay equal — see "The analysis-only margin is 2.5% in two apps with nothing holding them
together" in TODOS.md.

The toggle itself is a new optional `viewToggle` prop on `AnalystChartCard`
(`apps/web/components/charts/AnalystChartCard.tsx`), drawn next to the axis-mode `overlay` /
`split by unit` pair by a shared local `PillButton` — both are the same control at different
arities, so a third copy of the button's `sx` was not needed.

### A Graphs chart zoom refetches the window, it does not just redraw it

Dragging a zoom box on the Graphs chart (v0.2.97.20) does not simply narrow what Plotly already
holds — `GraphsChart`'s `onRelayout` reads the gesture through `zoomRangeFromRelayout`
(`apps/web/app/test-runs/[id]/components/graphs/utils/chart-utils.ts`), and `useGraphsData`'s
`applyZoomRange` refetches every added series for that window via `GET
/metrics/ds-metrics/:testRunId/:panelId?from=...&to=...` (validated by `parseMetricTimeRange` in
`apps/api/src/modules/metrics/metrics.controller.ts` — both bounds or neither, else a 400). The
point is resolution: the endpoint's LTTB budget (4000 points, divided across a panel's distinct
metrics) is spent on the visible window instead of the whole run, so a window a tenth the run's
length comes back with up to ten times the detail — down to the bucket size the data was
collected at, which no zoom goes below.

Four things worth knowing before touching this path:

### A narrowed view drops the y-axis zero pin

`yAxis` (`apps/web/lib/charts/layout.ts`) gives a group whose values are all >= 0 an explicit
`[0, topTick]` range plus explicit `tickvals`, and that shared tick set is the whole reason a
right-hand axis lands on the left axis' gridlines (only the left axis draws them —
`grid = overlaying === undefined`). Correct for a whole run: a band of values near the top is
*meant* to read as small next to zero.

Wrong the moment the chart is narrowed. `LayoutSpec.zeroBase: false` (v0.2.97.22) takes the
autorange branch a negative-valued group already took, so the axis frames what is drawn;
`GraphsChart` passes `!(zoomed || clip !== null)`, covering both the drag-zoom and the
analysis-range-only view. It defaults to true, so a caller that does not opt in keeps the zero
pin.

**Trends opts in unconditionally** (v0.2.97.23, `useTrendsPlot`): it has no narrowed view, but a
trend is read for its SHAPE across releases, so a run-over-run series sitting at 820-840ms is a
flat line in the top tenth of a 0-900 axis and a 20ms climb is invisible. Compare is the one
layout caller still fully zero-pinned, and deliberately: it draws two runs over their whole
length, which is the case the zero pin is right for.

Two consequences:

1. **Two unit families lose shared gridlines wherever `zeroBase: false` applies** — a
   narrowed Graphs view, or Trends unconditionally. The autorange branch
   omits `tickvals`, so each axis picks its own and the right axis' labels stop sitting on the
   drawn gridlines. Visual only, accepted, tracked under "Two autoranged axes no
   longer share gridlines" in TODOS.md.
2. **An autoranged non-negative group is clamped with `rangemode: 'nonnegative'`.** Plotly's
   plain autorange gives a CONSTANT series `[value - 1, value + 1]`
   (`plotly.js/src/plots/cartesian/autorange.js`, the `minmin === maxmax` branch), so an
   all-zero error count — a clean run — would render a -1..1 axis with ticks for impossible
   values. `nonnegative` clamps that to `[max(0, lower), max(1, upper)]`. It is NOT inert on a
   non-constant series either: the same flag pins the padded lower edge at 0 when the padding
   would carry it under, so `[0.1, 5, 10]` starts at 0 rather than just below it. It is applied
   only when the group's `min >= 0`: the pre-existing negative branch must keep showing
   negatives, which is the data it exists for.
3. **Autorange counts DATA-REFERENCED shapes in its range.** Every overlay in `layout.ts` is
   `yref: 'paper'` — the analysis-window wash and boundary labels, the event lines — except
   `sloShape`, whose `y0`/`y1` are the SLO value. A chart that merges an SLO line *and* passes
   `zeroBase: false` would stretch its axis to the SLO with the data nowhere near it, which is
   the exact failure the flag exists to remove. `sloShape` has no production caller today; give
   it a paper ref before wiring one into a narrowed view.

A zero-pinned axis uses the last entry of `tickValues` (`lib/charts/format.ts`) as its top, so that
list has to reach the data. Until v0.2.97.48 it stopped at the tick nearest `max`, so 466 on a step
of 200 gave `[0, 200, 400]`: a 0-400 axis with the peak cut off and nothing logged. Only a max less
than half a step past a tick showed it, and the series table only gives it away when the peak sits
inside the analysis window, since its stats cover that window alone. It now
runs to the first tick at or above `max`, which costs some headroom (401 tops out at 600).

### The Graphs zoom reset

1. **A reset is recognised only by `xaxis.autorange`, never by a full-span range.** Plotly
   rewrites the INDEX x-axis to an explicit `[0, len - 1]` on every render, so a relayout whose
   range happens to span the whole run is not a safe "zoomed back out" signal — reading it that
   way would refetch the whole run on every redraw. `zoomRangeFromRelayout` treats only
   `event['xaxis.autorange'] === true` as a reset, and only when already `zoomed`.
2. **One request per (dashboard, panel, source), not per series.** The panel endpoint returns
   every metric on the panel regardless of what the caller asked for, so `fetchSeriesBatch`
   groups the added series by that triple and calls `fetchPanelRows` once per group, sharing the
   answer — a perf-test panel with hundreds of per-transaction series is one request per zoom,
   not one per series. `fetchPanelRows` gets one retry (`PANEL_FETCH_ATTEMPTS = 2`) to buy back
   some of the per-series robustness the grouping gives up: a deterministic failure (404/403/500)
   still blanks the whole group — a known residue, see "Three residues of the Graphs card's zoom
   refetch" in TODOS.md — but a one-off blip no longer does.
3. **The synthetic "All aggregated" series has no range parameter and is filtered client-side.**
   `/test-runs/:id/aggregated-metric-timeseries` always returns the whole run's fixed 60s buckets;
   `fetchSeriesData` narrows it by filtering the parsed-timestamp points itself. On a live run this
   also means that series keeps growing independent of the zoom — deliberate for now, see item 1 of
   the same TODOS.md entry.
4. **A stale in-flight reply is dropped, not merged.** `zoomRequestRef` tags each
   `applyZoomRange` call; a narrow window's request can answer before an earlier wide one is done,
   so only the reply whose tag still matches the ref is allowed to call `setSeriesData` — and it
   replaces the series map wholesale rather than merging, because a narrowed window is the new
   truth for every series and a leftover entry would draw points outside it.

The chart stays mounted and fully legible during the refetch — the spinner condition is `loading
&& !plot`, not bare `loading`, so a zoom or an add landing on an already-drawn chart keeps it on
screen — with an `updating…` `role="status"` label in the header instead of a dim on the plot. A
0.45 opacity on the chart subtree was tried and reverted: `lib/charts/tokens.ts` measures that
value at 3.36:1 for the chart's 9-11px axis/legend text, below the contrast floor, and it would
also sit over the axis labels during the exact moment the reader needs to read them.

Riding along: `PillButton` (inside `AnalystChartCard`) is now exported, because the zoom's `reset
zoom` control is a one-off action button rather than a toggle — `active` became optional so a
caller can omit it and skip the `aria-pressed` a reset state should not carry. The header row that
holds it also gained `flexWrap` + `rowGap`: the Graphs card can carry nine controls at once (axis
mode, view toggle, zoom reset, chart actions…), and on a narrow content column the rightmost ones
used to clip rather than wrap onto a second line.

### A Plotly chart must observe its own container, not the window

`react-plotly.js` 2.6.0's `useResizeHandler` is only
`window.addEventListener('resize', () => Plotly.Plots.resize(el))`. There is no ResizeObserver in
it. So a container that changes size while the **window** does not leaves Plotly's cached geometry
stale, and the hover label is then measured and drawn against the old box: the tooltip text drifts
away from its background box, leaving the text over the chart title and an empty box near the data
point.

Two such changes exist in the anomaly-detection rows, and neither moves the window: the statistical
drawer's 0.3 s width transition, and — Windows only — a classic scrollbar appearing and taking ~15px
off the container. macOS overlay scrollbars take nothing, which is why this reproduces on Chrome
under Windows and not on a Mac.

`apps/web/components/ResponsivePlot.tsx` (v0.2.95.2) is the fix: it wraps `react-plotly.js`,
observes its own wrapper div, and calls `Plotly.Plots.resize` on **its own** graph div. New chart
call sites should import it (`import Plot from '@/components/ResponsivePlot'`) rather than writing
`dynamic(() => import('@/components/plotly-cartesian'))` again.

Five things about it are load-bearing:

1. **It resizes that one chart, deliberately.** Dispatching a window resize instead — what
   `kickPlotlyResize` in `app/test-runs/[id]/components/shared/ExpandableCardHeader.tsx` does — wakes
   every Plotly listener on the page, and a drawer transition emits an observer callback per
   animation frame. One local animation would relayout every unrelated chart, ~18 times over 300 ms.
2. **The `onEntered={() => window.dispatchEvent(new Event('resize'))}` kicks on the Collapses that
   wrap charts are NOT redundant now — do not delete them.** MUI *clips* a Collapse rather than
   resizing its content, so the observed box keeps its final size throughout the animation and the
   observer fires only once, on `observe()`. That case is invisible to the observer and the one-shot
   kick is the only thing covering it.
3. **Every guard in the effect has a failure behind it.** No `ResizeObserver` in the environment →
   return (an effect that throws blanks the whole page rather than losing one chart's resize); a
   `contentRect.width` of 0 (hidden tab panel) → skip, resizing to nothing is wasted work; no
   `.js-plotly-plot` yet (the lazy chunk has not drawn) → skip, its first draw measures the current
   size anyway; and `Plots.resize` rejects when the div is hidden, so the call is `.catch`ed or the
   rejection surfaces as a page error.
4. **Three call sites still bypass it** — `dynatrace/HostPerformanceGraphs.tsx`,
   `service-level-objectives/AggregatedSloChart.tsx` and `service-level-objectives/SLOMetricsChart.tsx`
   call `dynamic(() => import('@/components/plotly-cartesian'))` directly and therefore respond to a
   window resize only; that is deliberate scope, tracked in TODOS.md, not an oversight.
5. **It hands Plotly a copy of the layout, because `Plots.resize` deletes `width` and `height` from
   the object it holds** (v0.2.97.48), and react-plotly gives it the caller's own. `GraphsChart` and
   `TrendsChart` size their container from `layout.height ?? <300px default>`, so after any resize the
   next render that reused the layout (on Graphs, any hover) took the default, and the following resize autosized the plot to
   it. A lanes chart's domains are fractions, so four lanes built for 694px squeezed into 300 with
   their captions over each other's ticks. An overlay chart's real height IS 300, so it never showed.
   What triggers it is any `Plots.resize`: `config.responsive`'s window listener, `kickPlotlyResize`,
   the observer above, a tab switch. The copy is memoized on the caller's layout, because a fresh
   object per render reads as a new figure to react-plotly, which on Graphs is a `Plotly.react` per
   hover. Trends and Compare already rebuild their layout on hover (`cursorIndex` is in their memo
   deps), which is why a Trends chart squashed only until its next hover.

jsdom has no `ResizeObserver`. `apps/web/jest.setup.js` stubs it so a component that observes its
container mounts in tests at all.

### Never `fetch()` a `data:` URL — copy a chart through `apps/web/lib/plotly.ts`

The web app's CSP sets `connect-src 'self' <api> <keycloak> https: wss:`
(`apps/web/next.config.js`), and `data:` is not in that list. So `fetch(dataUrl)` is blocked
before it leaves the page and rejects with a bare `TypeError: Failed to fetch` — no CSP
violation reaches the `catch`, nothing distinguishes it from a dead network. Every chart's
"copy to clipboard" modebar button did `Plotly.toImage().then(fetch).then(r => r.blob())`, so
the button failed on **every chart, in every browser, on localhost and in production alike**,
and reported it as a network error. Fixed in v0.2.96.27.

`apps/web/lib/plotly.ts` is now the one implementation. `components/charts/ChartActions.tsx` and
six modebar copy buttons go through it: `graphs/utils/chart-utils.ts`,
`compare/current-test-run-chart/utils/current-test-run-chart-utils.ts`,
`anomaly-detection/components/utils/trends-plot-utils.ts`,
`performance-analysis/RequestTimeSeriesModal.tsx`,
`performance-analysis/transaction-graph-modal/utils/chart-config.ts`, and
`service-level-objectives/utils/slo-chart-utils.ts`. Another button writes its own
`toImage` chain at your peril.

**A chart on the Analyst layout exports through `ChartActions`, never its graph div** (v0.2.97.48).
`lib/charts/layout.ts` puts neither a title nor a legend on the canvas: both are HTML around the
plot, so `plotlyPngBlob(gd, ...)` rasterises an unlabelled chart with unnamed lines. Compare's
`ComparisonPlot` and Trends' `useTrendsPlot` did that from a modebar button, and Plotly's own
download button does it too, so those cards hide the modebar (`displayModeBar: false`) rather than
just swapping the copy handler. `GraphsChart` and `TrendsChart` clear their `graphEl` in `onPurge`,
because their plot unmounts while the card stays and a purged div exports a blank image. The other modebar charts draw their own title or legend on the
canvas, so they are not this bug. `card-chart-export.test.tsx` pins both cards.

What the module owns, and why each piece is there:

- **`dataUrlToPngBlob`** decodes Plotly's base64 with `atob`. No network, so no CSP. This is
  the actual fix; everything else is consolidation.
- **`copyPlotToClipboard(render, { fallbackFilename, notify })`** calls
  `navigator.clipboard.write` in the same task as the click, handing `ClipboardItem` the
  **unsettled** `Promise<Blob>`. That keeps the user-activation context Safari requires and
  Chrome can withdraw on a slow render. It is wrapped in `try`/`catch`, not just `.catch`:
  `new ClipboardItem(...)` and `write()` can throw synchronously on a UA that refuses a
  Promise value, and from a bare click handler that throw escapes Plotly's modebar *and*
  orphans the blob.
- **The helper owns the download fallback and the blob's rejection**, so no call site can
  forget either. Two of the eight previously did nothing at all on a clipboard refusal — no
  file, no toast — and an unhandled rejection surfaced whenever the render failed on a
  browser with no `ClipboardItem`.
- **Pair `fallbackFilename` with `notify` wherever a toast is in scope.** A refusal
  ("Document is not focused") is routine, and without a message the user gets a surprise file
  in Downloads. `graphs/utils/chart-utils.ts` is the deliberate exception: its own suite pins
  the silent download as a regression guard, and it sits beside an explicit "Download as PNG"
  button.
- **`downloadPng` revokes the object URL in a `setTimeout`, not inline.** Firefox and WebKit
  abort a just-started blob download when the URL is revoked in the same task, and a
  multi-megabyte PNG is exactly the case that loses that race.
- **`plotSize(gd, fallback)`** reads Plotly's undocumented `_fullLayout`, the only place the
  rendered pixel size lives. `PlotlyGraphDiv` / `PlotlyGlobal` / `getPlotly()` replace the
  inline re-declarations and `unknown` casts each site used to carry.

jsdom has no CSP, so the original bug was **not catchable in Jest** — `apps/web/__tests__/lib/plotly-clipboard.test.ts`
covers the module's contract (fallback, toasts, rejection ownership), not the CSP itself. An
end-to-end check of the eight adapters is filed in TODOS.md under "Charts".

### The Scenarios table earns its width back from the header labels, not from `minWidth`

Performance Analysis scrolled sideways **at full width on a 16" MacBook** (1728px viewport,
sidebar open → a 1302px content column), not only on a small screen. Measured on
`SONAR-acceptatie-loadtest_perfana-00010` with one scenario expanded, the table's min-content
width was 1703px: 401px of overflow, and the only horizontal scroller on the page.

`<Table sx={{ minWidth: 800 }}>` looks like the cause and is not. 800 is *below* the real
minimum, so it never produced the scrollbar — all it did was stop the **collapsed** table,
whose true minimum is 606px, from shrinking. Removing it is worth doing, but on its own it
changes nothing about the expanded case.

The actual cause was `whiteSpace: 'nowrap'` in `utils/table-header-style.ts`. Eleven uppercase
measurement labels that cannot wrap set the floor for eleven columns. The comment defending it
was accurate about the mechanism — the transaction-name column claims the leftover width, so
every other column is squeezed to its longest word and the labels answer by stacking — but it
priced a three-row header as worse than a sideways scroll, which it is not.

Two changes, measured in the running container, all eleven columns kept:

| | min-content |
|---|---|
| before | 1703px |
| header labels wrap (`whiteSpace: 'normal'`) | 1379px |
| + `'& .MuiTableCell-root': { px: 1 }` on the `<Table>` | **1203px** |

The padding is the other half and is not cosmetic: MUI's default 16px per side across eleven
columns is 352px, and halving it returns 176px. It cascades into the nested request table
(`SamplerTable`) on purpose — that one shares the same grid and would otherwise reintroduce
the overflow when a transaction row is expanded.

Do not put `nowrap` back on those labels without re-measuring against the content column.
Do not add a `minWidth` back to that table either; the natural minimum is now below every
width it is rendered at, and a hardcoded floor can only be wrong again.

### Two colour bugs that look like one, and the `readable` palette

Both of these made the SLO and anomaly detail tables unreadable, and neither is visible in a code
review — the code reads as if it is asking for a subtle tint or a dark accent. Fixed across ~26
sites in v0.2.96.14.

1. **MUI's `alpha()` REPLACES the alpha channel, it does not multiply it.** `theme.palette.action.hover`
   is already an rgba (4% black in light mode, 8% white in dark) and `divider` is 12%, so
   `alpha(theme.palette.action.hover, 0.3)` is a **30% black slab** in light mode and a 30% white one
   in dark — roughly seven times the token, not a third of it. Same call on `divider` gives a 60%
   border where a hairline was intended. The rule: **never pass an already-translucent token
   (`action.*`, `divider`) to `alpha()`** — use the token itself. `alpha()` on a `.main` shade is
   fine, those are opaque. Two unswept sites (`ComparePresetsTable.tsx`, `GraphPresetsTable.tsx`)
   and four deliberate chart gridlines are tracked in TODOS.md; only a lint rule closes the class.

2. **`.dark` and `.light` palette shades are mode-blind.** MUI's `.dark` shade is tuned to sit on a
   *light* surface, and `color: 'primary.dark'` resolves to the same hex whichever theme is active.
   In dark mode it lands at roughly the lightness of the surface itself and the text fades out — the
   anomaly column headers measured 2.8:1, below the contrast floor even for large text. Use the
   derived palette entry, which needs no theme callback:

   ```tsx
   <Typography sx={{ color: 'readable.primary' }} />          // preferred
   color: readableShade(theme, 'success')                     // where a Theme is already in hand
   ```

   `readableShade(theme, key)` (`apps/web/lib/theme.ts`) returns `.light` in dark mode and `.dark` in
   light mode, for `primary | secondary | success | error | warning | info` (`READABLE_KEYS`).
   `withReadablePalette` resolves all six once against the built theme and re-runs `createTheme` to
   hang them off `palette.readable`. That indirection is required, not stylistic: this repo declares
   only `main` for success/warning/error, so the `.light`/`.dark` shades are `augmentColor`
   derivatives that do not exist until the theme is built and cannot be written into the palette
   literal. `readableShade` is re-exported from
   `app/test-runs/[id]/components/service-level-objectives/utils/metric-series-table-utils.ts` for
   that feature's existing importers; new code imports it from `@/lib/theme`.

   `getApdexScoreColor` in `.../service-level-objectives/utils/slo-formatters.ts` takes
   `(score, theme)` as of this version — it was commented "theme-aware" and was not, returning two
   fixed shades that measured ~3.3:1 in dark mode.

**Ordering the row states is a third, separate problem.** With the 30% band gone, a striped row, a
hovered row and a selected row sat within ~3% brightness of each other, and hovering could make a row
lighter or darker depending on its parity. The invariant that keeps them ordered: **hover is keyed on
`primary.main`, never on the stripe token**, so it is stronger than either parity's resting
background. An *expanded* anomaly row uses `action.selected` rather than `action.hover` for the same
reason — it has to stay above the stripe beneath it.

The regression tests assert on the **rendered** style (`AnomalyTableRow.contrast.test.tsx`,
`MetricSeriesTableRow.striping.test.tsx`, `metric-series-table-theme.test.ts`), so re-wrapping a
token in `alpha()` or hard-coding an rgba fails them. Hover tints are not assertable — jsdom never
applies `sx['&:hover']`.


### A Grafana dashboard uid needs its instance — use `fetchGrafanaDashboardByUid`

`GET /grafana/dashboards?uid=` applies **no instance scope** (`grafana-dashboards.service.ts`,
the `query.uid` arm) and orders by `gd.name`, which ties for two copies of one dashboard. A uid
is unique only *within* a Grafana, and on the dev database **20 of 152 uids are duplicated across
instances** — a dev copy and a prod copy of the same dashboard, with different panel sets and
different panel ids.

Five call sites each did `Array.isArray(data) ? data[0] : data`. The result: a panel picked for an
SLO or a graph preset could be a panel id that does not exist on the dashboard the run collected
from, so the SLO evaluates nothing. Nothing errors.

`fetchGrafanaDashboardByUid(uid, grafanaInstanceId?)` in `lib/grafana-dashboards.ts` is the one
way in. Pass the instance whenever it is in hand — an `ApplicationDashboard` carries
`grafana_instance_id`. Without it the helper still returns the first row, but **logs that the uid
was ambiguous and how many instances answered**, so the guess is visible rather than silent.

Two callers do not pass it yet, for different reasons — both filed in TODOS.md:

- `useGraphsPresets` — genuinely blocked. `SeriesConfig` is a **persisted preset** shape with no
  instance field, so adding one means migrating stored presets.
- `useBenchmarkForm` — **cheap, just not done here.** A `ProfileDashboard` carries a Grafana
  *label* and the endpoint takes an id, but `settings/profiles/[id]/page.tsx` already holds
  `grafanaData.instances` and hands them to the sibling `DashboardFormDialog` one line above
  `BenchmarkFormDialog`. One prop to thread. Do not file it next to the blocked one.

The pattern to copy is `useDashboardManagement`, which fetches per instance and matches on `d.id`.

### The Hosts tab's scope comes from the run, not from `hostEntities[0]`

`HostsTabContent` fans out one `GET /dynatrace/hosts/overview` per host, and that endpoint
requires `systemId`, `environment` and `workload` — it answers 400 without all three, before it
calls Dynatrace at all. The scope used to be read off the first entry of the mapping list:

```ts
const first = hostEntities[0];
const testEnvironment = first?.testEnvironment ?? '';   // wrong
```

A **`sut`-level** mapping has `test_environment` and `workload` NULL on purpose — that is what
"applies to the whole system" means, and `copyEntityMappings` preserves the level when copying.
Mappings come back ordered `createdAt DESC`, so the moment the newest mapping was a system-level
one, `?? ''` sent `environment=&workload=`, every host 400'd, and the table rendered empty with
nothing in the browser console to explain it. Since v0.2.95.1 made it one request per host, that
is four or five 400s per poll for anyone with the card open.

The scope is now destructured from `testRun`, which the component already receives. That is also
the more correct source: `DynatraceRepository.getEntityMappings` resolves **all three** mapping
levels for a concrete scope, so passing the run's environment and workload returns a superset of
what any single mapping's own scope would — the sut-level hosts come along.

Two things worth keeping:

- **`environment` and `workload` are in the effect's early-return guard.** Firing without them is
  a guaranteed 400 per host per poll, so the component asks for nothing instead.
- **The fixture in `HostsTabContent.test.tsx` had no `test_environment`/`workload` at all** — it is
  cast `as never`, so TypeScript never objected, and every mapping in it carried a concrete scope.
  That is why ten weeks of tests passed over this. The regression case puts a `sut`-level mapping
  first in the list and asserts what `fetchHostsOverview` was actually called with.

This is the repo's recurring **first-row-selection** shape — `configs[0]`, `LIMIT 1`, `take: 1`.
The same commit that introduced this one got it right one line away, for the Dynatrace config:
`configs.find((c) => c.id === selectedHost.dynatraceConfigId) ?? configs[0]`.

### Visited test-run tabs stay mounted while hidden

Since v0.2.97.41 `app/test-runs/[id]/page.tsx` mounts a tab on its first visit and then keeps it
mounted and hidden, so a card's own state (expanded rows, picker drafts, added series, a search
box) survives a switch to another tab and back. Each rule below fails silently when broken:

- **A hidden tab does not re-render.** Each tab sits in a memoised `TabBody` whose comparator
  skips every render while `active` is false; it catches up when shown. Context still crosses the
  memo, so a Provider whose value must change while the tab is hidden (`TabActiveContext`,
  `CardLinkRequestContext`) has to wrap `TabBody` from **outside**. A Provider inside the frozen
  subtree never receives a new value.
- **Timers keep running unless they read `TabActiveContext`** (`context/TabActiveContext.ts`,
  `true` outside the page). The AWR report poll and the Performance Analysis rollup poll and live
  refresh timer gate on it and refetch once when shown again, because re-arming a poll does not fire it: react-query
  does not fetch when the AWR card's `refetchInterval` goes from 0 back to N, and the rollup
  poll's fresh `setInterval` waits its full 5 s. A new poll in a test-run card must do the same.
- **A render error stays in its tab.** `TabErrorBoundary`, keyed on the run id, replaces only
  that tab's cards with a "Try again" alert instead of Next's page-wide "Application error".
- **A drill-down lands on a fresh RCA card.** `useExpansionState` bumps `drillDownSeq` per
  drill-down and the Dynatrace and Distributed Tracing cards are keyed on it. Without the key a
  kept-mounted card keeps whatever its filter effect does not overwrite: that effect sets only the
  scenario, transaction and sampler the new drill-down matches, so an earlier sampler, the
  tracing card's durations and the Dynatrace card's Hosts/Services tab (defaulted once per
  mount) carry over.
- **Only the shown panel's charts are resized on a switch**, by `Plots.resize` on its
  `.js-plotly-plot` nodes, never by a window resize event, which every chart on every tab
  would answer.
- **`TAB_CARDS` must match the panels in `page.tsx`.** A re-click on the active tab collapses
  exactly that tab's `TAB_CARDS` entries, and `revealCard` picks the tab from the same list.

### The add-series cascade is app-typed, and the chart inside it is not

`MetricSeriesCascade` (`app/test-runs/[id]/components/shared/`) and its presentation half
`components/charts/CascadeColumns.tsx` are the three-column series picker behind the
Graphs, Compare and Trends cards and the report section configs. They deliberately follow
two different type systems from the charts they feed.

**No `fontFamily` anywhere below the cascade's root.** Every `Typography` and MUI control
inherits `theme.typography.fontFamily`, so the picker reads as part of the app. The charts
themselves are the opposite — `MONO` from `lib/charts/tokens.ts` on every tick, value and
table cell — because a column of numbers that do not line up is unreadable, and a dialog
of labels set in JetBrains Mono looks like a terminal someone embedded. The rule is: a
measurement is mono, a label is the app face. Sizes come from the app (11/12/13px, 32px
rows), not from `SIZE`.

**The palette still comes from `chartTheme`**, because the picker sits inside the chart
card and has to match the surface it is on. It derives its own mode from
`useTheme().palette.mode` rather than taking it as a prop: two of the three call sites
never passed one, so a `mode = 'light'` default rendered a white panel with black text
inside a dark card. A new caller must not have to know.

`CascadeColumns` holds the presentation (`CascadeFrame`, `CascadeColumn`, `CascadeGroup`,
`CascadeRow`, the filter input, `cascadeGroupBy`) and `MetricSeriesCascade` holds the
selection logic, so the report-side `MetricSelectionCascade` can reuse the first without
inheriting the second.

**Checked means added, when the caller can remove.** Passing `onRemoveSeries` puts the
cascade in *instant* mode: a series is added the moment its box is ticked and removed when
it is unticked, and the "already added" affordance is suppressed because the checkbox now
carries that state. Without `onRemoveSeries` it is a staged picker whose selection is
applied on confirm. One prop, two behaviours — `MetricSeriesCascade.instant.test.tsx` pins
the first and `MetricSeriesCascade.test.tsx` the second.

**In draft mode a tick means drafted OR already on the chart (v0.2.97.4), and three things
had to move together for that to be honest.** An added series used to render as an *empty*
disabled checkbox, which since v0.2.97.1 reads as a lie: a card link adds its series
outright, so the picker claimed nothing was selected while the chart was already drawing it.
It is now ticked and disabled — but `seriesChecked` is no longer the same question as "what
would Add send", so anything that asked it the second question had to stop:

- **Select all / Clear follows the DRAFT, not the ticks** (`selectableSeries` = visible minus
  already-added). Folding the added rows in made the button read "Clear" over an empty draft
  on the very render after an Add or a card link — live, and a no-op. `toggleDisabled` keys
  on the same set, so the column disables when nothing is actually selectable.
- **Select all skips the already-added**, because their rows are disabled: a draft entry for
  one can only be cleared by unpicking the whole panel, and Add answers it with "already
  added".
- **The footer counts both halves** — `N on chart · M selected` — since they are two
  different states on screen (ticked-and-greyed vs ticked-and-live). Counting only the draft
  put "0 series selected" under two ticked rows, the same contradiction the ticks removed.

Instant mode is untouched: there the checkbox *is* the membership. One state is still
reachable and still looks wrong — a series both drafted and added renders identically to an
added-only one while only the draft half is counted and re-sent; it is filed in TODOS.md
("A series can be both drafted and already added").

**A card link is an instruction, not a draft — and that is why the panel stays mounted.**
The cascade is also what walks a card link: a new tab's `?card=…&dashboard=…&panel=…&metric=…`
params (`metric-card-links.tsx` builds them), or, since v0.2.97.41, the in-page
`CardLinkRequest` that a plain "Open in …" click hands over through `CardLinkRequestContext`
without navigating. `page.tsx` provides that context outside every tab's memoised `TabBody`,
because a Provider inside a frozen subtree never gets a new value (see "Deep link into a card"
in `docs/reference/Apps/Web/Web Overview.md`). Two rules fall out of that, both of which fail
silently when broken — v0.2.97.0 broke the first and v0.2.97.1 is the repair:

- **`AnalystChartCard` keeps the add-series panel mounted while the picker is closed**, hidden
  with `display: none` rather than unmounted. The walk lives in the cascade's effects, so a
  card whose picker starts closed — Graphs and Trends both do, behind `+ add series` — would
  never run it: the link opened the right card, expanded it, and then the chart just stayed
  empty, with nothing logged. Compare was unaffected throughout because its cascade is always
  on screen, which is exactly why this shipped unnoticed. `AnalystChartCard.test.tsx` asserts
  the panel is in the DOM while closed; `MetricSeriesCascade.closedPicker.test.tsx` asserts
  the walk completes without the picker ever being opened.
- **The price of that, and it is real:** a closed picker renders every dashboard row on every
  render of the card, so the caller must hand `addSeries.panel` a *stable* element. `GraphsChart`
  and `TrendsChart` both `useMemo` it against a `useCallback`'d close handler, because their
  Plotly cursor state re-renders the chart on every pointer move — inline, that was the whole
  dashboard list rebuilt per hover. The walk also *fetches* (panels for the linked dashboard,
  then series for each of its panels) with the picker never opened.

**The link adds outright in both modes, and a dashboard-only link is capped.** It used to tick
checkboxes and wait for "Add N series", which only works while the picker is visible. Three
details that are load-bearing:

- A **dashboard-only** link (`?dashboard=` with no `panel` and no `metric`) is a wildcard —
  every panel, every series — and is capped at `LINK_WILDCARD_MAX_SERIES` (50) with a toast.
  `dynatraceHostSeriesRef` emits that shape at 19-35 series, but the label is guessable and the
  URL is shareable, and a hand-typed perf-test dashboard label is one series per transaction
  (586 on a small demo run, each its own `ds_metrics` fetch in `useGraphsData`). The optional
  `showToast` prop exists only for that one message — the cards own every other toast — and is
  wired at all three call sites.
- **An empty pick list must not reach `onAddSeries`.** The fetch writes a fresh `[]` for a
  dashboard whose panels recorded nothing, which lands in the effect with the link still armed,
  and the cards answer a zero-length add with "All selected metrics are already added" — a toast
  the user did nothing to earn.
- **The effect is single-shot by construction**: `disarm()` runs synchronously in the same tick,
  so it reads `isAdded` without listing it as a dependency. Anything that makes it re-enter has
  to revisit those deps, or a second armed run dedupes against a stale snapshot.
  `MetricSeriesCascade.preselect.test.tsx` pins both modes. Single-shot is per link, not per
  page load (v0.2.97.41): `MetricSeriesCascade` is a thin wrapper that remounts its body
  (`CascadeBody`) per link key, and `disarm()` records that key in the page-owned `consumed` set
  from `CardLinkRequestContext` rather than in the module-level set it used to keep, so every
  in-page click is a fresh walk while a collapse and re-expand of the same link is not.

**Cancel drops the draft.** Because the panel survives a close, a cancelled selection would
otherwise still be ticked — with an armed "Add 3 series" — the next time the picker is opened.

### The series cascade reads its series from the panel list, and the key is a label

`/ds-metrics/available/:run` has always returned `metric_names` per panel. The cascade used to
discard it and then ask `/ds-metrics/distinct-names` once per panel — on a production select-all
over a 62-dashboard perf-test run, **625 requests** six at a time, three database round trips each
(`validateTestRunAccess` is two of them), for an answer already in the response. Since v0.2.97.6
`fetchPanelsForDashboards` builds a map with `seriesFromAvailableRows` and hangs it on
`PanelOption.metricNames`; `fetchSeriesForPanel` returns it without a request.

Four things hold it together, and three of them fail silently:

1. **The run-wide fetch stays gated on the batch containing a perf-test dashboard.** Widening it
   to every selection reads as "one call replaces N" and is a net LOSS, because the series step is
   lazy: `MetricSeriesCascade` asks for series only for the panels the user actually ticks, never
   for every panel it lists. At 895 ms warm / 5958 ms cold for `/available` against ~10 ms for a
   scoped `/distinct-names`, breakeven is ~90 ticked panels, and the effect re-runs on every
   dashboard toggle with nothing cached. The 625-request trace is a select-all over a perf-test
   run — exactly the case where these rows are fetched for the panel list anyway, so reading the
   series out of them costs nothing extra.
2. **`dashboard_label` is not a dashboard identity, and the endpoint groups by it.**
   `uq_application_dashboards_unique` carries `grafana_instance_id`, so one label can belong to two
   application dashboards with the same uid and the same panel ids. The server merges their series
   in its `GROUP BY` before anything reaches the client. `ambiguousLabels` detects the collision and
   declines the map for that label, so those panels fall back to `/distinct-names`, which is scoped
   by `application_dashboard_id`. **Judge it over every dashboard on the system, not over the
   selection** — the merge has already happened whether or not both twins are picked, so a
   selection-scoped guard catches the obvious case and misses the quiet one. That is why
   `fetchPanelsForDashboards` takes a fourth `allDashboards` argument.
3. **`isUrlPanel` is tested BEFORE the short-circuit, and must stay there.** A URL panel's series
   are the run's normalized URLs, which no `ds_metrics` row carries; panels 210-218 do get
   `metricNames` attached and deliberately never read it.
4. **An empty `metric_names` must not reach `panel.metricNames`.** `[]` is truthy, so it would
   short-circuit to an empty dropdown with no request and nothing logged. The
   `!row.metric_names?.length` guard in the map builder is what prevents it, and the same guard is
   what lets an API older than this client fall back cleanly.

The whole mechanism degrades to the old behaviour rather than to an error, so nothing here is
visible in a log — the only symptom of a break is the latency that was there before. The API side
pins the projection in `metrics.service.spec.ts`; see "`hasData` probes one index per dashboard"
in [apps/api/CLAUDE.md](../api/CLAUDE.md) for the other half of the same dialog — why the
dashboard list it opens with now probes an index instead of scanning `ds_metric_statistics`.

### There is one `CopyButton` — reach for it instead of hand-rolling the next one

`apps/web/components/ui/copy-button.tsx` is the shared copy-to-clipboard icon button
(`import { CopyButton } from '@/components/ui/copy-button'`). It takes `text`, an optional `title`
and an optional glyph `fontSize`, shows a transient "Copied!" check for 1.5 s, and swallows a
rejected `navigator.clipboard.writeText` without showing a false confirmation (an insecure context
or a denied permission).

Two details it exists to get right, and that a fresh hand-rolled handler tends to miss:

- **The revert timer is cleared on unmount.** A dialog can render eight of these (every field of
  `ErrorDetailsDialog` has one), and a copy followed within 1.5 s by the dialog closing would
  otherwise leave a pending `setTimeout` per instance.
- **The hit area stays >= 24 px** (`minWidth`/`minHeight`, WCAG 2.5.8) no matter how small
  `fontSize` gets. Shrinking the glyph to fit a dense row must not shrink the target.

~13 sites under `apps/web` still hand-roll the same Tooltip + IconButton + `writeText` trio; they
are filed in TODOS.md and are convertible one at a time. `SamplerDetailsModal` and
`components/ui/clipped-url.tsx` are the worked examples. Do not add a fourteenth.

### The error drill-down has one dialog and one fetcher, reached from two places

The Performance Analysis overview (`ErrorsModal`) and the Error Analysis tab both open the same
`ErrorDetailsDialog`
(`app/test-runs/[id]/components/performance-analysis/error-analysis/components/`) through the same
`fetchErrorDetails` helper in that feature's `utils/`. Before v0.2.96.17 the overview carried its
own ~140-line accordion, which drifted: it hard-coded two light-mode greys and had no loading or
failure state, so the drill-down icon was a dead click on a slow or failed fetch. It now shows a
spinner, disables the icon while in flight, and surfaces a toast on failure.

Consequences worth knowing before editing either side:

- **`fetchErrorDetails` requires the URL exactly as the server stored it.** The details query
  matches `url` with `=`; see "The errors endpoint's `sample_url` is a key the client sends back"
  in [apps/api/CLAUDE.md](../api/CLAUDE.md). Do not lowercase, trim or re-encode it in the client
  either.
- **Formatters come from `utils/performance-formatters`**, not from local copies. Replacing the
  overview's three private helpers moved one Apdex colour on screen: `getApdexColor`'s `>= 0.50`
  band is `#ef5350` in the shared copy against the local copy's `#f57c00`. That is the shared
  version winning on purpose, not a regression.
- **The timestamp field copies ISO 8601 while displaying the local format.** What is on screen is
  for reading; what lands on the clipboard is for pasting into a query.

### A graph preset's scope is a flag, not a missing `test_run_id`

`SaveGraphPresetModal` always sends `test_run_id: currentTestRunId` now, for both scopes
(v0.2.96.27). It used to send `undefined` for the Global option, which is where the whole
class of bugs came from: the API derived the preset's owning system from the run, so a preset
with no run was stamped with an arbitrary one, and the list treated "no run" as "belongs to
every system".

Three rules follow:

- **Only `is_global` moves when the radio changes.** `handleScopeChange` no longer clears
  `test_run_id`, and the radio's `value` is read from `is_global`, not from whether a run id
  is set. Reintroducing the `test_run_id ? 'test_run' : 'global'` read brings the bug back.
- **"Global" is called "All runs of this system"** because that is what it does: every run of
  that system under test **and environment**, not every system. See "Graph presets are scoped
  by their series' dashboards" in [apps/api/CLAUDE.md](../api/CLAUDE.md) for how the server
  resolves it.
- **Only ever upsert over a preset the caller owns.** `useGraphsPresets.handleSavePreset`
  matches on `name && userId === currentUserId && isGlobal`. `presets` is what `findAll`
  returned, which for a regular user is `own OR isGlobal` — so it contains other people's
  global presets. Matching on name alone meant a name collision PATCHed someone else's row:
  a 403 for a regular user, reported only as the generic failure toast, but a **global
  admin's PATCH succeeded and silently overwrote it**.

`UpdateGraphPresetRequest` deliberately omits `testRunId` (`apps/web/lib/graph-presets.ts`);
the server's `UpdateGraphPresetDto` omits it too and the global `ValidationPipe` strips it, so
sending it is a silent no-op that reads like a re-scope.

### A graph's title is a preset field, and it is state only once someone chose it

`useGraphsData` holds `customChartName` (`string | null`) and derives
`chartName = customChartName ?? generateChartName(addedSeries)` (v0.2.97.48). It used to be an effect
that regenerated the name on every series change, so loading a preset overwrote the title, and so
did adding one series to a chart you had just named. Four things are easy to undo:

- **`??`, never `||`.** An empty string is what the field holds while someone retypes it. With `||`
  the generated name snaps back on the last backspace.
- **The title lives in `chartOptions.title`, not in the preset's `name`.** The save dialog only
  defaults the name to the title, and the two can differ. A preset with no stored title falls back
  to its name, which is the best guess for one saved before v0.2.97.48.
- **A loaded title equal to the composed default goes back to `null`,** so adding a series to that
  chart keeps its name accurate instead of freezing a description of the old set.
- **`chartOptions` is unvalidated and global presets are shared,** so the load path checks `typeof`
  rather than trusting the type. A non-string reaches `exportFilename`'s `.toLowerCase()`.

**Trends has no editable title and no column to store one**, so the loaded preset's `name` is the
title: `useTrendsData.presetName`, rendered as `<name> (avg)`, set by applying or saving a preset.
A preset that restores no series leaves it alone, because the chart still draws what it had.

On both cards the title goes when the last series does, by Clear all or by removing them one at a
time, since it named those series. Typing a Graphs title onto an empty chart first is fine: that is
why this lives in the remove handlers and not in a derivation over `addedSeries`. Compare has
nothing to restore, because its charts are per metric and titled by that metric.

### A compare preset's baseline is restored for both preset types, and they differ only in who wins

Every `compare_filter_presets` row carries `baseline_test_run_id`, and `ComparePresetsTable`
prints it inside the preset's own description ("Baseline: …-00003"). `applyPreset`
(`compare/hooks/useComparePresets.ts`) used to gate the restore on
`preset_type === PresetType.SPECIFIC`, so for a **generic** preset — what the Save dialog
produces by default, and what both presets on the dev database are — the baseline was read,
printed, and then never applied.

The symptom is not an error. The preset's series load, the toast says "Applied preset: … (22
series)", the footer reads `22 series added`, and the card **renders nothing at all**, because
`Metrics Comparison` needs a selected comparison run. The only way out is to open the selector
and pick the run the preset just named. Nothing is logged. Fixed in v0.2.97.33.

Three rules, all three load-bearing:

1. **Both types restore; they differ in who wins.** `SPECIFIC` is locked to its baseline and
   overrides the current selection. `GENERIC` fills an **empty** selector only — overriding
   there would silently discard a comparison the user set up by hand before applying the
   preset, which is the whole meaning of "generic". That is why the hook needs
   `selectedTestRun` as a prop and not just `setSelectedTestRun`; `setSelectedTestRun` takes a
   value, not an updater, so the current value cannot be read from inside the setter.
2. **A baseline missing from `relatedTestRuns` leaves the selector alone, never clears it.**
   The run may have been deleted or may sit outside this run's comparable set
   (`test_run_id` has no foreign key). The series are still applied, so the user can pick any
   other run and the preset is not wasted.
3. **The Baseline COLUMN in `ComparePresetsTable` is a different thing and correctly stays
   specific-only** (`ComparePresetsTable.tsx:198`). It renders "Locked to: …" plus version and
   annotations — a statement that the preset is pinned. A generic preset shows "-" there and
   still restores its baseline. Do not "fix" that column to match this behaviour; the two
   answer different questions.

`useComparePresets.baseline.test.ts` pins all five cases and is mutation-verified in both
directions: narrowing the guard to `isLocked` alone fails the generic-restore case, and widening
it to unconditional fails the don't-override case. Its `setup()` deliberately does **not**
`await act(...)` to flush the preset-list effect — that effect re-triggers on its own state, so
awaiting it never settles and every case times out at 10 s. The unwrapped-act warning is noise;
the hang is not.

### The Compare card's "Control group" baseline is a sentinel riding in `selectedTestRun`

The baseline picker offers the run's control group (the runs anomaly detection judges it against)
first, as a synthetic `RelatedTestRun` whose `test_run_id` is `CONTROL_GROUP_BASELINE` and whose
`control_group` carries the group (`controlGroupOption` in `compare/utils/compare-utils.ts`,
v0.2.97.51). Sharing the state keeps every id-only consumer working — "is a baseline selected",
preset save — and makes everything that would treat the id as a run a bug unless it branches on
`isControlGroupOption`. Four places do, and each fails silently if the branch is lost:

1. **The pairing in `useCompareData`.** The baseline comes from
   `/metrics/control-group-statistics/:run` (pooled `ds_control_group_statistics`), never from the
   rows of `ds-metric-statistics`, which would match nothing for the sentinel. URL panels and the
   synthetic "All aggregated" series have no pooled rows: they are fetched for the current run alone
   and shown with an empty baseline, never a stand-in. `fetchControlGroupStatistics` sends the
   series' dashboard id together with its metrics source, and the API ANDs them: one source can
   back several dashboards, and filtering on the source is what anomaly detection does, so a series
   whose source changed gets no control value, as it is incomparable there. A non-uuid dashboard id
   (a synthetic list entry) is not sent.
2. **The graph.** `fetchGraphData` omits `baselineTestRunId` (now optional on
   `ds-metrics-comparison`), and `ComparisonPlot` draws the group's pooled mean — the `avg` cell's
   `selected_value` — as a flat dashed line, since a pooled distribution has no time series.
3. **Captions.** `baselineDisplayName` / `getTestRunDisplayText` print "control group (N runs)";
   the raw sentinel must never reach the screen.
4. **Preset restore.** `CompareCard` hands `useComparePresets` the `baselineOptions`, not
   `relatedTestRuns`, so a preset stored with the sentinel finds the option. `SavePresetModal`
   defaults such a preset to **generic**: every run has its own control group, so it is reusable.
   The API's `baselineRunOf` (`compare-presets.service.ts`) keeps the sentinel away from the run
   access checks — without it a non-admin's save 404s.

The group is fetched once per run on first expand (`undefined` = not asked yet, `null` = none), so
a preset applied before it lands leaves the selector alone, as for a missing run.

Two things in `useCompareData` keep the modes from bleeding into each other (v0.2.97.52):

- **An open graph closes when the baseline id changes.** `graphData` holds what was fetched for
  the old baseline, and the table re-renders the open row against the new one: leaving the
  control group for a run drew "Baseline (null)" with no line. `toggleGraph` refetches on open,
  so closing is enough for a graph that has landed. One still loading when the baseline changes
  is dropped in `useCompareHandlers` (`baselineIdRef`): `fetchGraphData` resolves `false`, so the
  late answer neither writes `graphData` nor reopens the row under the new baseline.
- **Only the latest `fetchMetricsComparison` writes state** (`comparisonRequestRef`). The
  control-group branch waits on an extra request per panel, so it routinely answers after a run
  picked later and would otherwise fill the table with the group's numbers under the run's
  legend. The empty-selection arm bumps the counter too, so a request still out cannot
  repopulate a cleared table.

### An SLO with no targets must not borrow the panel's series

`useSLOMetricsChart` falls back to "every series on the panel" when a target matches no
charted series — a deliberate fallback for a near-miss name. With **zero** targets that
fallback draws a bar per transaction: numbers that are not the SLO's, beside a series table
correctly reading "No values available for this SLO". The case in the wild is a trend SLO on a
panel whose series hold one point each, so the worker records ERROR / "No targets found for
processing" (see "A Trend SLO judges the slope of a series" in
[apps/worker/CLAUDE.md](../worker/CLAUDE.md)) and the chart answered with fifteen unrelated
bars.

`SLOMetricsChart` now returns early on `!checkResult.targets?.length` (v0.2.96.27).
`ChartEmptyState` takes an optional `message` and `detail`: the headline is written for the
user, and the pipeline's own words go underneath as supporting text, capped at `60ch` so an
arbitrary-length message is not set as one centred line across the chart.

### A perf-test panel's unit arrives as a display string, and the SLO dialogs store codes

`GET /metrics/ds-metrics/panels-by-dashboard` answers each performance-test panel's unit the way
the worker writes it (`METRIC_TYPE_PANEL_UNITS` in `apps/worker/src/constants/performance-metrics.ts`):
`'ms'`, `'%'`, `'req/s'`, `'threads'`, `''`. The SLO dialogs convert thresholds and save
`configuration.yAxesFormat` (which the API copies into `metric_unit`) as unit **codes** from
`lib/units.ts`. `perfPanelUnitCode` maps the two that differ: `'%'` to `'percent'` (perf error
rates are 0-100, never `percentunit`) and `'req/s'` to `'reqps'`. Until v0.2.97.58 both dialogs
dropped the unit altogether, so a perf-test SLO was saved with `metric_unit` NULL: its threshold
was never converted and the SLO list showed a bare number. Rows saved before then keep NULL until
someone saves them in Edit.

Two things to keep:

- **The Add dialog stores the panel id as `configuration.id`, never `panelId`.** Edit's panel
  upgrade matches `configuration.panelId ?? configuration.id`. Matching `panelId` alone sent every
  UI-created SLO to title and fuzzy matching, and the matched panel's unit is what the save uses.
- **Edit has one unit, `sloFormData.thresholdUnit`** (v0.2.97.60). It is what the stored value is
  shown in (percentunit 0-1 as 0-100), what validation, the helper text, the placeholder and the
  chip read, what the save converts into, and what it sends as `configuration.yAxesFormat`.
  `thresholdUnitFormat` turns it into "no unit" for a trend, which is %/h. Nothing in Edit reads
  the selected panel's unit for any of that; doing so again is how a stored number and its label
  came apart, an SLO that always passes or always fails with nothing logged. It is set in three
  places only:
  1. **At open, from the record** (`storedThresholdUnit`): `configuration.yAxesFormat`, then
     `configuration.metricUnit`, then `metric_unit`, skipping `'%/h'` per candidate, because the
     API writes that label for a trend and a former trend keeps it after an edit to avg.
  2. **When the live panel or Dynatrace metric arrives** (`adoptPanelUnit`), only if the record had
     none. A record with a unit keeps it even when the panel's unit has changed since, and the
     threshold section says so under the field. A Dynatrace SLO therefore keeps the record's unit
     whether or not its metric matches; the reverted single-unit attempt took the unit from the
     panel, which a Dynatrace synthetic or unmatched metric does not have, and saved `1s` as 1 ms.
     Adopting percentunit re-shows the untouched value scaled, for a non-trend record only, and
     declines if the user already typed a bare number over it: that number was entered against no
     unit and is saved as typed (#719, never scaled twice). A typed suffix (`90%`) does not block
     it: it converts under the adopted unit. Only the benchmark's own panel is upgraded, so in
     Duplicate a late fetch for the original dashboard cannot swap back a panel the user picked.
  3. **When Duplicate picks another metric** (`SLOFormFields`): the new metric's unit, since the
     clone's record unit belongs to the old one.

  For a trend the base unit is still saved in `configuration.yAxesFormat`; the API puts `'%/h'` in
  `metric_unit` and keeps the configuration, so a later edit back to avg finds the panel's unit.

### The error rate has one threshold and one set of formatters

`ERROR_RATE_WARN_PCT` (5), `computeErrorRate`, `errorRateSeverity` and `formatErrorRate` live
in `performance-analysis/utils/performance-formatters.ts` and are shared by
`OverallTestMetrics` and the collapsed `PerformanceAnalysisCollapsedView` badge
(v0.2.96.27). Before that the threshold sat in three places in the expanded tile and a fourth
in the badge, with a comment claiming a parity it did not have — the badge warned amber under
5% while the tile reported the same number in success green.

Three behaviours the helpers encode, so a new caller does not have to rediscover them:

- **Pooled, never averaged.** `SUM(failed) / SUM(total)`. The mean of per-row rates lets one
  failed execution in a quiet transaction count as 100% — the same mistake the perf-test
  error-rate SLO made before v0.2.96.1.
- **`errorRateSeverity` returns `'none'`** when there is nothing to report, and callers hide
  the indicator rather than rendering an alarm-coloured "0.00%". It range-checks with
  `Number.isFinite` first: `NaN <= 0` is false, so a comparison alone falls through to a badge
  reading "NaN% errors", and these counts come off the API response typed but never validated.
- **A non-zero rate that rounds to 0.00 renders as `<0.01%`.** Three failures in 100k
  transactions is routine on a large run, and "0.00% errors" on a red badge asserts the one
  thing the badge exists to rule out.

### A third config scope fans out to every dashboard sharing a panel title, matched by title alone

`ConfigFormData`'s save used to take `scope: 'metric' | 'panel'`. `ConfigScope`
(`anomaly-detection/types.ts`) adds `'all-dashboards'` — the row settings view's third radio,
"This Panel On All Dashboards" (`configuration-comparison/MetricConfigForm.tsx`). It does not
introduce a third kind of stored row: `handleConfigSave` (`anomaly-detection/hooks/useAnomalyDetection.ts`)
still writes `config_data.source` as `'metric'` or `'panel'` only — `all-dashboards` decides **how
many** panel-level rows get written, not what shape they are.

- **Targets come from the fan-out helper, not from every dashboard in the system.**
  `collectPanelTargets` (`anomaly-detection/utils.ts`) scans the run's whole already-loaded
  `anomalyData` list (not `paginatedData` — the current page would silently miss targets), keeps every one whose `panel_title` equals the row being edited, and dedupes
  by `application_dashboard_id` + `panel_id`. The set is therefore exactly the dashboards *this
  test run* collected from — nothing is fetched to find dashboards the run has no anomaly rows for.
- **The match key is the panel title string, not the panel or its source.** A panel id is only
  unique within one Grafana dashboard (see item 43 in the root [CLAUDE.md](../../CLAUDE.md)), so
  this helper deliberately matches on the human-readable title instead — but that means two
  unrelated panels that happen to share a title (a Grafana dashboard and a Dynatrace host panel
  both called "CPU Usage", say) are indistinguishable to it and both receive the same classification
  and threshold.
- **Each target is an independent POST, via `Promise.allSettled`, not `Promise.all`.** The API has
  no transaction spanning multiple `ds_compare_config` rows, so a partial failure is a real
  outcome, not an edge case to collapse into one error. `saved === 0` is reported as a hard
  failure; `0 < saved < total` surfaces as "Configuration saved on N of M dashboards — K failed:
  `<first error>`" so the user knows a retry is worth it (every target is an upsert, so retrying
  is safe) rather than reading one opaque failure or a false "success."

### A golden-path template's discriminator is a shared constant now, not a repeated string literal

`DYNATRACE_HOST_COMPARE_SOURCE` (`apps/api/src/constants/ds-compare-config.constants.ts`) is the
`config_data.source` marker `DynatraceRepository.createDsCompareConfigForMetric` stamps on the
panel-level row it writes when a host is mapped, and the same value `TestRunsMetricsService
.applyGoldenPathClassifications` tests for to tell that boilerplate row apart from a user edit (see
"A golden-path template loses to any row already on the panel" in
[apps/api/CLAUDE.md](../api/CLAUDE.md) for the full mechanism and the bug it fixes). The web side's
part of the contract: `handleConfigSave` above always overwrites `source` with `'metric'` or
`'panel'` on any UI save, which is what made a user edit distinguishable from the Dynatrace
boilerplate in the first place. It is no longer the only guard: the golden path reads a
Dynatrace-marked row as machine-seeded only when it has no author, and the API stamps one on every
save (`updateDsCompareConfig` since v0.2.95.42, the insert in `createOrUpdateDsCompareConfig` since
v0.2.97.54). A save path that bypassed both methods and also skipped `source` would still make every
row it touches look machine-seeded again.

### The ADAPT template dialog sends only the fields that are ticked

`/settings/profiles/adapt-templates` (v0.2.97.55) manages organization and install-wide compare-config
templates, and the profile page's **ADAPT templates** tab (v0.2.97.57) a profile's; both render
`adapt-templates/components/AdaptTemplatesPanel.tsx`. The dialog is
`adapt-templates/components/CompareTemplateDialog.tsx`, its state mapping `adapt-templates/template-form.ts`.
A definition never carries its scope (`organizationId` or `profile`): the panel's scope names the
collection, `toDto` strips the profile on the way out, and a copy POSTs the same definition to another scope.
A template's meaning is which fields it names: a named field is forced onto every panel the template
reaches, an absent one keeps each panel's own value. Three rules:

- **Do not swap in `MetricConfigForm`.** It writes every field on every save and has no "no direction",
  so every template saved through it would force every field. Only the option lists are shared, from
  `@/lib/compare-config-options`, which both import; add a classification or aggregation there.
- **`null` is a value only for `higherIsBetter` and `absThreshold`.** Every other field is omitted, never
  sent as `null`: the API holds a definition to the YAML file's rules, and `dashboardUid: null` is an
  error there, not a wildcard.
- **An untouched number is sent back as stored.** The percentage is shown as a percent and stored as a
  fraction; re-deriving the stored value from the displayed text would rewrite a provisioned
  `0.1234567890123456` on a copy. `toDefinition` keeps the original while the text is unchanged.

### "Save as template" on the anomaly card builds a definition, it does not save the row

`MetricConfigForm` shows **Save as template** when given `onTemplateSaved` (v0.2.97.67). It opens
`configuration-comparison/PromoteTemplateDialog.tsx`, which POSTs the definition built by
`buildPromotedDefinition` (`promote-template.ts`) to an existing template collection. Three rules:

- **The row is never saved by it.** Promotion must not change the workload it came from; `onSave` is not
  called. The definition is built from the form's current values, so unsaved edits go into the template.
- **A title template carries no panel id or uid**, and a uid template carries both. A panel id is unique only
  within one dashboard (root CLAUDE.md #43), so `panelId` without `dashboardUid` would reach every dashboard
  of the workload that happens to have that id.
- **The default target is derived, not stored.** The profiles load after the dialog opens; a `useEffect` that
  picked `targets[0]` stuck on the organization because it was still valid when the matching profile arrived.
  `targetKey` falls back to `targets[0]` until the user picks.

### Series grouping in the web: where a group's badge comes from, and what the dialog fetches

Series grouping (v0.2.97.43; design in `docs/design/2026-11-01-series-grouping-design.md`) has
three web surfaces: suggestions and a stale notice on the anomaly card
(`anomaly-detection/components/SeriesGroupingNotices.tsx`), a **Series grouping** section in a
dashboard's settings (`systems/[id]/config/components/SeriesGroupingRulesSection.tsx`), and the
`N pods` badge plus **show pods** switch in the series picker. All of them open one dialog,
`components/series-grouping/SeriesGroupingDialog.tsx`. Seven things are easy to undo:

1. **The picker learns a panel's groups from `/ds-metrics/distinct-series`, not from
   `/ds-metrics/available`.** The plan said `available`, and that would have shipped a badge that
   never appears: `fetchPanelsForDashboards` asks `available` only when a perf-test dashboard is in
   the batch, and a perf-test dashboard never gets a rule. A Kubernetes Grafana panel gets its
   series from the per-panel call, so that call is the one that has to carry `series_groups`.
   `distinct-series` is `distinct-names` plus the groups, from the same reads; a **404 falls back
   to `distinct-names`**, so a web build ahead of its API loses the badge and nothing else. The
   `available` rows' `series_groups` are still mapped onto `PanelOption.seriesMembers` for the
   panels that path does cover.
2. **The per-pod view bypasses `panel.metricNames`.** Those names are grouped, and the raw members
   are the point of the switch. `fetchSeriesForPanels` is called with **two** arguments while no
   panel is switched — the third (`memberPanels`) only appears when one is — so the common call is
   unchanged. Switching a panel drops the draft picks on it, because they name series the column
   no longer lists.
3. **One control picks every series a group emits (v0.2.97.44).** **Series per group** is a single
   `FormGroup` of four checkboxes — Average per pod, Total, Highest pod, Number of pods — and each
   ticked box is one series named `<group> (avg)` / `(sum)` / `(max)` / `(count)`. There is no
   primary, no radio, and no bare `api`. It replaced three controls (Combine / Also add / Also
   track) that were one question split three ways; the split existed only to keep one series
   unsuffixed for stored baselines, which a greenfield feature does not have. Five rules:

   - **Save is disabled with nothing ticked**, and an Alert says why. A rule that emits nothing
     still excludes its panels from the main statistics statement, so the panel would lose every
     series rather than keeping its pods — and the DTO and the CHECK both refuse it anyway, which
     without this guard is a 400 on a form that looked valid.
   - **The series are previewed as sub-lines under the group name**, never as extra rows, so the
     *After: N of M groups match* figure keeps counting **groups**: ticking a box must not inflate
     a number that is about baseline matching. The series count is printed separately.
   - **Unticking a box on a SAVED rule warns**, because `deleteOrphanedResults` covers
     `ds_adapt_results` only — an SLO, a graph preset or a report section on that name just stops
     matching, with nothing logged.
   - **The order of the ticks never reaches the server.** `normalizeAggregations` canonicalises
     before the spec is built, because the rule hash is taken over that list and the insights page
     reads a changed hash as "this run is stale".
   - **A `FormLabel` + `role="group"`, not `aria-label` on the `FormGroup`.** MUI renders
     `FormGroup` as a plain `<div>` with no role, where `aria-label` is ignored by assistive tech,
     and a checkbox reading `Total as "… (sum)"` means nothing without its group.

4. **The dialog fetches names once per scope and regroups on every keystroke client-side.** Only
   the SLO check depends on the rule (it needs stored SLO patterns), so `useSeriesGroupingPreview`
   re-asks the preview for it 600 ms after the rule stops changing, never for a rule that does not
   compile, and shows "Checking SLOs…" instead of a warning list computed for a different rule.
   Changing "This panel" ↔ "All panels" is a different name list and refetches.
5. **The dialog's state is initialised from its props on the first render**, not only by the
   reset-on-open effect. The preview fetches on the first commit, and a first render with a
   placeholder scope (`panelId: null`) fetched the whole dashboard and then the panel — two
   requests per open, caught by the "fetched once" test.
6. **The anomaly notices refetch when the card's `anomalyData` array is replaced**, which is what
   happens after a re-evaluate lands. A requested recalculation keeps the stale notice reading
   "Recalculation requested" until then: the status endpoint still describes the old statistics,
   and repeating the warning right after the user acted would read as a failure. Dismissals are
   per browser (`lib/safe-storage.ts`, `perfana.seriesGrouping.dismissed.<sut>.<env>.<workload>.<dashboard>.<panel>`),
   a convenience only.
7. **The settings section is gated on a selected workload** (rules are per workload, the dashboard
   list is per environment) and is not rendered at all for a `performance-test-metrics-` dashboard,
   which the API refuses.

Not in v1, by design: the Compare card's inline hint, the "avg of 3 pods · baseline 5" table
affordance, and a badge in the report section cascade (`MetricSelectionCascade`), which reads its
names from `getAvailableMetricsPanels` and shows group names unbadged.

### Performance Analysis live refresh is a client timer, and background callers wait for the latest request

Since v0.2.97.42 the card no longer refetches on the test run's WebSocket `updated_at`; while a
run is live it refetches on its own timer, at the period picked in the **Refresh** dropdown
(`REFRESH_OPTIONS` in `performance-analysis/hooks/usePerformanceAnalysisData.ts`: Off, 10s, 30s,
1m, 5m; default 30s). Test-run status and job progress are still WebSocket-driven.

Six things hold it together:

1. **Only the latest `/transactions` request may write state.** `fetchTransactions` takes a
   sequence number and checks `isStale()` after every `await`, in `catch`, and before its
   `finally` sets `loading` and the ≥5 s pause. A user-driven fetch (window or filter change,
   manual refresh, run completion) overtakes one still out, and the late answer is dropped.
2. **Background callers wait while that latest request is out.** The timer tick and the 5 s
   rollup-pending poll skip while `latestTransactionsSettledRef` is false. Without this the two
   rules livelock: a fixed-interval caller starts a new request every period, so once answers are
   slower than the period every one is stale on arrival, `loading` sticks, the pause never
   engages, and the rollup poll never leaves pending (that last one was a regression against the
   old code). It is a **flag, not a counter**: a counter leaks on the stale early returns and lets
   a superseded slow request block ticks. Only the non-stale `finally` sets it true — moving that
   assignment above the stale check reintroduces the livelock and no test catches it yet
   (TODOS.md, "Tests the live refresh review proposed but did not add").
3. **`refreshAll` is read through a ref**, so expanding a row or changing a filter does not restart
   the timer, and the next tick still refreshes the newly expanded row.
4. **Completion refetches once.** On running → completed the hook calls `refreshAll`, or resets
   `sinceMinutes` to null (which refetches through the mount effect) when a window was picked.
5. **Re-picking the shown period must resume a pause.** MUI's `Select` fires `onChange` only for a
   different value, so each `MenuItem` has an `onClick` guarded on `opt.value === refreshIntervalMs`.
6. **The timer stops while the Results tab is hidden** (`TabActiveContext`, see "Visited test-run
   tabs stay mounted while hidden") and refreshes once when the tab is shown again, as the rollup
   poll does.

A picked period is remembered per browser in `localStorage`, read once through
`readStoredRefreshInterval`: missing, blank (`Number('')` is 0, which is Off), 0, or a value the
dropdown no longer offers all fall back to 30s, and storage that throws is ignored. **Off is never
persisted** (the setter returns before writing it): the collapsed card shows no refresh state, so a
remembered Off would freeze its figures on every later run with nothing on screen saying so. The card derives
one `refreshState` (`on` / `off` / `paused`, Off outranking paused) for the caption, the LIVE
tooltip and the manual button's label.

Testing it: `npx jest` takes a regex, so a path containing `[id]` matches nothing — use
`'performance-analysis/hooks/__tests__/usePerformanceAnalysisData'`. With fake timers, state
written after an awaited fetch is only visible through `jest.advanceTimersByTimeAsync`, and React
commits only between `act()` calls: one `act` spanning an answer and the next tick lets that tick
fire before the pause it should have seen.

The live controls (LIVE chip, Time window, Refresh, the "Updated" caption, the manual button) sit
in their **own wrapping row inside the sticky header block, under the title** — not in the title
row. Everything in the title row is `position: absolute` at fixed offsets around a centred title,
so a group placed there cannot wrap: before this was moved, the group ran over the title and, at an
~880 px window, pushed the manual refresh button under the sidebar where it could not be clicked.
Keep new live controls in that row.

Known gaps (the sibling endpoints' ordering, polling while hidden, polish) are in TODOS.md under
"Performance Analysis live refresh".

### dnd-kit can end a drag without telling the report builder

`GenerateReportDialog` (`components/reports/report-generation/`, v0.2.97.46) runs one `DndContext`
across the palette and the canvas and keeps its own `dragging` state. While that is set the dialog
ignores the mouse and Escape: `pointerEvents: 'none'` on everything but the canvas scroller, which
keeps the wheel, and `disableEscapeKeyDown`, so Escape reaches dnd-kit's cancel instead of closing
the dialog over an unsaved report. A keyboard drag gets the same lockout, because Delete, Back or
Cancel would pull the list out from under it, so the canvas heading swaps "Drag to reorder
sections" for its keys: nothing else on screen says why the mouse stopped answering.

Four things fail silently when undone:

1. **Neither `onDragEnd` nor `onDragCancel` fires when a drag starts and ends before React
   commits.** Their caller (`createHandler` in `@dnd-kit/core` 6.3.1) reads `active` from
   `sensorContext.current`, which a layout effect fills in, and builds the event only if it is set.
   A move past the 5 px activation distance and a release in one batch (a jittery click, a trackpad
   tap-and-nudge) runs `onDragStart` and then neither of them, so `dragging` stays set and the
   report in progress cannot be reached. Nothing clears that except `ClearDragWhenIdle`, which ends
   the state when `useDndContext().active` reads null and has to render inside the `DndContext`.
2. **The suite's hand-held drags fake dnd-kit's `active`, so they cannot catch a break in item 1.**
   They call the recorded handlers directly, which dnd-kit knows nothing about, and
   `ClearDragWhenIdle` would end such a drag on its first commit. So in
   `GenerateReportDialog.test.tsx` the wrapped `onDragStart` records `mockDnd.handDrag` and the
   mocked `useDndContext` reports it as `active`. Only the `with the real pointer sensor` block
   goes through the real `PointerSensor` and `DndContext`, so a test of the drag's lifecycle
   belongs there.
3. **The reset to the starting point happens while rendering, not in an effect.** The dialog stays
   mounted while closed on the test-run page, and MUI's `Portal` mounts its children from a layout
   effect, so on a reopen they commit before an effect in the dialog can change what they render.
   The last report's whole builder mounts, every card's form fires its fetches, and only then does
   the starting point replace it. The settled screen is right either way, so the test
   `fetches nothing for the last report on a reopen` counts requests, and it waits for the dialog
   to close all the way: a reopen during the exit animation never unmounted the old content.
4. **`sections` and `sectionKeys` move together.** Cards are keyed by `sectionKeys`, so every edit
   that inserts, removes or moves a section has to edit both. Index keys handed a card's expanded
   state and form state to whichever section landed at its position, which a drop into the middle
   of the list does on every add.

### The report builder asks before a template's changes are lost

Since v0.2.97.56 `GenerateReportDialog` compares the builder's sections with the template they were
loaded from and, when they differ, routes every exit through `requestExit` to
`SaveTemplateChangesDialog`: Generate, Cancel, Escape, a backdrop click, **Back to Template** and the
browser's Back button. Saving is a `PUT /report-templates/:id` with the sections, before the report
is queued. Four things fail silently when undone:

1. **The comparison is a fingerprint, not a dirty flag** (`template-changes.ts`). A flag set by the
   edit handlers would fire for a form that rewrites its config on mount and for an edit that is
   put back. The fingerprint reads array position rather than the stored `order`, a blank title as
   none, the text through `getSectionText` and `{}` as no config, so a template loaded and left
   alone matches itself. A new section-level field the template stores has to be added there, or a
   change to it is never offered for saving.
2. **The shared baseline counts as a change.** Picking a baseline run for comparison sections writes
   `baselineTestRunId` into them, so an unpinned template is offered for saving on every report that
   needs one. That is the honest answer, since saving would pin the run, and *Generate without
   saving* is one click.
3. **The browser Back guard is one extra history entry** (`useHistoryBackGuard.ts`). Its state
   spreads the current one so Next's App Router finds its own keys and treats the pop as a same-page
   no-op; a pop onto anything but this guard's own entry (per-arming token) re-arms and opens the
   prompt. On release it calls `history.back()` only while its entry is still current, so a
   navigation away is not undone. A router `replaceState` while the dialog is open overwrites the
   entry and leaves one duplicate entry behind, which is harmless.
4. **jsdom queues `history.back()` in two stages**, so in tests it lands in whichever test is
   running by then. The tests dispatch `popstate` themselves and spy on `history.back`.

