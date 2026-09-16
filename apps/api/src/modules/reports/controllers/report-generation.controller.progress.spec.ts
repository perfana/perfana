import { ReportGenerationController } from './report-generation.controller';

/**
 * GET /reports/:id carries the HTML job's own progress record while the report is
 * processing, and nothing else — a missing job, an unavailable queue or a record without
 * a `stage` must never turn a plain report read into an error.
 */
describe('ReportGenerationController.findOne progress', () => {
  const ctx = { userId: 'user-1', roles: ['user'] } as any;

  const report = (overrides: Record<string, unknown>) => ({
    id: 'r1', test_run_id: 't1', template_id: 'tpl', name: 'Nightly', generated_by: 'u',
    status: 'processing', job_id: 'html-gen-r1-1', retry_count: 0, max_retries: 3,
    download_count: 0, created_at: new Date(), updated_at: new Date(),
    ...overrides,
  });

  function setup(reportRow: Record<string, unknown>, processor: Record<string, jest.Mock>) {
    const reportGenerationService = { findById: jest.fn().mockResolvedValue(reportRow) };
    const htmlGenerationProcessor = {
      isAvailable: jest.fn().mockReturnValue(true),
      getJobStatus: jest.fn().mockResolvedValue(null),
      ...processor,
    };
    const controller = new ReportGenerationController(
      reportGenerationService as any,
      {} as any,
      htmlGenerationProcessor as any,
      {} as any,
    );
    return { controller, htmlGenerationProcessor };
  }

  it('returns the job progress while the report is processing', async () => {
    const progress = { stage: 'rendering', percent: 37, done: 3, total: 8, section: 'Custom Graphs' };
    const { controller, htmlGenerationProcessor } = setup(report({}), {
      getJobStatus: jest.fn().mockResolvedValue({ status: 'active', progress }),
    });

    const dto = await controller.findOne('r1', ctx);

    expect(htmlGenerationProcessor.getJobStatus).toHaveBeenCalledWith('html-gen-r1-1');
    expect(dto.progress).toEqual(progress);
    expect(dto.status).toBe('processing');
  });

  it('asks the queue for nothing when the report is not processing, or has no job, or the queue is down', async () => {
    const completed = setup(report({ status: 'completed' }), {});
    expect((await completed.controller.findOne('r1', ctx)).progress).toBeUndefined();
    expect(completed.htmlGenerationProcessor.getJobStatus).not.toHaveBeenCalled();

    const noJob = setup(report({ job_id: undefined }), {});
    expect((await noJob.controller.findOne('r1', ctx)).progress).toBeUndefined();
    expect(noJob.htmlGenerationProcessor.getJobStatus).not.toHaveBeenCalled();

    const queueDown = setup(report({}), { isAvailable: jest.fn().mockReturnValue(false) });
    expect((await queueDown.controller.findOne('r1', ctx)).progress).toBeUndefined();
    expect(queueDown.htmlGenerationProcessor.getJobStatus).not.toHaveBeenCalled();
  });

  it('treats a gone job, a stage-less progress value and a queue error as "no progress", not a failure', async () => {
    // Job already removed from Redis
    const gone = setup(report({}), { getJobStatus: jest.fn().mockResolvedValue(null) });
    expect((await gone.controller.findOne('r1', ctx)).progress).toBeUndefined();

    // BullMQ's default numeric progress carries no section information
    const numeric = setup(report({}), { getJobStatus: jest.fn().mockResolvedValue({ progress: 42 }) });
    expect((await numeric.controller.findOne('r1', ctx)).progress).toBeUndefined();

    // Redis unreachable mid-request: the read still answers
    const broken = setup(report({}), { getJobStatus: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) });
    const dto = await broken.controller.findOne('r1', ctx);
    expect(dto.progress).toBeUndefined();
    expect(dto.id).toBe('r1');
  });
});
