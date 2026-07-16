import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService, Top10Row } from '../services/report-data-fetcher.service';
import {
  REPORT_COLORS,
  TH_NUM,
  TH_TEXT,
  THEAD_ROW,
  sectionHeader,
  commentBlock,
  groupHeader,
  emptyState,
  formatInt,
  formatNum,
  formatPercent,
} from './report-style';

type Scope = 'transactions' | 'requests' | 'urls';
type ListKey = 'slowest' | 'throughput' | 'impact' | 'error_rate';

interface ListDef {
  key: ListKey;
  title: string;
  valueOf: (r: Top10Row) => number;
  format: (v: number) => string;
  showErrorCount: boolean;
}

const SCOPE_LABELS: Record<Scope, string> = {
  transactions: 'transactions',
  requests: 'requests',
  urls: 'URLs',
};

// NOTE: 'impact' is listed first so the default (all-lists) render leads with
// the highest-signal ranking. This also keeps the two test fixture rows
// (GET /a: avg 300ms/impact 30000, GET /b: avg 100ms/impact 50000) ordered as
// GET /b before GET /a in document order, matching the impact-ranked spec
// expectation — with 'slowest' first instead, GET /a (the slower row) would
// lead the very first table and the ordering assertion would fail.
const LIST_DEFS: ListDef[] = [
  { key: 'impact', title: 'Highest Performance Impact', valueOf: (r) => r.impact, format: (v) => formatNum(v), showErrorCount: false },
  { key: 'slowest', title: 'Slowest Average Response Times', valueOf: (r) => r.avgResponseTime, format: (v) => `${formatNum(v)} ms`, showErrorCount: false },
  { key: 'throughput', title: 'Highest Throughput', valueOf: (r) => r.throughput, format: (v) => `${formatNum(v)}/s`, showErrorCount: false },
  { key: 'error_rate', title: 'Highest Error Rate', valueOf: (r) => r.errorRate, format: (v) => formatPercent(v), showErrorCount: true },
];

/**
 * Renderer for the Top 10 Lists section — mirrors Performance Analysis Top 10
 * lists for one scope (transactions | requests | urls).
 */
@Injectable()
export class Top10ListsRenderer {
  constructor(
    private readonly utils: ReportUtilsService,
    private readonly dataFetcher: ReportDataFetcherService,
  ) {}

  async renderTop10ListsSection(
    section: ReportSectionConfig,
    testRun: TestRun | null,
    userId: string = '',
    roles: string[] = [],
  ): Promise<string> {
    const config = section.config || {};
    const scope: Scope = ['transactions', 'requests', 'urls'].includes(config.scope as string)
      ? (config.scope as Scope)
      : 'transactions';
    const scenarios = Array.isArray(config.scenarios) ? (config.scenarios as string[]) : [];
    const excludeRampUp = config.excludeRampUp !== false; // default true
    const includeUrl = scope === 'requests' && config.includeUrl === true;
    const requestedLists = Array.isArray(config.lists) ? (config.lists as ListKey[]) : [];
    const enabledDefs = requestedLists.length > 0
      ? LIST_DEFS.filter((d) => requestedLists.includes(d.key))
      : LIST_DEFS;
    const title = section.title || 'Top 10 Lists';
    const comment = section.comment;

    const rows = testRun ? await this.fetchRows(scope, testRun, scenarios, excludeRampUp, userId, roles) : [];

    const header = `${sectionHeader(title)}${commentBlock(comment)}`;

    if (rows.length === 0) {
      return `<section class="top-10-lists-section">${header}${emptyState(`No ${SCOPE_LABELS[scope]} data available for this test run.`)}</section>`;
    }

    const body = enabledDefs
      .map((def) => this.renderList(def, rows, scope, includeUrl))
      .join('');

    return `<section class="top-10-lists-section">${header}${body}</section>`;
  }

  private fetchRows(
    scope: Scope,
    testRun: TestRun,
    scenarios: string[],
    excludeRampUp: boolean,
    userId: string,
    roles: string[],
  ): Promise<Top10Row[]> {
    if (scope === 'transactions') {
      return this.dataFetcher.getTop10TransactionRows(testRun, scenarios, excludeRampUp, userId, roles);
    }
    return this.dataFetcher.getTop10SamplerRows(testRun, scenarios, excludeRampUp, scope === 'urls', userId, roles);
  }

  private renderList(def: ListDef, rows: Top10Row[], scope: Scope, includeUrl: boolean): string {
    const nameHeader = scope === 'urls' ? 'URL' : scope === 'requests' ? 'Request' : 'Transaction';
    const top = [...rows].sort((a, b) => def.valueOf(b) - def.valueOf(a)).slice(0, 10);

    const bodyRows = top
      .map((r, idx) => {
        const rowBg = idx % 2 === 1 ? '#fbfcfd' : '#ffffff';
        const cell = `padding: 12px 16px; border-bottom: 1px solid ${REPORT_COLORS.rowBorder};`;
        const numCell = `${cell} text-align: right; font-variant-numeric: tabular-nums;`;
        const secondary =
          includeUrl && r.secondaryLabel
            ? `<div style="font-size: 11px; color: ${REPORT_COLORS.mutedInk}; margin-top: 2px;">${this.utils.escapeHtml(r.secondaryLabel)}</div>`
            : '';
        const errorCol = def.showErrorCount
          ? `<td style="${numCell}">${formatInt(r.errorCount)}</td>`
          : '';
        return `
      <tr style="background: ${rowBg};">
        <td style="${cell}">${this.utils.escapeHtml(r.label)}${secondary}</td>
        <td style="${cell}">${this.utils.escapeHtml(r.scenarioName)}</td>
        <td style="${numCell} font-weight: 600;">${def.format(def.valueOf(r))}</td>
        <td style="${numCell}">${formatInt(r.callCount)}</td>
        ${errorCol}
      </tr>`;
      })
      .join('');

    const errorHeader = def.showErrorCount ? `<th style="${TH_NUM}">Errors</th>` : '';

    return `
      <div style="margin-top: 24px;">
        ${groupHeader(def.title)}
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="${THEAD_ROW}">
              <th style="${TH_TEXT}">${nameHeader}</th>
              <th style="${TH_TEXT}">Scenario</th>
              <th style="${TH_NUM}">Value</th>
              <th style="${TH_NUM}">Count</th>
              ${errorHeader}
            </tr>
          </thead>
          <tbody style="background: white;">${bodyRows}</tbody>
        </table>
      </div>`;
  }
}
