import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';

/**
 * Renderer for Graphs section
 *
 * Displays custom graphs and visualizations based on
 * user-defined metrics and configurations
 */
@Injectable()
export class GraphsRenderer {
  constructor(private readonly utils: ReportUtilsService) {}

  /**
   * Render Graphs section
   */
  renderGraphsSection(section: ReportSectionConfig, _testRun: TestRun | null): string {
    const title = section.title || 'Custom Graphs';
    const comment = section.comment;

    return `
      <section class="graphs-section">
        <h2>${this.utils.escapeHtml(title)}</h2>
        ${comment ? `<div class="section-comment">${this.utils.escapeHtml(comment)}</div>` : ''}
        <div class="graphs-results">
          <p class="placeholder-message">Graph data will be populated during report generation.</p>
        </div>
      </section>
    `;
  }
}
