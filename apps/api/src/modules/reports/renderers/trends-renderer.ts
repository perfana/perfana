import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';

/**
 * Renderer for Trends section
 *
 * Displays performance trends over time across multiple test runs
 * showing improvements or degradations in key metrics
 */
@Injectable()
export class TrendsRenderer {
  constructor(private readonly utils: ReportUtilsService) {}

  /**
   * Render Trends section
   */
  renderTrendsSection(section: ReportSectionConfig, _testRun: TestRun | null): string {
    const title = section.title || 'Trends';
    const comment = section.comment;

    return `
      <section class="trends-section">
        <h2>${this.utils.escapeHtml(title)}</h2>
        ${comment ? `<div class="section-comment">${this.utils.escapeHtml(comment)}</div>` : ''}
        <div class="trends-results">
          <p class="placeholder-message">Trend analysis data will be populated during report generation.</p>
        </div>
      </section>
    `;
  }
}
