import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig, getSectionText } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import {
  ReportDataFetcherService,
  ReportErrorAnalysis,
  ReportErrorOverTimePoint,
} from '../services/report-data-fetcher.service';
import {
  REPORT_COLORS,
  TH_NUM,
  TH_TEXT,
  THEAD_ROW,
  chip,
  emptyState,
  formatInt,
  formatNum,
  formatPercent,
  groupHeader,
  pill,
  sectionHeader,
  sectionText,
  statCard,
} from './report-style';

/** Default number of rows in the per-transaction table before it is capped. */
const DEFAULT_TOP_N = 20;

/**
 * Renderer for the Error Analysis section.
 *
 * Aggregates only: counts, rates and shapes. `requests_error` also holds response
 * bodies and request/response headers, and a generated report is downloadable and
 * shareable over an unauthenticated link — per-error inspection stays in the app,
 * behind auth.
 */
@Injectable()
export class ErrorAnalysisRenderer {
  constructor(
    private readonly utils: ReportUtilsService,
    private readonly dataFetcher: ReportDataFetcherService,
  ) {}

  async renderErrorAnalysisSection(
    section: ReportSectionConfig,
    testRun: TestRun | null,
    userId: string = '',
    roles: string[] = [],
  ): Promise<string> {
    const config = section.config || {};
    const title = section.title || 'Error Analysis';
    const text = getSectionText(section);
    const includeChart = config.includeChart !== false;
    const excludeRampUp = config.excludeRampUp !== false;
    const topN = Number(config.topN) > 0 ? Number(config.topN) : DEFAULT_TOP_N;
    const scenarios = Array.isArray(config.scenarios)
      ? (config.scenarios as unknown[]).filter((n): n is string => typeof n === 'string' && n !== '')
      : [];

    if (!testRun) {
      return this.wrap(title, text, [], emptyState('No test run data available for error analysis.'));
    }

    const data = await this.dataFetcher.getErrorAnalysis(testRun, scenarios, excludeRampUp, userId, roles);

    // No errors is a result, and a good one — say so rather than showing four
    // zeroes and three empty tables.
    if (data.totalErrors === 0) {
      return this.wrap(
        title,
        text,
        [chip('No errors', 'good')],
        emptyState('No errors were recorded for this test run.'),
      );
    }

    return this.wrap(title, text, this.headerChips(data), `
      ${this.renderSummaryCards(data)}
      ${includeChart ? this.renderErrorsOverTime(data.overTime) : ''}
      ${this.renderByCode(data)}
      ${this.renderByTransaction(data, topN)}
    `);
  }

  private wrap(title: string, text: string | undefined, chips: string[], body: string): string {
    return `
      <section class="error-analysis-section">
        ${sectionHeader(title, { chipsHtml: chips })}
        ${sectionText(text)}
        ${body}
      </section>
    `;
  }

  private headerChips(data: ReportErrorAnalysis): string[] {
    return [
      chip(`${formatInt(data.totalErrors)} errors`, 'bad'),
      data.errorRate != null ? chip(`${formatPercent(data.errorRate)} of requests`, 'warn') : '',
    ].filter(Boolean);
  }

  /** How bad, in one line. */
  private renderSummaryCards(data: ReportErrorAnalysis): string {
    const rate = data.errorRate;
    const rateColor = rate == null
      ? REPORT_COLORS.ink
      : rate >= 5 ? REPORT_COLORS.dot.bad
      : rate > 0 ? REPORT_COLORS.dot.warn
      : REPORT_COLORS.dot.good;

    return `
      <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin: 24px 0;">
        ${statCard('Total errors', formatInt(data.totalErrors))}
        ${statCard(
          'Error rate',
          `<span style="color: ${rateColor};">${rate == null ? '—' : formatPercent(rate)}</span>`,
          data.totalRequests != null
            ? `<div style="font-size: 9pt; color: ${REPORT_COLORS.mutedInk};">of ${formatInt(data.totalRequests)} requests</div>`
            : '',
        )}
        ${statCard('Response codes', formatInt(data.uniqueResponseCodes))}
        ${statCard('Transactions affected', formatInt(data.transactionsWithErrors))}
      </div>
    `;
  }

