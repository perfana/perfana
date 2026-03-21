import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';

/**
 * Renderer for header section
 *
 * Generates cover page and test run summary with key metrics
 */
@Injectable()
export class HeaderRenderer {
  constructor(private readonly utils: ReportUtilsService) {}

  /**
   * Render header section - Cover page and Test Run Summary
   */
  renderHeaderSection(section: ReportSectionConfig, testRun: TestRun | null): string {
    const config = section.config || {};
    const title = (config.title as string) || 'Performance Test Report';
    const subtitle = config.subtitle as string;
    const includeCoverPage = config.includeCoverPage !== false;
    const includeSummary = config.includeSummary !== false;

    // Use mock data if testRun is null (preview mode)
    const systemId = testRun?.systemUnderTestId || 'sample-system';
    const environment = testRun?.testEnvironment || 'test';
    const workload = testRun?.workload || 'sample-workload';
    const testRunId = testRun?.testRunId || 'preview-test-run';
    const applicationRelease = testRun?.applicationRelease || 'v1.0.0';
    const annotations = testRun?.annotations || [];

    const testStartDate = testRun?.startTime
      ? new Date(testRun.startTime).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZoneName: 'short',
        })
      : 'Jan 28, 2026, 10:00 AM PST';

    const durationFormatted = testRun?.duration ? this.utils.formatDuration(testRun.duration) : '1h 23m';

    // Mock data for badges - TODO: fetch from test run status/results
    const sloStatus = '662/871 PASSED';
    const anomalyCount = 5;

    let html = '';

    // Cover Page
    if (includeCoverPage) {
      html += `
        <div class="cover-page">
          <h1>${this.utils.escapeHtml(title)}</h1>
          ${subtitle ? `<div class="subtitle">${this.utils.escapeHtml(subtitle)}</div>` : ''}

          <div class="cover-info-card">
            <div class="cover-info-row">
              <div class="cover-info-label">System Under Test</div>
              <div class="cover-info-value">${this.utils.escapeHtml(systemId)}</div>
            </div>
            <div class="cover-info-row">
              <div class="cover-info-label">Environment</div>
              <div class="cover-info-value">${this.utils.escapeHtml(environment)}</div>
            </div>
            <div class="cover-info-row">
              <div class="cover-info-label">Workload</div>
              <div class="cover-info-value">${this.utils.escapeHtml(workload)}</div>
            </div>
            <div class="cover-info-row">
              <div class="cover-info-label">Test Run ID</div>
              <div class="cover-info-value link">${this.utils.escapeHtml(testRunId)}</div>
            </div>
            <div class="cover-info-row">
              <div class="cover-info-label">Test Run Date</div>
              <div class="cover-info-value">${testStartDate}</div>
            </div>
          </div>
        </div>
      `;
    }

    // Test Run Summary Section
    if (includeSummary) {
      html += `
        <section>
          <h2>Test Run Summary</h2>

          <!-- Info Grid (3 columns x 3 rows) -->
          <div class="info-grid">
            <!-- Row 1 -->
            <div class="info-item">
              <div class="info-label">System Under Test</div>
              <div class="info-value">${this.utils.escapeHtml(systemId)}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Test Run ID</div>
              <div class="info-value">${this.utils.escapeHtml(testRunId)}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Environment</div>
              <div class="info-value">${this.utils.escapeHtml(environment)}</div>
            </div>

            <!-- Row 2 -->
            <div class="info-item">
              <div class="info-label">Workload</div>
              <div class="info-value">${this.utils.escapeHtml(workload)}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Start Time</div>
              <div class="info-value">${testStartDate}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Duration</div>
              <div class="info-value">${durationFormatted}</div>
            </div>

            <!-- Row 3 -->
            <div class="info-item">
              <div class="info-label">Release</div>
              <div class="info-value">${this.utils.escapeHtml(applicationRelease)}</div>
            </div>
            <div class="info-item">
              <div class="info-label">SLO Status</div>
              <div class="info-value"><span class="badge badge-error">${sloStatus}</span></div>
            </div>
            <div class="info-item">
              <div class="info-label">Anomaly Detection</div>
              <div class="info-value"><span class="badge badge-warning">${anomalyCount} ANOMALIES DETECTED</span></div>
            </div>
          </div>

          <!-- Annotations (if present) -->
          ${annotations.length > 0 ? `
            <div class="annotations-box">
              <h4>Annotations</h4>
              <ul>
                ${annotations.map((ann) => `<li>${this.utils.escapeHtml(ann)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
        </section>
      `;
    }

    return html;
  }
}
