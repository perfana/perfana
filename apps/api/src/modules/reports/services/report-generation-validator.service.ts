import { Injectable } from '@nestjs/common';
import { ReportStatus } from '@perfana/shared';
import { InvalidStateException } from '../../../common/exceptions/business.exception';

/**
 * Service for validating report generation operations
 *
 * Handles validation logic for report status transitions and business rules.
 */
@Injectable()
export class ReportGenerationValidatorService {
  /**
   * Validate status transition for a report
   * @param currentStatus - Current report status
   * @param newStatus - Desired new status
   * @throws InvalidStateException if transition is not allowed
   */
  validateStatusTransition(currentStatus: ReportStatus, newStatus: ReportStatus): void {
    const validTransitions: Record<ReportStatus, ReportStatus[]> = {
      pending: ['processing', 'failed'],
      processing: ['html_complete', 'failed'],
      html_complete: ['pdf_processing', 'pdf_complete', 'failed'], // Allow direct transition to pdf_complete for on-demand generation
      pdf_processing: ['pdf_complete', 'failed'],
      pdf_complete: [],
      // 'pending' = manual retry (POST /reports/:id/retry); 'processing' =
      // BullMQ auto-retry re-entering generateHtml() after a prior attempt set
      // 'failed'. Without 'processing', attempts 2/3 throw on the failed→
      // processing transition and never re-run the render (issue #421).
      failed: ['pending', 'processing'],
    };

    const allowed = validTransitions[currentStatus] || [];
    if (!allowed.includes(newStatus)) {
      throw new InvalidStateException(
        `Invalid status transition from '${currentStatus}' to '${newStatus}'`,
        currentStatus,
        newStatus,
      );
    }
  }
}
