import { ConfluenceRenderProcessor } from './confluence-render.processor';

type Box = { width: number; height: number } | null;

/** A fake puppeteer SVG handle: `topLevel` is what the isTopLevel evaluate returns. */
function svgHandle(box: Box, topLevel = true) {
  const replaced: Array<{ index: number; width: number }> = [];
  return {
    replaced,
    boundingBox: jest.fn(async () => box),
    screenshot: jest.fn(async () => `png-${replaced.length}-${box?.width}`),
    evaluate: jest.fn(async (_fn: unknown, index?: number, width?: number) => {
      if (index === undefined) return topLevel;
      replaced.push({ index, width: width! });
      return undefined;
    }),
  };
}

function setup(
  svgs: ReturnType<typeof svgHandle>[],
  html = '<html>rendered</html>'
) {
  const page = {
    setViewport: jest.fn(),
    setContent: jest.fn(),
    evaluate: jest.fn(),
    $$: jest.fn(async () => svgs),
    content: jest.fn(async () => html),
    close: jest.fn(async () => undefined),
  };
  const browserPool = {
    getBrowser: jest.fn(async () => ({ newPage: async () => page })),
  };
  const reportRepo = { findOne: jest.fn() };
  const processor = new ConfluenceRenderProcessor(
    { get: (_k: string, d: string) => d } as never,
    browserPool as never,
    reportRepo as never
  );
  return { processor, page, reportRepo };
}

describe('ConfluenceRenderProcessor.render', () => {
  it('screenshots each top-level chart and replaces it with a numbered img', async () => {
    const chartA = svgHandle({ width: 640.4, height: 300 });
    const chartB = svgHandle({ width: 900, height: 400 });
    const { processor } = setup([chartA, chartB]);

    const result = await processor.render('<html></html>');

    expect(result.images).toEqual(['png-0-640.4', 'png-0-900']);
    expect(chartA.replaced).toEqual([{ index: 0, width: 640 }]);
    expect(chartB.replaced).toEqual([{ index: 1, width: 900 }]);
    expect(result.html).toBe('<html>rendered</html>');
  });

  it('skips icons, nested SVGs and hidden ones without consuming an index', async () => {
    const icon = svgHandle({ width: 16, height: 16 });
    const nested = svgHandle({ width: 800, height: 400 }, false);
    const hidden = svgHandle(null);
    const chart = svgHandle({ width: 800, height: 400 });
    const { processor } = setup([icon, nested, hidden, chart]);

    const result = await processor.render('<html></html>');

    expect(result.images).toHaveLength(1);
    expect(chart.replaced).toEqual([{ index: 0, width: 800 }]);
    for (const skipped of [icon, nested, hidden]) {
      expect(skipped.screenshot).not.toHaveBeenCalled();
      expect(skipped.replaced).toEqual([]);
    }
    expect(nested.boundingBox).not.toHaveBeenCalled();
  });

  it('closes the page when rendering fails', async () => {
    const { processor, page } = setup([]);
    page.setContent.mockRejectedValueOnce(new Error('timeout'));

    await expect(processor.render('<html></html>')).rejects.toThrow('timeout');
    expect(page.close).toHaveBeenCalled();
  });
});

describe('ConfluenceRenderProcessor.process', () => {
  it('writes the result under a per-job key with a TTL and returns only the key', async () => {
    const { processor, reportRepo } = setup([
      svgHandle({ width: 800, height: 400 }),
    ]);
    reportRepo.findOne.mockResolvedValue({
      id: 'r1',
      html_content: '<html></html>',
    });
    const set = jest.fn();
    (processor as unknown as { redis: unknown }).redis = { set };

    const out = await (
      processor as unknown as { process: (j: unknown) => Promise<unknown> }
    ).process({ id: '42', data: { reportId: 'r1' } });

    expect(out).toEqual({ resultKey: 'confluence-render:42' });
    expect(set).toHaveBeenCalledWith(
      'confluence-render:42',
      expect.any(String),
      'EX',
      600
    );
    expect(JSON.parse(set.mock.calls[0][1])).toEqual({
      html: '<html>rendered</html>',
      images: ['png-0-800'],
    });
  });

  it('refuses a report with no HTML', async () => {
    const { processor, reportRepo } = setup([]);
    reportRepo.findOne.mockResolvedValue({ id: 'r1', html_content: null });

    await expect(
      (
        processor as unknown as { process: (j: unknown) => Promise<unknown> }
      ).process({ id: '1', data: { reportId: 'r1' } })
    ).rejects.toThrow('Report r1 has no HTML content');
  });

  /*
   * Value: protects=a job the API already gave up on (queued > 180 s ago) never takes the single render
   *   slot; fails_when=the staleness check is removed or compares the wrong way; why_new=no case covered
   *   queue age; seam=none; no_claim=BullMQ scheduling (job object faked; unit only)
   */
  it('skips a job queued longer ago than the API waits, without loading or rendering the report', async () => {
    const { processor, reportRepo } = setup([
      svgHandle({ width: 800, height: 400 }),
    ]);
    const process = (
      processor as unknown as { process: (j: unknown) => Promise<unknown> }
    ).process.bind(processor);

    await expect(
      process({
        id: '7',
        timestamp: Date.now() - 181_000,
        data: { reportId: 'r1' },
      })
    ).rejects.toThrow(/the API stopped waiting/);
    expect(reportRepo.findOne).not.toHaveBeenCalled();
  });
});
