/**
 * REGRESSION: five of the six chart modebar buttons awaited `toImage` and only then
 * called `navigator.clipboard.write`. That spends the click's transient user
 * activation, so Chrome rejects with NotAllowedError and Safari refuses a
 * non-promise ClipboardItem outright — "copy graph" failed everywhere.
 *
 * The contract this pins: `write` is called SYNCHRONOUSLY with the click, and the
 * item carries the still-unsettled Promise<Blob>.
 */
import {
  CHART_COPIED,
  CHART_COPY_DOWNLOADED,
  CHART_COPY_FAILED,
  copyPlotToClipboard,
  dataUrlToPngBlob,
  dimOtherTraces,
  downloadPng,
  plotSize,
  plotlyPngBlob,
} from '@/lib/plotly';

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('copyPlotToClipboard', () => {
  let write: jest.Mock;

  beforeEach(() => {
    write = jest.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).ClipboardItem = class {
      items: Record<string, unknown>;
      constructor(items: Record<string, unknown>) { this.items = items; }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).clipboard = { write };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).ClipboardItem;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (navigator as any).clipboard;
  });

  it('writes in the same task as the click, with an unsettled blob promise', () => {
    let settle: (b: Blob) => void = () => {};
    const blob = new Promise<Blob>((res) => { settle = res; });

    copyPlotToClipboard(() => blob);

    // Called before the render resolved — this is the whole fix.
    expect(write).toHaveBeenCalledTimes(1);
    const item = write.mock.calls[0]![0][0] as { items: Record<string, unknown> };
    expect(item.items['image/png']).toBe(blob);
    settle(new Blob([]));
  });

  it('notifies on success once the write resolves', async () => {
    const notify = jest.fn();
    copyPlotToClipboard(() => Promise.resolve(new Blob([])), { notify });
    await flush();
    expect(notify).toHaveBeenCalledWith(CHART_COPIED);
  });

  it('downloads and says so when the clipboard write is refused', async () => {
    write.mockRejectedValue(new Error('denied'));
    jest.spyOn(console, 'warn').mockImplementation();
    const notify = jest.fn();
    const png = new Blob(['x']);
    const clicked: string[] = [];
    const realCreate = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag) as HTMLAnchorElement;
      if (tag === 'a') el.click = () => clicked.push(el.download);
      return el;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).createObjectURL = jest.fn(() => 'blob:fake');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).revokeObjectURL = jest.fn();

    copyPlotToClipboard(() => Promise.resolve(png), {
      fallbackFilename: 'chart.png',
      notify,
    });
    await flush();

    expect(clicked).toEqual(['chart.png']);
    expect(notify).toHaveBeenCalledWith(CHART_COPY_DOWNLOADED);
  });

  it('falls back when the browser has no ClipboardItem', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).ClipboardItem;
    jest.spyOn(console, 'warn').mockImplementation();
    const notify = jest.fn();

    expect(() =>
      copyPlotToClipboard(() => Promise.resolve(new Blob([])), {
        fallbackFilename: 'chart.png',
        notify,
      }),
    ).not.toThrow();
    await flush();

    expect(write).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalled();
  });

  it('reports failure when the render itself fails', async () => {
    jest.spyOn(console, 'warn').mockImplementation();
    write.mockRejectedValue(new Error('denied'));
    const notify = jest.fn();

    copyPlotToClipboard(() => Promise.reject(new Error('Plotly is not loaded')), {
      fallbackFilename: 'chart.png',
      notify,
    });
    await flush();

    expect(notify).toHaveBeenCalledWith(CHART_COPY_FAILED);
  });

  /**
   * REGRESSION: the helper used to hand the started blob to the caller's onError and
   * rely on it to attach a `.catch()`. Two of the eight call sites took only `err`, so
   * a failing render on a browser with no ClipboardItem surfaced as an unhandled
   * rejection. The helper owns the promise now.
   */
  it('leaves no unhandled rejection when the render fails and there is no clipboard', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).ClipboardItem;
    jest.spyOn(console, 'warn').mockImplementation();
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);

    copyPlotToClipboard(() => Promise.reject(new Error('Plotly is not loaded')));
    await new Promise((r) => setTimeout(r, 20));

    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

