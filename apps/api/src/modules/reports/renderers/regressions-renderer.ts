import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';

/**
 * Renderer for Regressions section
 *
 * Displays performance regression analysis comparing
 * current test run against baseline or previous runs
 */
@Injectable()
export class RegressionsRenderer {
  constructor(private readonly utils: ReportUtilsService) {}

  /**
   * Render Regressions section
   */
  renderRegressionsSection(section: ReportSectionConfig, _testRun: TestRun | null): string {
    const title = section.title || 'Regressions';
    const comment = section.comment;

    return `
      <section class="regressions-section">
        <h2>${this.utils.escapeHtml(title)}</h2>
        ${comment ? `<div class="section-comment">${this.utils.escapeHtml(comment)}</div>` : ''}
        <div class="regressions-results">
          <p class="placeholder-message">Regression analysis data will be populated during report generation.</p>
        </div>
      </section>
    `;
  }
}
