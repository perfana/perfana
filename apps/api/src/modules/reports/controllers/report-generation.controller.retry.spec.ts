import { HttpException } from '@nestjs/common';
import { ReportGenerationController } from './report-generation.controller';

/**
 * A report whose template was deleted (template_id NULL, migration 1821) is still readable, but
 * regenerating it needs the sections the template held. The refusal has to come before the status
 * moves: the job would only find out asynchronously, and the report would flip back to failed.
 */
describe('ReportGenerationController.retryGeneration', () => {
  const ctx = { userId: 'user-1', roles: ['user'] } as any;

  function setup(template_id: string | null) {
    const reportGenerationService = {
      findById: jest.fn().mockResolvedValue({
        id: 'r1', test_run_id: 't1', template_id, status: 'failed', generated_by: 'u', retry_count: 0, max_retries: 3,
      }),
      updateStatus: jest.fn().mockResolvedValue(undefined),
      incrementRetryCount: jest.fn().mockResolvedValue(undefined),
      updateJobId: jest.fn().mockResolvedValue(undefined),
    };
    const htmlGenerationProcessor = {
      isAvailable: jest.fn().mockReturnValue(true),
      addJob: jest.fn().mockResolvedValue('job'),
    };
    const controller = new ReportGenerationController(
      reportGenerationService as any,
      {} as any,
      htmlGenerationProcessor as any,
      {} as any,
    );
    return { controller, reportGenerationService };
  }

  it('refuses with a 400 naming the deleted template, before touching the report', async () => {
    const { controller, reportGenerationService } = setup(null);

    const error = await controller.retryGeneration('r1', ctx).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(400);
    expect((error as HttpException).message).toMatch(/template .* has been deleted/);
    expect(reportGenerationService.updateStatus).not.toHaveBeenCalled();
    expect(reportGenerationService.incrementRetryCount).not.toHaveBeenCalled();
  });

  it('still retries a report that has its template', async () => {
    const { controller, reportGenerationService } = setup('tpl-1');

    await controller.retryGeneration('r1', ctx);

    expect(reportGenerationService.updateStatus).toHaveBeenCalledWith('r1', 'pending');
  });
});
