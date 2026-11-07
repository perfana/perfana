import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig, getSectionText } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService } from '../services/report-data-fetcher.service';
import { statusFromConclusion } from './comparison-bands';
import { sectionText } from './report-style';

const nonBlank = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

/** `level` is unvalidated JSON that ends up in a tag name, so only 1-6 gets through. */
const coverHeadingTag = (level: unknown): string => {
  const n = Number(level);
  return `h${Number.isInteger(n) && n >= 1 && n <= 6 ? n : 1}`;
};

/**
 * Renderer for header section
 *
 * Generates cover page and test run summary with key metrics
 */
@Injectable()
export class HeaderRenderer {
  constructor(
    private readonly utils: ReportUtilsService,
    private readonly dataFetcher: ReportDataFetcherService,
  ) {}

  /**
   * Render header section - Cover page and Test Run Summary
   */
  async renderHeaderSection(
    section: ReportSectionConfig,
    testRun: TestRun | null,
    userId: string = '',
    roles: string[] = [],
  ): Promise<string> {
    const config = section.config || {};
    // The builder's "Header Text" is `config.text`. `config.title` is what a template posted
    // straight to the API carries, and the form cannot see it, so an edit in the UI has to win.
    const title = nonBlank(config.text) ?? nonBlank(config.title) ?? 'Performance Test Report';
    const titleTag = coverHeadingTag(config.level);
    const subtitle = config.subtitle as string;
    const includeCoverPage = config.includeCoverPage !== false;
    const includeSummary = config.includeSummary !== false;

    // Use mock data if testRun is null (preview mode)
    // Display the SUT's name; fall back to the id only when the relation isn't loaded
    const systemName = testRun?.systemUnderTest?.name || testRun?.systemUnderTestId || 'sample-system';
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

    // Fetch real SLO and anomaly data
    let sloStatusHtml: string;
    let anomalyStatusHtml: string;

    if (testRun) {
      const [sloSummary, anomalySummary] = await Promise.all([
        this.dataFetcher.getSloSummary(testRun.testRunId, userId, roles),
        this.dataFetcher.getAnomalySummary(testRun.testRunId, userId, roles),
      ]);

      if (sloSummary.total === 0) {
        sloStatusHtml = '<span class="badge badge-info">No SLO data</span>';
      } else if (sloSummary.failed === 0) {
        sloStatusHtml = `<span class="badge badge-success">${sloSummary.passed}/${sloSummary.total} PASSED</span>`;
      } else {
        sloStatusHtml = `<span class="badge badge-error">${sloSummary.passed}/${sloSummary.total} PASSED</span>`;
      }

      anomalyStatusHtml = this.anomalyBadge(anomalySummary.conclusion, anomalySummary.regressionCount);
    } else {
      sloStatusHtml = '<span class="badge badge-info">No SLO data</span>';
      anomalyStatusHtml = '<span class="badge badge-info">No anomaly data</span>';
    }

    let html = '';

    // Cover Page
    if (includeCoverPage) {
      html += `
        <div class="cover-page">
          <${titleTag}>${this.utils.escapeHtml(title)}</${titleTag}>
          ${subtitle ? `<div class="subtitle">${this.utils.escapeHtml(subtitle)}</div>` : ''}

          <div class="cover-info-card">
            <div class="cover-info-row">
              <div class="cover-info-label">System Under Test</div>
              <div class="cover-info-value">${this.utils.escapeHtml(systemName)}</div>
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

    // Test Run Summary Section. The accompanying text renders here (rule 07),
    // directly under the heading — never on the cover page.
    if (includeSummary) {
      html += `
        <section>
          <h2>${this.utils.escapeHtml(section.title || 'Test Run Summary')}</h2>
          ${sectionText(getSectionText(section))}

          <!-- Info Grid (3 columns x 3 rows) -->
          <div class="info-grid">
            <!-- Row 1 -->
            <div class="info-item">
              <div class="info-label">System Under Test</div>
              <div class="info-value">${this.utils.escapeHtml(systemName)}</div>
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
              <div class="info-value">${sloStatusHtml}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Anomaly Detection</div>
              <div class="info-value">${anomalyStatusHtml}</div>
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

  /**
   * Only a verdict may read as a pass. A run ADAPT never compared (first run, changepoint, no
   * comparable results, a failed read) also has zero regressions, for a different reason, and the
   * Anomaly Detection section reports it as N/A from the same `statusFromConclusion`.
   *
   * The conclusion also outranks the count: a run whose only regressions are tracked ones is
   * `REGRESSION` with an empty `regressions` array.
   */
  private anomalyBadge(conclusion: string, regressionCount: number): string {
    if (regressionCount > 0) {
      const noun = regressionCount === 1 ? 'REGRESSION' : 'REGRESSIONS';
      return `<span class="badge badge-warning">${regressionCount} ${noun} DETECTED</span>`;
    }
    const status = statusFromConclusion(conclusion);
    if (status === 'regression') return '<span class="badge badge-warning">REGRESSIONS DETECTED</span>';
    if (status === 'ok' || status === 'improvement') return '<span class="badge badge-success">NO REGRESSIONS</span>';
    return '<span class="badge badge-info">NOT EVALUATED</span>';
  }
}
