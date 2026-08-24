import { Injectable, Logger } from '@nestjs/common';
import { ReportStatus, findDuplicateTitles } from '@perfana/shared';
import { InvalidStateException } from '../../../common/exceptions/business.exception';

/**
 * Service for validating report generation operations
 *
 * Handles validation logic for report status transitions and business rules.
 */
@Injectable()
export class ReportGenerationValidatorService {
  private readonly logger = new Logger(ReportGenerationValidatorService.name);

  /**
   * `#` link targets that no section emitted.
   *
   * Catches the common case: a section was renamed and the links pointing at its
   * old slug now go nowhere. It CANNOT catch the worse case — a duplicate title
   * making a link resolve to the wrong section — because that anchor still
   * exists. That is what the duplicate-title warning is for.
   */
  findDeadAnchors(html: string): string[] {
    const defined = new Set<string>();
    for (const match of html.matchAll(/\sid="([^"]+)"/g)) {
      const id = match[1];
      if (id === undefined) {
        continue;
      }
      defined.add(id);
    }

    const dead: string[] = [];
    const seen = new Set<string>();
    // Only same-document fragments: href="#x", not href="https://…/#x".
    for (const match of html.matchAll(/href="#([^"]+)"/g)) {
      const target = match[1];
      if (target === undefined || defined.has(target) || seen.has(target)) {
        continue;
      }
      seen.add(target);
      dead.push(target);
    }

    return dead;
  }

  /** Log link problems. Never throws — a report with a bad link still generates. */
  warnOnAnchorProblems(html: string, titles: string[]): void {
    try {
      const dead = this.findDeadAnchors(html);
      if (dead.length > 0) {
        this.logger.warn(
          `Report links point at ${dead.length} anchor(s) that do not exist: ${dead.join(', ')}. ` +
            `A section was probably renamed after the links were written.`,
        );
      }

      const duplicates = findDuplicateTitles(titles);
      if (duplicates.length > 0) {
        this.logger.warn(
          `Report has sections sharing a title: ${duplicates.join(', ')}. ` +
            `Anchors fall back to numbered suffixes, so reordering or deleting one of them ` +
            `silently repoints existing links. Give them distinct titles.`,
        );
      }
    } catch (error) {
      const msg = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message : 'Unknown error';
      this.logger.warn(`Anchor/duplicate-title check failed unexpectedly: ${msg}`);
    }
  }

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
