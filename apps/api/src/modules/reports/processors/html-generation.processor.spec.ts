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
});
