import { Injectable, Logger } from '@nestjs/common';
import { TestRun, ReportSectionConfig, ReportStyling, GeneratedReport } from '@perfana/shared';
import { ReportUtilsService } from './report-utils.service';
import { HeaderRenderer } from '../renderers/header-renderer';
import { TextBlockRenderer } from '../renderers/text-block-renderer';
import { SloRenderer } from '../renderers/slo-renderer';
import { ApdexRenderer } from '../renderers/apdex-renderer';
import { TransactionResponseTimesRenderer } from '../renderers/transaction-response-times-renderer';
import { RegressionsRenderer } from '../renderers/regressions-renderer';
import { AwrRenderer } from '../renderers/awr-renderer';
import { TrendsRenderer } from '../renderers/trends-renderer';
import { ComparisonsRenderer } from '../renderers/comparisons-renderer';
import { GraphsRenderer } from '../renderers/graphs-renderer';
import { Top10ListsRenderer } from '../renderers/top-10-lists-renderer';
import { PlaceholderRenderer } from '../renderers/placeholder-renderer';

/**
 * Service for compiling report sections into HTML
 *
 * Orchestrates section rendering and HTML document compilation.
 * Delegates rendering to specialized renderer services and handles
 * the final HTML assembly with styling and layout.
 */
@Injectable()
export class ReportHtmlCompilerService {
  private readonly logger = new Logger(ReportHtmlCompilerService.name);

  constructor(
    private readonly utils: ReportUtilsService,
    private readonly headerRenderer: HeaderRenderer,
    private readonly textBlockRenderer: TextBlockRenderer,
    private readonly sloRenderer: SloRenderer,
    private readonly apdexRenderer: ApdexRenderer,
    private readonly transactionResponseTimesRenderer: TransactionResponseTimesRenderer,
    private readonly regressionsRenderer: RegressionsRenderer,
    private readonly awrRenderer: AwrRenderer,
    private readonly trendsRenderer: TrendsRenderer,
    private readonly comparisonsRenderer: ComparisonsRenderer,
    private readonly graphsRenderer: GraphsRenderer,
    private readonly top10ListsRenderer: Top10ListsRenderer,
    private readonly placeholderRenderer: PlaceholderRenderer,
  ) {}

  /**
   * Render all report sections to HTML
   * @param sections - Array of section configurations
   * @param testRun - Test run entity (can be null for preview mode)
   * @param report - Report entity (can be null for preview mode)
   * @returns Combined HTML string of all sections
   */
  async renderSections(
    sections: ReportSectionConfig[],
    testRun: TestRun | null,
    report: GeneratedReport | null,
    userId: string = '',
    roles: string[] = [],
  ): Promise<string> {
    const sortedSections = [...sections].sort((a, b) => a.order - b.order);
    const renderedSections: string[] = [];

    for (const section of sortedSections) {
      try {
        const sectionHtml = await this.renderSection(section, testRun, report, userId, roles);
        renderedSections.push(sectionHtml);
      } catch (error) {
        this.logger.warn(
          `Failed to render section ${section.type}: ${(error as Error).message}`,
        );
        // Include error placeholder in report
        renderedSections.push(this.placeholderRenderer.renderErrorSection(section, (error as Error).message));
      }
    }

    return renderedSections.join('\n');
  }

  /**
   * Render a single section to HTML
   * @param section - Section configuration
   * @param testRun - Test run entity (can be null for preview mode)
   * @param report - Report entity (can be null for preview mode)
   * @returns HTML string for the section
   */
  private async renderSection(
    section: ReportSectionConfig,
    testRun: TestRun | null,
    _report: GeneratedReport | null,
    userId: string = '',
    roles: string[] = [],
  ): Promise<string> {
    const sectionTitle = section.title || this.utils.getSectionTitle(section.type);

    switch (section.type) {
      case 'header':
        return await this.headerRenderer.renderHeaderSection(section, testRun, userId, roles);
      case 'text_block':
        return this.textBlockRenderer.renderTextBlockSection(section);
      case 'slo':
        return await this.sloRenderer.renderSloSection(section, testRun, userId, roles);
      case 'apdex':
        return await this.apdexRenderer.renderApdexSection(section, testRun, userId, roles);
      case 'transaction_response_times':
        return await this.transactionResponseTimesRenderer.renderTransactionResponseTimesSection(section, testRun, userId, roles);
      case 'regressions':
        return await this.regressionsRenderer.renderRegressionsSection(section, testRun, userId, roles);
      case 'awr':
        return await this.awrRenderer.renderAwrSection(section, testRun);
      case 'trends':
        return await this.trendsRenderer.renderTrendsSection(section, testRun, userId, roles);
      case 'comparisons':
        return await this.comparisonsRenderer.renderComparisonsSection(section, testRun, userId, roles);
      case 'graphs':
        return await this.graphsRenderer.renderGraphsSection(section, testRun, userId, roles);
      case 'top_10_lists':
        return await this.top10ListsRenderer.renderTop10ListsSection(section, testRun, userId, roles);
      default:
        return this.placeholderRenderer.renderPlaceholderSection(sectionTitle, section.type);
    }
  }

