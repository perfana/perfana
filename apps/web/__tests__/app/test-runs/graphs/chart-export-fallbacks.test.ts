/**
 * The three export outcomes the modebar buttons have to survive.
 *
 * `chart-utils.test.ts` covers the titling and the "everything failed" rejection
 * paths. This file covers the branch selection itself: which of clipboard-write /
 * download actually runs, and — the regression this guards — that a browser with
 * `navigator.clipboard.write` but no `ClipboardItem` constructor falls through to
 * a download instead of throwing a ReferenceError out of the click handler.
 */

import { buildChartConfig } from '@/app/test-runs/[id]/components/graphs/utils/chart-utils';

type ModeBarButton = { name: string; click: (gd: unknown) => void };

const gd = {
  data: [{ y: [1, 2, 3] }],
  layout: { font: { color: '#111', family: 'Inter' }, xaxis: {} },
  _fullLayout: { width: 900, height: 400 },
};

const clickButton = (name: string) => {
  const config = buildChartConfig('My Chart');
  const buttons = config.modeBarButtonsToAdd as ModeBarButton[];
  buttons.find((b) => b.name === name)!.click(gd);
};

// Let the deferred render, the clipboard promise and every fallback settle.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('chart export branch selection', () => {
  let toImage: jest.Mock;
  let downloadImage: jest.Mock;
  let anchorClick: jest.SpyInstance;

  beforeEach(() => {
    toImage = jest.fn().mockResolvedValue('data:image/png;base64,AAAA');
    downloadImage = jest.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Plotly = { toImage, downloadImage };
    URL.createObjectURL = jest.fn(() => 'blob:mock');
    URL.revokeObjectURL = jest.fn();
    anchorClick = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    anchorClick.mockRestore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).ClipboardItem;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (navigator as any).clipboard;
  });

  it('downloads the rendered blob when the download button is used', async () => {
    clickButton('Download as PNG');
    await settle();

    expect(toImage).toHaveBeenCalledTimes(1);
    // The blob actually reaches the browser: an object URL is minted, the anchor is
    // clicked, and the URL is released again.
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    // Plotly's own downloader is the fallback only — it must not fire on success.
    expect(downloadImage).not.toHaveBeenCalled();
  });

  it('writes the image to the clipboard when the browser supports it', async () => {
    const write = jest.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).ClipboardItem = class {
      constructor(public items: unknown) {}
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).clipboard = { write };

    clickButton('Copy to Clipboard');
    await settle();

    expect(write).toHaveBeenCalledTimes(1);
    // Handed the promise synchronously, which is what keeps the user-activation
    // context alive; the browser resolves it itself.
    const [items] = write.mock.calls[0];
    expect(items).toHaveLength(1);
    // A successful copy must not also drop a file in the downloads folder.
    expect(anchorClick).not.toHaveBeenCalled();
  });

  // REGRESSION: `navigator.clipboard.write` exists in browsers that never shipped
  // the `ClipboardItem` constructor. The old feature test only checked for `write`,
  // so `new ClipboardItem(...)` threw a ReferenceError straight out of the modebar
  // click handler — the button did nothing and nothing was downloaded either.
  it('falls back to a download when ClipboardItem is missing', async () => {
    const write = jest.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).clipboard = { write };
    expect(typeof (globalThis as { ClipboardItem?: unknown }).ClipboardItem).toBe('undefined');

    expect(() => clickButton('Copy to Clipboard')).not.toThrow();
    await settle();

    expect(write).not.toHaveBeenCalled();
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });

  it('falls back to a download when the clipboard write is rejected', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).ClipboardItem = class {
      constructor(public items: unknown) {}
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).clipboard = { write: jest.fn().mockRejectedValue(new Error('denied')) };

    clickButton('Copy to Clipboard');
    await settle();

    expect(anchorClick).toHaveBeenCalledTimes(1);
  });
});
