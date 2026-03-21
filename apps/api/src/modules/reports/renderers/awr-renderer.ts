import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';

/**
 * Renderer for AWR section
 *
 * Displays Oracle Automatic Workload Repository (AWR) analysis
 * for database performance insights
 */
@Injectable()
export class AwrRenderer {
  constructor(private readonly utils: ReportUtilsService) {}

  /**
   * Render AWR section
   */
  renderAwrSection(section: ReportSectionConfig, _testRun: TestRun | null): string {
    const title = section.title || 'AWR Analysis';
    const comment = section.comment;

    return `
      <section class="awr-section">
        <h2>${this.utils.escapeHtml(title)}</h2>
        ${comment ? `<div class="section-comment">${this.utils.escapeHtml(comment)}</div>` : ''}
        <div class="awr-results">
          <p class="placeholder-message">AWR analysis data will be populated during report generation.</p>
        </div>
      </section>
    `;
  }
}
