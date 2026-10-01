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

/** The subset of the global Plotly API this app calls directly. */
export interface PlotlyGlobal {
  toImage: (
    gd: PlotlyGraphDiv,
    opts: { format?: string; width?: number; height?: number; scale?: number },
  ) => Promise<string>;
  Plots: {
    /**
     * Re-measure the graph div against its container and relayout. Rejects when the
     * div is hidden, so callers must catch.
     */
    resize: (gd: PlotlyGraphDiv) => Promise<unknown>;
  };
}

/**
 * Read the Plotly global. Returns undefined when the bundle has not attached
 * it yet, so callers can skip the export rather than throw.
 */
export function getPlotly(): PlotlyGlobal | undefined {
  return (window as unknown as { Plotly?: PlotlyGlobal }).Plotly;
}

/** One voice for all eight chart copy buttons. */
export const CHART_COPIED = 'Chart copied to clipboard';
export const CHART_COPY_DOWNLOADED = 'Clipboard not available - chart downloaded instead';
export const CHART_COPY_FAILED = 'Could not copy the chart';

/**
 * Copy a rendered chart to the clipboard, falling back to a download.
 *
 * TWO RULES, and the first is what actually broke every chart in the app:
 *
 * 1. **Never `fetch()` a `data:` URL.** The CSP's `connect-src` does not list `data:`
 *    (`apps/web/next.config.js`), so `fetch(dataUrl)` is blocked and rejects with a bare
 *    `TypeError: Failed to fetch` — no CSP violation reaches the catch, so it reads like
 *    a network fault. Every modebar button did
 *    `toImage().then(fetch).then(r => r.blob())`, so "copy chart to clipboard" failed on
 *    every chart, in every browser, on localhost and in production alike. `plotlyPngBlob`
 *    decodes the base64 with `atob` instead: no network, no CSP.
 * 2. `navigator.clipboard.write` is called in the same task as the click, with the
 *    unsettled `Promise<Blob>` handed to `ClipboardItem`. This one is belt-and-braces
 *    rather than the observed bug — it keeps the user-activation context, which Safari
 *    requires and which Chrome can withdraw if the render is slow.
 *
 * The helper owns the download fallback so no call site can forget it. It also owns the
 * blob's rejection handling: the five sites that hand-rolled this each had to remember
 * to `.catch()` the promise, and the two that did not would surface an unhandled
 * rejection whenever the render failed on a browser with no `ClipboardItem`.
 *
 * `render` is called synchronously but must not throw — a missing `window.Plotly` has
 * to come back as a rejected promise, or the rejection escapes the click handler.
 */
export function copyPlotToClipboard(
  render: () => Promise<Blob>,
  options: {
    /**
     * Saved under this name when the clipboard is unavailable or refuses.
     *
     * Pair it with `notify` wherever a toast is in scope: a clipboard refusal
     * ("Document is not focused") is routine rather than exceptional, so without one the
     * user gets a file in their Downloads folder with nothing on screen to explain it.
     * `graphs/utils/chart-utils.ts` is the deliberate exception — its own suite pins the
     * download as a regression guard, and it sits beside an explicit
     * "Download as PNG" button, so the file is not a surprise there.
     */
    fallbackFilename?: string;
    /** Receives the user-facing message for each outcome. */
    notify?: (message: string) => void;
  } = {},
): void {
  const { fallbackFilename, notify } = options;
  const blob = render();

  const fallBackToDownload = (err: unknown) => {
    console.warn('[chart-export] clipboard copy failed', err);
    if (!fallbackFilename) {
      // Nothing to fall back to, but the promise still needs an owner: an unconsumed
      // rejected render is an unhandled rejection, which is how this surfaced before
      // the helper took ownership of the blob.
      blob.catch(() => undefined);
      notify?.(CHART_COPY_FAILED);
      return;
    }
    blob
      .then((png) => {
        downloadPng(png, fallbackFilename);
        notify?.(CHART_COPY_DOWNLOADED);
      })
      .catch(() => notify?.(CHART_COPY_FAILED));
  };

  if (navigator.clipboard && 'write' in navigator.clipboard && typeof ClipboardItem !== 'undefined') {
    // try/catch, not just .catch: `new ClipboardItem(...)` and `write()` can throw
    // SYNCHRONOUSLY (a UA that refuses a Promise value, a hardened clipboard). Before the
    // consolidation each site built the item inside a `.then()`, so such a throw was
    // caught by the chain; from the bare click handler it would escape Plotly's modebar
    // AND orphan the blob — the exact unhandled rejection this helper exists to own.
    try {
      navigator.clipboard
        .write([new ClipboardItem({ 'image/png': blob })])
        .then(() => notify?.(CHART_COPIED))
        .catch(fallBackToDownload);
    } catch (err) {
      fallBackToDownload(err);
    }
  } else {
    fallBackToDownload(new Error('Clipboard API unavailable'));
  }
}

/**
 * Render a graph div (or a figure object) to a PNG blob. Deferred with
 * `Promise.resolve().then` so an absent `window.Plotly` rejects instead of throwing
 * out of a click handler — see `copyPlotToClipboard`.
 */
export function plotlyPngBlob(
  target: unknown,
  size: { width: number; height: number },
): Promise<Blob> {
  return Promise.resolve().then(() => {
    const plotly = getPlotly();
    if (!plotly) throw new Error('Plotly is not loaded');
    return plotly
      .toImage(target as PlotlyGraphDiv, { format: 'png', ...size, scale: 2 })
      .then(dataUrlToPngBlob);
  });
}

/** Convert Plotly's data-URL output into a Blob without a `fetch` round trip. */
export function dataUrlToPngBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',');
  const mime = parts[0]!.match(/:(.*?);/)?.[1] || 'image/png';
  const raw = atob(parts[1]!);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/** The pixel size Plotly actually rendered the chart at, with a caller-supplied default. */
export function plotSize(
  gd: PlotlyGraphDiv,
  fallback: { width: number; height: number },
): { width: number; height: number } {
  return {
    width: gd._fullLayout?.width || fallback.width,
    height: gd._fullLayout?.height || fallback.height,
  };
}

/** Trigger a browser download for an already-rendered blob — the clipboard fallback. */
export function downloadPng(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Deferred: Firefox and WebKit have a history of aborting a just-started blob download
  // when the URL is revoked in the same task, and all eight copy buttons now share this
  // one implementation — a multi-megabyte PNG is exactly the case that loses the race.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
