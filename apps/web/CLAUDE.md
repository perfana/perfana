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

Four things about it are load-bearing:

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
4. **Only three call sites use it so far** — `anomaly-detection/components/TrendChart.tsx`,
   `anomaly-detection/.../AnomalyExpandedContent.tsx`, and `compare/CurrentTestRunChart.tsx`. Nine
   others still call `dynamic(() => import('@/components/plotly-cartesian'))` directly and therefore still respond
   to a window resize only; that is deliberate scope, tracked in TODOS.md, not an oversight.

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

`apps/web/lib/plotly.ts` is now the one implementation. All eight modebar copy buttons go
through it: `graphs/utils/chart-utils.ts`, `compare/components/ComparisonPlot.tsx`,
`compare/current-test-run-chart/utils/current-test-run-chart-utils.ts`,
`anomaly-detection/components/utils/trends-plot-utils.ts`, `trends/hooks/useTrendsPlot.ts`,
`performance-analysis/RequestTimeSeriesModal.tsx`,
`performance-analysis/transaction-graph-modal/utils/chart-config.ts`, and
`service-level-objectives/utils/slo-chart-utils.ts`. A ninth button writes its own
`toImage` chain at your peril.

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