/**
 * REGRESSION, and the one that actually broke every chart: the CSP's `connect-src` does
 * not list `data:`, so `fetch(dataUrl)` is blocked and rejects with a bare
 * `TypeError: Failed to fetch`. Every modebar button decoded Plotly's PNG that way.
 * Proven in the running app on 2026-10-01: `fetch(tinyPngDataUrl)` threw while the
 * `atob` path returned a 70-byte Blob, with `isSecureContext` true and the whole
 * Clipboard API present.
 */
// REGRESSION: the consolidation moved `new ClipboardItem(...)` out of a promise chain
// and into the bare click handler. A UA whose constructor or write() throws
// SYNCHRONOUSLY would escape Plotly's modebar handler AND orphan the blob.
describe('a clipboard that throws synchronously', () => {
  it('falls back instead of escaping the click handler', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).ClipboardItem = class {
      constructor() { throw new TypeError('Promise values are not supported'); }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).clipboard = { write: jest.fn() };
    const notify = jest.fn();

    expect(() =>
      copyPlotToClipboard(() => Promise.resolve(new Blob([])), { notify }),
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));

    expect(warn).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(CHART_COPY_FAILED);

    jest.restoreAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).ClipboardItem;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (navigator as any).clipboard;
  });
});

describe('PNG decoding never touches the network', () => {
  const TINY_PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  it('decodes a data URL with atob, not fetch', () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch' as never);

    const blob = dataUrlToPngBlob(TINY_PNG);

    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(70);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('renders through plotlyPngBlob without fetching', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch' as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Plotly = { toImage: jest.fn().mockResolvedValue(TINY_PNG) };

    const blob = await plotlyPngBlob({}, { width: 10, height: 10 });

    expect(blob.size).toBe(70);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).Plotly;
  });

  it('rejects rather than throwing when Plotly is absent', async () => {
    await expect(plotlyPngBlob({}, { width: 10, height: 10 })).rejects.toThrow('Plotly is not loaded');
  });
});

/**
 * The two helpers the six call sites now share for sizing and for the download
 * fallback. `plotSize` is what stops a copied chart coming out at a stock 800x400 when
 * the user widened it, and `downloadPng` is the only fallback that produces a PNG —
 * the chain it replaced copied the base64 data URL as *text* and told the user to paste
 * it into an image editor, which no editor accepts.
 */
describe('plotSize', () => {
  it('reads the size Plotly actually rendered at', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gd = { _fullLayout: { width: 1440, height: 620 } } as any;

    expect(plotSize(gd, { width: 800, height: 400 })).toEqual({ width: 1440, height: 620 });
  });

  it('falls back per-axis when the layout has not been measured', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(plotSize({} as any, { width: 800, height: 400 })).toEqual({ width: 800, height: 400 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(plotSize({ _fullLayout: { width: 1000 } } as any, { width: 800, height: 400 }))
      .toEqual({ width: 1000, height: 400 });
  });

  // A zero is Plotly's "not laid out yet", and a 0x0 toImage produces an empty PNG.
  it('treats a zero dimension as unmeasured', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(plotSize({ _fullLayout: { width: 0, height: 0 } } as any, { width: 800, height: 480 }))
      .toEqual({ width: 800, height: 480 });
  });
});