  /**
   * Compile section HTML into preview document
   * @param sectionHtml - Rendered section HTML
   * @param section - Section configuration
   * @param styling - Report styling configuration
   * @returns Complete HTML document for preview
   */
  compilePreviewHtml(
    sectionHtml: string,
    section: ReportSectionConfig,
    styling: ReportStyling,
  ): string {
    const primaryColor = styling.primaryColor || '#1976d2';
    const secondaryColor = styling.secondaryColor || '#9c27b0';
    const fontFamily =
      styling.fontFamily ||
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
    const customCss = styling.customCss || '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Section Preview: ${this.utils.getSectionTitle(section.type)}</title>
  <style>
    :root {
      --primary-color: ${primaryColor};
      --secondary-color: ${secondaryColor};
      --font-family: ${fontFamily};
      --success-color: #4caf50;
      --warning-color: #ff9800;
      --error-color: #f44336;
      --info-color: #2196f3;
      --border-color: #e0e0e0;
      --bg-light: #f5f5f5;
      --text-primary: #212121;
      --text-secondary: #757575;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: var(--font-family);
      color: var(--text-primary);
      background-color: white;
      line-height: 1.6;
      padding: 24px;
    }

    h1, h2, h3, h4, h5, h6 {
      color: var(--primary-color);
      margin-bottom: 16px;
      font-weight: 600;
    }

    h1 { font-size: 32px; }
    h2 { font-size: 24px; }
    h3 { font-size: 20px; }
    h4 { font-size: 18px; }
    h5 { font-size: 16px; }
    h6 { font-size: 14px; }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
      background: white;
      box-shadow: 0 1px 3px rgba(0,0,0,0.12);
    }

    th, td {
      padding: 12px 16px;
      text-align: left;
      border-bottom: 1px solid var(--border-color);
    }

    th {
      background-color: var(--bg-light);
      font-weight: 600;
      color: var(--primary-color);
    }

    tr:hover {
      background-color: rgba(25, 118, 210, 0.04);
    }

    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .badge-success { background-color: var(--success-color); color: white; }
    .badge-warning { background-color: var(--warning-color); color: white; }
    .badge-error { background-color: var(--error-color); color: white; }
    .badge-info { background-color: var(--info-color); color: white; }

    .metric-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin: 16px 0;
    }

    .metric-card {
      padding: 16px;
      background: var(--bg-light);
      border-radius: 8px;
      border-left: 4px solid var(--primary-color);
    }

    .metric-label {
      font-size: 12px;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }

    .metric-value {
      font-size: 24px;
      font-weight: 700;
      color: var(--text-primary);
      font-family: 'Monaco', 'Menlo', monospace;
    }

    ${customCss}
  </style>
</head>
<body>
  ${sectionHtml}
