import { ReportGenerationValidatorService } from './report-generation-validator.service';
import { InvalidStateException } from '../../../common/exceptions/business.exception';

describe('ReportGenerationValidatorService.validateStatusTransition', () => {
  const validator = new ReportGenerationValidatorService();

  it('allows a BullMQ auto-retry to re-enter processing from failed (#421)', () => {
    expect(() => validator.validateStatusTransition('failed', 'processing')).not.toThrow();
  });

  it('still allows the manual retry path failed -> pending', () => {
    expect(() => validator.validateStatusTransition('failed', 'pending')).not.toThrow();
  });

  it('allows the happy path pending -> processing -> html_complete', () => {
    expect(() => validator.validateStatusTransition('pending', 'processing')).not.toThrow();
    expect(() => validator.validateStatusTransition('processing', 'html_complete')).not.toThrow();
  });

  it('rejects transitions out of the terminal pdf_complete state', () => {
    expect(() => validator.validateStatusTransition('pdf_complete', 'processing')).toThrow(
      InvalidStateException,
    );
  });

  it('rejects an illegal jump pending -> html_complete', () => {
    expect(() => validator.validateStatusTransition('pending', 'html_complete')).toThrow(
      InvalidStateException,
    );
  });
});