describe('downloadPng', () => {
  const createObjectURL = jest.fn(() => 'blob:fake');
  const revokeObjectURL = jest.fn();

  beforeEach(() => {
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).createObjectURL = createObjectURL;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).revokeObjectURL = revokeObjectURL;
  });

  it('clicks a download anchor and cleans up after itself', async () => {
    const clicks: string[] = [];
    const appended: HTMLElement[] = [];
    const realCreate = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag) as HTMLAnchorElement;
      if (tag === 'a') el.click = () => clicks.push(el.download);
      return el;
    });
    const appendSpy = jest.spyOn(document.body, 'appendChild');
    appendSpy.mockImplementation(((el: HTMLElement) => {
      appended.push(el);
      return el;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);
    const removeSpy = jest.spyOn(document.body, 'removeChild');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    removeSpy.mockImplementation(((el: HTMLElement) => el) as any);

    downloadPng(new Blob(['x']), 'trend_chart.png');

    expect(clicks).toEqual(['trend_chart.png']);
    expect((appended[0] as HTMLAnchorElement).href).toContain('blob:fake');
    // The anchor must not be left in the DOM and the object URL must not leak.
    expect(removeSpy).toHaveBeenCalledWith(appended[0]);
    // The revoke is deferred a task on purpose — Firefox and WebKit can abort a
    // just-started blob download when it happens in the same turn as the click.
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 0));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });

  // In the `it` body this never ran on a failing assertion, leaving the document spies
  // installed for every later describe and turning one failure into a cascade.
  afterEach(() => {
    jest.restoreAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (URL as any).createObjectURL;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (URL as any).revokeObjectURL;
  });
});

describe('copyPlotToClipboard with no notify handler', () => {
  it('warns rather than throwing when the clipboard is unavailable', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).ClipboardItem;

    expect(() =>
      copyPlotToClipboard(() => Promise.resolve(new Blob([]))),
    ).not.toThrow();
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });
});

describe('dataUrlToPngBlob edge cases', () => {
  it('keeps a non-png mime type when Plotly hands one over', () => {
    const blob = dataUrlToPngBlob('data:image/webp;base64,AAAA');

    expect(blob.type).toBe('image/webp');
  });

  it('defaults to image/png when the header carries no mime', () => {
    const blob = dataUrlToPngBlob('data:;base64,AAAA');

    expect(blob.type).toBe('image/png');
  });
});

/**
 * Fading the other lines when a series row is hovered.
 *
 * This fires on every mouse move across the series table of three charts (Graphs, Trends,
 * Compare), so each guard is about not throwing from a bare pointer handler: a torn-down
 * graph div, a figure with no traces yet, a Plotly global that loaded without `restyle`,
 * and a `restyle` that rejects because the div went away mid-hover. An unhandled rejection
 * there surfaces as a page error, which is why the `.catch` exists.
 */
describe('dimOtherTraces', () => {
  const withPlotly = (plotly: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Plotly = plotly;
  };
  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).Plotly;
  });

  it('fades every trace but the focused one, and restores them all on null', () => {
    const restyle = jest.fn().mockResolvedValue(undefined);
    withPlotly({ restyle });

    dimOtherTraces({} as HTMLElement, 3, 1);
    expect(restyle.mock.calls[0]![1]).toEqual({ opacity: [0.18, 1, 0.18] });

    dimOtherTraces({} as HTMLElement, 3, null);
    expect(restyle.mock.calls[1]![1]).toEqual({ opacity: [1, 1, 1] });
  });

  it('focuses trace 0, which a falsy check would treat as no focus', () => {
    const restyle = jest.fn().mockResolvedValue(undefined);
    withPlotly({ restyle });

    dimOtherTraces({} as HTMLElement, 2, 0);
    expect(restyle.mock.calls[0]![1]).toEqual({ opacity: [1, 0.18] });
  });

  it('does nothing without a graph div, without traces, or without restyle', () => {
    const restyle = jest.fn().mockResolvedValue(undefined);
    withPlotly({ restyle });

    dimOtherTraces(null, 3, 0);
    dimOtherTraces(undefined, 3, 0);
    dimOtherTraces({} as HTMLElement, 0, 0);
    expect(restyle).not.toHaveBeenCalled();

    withPlotly({});
    expect(() => dimOtherTraces({} as HTMLElement, 3, 0)).not.toThrow();
  });

  it('swallows a rejected restyle rather than leaving an unhandled rejection', async () => {
    const restyle = jest.fn().mockRejectedValue(new Error('div is gone'));
    withPlotly({ restyle });

    expect(() => dimOtherTraces({} as HTMLElement, 3, 0)).not.toThrow();
    await flush();
    expect(restyle).toHaveBeenCalledTimes(1);
  });
});