  /**
   * Was this a burst at peak load, or constant from the start? One line per
   * response code, so a spike in 503s is distinguishable from steady 404s.
   */
  private renderErrorsOverTime(points: ReportErrorOverTimePoint[]): string {
    if (points.length < 2) return '';

    const width = 1000;
    const height = 260;
    const padding = { top: 16, right: 40, bottom: 56, left: 70 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Codes ordered by total volume, so the legend reads worst-first and the
    // busiest series gets the first colour.
    const totals = new Map<string, number>();
    for (const point of points) {
      for (const [code, count] of Object.entries(point.countsByCode)) {
        totals.set(code, (totals.get(code) ?? 0) + count);
      }
    }
    const codes = [...totals.entries()].sort(([, a], [, b]) => b - a).map(([code]) => code);

    const times = points.map((p) => p.time.getTime());
    const tMin = Math.min(...times);
    const tMax = Math.max(...times);
    const tRange = tMax - tMin || 1;
    const maxCount = Math.max(...points.map((p) => Object.values(p.countsByCode).reduce((n, c) => n + c, 0)), 1);
    const yMax = maxCount * 1.1;

    const scaleX = (t: number) => padding.left + ((t - tMin) / tRange) * chartWidth;
    const scaleY = (v: number) => padding.top + chartHeight - (v / yMax) * chartHeight;

    const lines = codes.map((code, i) => {
      const color = this.codeColor(code, i);
      // A bucket with no row for this code had no errors of that code, which is
      // a zero — not a gap. Charting it as a gap would hide the recovery.
      const path = points
        .map((p, j) => {
          const x = scaleX(p.time.getTime());
          const y = scaleY(p.countsByCode[code] ?? 0);
          return j === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
        })
        .join(' ');
      return { code, color, path };
    });

    const gridLines: string[] = [];
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartHeight / 4) * i;
      const value = yMax - (yMax / 4) * i;
      gridLines.push(`
        <line x1="${padding.left}" y1="${y}" x2="${padding.left + chartWidth}" y2="${y}"
              stroke="#e0e0e0" stroke-width="1" stroke-dasharray="2,2"/>
        <text x="${padding.left - 10}" y="${y + 4}" text-anchor="end" font-size="9" fill="#666">${formatInt(Math.round(value))}</text>
      `);
    }

    const xLabelCount = Math.min(6, points.length);
    const xLabels: string[] = [];
    for (let i = 0; i < xLabelCount; i++) {
      const idx = Math.round((i / Math.max(1, xLabelCount - 1)) * (points.length - 1));
      const point = points[idx]!;
      const x = scaleX(point.time.getTime());
      const y = padding.top + chartHeight + 10;
      const label = point.time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      xLabels.push(`<text x="${x}" y="${y}" text-anchor="end" font-size="9" fill="#666" transform="rotate(-30 ${x} ${y})">${label}</text>`);
    }

