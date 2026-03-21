import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';

/**
 * Renderer for Comparisons section
 *
 * Displays side-by-side comparison of metrics between
 * two or more test runs
 */
@Injectable()
export class ComparisonsRenderer {
  constructor(private readonly utils: ReportUtilsService) {}

  /**
   * Render Comparisons section
   */
  renderComparisonsSection(section: ReportSectionConfig, _testRun: TestRun | null): string {
    const title = section.title || 'Comparisons';
    const comment = section.comment;

    return `
      <section class="comparisons-section">
        <h2>${this.utils.escapeHtml(title)}</h2>
        ${comment ? `<div class="section-comment">${this.utils.escapeHtml(comment)}</div>` : ''}
        <div class="comparisons-results">
          <p class="placeholder-message">Comparison data will be populated during report generation.</p>
        </div>
      </section>
    `;
  }
}
