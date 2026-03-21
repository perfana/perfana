import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';

/**
 * Renderer for SLO section
 *
 * Displays Service Level Objective results with pass/fail status
 * Note: Actual SLO data fetching will be implemented in a later phase
 */
@Injectable()
export class SloRenderer {
  constructor(private readonly utils: ReportUtilsService) {}

  /**
   * Render SLO section
   * Note: Actual SLO data fetching will be implemented in a later phase
   */
  renderSloSection(section: ReportSectionConfig, _testRun: TestRun | null): string {
    const title = section.title || 'SLO Results';
    const comment = section.comment;

    return `
      <section class="slo-section">
        <h2>${this.utils.escapeHtml(title)}</h2>
        ${comment ? `<div class="section-comment">${this.utils.escapeHtml(comment)}</div>` : ''}
        <div class="slo-results">
          <p class="placeholder-message">SLO data will be populated during report generation.</p>
          <!-- SLO results table placeholder -->
          <table class="data-table">
            <thead>
              <tr>
                <th>SLO Name</th>
                <th>Target</th>
                <th>Actual</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colspan="4" class="no-data">No SLO data available</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    `;
  }
}