</body>
</html>`;
  }

  /**
   * Compile final HTML document with professional PDF-style layout
   * @param reportName - Name of the report
   * @param sectionsHtml - Combined HTML from all sections
   * @param styling - Report styling configuration
   * @returns Complete HTML document
   */
  compileHtml(reportName: string, sectionsHtml: string, styling: ReportStyling): string {
    const primaryColor = styling.primaryColor || '#1976d2';
    const secondaryColor = styling.secondaryColor || '#9c27b0';
    const fontFamily =
      styling.fontFamily ||
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
    const customCss = styling.customCss || '';

    const currentDate = new Date().toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.utils.escapeHtml(reportName)} - Perfana Performance Report</title>
  <style>
    :root {
      --primary-color: ${primaryColor};
      --secondary-color: ${secondaryColor};
      --font-family: ${fontFamily};
      --text-color: #333333;
      --text-secondary: #666666;
      --bg-color: #ffffff;
      --bg-light: #f5f5f5;
      --bg-card: #ffffff;
      --border-color: #e0e0e0;
      --success-color: #4caf50;
      --success-light: #66bb6a;
      --warning-color: #ff9800;
      --warning-light: #ffb74d;
      --error-color: #f44336;
      --error-light: #ef5350;
      --info-color: #2196f3;
      --purple-color: #9c27b0;
      --orange-color: #ff9800;
      --green-success: #4caf50;
      --red-error: #f44336;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--font-family);
      color: var(--text-color);
      background-color: var(--bg-light);
      line-height: 1.6;
      margin: 0;
      padding: 40px 50px;
      font-size: 11pt;
    }

    /* Page Header (appears on every page in print) */
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 10px;
      margin-bottom: 20px;
      font-size: 9pt;
      color: var(--text-secondary);
    }

    /* Cover Page */
    .cover-page {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      background: linear-gradient(135deg, var(--bg-light) 0%, var(--bg-color) 100%);
      page-break-after: always;
      padding: 60px;
    }

    .cover-page h1 {
      font-size: 48pt;
      font-weight: 700;
      background: linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 20px;
      text-align: center;
      line-height: 1.2;
    }

    .cover-page .subtitle {
      font-size: 16pt;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 60px;
    }

    .cover-info-card {
      background: var(--bg-card);
      border-radius: 8px;
      padding: 40px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      max-width: 600px;
      width: 100%;
    }

    .cover-info-row {
      display: flex;
      justify-content: space-between;
      padding: 16px 0;
      border-bottom: 1px solid var(--border-color);
    }

    .cover-info-row:last-child {
      border-bottom: none;
    }

    .cover-info-label {
      font-size: 10pt;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
    }

    .cover-info-label::before {
      content: "• ";
      color: ${primaryColor};
      font-weight: bold;
      margin-right: 8px;
    }

    .cover-info-value {
      font-size: 11pt;
      font-weight: 600;
      color: var(--text-color);
      font-family: 'Courier New', monospace;
      text-align: right;
    }

    .cover-info-value.link {
      color: ${primaryColor};
    }

    /* Main Content Sections */
    section {
      background: var(--bg-card);
      border-radius: 8px;
      padding: 30px;
      margin-bottom: 30px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.04);
    }

    section h2 {
      font-size: 18pt;
      font-weight: 600;
      color: var(--primary-color);
      border-bottom: 2px solid var(--primary-color);
      padding-bottom: 12px;
      margin-bottom: 24px;
    }

    section h3 {
      font-size: 14pt;
      font-weight: 600;
      color: var(--text-color);
      margin: 24px 0 16px 0;
      padding-left: 16px;
      border-left: 4px solid ${primaryColor};
    }

    /* Grid Layouts for Metrics */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin: 24px 0;
    }

    .metric-card {
      background: var(--bg-light);
      border-radius: 6px;
      padding: 20px;
      text-align: center;
      border: 1px solid var(--border-color);
    }

    .metric-label {
      font-size: 9pt;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 8px;
      font-weight: 600;
    }

    .metric-value {
      font-size: 24pt;
      font-weight: 700;
      font-family: 'Courier New', monospace;
    }

    .metric-value.blue { color: ${primaryColor}; }
    .metric-value.purple { color: var(--purple-color); }
    .metric-value.green { color: var(--success-color); }
    .metric-value.red { color: var(--error-color); }
    .metric-value.orange { color: var(--orange-color); }

    .metric-subtitle {
      font-size: 8pt;
      color: var(--text-secondary);
      margin-top: 4px;
    }

    /* Info Grid (3-column layout for test run summary) */
    .info-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 24px;
      margin: 24px 0;
    }

    .info-item {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .info-label {
      font-size: 9pt;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
    }

    .info-value {
      font-size: 12pt;
      font-weight: 600;
      color: var(--text-color);
      font-family: 'Courier New', monospace;
    }

    /* Status Badges */
    .badge {
      display: inline-block;
      padding: 6px 12px;
      border-radius: 4px;
      font-size: 9pt;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .badge-success {
      background-color: #e8f5e9;
      color: #2e7d32;
    }

    .badge-error {
      background-color: #ffebee;
      color: #c62828;
    }

    .badge-warning {
      background-color: #fff3e0;
      color: #e65100;
    }

    .badge-info {
      background-color: #e3f2fd;
      color: #1565c0;
    }

    /* Annotations Box */
    .annotations-box {
      border-left: 4px solid var(--warning-color);
      background-color: #fff9c4;
      padding: 16px 20px;
      margin: 20px 0;
    }

    .annotations-box h4 {
      font-size: 10pt;
      font-weight: 600;
      color: var(--text-color);
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .annotations-box ul {
      margin-left: 20px;
      color: var(--text-color);
    }

    .annotations-box li {
      margin-bottom: 6px;
      font-size: 10pt;
    }

    /* Data Tables */
    .data-table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      font-size: 10pt;
    }

    /* Data cells only, and inherited by the inline-block pills inside them. Without
       this a long unbreakable cell (the UNACCEPTABLE apdex pill) sets a min-content
       width wider than the page and Chrome silently clips the trailing columns.
       Headers keep normal wrapping so they break on spaces, not mid-word. */
    .data-table td {
      /* Data cells only. Letting a HEADER break anywhere lets the browser shrink a column to
         almost nothing, and "TRANSACTION NAME" came out as "TRANSACTI ON NAME" stacked over
         three lines. A header should set the column's floor; it is the shortest honest width
         that column can have. */
      overflow-wrap: anywhere;
    }

    .data-table th {
      background-color: ${primaryColor};
      color: var(--bg-color);
      padding: 12px;
      text-align: left;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-size: 9pt;
    }

    .data-table td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border-color);
      color: var(--text-color);
    }

    .data-table tr:nth-child(even) {
      background-color: #f8f9fa;
    }

    .data-table tr:hover {
      background-color: #f0f0f0;
    }

    .data-table .no-data {
      text-align: center;
      color: var(--text-secondary);
      font-style: italic;
      padding: 24px;
    }

    /* Table Values */
    .table-value-pass {
      color: var(--success-color);
      font-weight: 600;
    }

    .table-value-fail {
      color: var(--error-color);
      font-weight: 600;
    }

    .table-value-error-pct {
      color: var(--warning-color);
      font-weight: 600;
    }

    /* Placeholder Messages */
    .placeholder-message {
      color: var(--text-secondary);
      font-style: italic;
      padding: 24px;
      text-align: center;
      background-color: var(--bg-light);
      border-radius: 6px;
      border: 2px dashed var(--border-color);
    }

    /* Error Sections */
    .error-section {
      border: 2px solid var(--error-color);
      background-color: #ffebee;
    }

    .error-message {
      background-color: #ffcdd2;
      color: var(--error-color);
      padding: 16px;
      border-radius: 4px;
      font-weight: 600;
    }

    /* Footer */
    footer {
      margin-top: 60px;
      padding: 30px 0;
      border-top: 2px solid var(--border-color);
      text-align: center;
      color: var(--text-secondary);
      page-break-inside: avoid;
    }

    footer .footer-brand {
      font-size: 12pt;
      font-weight: 600;
      color: var(--text-color);
      margin-bottom: 6px;
    }

    footer .footer-tagline {
      font-size: 9pt;
      font-style: italic;
      margin-bottom: 16px;
    }

    footer .footer-meta {
      font-size: 8pt;
      font-family: 'Courier New', monospace;
    }

    /* On screen the report is held to a fixed measure instead of stretching to whatever the
       window happens to be: on a wide monitor the full-bleed column ran lines well past any
       comfortable reading length.

       340mm, not A4's 210mm. A4 was tried and is too narrow for this content — the regressions
       table needs seven columns and at 210mm it lost Diff % and Status entirely, the Apdex
       metric cards clipped their values, and headings broke mid-word. Measured against a real
       report, everything fits from roughly 320mm; 340mm leaves the dashboard column two lines
       instead of four. It is still bounded, which is the point: a 2560px monitor gives a
       ~1285px column rather than a 2560px line.

       The consequence, stated plainly: the screen no longer matches the PDF's line breaks. The
       PDF is A4 and those wide tables are clipped there — which was true before any of this and
       is a separate problem.

       Screen only. In print Puppeteer's page box already sets the width, and the @media print
       block below zeroes this padding; constraining it again would inset the content twice. */
    @media screen {
      /* The grey moves to the page itself, otherwise a centred body would paint a grey column
         on a white surround rather than a document sitting on a background. */
      html {
        background-color: var(--bg-light);
      }

      body {
        max-width: 340mm;
        padding: 20mm 15mm;
        margin-left: auto;
        margin-right: auto;
      }

      /* The cover is a page, so give it a page's height rather than the viewport's. 100vh means
         "as tall as whatever container this lands in", and the report is rendered inside an
         iframe: in a tall one the cover became a screen and a half of gradient with the title
         marooned in the middle of it. 257mm is A4 minus the 20mm top and bottom the PDF insets,
         so the cover on screen is the same page as the cover on paper.

         Print keeps 100vh — there the container IS the page box, and page-break-after already
         ends the cover. */
      .cover-page {
        min-height: 257mm;
      }

      /* Some tables are genuinely wider than a page — the regressions list and the
         per-transaction Apdex breakdown carry more columns than 180mm holds. Before the column
         was constrained they simply used the whole window; now they would run out of their card
         and off the page.

         They scroll inside their own container instead. Forcing them to fit was tried and is
         worse: table-layout:fixed gives every column an equal share, which squashed the
         per-transaction tables until the text overlapped. Print is untouched — this is a screen
         affordance, and paper has no scrollbar.

         Scoped to .table-scroll, not the section itself. On the section the scrollbar landed at the
         bottom of the whole 30px-padded card rather than under the table, the card's right
         padding collapsed at the end of the scroll, and — per spec — overflow-y computed
         from visible to auto, so any child overflowing vertically got its own scrollbar too. */
      .table-scroll {
        overflow-x: auto;
      }

      /* Tables need the 340mm measure; prose does not. At full width body copy ran to
         150-170 characters per line, well past the 65-75 the width change was partly
         meant to fix. */
      .section-text,
      section > p {
        max-width: 75ch;
      }

      /* 11pt is ~14.7px, below the 16px floor. That was defensible while the report was
         print-first; it is a deliberate on-screen reading surface now. Print keeps 11pt. */
      body {
        font-size: 16px;
      }
    }

    /* Print Styles */
    @media print {
      /* Puppeteer's pdfOptions.margin already insets the page box. Padding here stacks
         on top of it and squeezed the content column to ~140mm of a 210mm page. */
      body {
        padding: 0;
        background-color: var(--bg-color);

        /* A4 minus the PDF's 15mm side margins is a 180mm text column, and the widest tables
           need more than that: the regressions list lost its Status column off the right edge
           of the page, where — unlike on screen — there is no scrollbar to recover it.

           zoom, not a smaller font-size, because the renderers set ~87 font sizes inline and
           an inline style beats any stylesheet rule; a .data-table font-size override
           here was measured and changed nothing. zoom scales those inline values, and the
           padding with them. Not transform: scale either — that paints smaller without
           relaying out, so pagination would still break at the unscaled positions.

           0.8 gives the content a 225mm column to lay out in. 0.85 also fits this report, with
           about 15px to spare on the widest row; 0.8 leaves room for longer metric names in
           other reports and is still comfortable to read (10pt body text prints at 8pt).

           Screen is untouched: there the measure is 340mm and wide tables scroll. */
        zoom: 0.8;
      }

      /* Chrome does not implement "position: running()", so this element never moved
         into the page margin box -- it printed inline on page 1, directly under the
         header Puppeteer draws from headerTemplate. */
      .page-header {
        display: none;
      }

      /* Restore the type that was already small before the zoom.

         zoom scales everything, but it was added for the wide tables, and the whole report
         pays for it: at 0.8 the uppercase table headers go 9pt -> 7.2pt and the footer
         metadata 8pt -> 6.4pt, both at the edge of print legibility. Dividing by the zoom
         puts them back at their intended physical size, so only the content that needed to
         shrink actually does. Body text is unaffected: 11pt -> 8.8pt is still comfortable
         and is what buys the tables their room. */
      .data-table th {
        font-size: 11.25pt; /* 9pt / 0.8 */
      }

      footer .footer-meta {
        font-size: 10pt; /* 8pt / 0.8 */
      }

      footer .footer-tagline {
        font-size: 11.25pt; /* 9pt / 0.8 */
      }

      section {
        box-shadow: none;
        border: 1px solid var(--border-color);
      }

      /* Break inside tables at row granularity, repeating the header on each page.
         "page-break-inside: avoid" on the whole section/table pushed any card that
         did not fit entirely onto the next page, leaving pages ~40% blank. */
      .data-table thead {
        display: table-header-group;
      }

      .data-table tr {
        page-break-inside: avoid;
      }

      .cover-page, .title-page, .toc-page {
        page-break-after: always;
      }

      /* The 60px screen margin was enough to push the three-line footer onto a
         page of its own at the end of the report. */
      footer {
        margin-top: 24px;
        padding: 16px 0;
      }

      /* No @page rule: Puppeteer owns the margins, and Chrome 142 *does* honour
         @bottom-right, which duplicated the footerTemplate page counter. */
    }

    /* Custom CSS Override */
    ${customCss}
  </style>
</head>
<body>
  <!-- Page Header (for print) -->
  <div class="page-header">
    <span>${this.utils.escapeHtml(reportName)}</span>
    <span>${currentDate}</span>
  </div>

  ${sectionsHtml}

  <!-- Footer -->
  <footer>
    <div class="footer-brand">Perfana Performance Analysis Platform</div>
    <div class="footer-tagline">Continuous Performance Testing & Analysis</div>
    <div class="footer-meta">
      Generated: ${currentDate}
    </div>
  </footer>
</body>
</html>`;
  }
}
