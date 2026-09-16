import { HtmlGenerationProcessor } from './html-generation.processor';

/**
 * Regression for #421: the worker must THROW on failure (not return
 * { success: false }), so BullMQ routes the job to :failed and the configured
 * attempts/backoff actually retry. Returning success:false marks the job
 * completed and the report stays stuck at pending forever.
 */
describe('HtmlGenerationProcessor.processJob', () => {
  function makeJob(reportId: string) {
    return {
      data: { reportId, testRunId: 't', templateId: 'tpl' },
      updateProgress: jest.fn().mockResolvedValue(undefined),
    } as any;
  }

  it('throws when HTML generation fails', async () => {
    const reportGenerationService = {
      generateHtml: jest.fn().mockRejectedValue(new Error('Report not found')),
    };
    const processor = new HtmlGenerationProcessor(
      {} as any,
      reportGenerationService as any,
      {} as any,
    );

    // processJob is private; exercise it via the bracket accessor.
    await expect(
      (processor as any).processJob(makeJob('r1')),
    ).rejects.toThrow('Report not found');
  });

  it('returns success and auto-queues PDF on success', async () => {
    const reportGenerationService = {
      generateHtml: jest.fn().mockResolvedValue({ generationTimeMs: 5, sectionCount: 2 }),
    };
    const pdfProcessor = {
      isAvailable: jest.fn().mockReturnValue(true),
      addJob: jest.fn().mockResolvedValue('pdf-1'),
    };
    const processor = new HtmlGenerationProcessor(
      {} as any,
      reportGenerationService as any,
      pdfProcessor as any,
    );

    const result = await (processor as any).processJob(makeJob('r2'));
    expect(result).toMatchObject({ success: true, reportId: 'r2', sectionCount: 2 });
    expect(pdfProcessor.addJob).toHaveBeenCalledWith('r2', { initiatedBy: 'auto-after-html' });
  });

  it('records per-section progress on the job as the compiler reports it', async () => {
    // Drive the onProgress callback the processor hands to generateHtml.
    const reportGenerationService = {
      generateHtml: jest.fn().mockImplementation(async (_id, _u, _r, onProgress) => {
        onProgress(0, 8, 'Header');
        onProgress(3, 8, 'Custom Graphs');
        onProgress(0, 0, 'Nothing'); // a template with no sections must not divide by zero
        return { generationTimeMs: 5, sectionCount: 8 };
      }),
    };
    const processor = new HtmlGenerationProcessor(
      {} as any,
      reportGenerationService as any,
      { isAvailable: jest.fn().mockReturnValue(false) } as any,
    );
    const job = makeJob('r3');

    await (processor as any).processJob(job);

    expect(job.updateProgress).toHaveBeenCalledWith({ stage: 'rendering', percent: 0, done: 0, total: 8, section: 'Header' });
    expect(job.updateProgress).toHaveBeenCalledWith({ stage: 'rendering', percent: 38, done: 3, total: 8, section: 'Custom Graphs' });
    expect(job.updateProgress).toHaveBeenCalledWith({ stage: 'rendering', percent: 0, done: 0, total: 0, section: 'Nothing' });
    expect(job.updateProgress).toHaveBeenLastCalledWith({ stage: 'complete', percent: 100 });
  });

  it('keeps rendering when a progress update cannot be written', async () => {
    // Progress is a courtesy to the UI; a Redis hiccup on updateProgress must not fail the report.
    const reportGenerationService = {
      generateHtml: jest.fn().mockImplementation(async (_id, _u, _r, onProgress) => {
        onProgress(1, 2, 'SLO');
        return { generationTimeMs: 5, sectionCount: 2 };
      }),
    };
    const processor = new HtmlGenerationProcessor(
      {} as any,
      reportGenerationService as any,
      { isAvailable: jest.fn().mockReturnValue(false) } as any,
    );
    const job = makeJob('r4');
    job.updateProgress
      .mockResolvedValueOnce(undefined)                     // starting
      .mockRejectedValueOnce(new Error('redis gone'))       // rendering
      .mockResolvedValue(undefined);                        // complete

    await expect((processor as any).processJob(job)).resolves.toMatchObject({ success: true, reportId: 'r4' });
  });
});