    return `
      <div style="margin: 24px 0;">
        ${groupHeader('Errors over time', [chip('per minute', 'neutral')])}
        <div style="display: flex; flex-wrap: wrap; gap: 14px; margin: 0 0 12px;">
          ${lines.map(({ code, color }) => `
            <span style="display: inline-flex; align-items: center; gap: 6px; font-size: 9pt; color: ${REPORT_COLORS.mutedInk};">
              <span style="width: 12px; height: 3px; border-radius: 2px; background: ${color}; display: inline-block;"></span>
              ${this.utils.escapeHtml(code)}
            </span>`).join('')}
        </div>
        <div style="background: white; border-radius: 4px; border: 1px solid #e0e0e0; padding: 10px;">
          <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: auto;" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
            <rect x="${padding.left}" y="${padding.top}" width="${chartWidth}" height="${chartHeight}" fill="none" stroke="#999" stroke-width="1"/>
            ${gridLines.join('')}
            ${lines.map(({ color, path }) => `<path d="${path}" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}
            ${xLabels.join('')}
            <text x="14" y="${padding.top + chartHeight / 2}" text-anchor="middle" font-size="10" fill="#666" font-weight="600"
                  transform="rotate(-90 14 ${padding.top + chartHeight / 2})">Errors</text>
          </svg>
        </div>
      </div>
    `;
  }

  /** What is failing. */
  private renderByCode(data: ReportErrorAnalysis): string {
    const rows = data.byCode.map((row, idx) => `
      <tr style="background: ${idx % 2 === 1 ? '#fbfcfd' : '#ffffff'};">
        <td style="padding: 10px 12px; border-bottom: 1px solid ${REPORT_COLORS.rowBorder};">${this.codePill(row.responseCode)}</td>
        <td style="padding: 10px 16px; text-align: right; font-variant-numeric: tabular-nums; border-bottom: 1px solid ${REPORT_COLORS.rowBorder};">${formatInt(row.errorCount)}</td>
        <td style="padding: 10px 16px; text-align: right; font-variant-numeric: tabular-nums; border-bottom: 1px solid ${REPORT_COLORS.rowBorder};">${formatPercent(row.share)}</td>
        <td style="padding: 10px 16px; text-align: right; font-variant-numeric: tabular-nums; border-bottom: 1px solid ${REPORT_COLORS.rowBorder};">${formatNum(row.avgResponseTime)}</td>
        <td style="padding: 10px 16px; text-align: right; font-variant-numeric: tabular-nums; border-bottom: 1px solid ${REPORT_COLORS.rowBorder};">${formatNum(row.minResponseTime)}</td>
        <td style="padding: 10px 16px; text-align: right; font-variant-numeric: tabular-nums; border-bottom: 1px solid ${REPORT_COLORS.rowBorder};">${formatNum(row.maxResponseTime)}</td>
      </tr>`).join('');

    return `
      <div style="margin-top: 30px;">
        ${groupHeader('By response code', [chip(`${formatInt(data.byCode.length)} codes`, 'neutral')])}
        <div class="table-scroll">
          <table style="width: 100%; border-collapse: collapse;">
            <thead><tr style="${THEAD_ROW}">
              <th style="${TH_TEXT}">Code</th>
              <th style="${TH_NUM}">Errors</th>
              <th style="${TH_NUM}">Share</th>
              <th style="${TH_NUM}">Avg (ms)</th>
              <th style="${TH_NUM}">Min (ms)</th>
              <th style="${TH_NUM}">Max (ms)</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  /** Where it is failing. */
  private renderByTransaction(data: ReportErrorAnalysis, topN: number): string {
    const shown = data.byTransaction.slice(0, topN);
    const rest = data.byTransaction.length - shown.length;

    const rows = shown.map((row, idx) => `
      <tr style="background: ${idx % 2 === 1 ? '#fbfcfd' : '#ffffff'};">
        <td style="padding: 10px 12px; font-size: 12.5px; font-weight: 600; color: ${REPORT_COLORS.ink}; border-bottom: 1px solid ${REPORT_COLORS.rowBorder};">${this.utils.escapeHtml(row.transactionName)}</td>
        <td style="padding: 10px 12px; font-size: 12px; color: ${REPORT_COLORS.mutedInk}; border-bottom: 1px solid ${REPORT_COLORS.rowBorder}; overflow-wrap: anywhere;">
          ${this.utils.escapeHtml(row.samplerName)}
          ${row.url ? `<div style="margin-top: 3px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; color: ${REPORT_COLORS.faintInk}; overflow-wrap: anywhere;">${this.utils.escapeHtml(row.url)}</div>` : ''}
        </td>
        <td style="padding: 10px 12px; border-bottom: 1px solid ${REPORT_COLORS.rowBorder};">${row.responseCode ? this.codePill(row.responseCode) : '—'}</td>
        <td style="padding: 10px 16px; text-align: right; font-variant-numeric: tabular-nums; border-bottom: 1px solid ${REPORT_COLORS.rowBorder};">${formatInt(row.errorCount)}</td>
        <td style="padding: 10px 16px; text-align: right; font-variant-numeric: tabular-nums; border-bottom: 1px solid ${REPORT_COLORS.rowBorder};">${formatPercent(row.share)}</td>
        <td style="padding: 10px 16px; text-align: right; font-variant-numeric: tabular-nums; border-bottom: 1px solid ${REPORT_COLORS.rowBorder};">${formatNum(row.avgResponseTime)}</td>
      </tr>`).join('');

    return `
      <div style="margin-top: 30px;">
        ${groupHeader('By transaction & request', [chip(`${formatInt(data.byTransaction.length)} failing requests`, 'neutral')])}
        <div class="table-scroll">
          <table style="width: 100%; border-collapse: collapse;">
            <thead><tr style="${THEAD_ROW}">
              <th style="${TH_TEXT}">Transaction</th>
              <th style="${TH_TEXT}">Request</th>
              <th style="${TH_TEXT}">Code</th>
              <th style="${TH_NUM}">Errors</th>
              <th style="${TH_NUM}">Share</th>
              <th style="${TH_NUM}">Avg (ms)</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ${rest > 0 ? `<div style="font-size: 11px; color: ${REPORT_COLORS.mutedInk}; margin-top: 6px;">and ${formatInt(rest)} more failing requests</div>` : ''}
      </div>
    `;
  }

  /**
   * Colour by HTTP class, because that is what decides who looks at it: 5xx is
   * the server's problem, 4xx is usually the test's. A non-numeric code (a
   * JMeter assertion label, a connection error) gets the neutral pill rather
   * than being forced into a class it does not belong to.
   */
  private codePill(code: string): string {
    const numeric = parseInt(code, 10);
    if (!Number.isFinite(numeric)) return pill(code, 'neutral');
    if (numeric >= 500) return pill(code, 'bad');
    if (numeric >= 400) return pill(code, 'warn');
    return pill(code, 'info');
  }

  private codeColor(code: string, index: number): string {
    const numeric = parseInt(code, 10);
    if (numeric >= 500) return REPORT_COLORS.dot.bad;
    if (numeric >= 400) return REPORT_COLORS.dot.warn;
    return ['#4285f4', '#9c50b6', '#46bdc6', '#ea8c55'][index % 4]!;
  }
}
