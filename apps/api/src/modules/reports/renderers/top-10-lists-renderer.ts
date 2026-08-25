import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig, getSectionText, formatImpactShare } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService, Top10Row } from '../services/report-data-fetcher.service';
import {
  REPORT_COLORS,
  TH_NUM,
  TH_TEXT,
  THEAD_ROW,
  sectionHeader,
  sectionText,
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
  /** `total` is the sum of valueOf over EVERY row in scope, not just the top ten. */
  format: (v: number, total: number) => string;
  showErrorCount: boolean;
  /** Column header over the value. */
  valueHeader: string;
}

const SCOPE_LABELS: Record<Scope, string> = {
  transactions: 'transactions',
  requests: 'requests',
  urls: 'URLs',
};

/** Title-case form, used in headings when a section covers more than one scope. */
const SCOPE_HEADINGS: Record<Scope, string> = {
  transactions: 'Transactions',
  requests: 'Requests',
  urls: 'URLs',
};

/**
 * Canonical order, applied regardless of the order the author ticked the boxes:
 * transactions are the coarsest view and URLs the finest, and a report should not
 * reorder itself because someone re-selected a checkbox.
 */
const SCOPE_ORDER: Scope[] = ['transactions', 'requests', 'urls'];

/**
 * Which scopes this section covers.
 *
 * `scopes` is the current shape. `scope` is the single-value key every section
 * saved before this was multi-scope carries, and it stays readable forever —
 * there is no migration, so a template written a year ago must keep rendering.
 * An unrecognised or empty value falls back to transactions rather than to
 * nothing, because an empty section is a worse answer than a default one.
 */
export function resolveScopes(config: Record<string, unknown>): Scope[] {
  const isScope = (v: unknown): v is Scope => SCOPE_ORDER.includes(v as Scope);

  const requested = Array.isArray(config.scopes)
    ? (config.scopes as unknown[]).filter(isScope)
    : isScope(config.scope)
      ? [config.scope]
      : [];

  const unique = [...new Set(requested)];
  return unique.length > 0 ? SCOPE_ORDER.filter((s) => unique.includes(s)) : ['transactions'];
}

// Order matches Performance Analysis display order.
const LIST_DEFS: ListDef[] = [
  { key: 'slowest', title: 'Slowest Average Response Times', valueOf: (r) => r.avgResponseTime, format: (v) => `${formatNum(v)} ms`, showErrorCount: false, valueHeader: 'Avg response time' },
  { key: 'throughput', title: 'Highest Throughput', valueOf: (r) => r.throughput, format: (v) => `${formatNum(v)}/s`, showErrorCount: false, valueHeader: 'Throughput' },
  {
    key: 'impact',
    title: 'Performance Impact Ranking',
    valueOf: (r) => r.impact,
    // Raw impact is avg × count — a millisecond-calls product in the millions
    // that means nothing on its own and cannot be compared between runs. The
    // share of the run's total time can: "this transaction is 34% of all the
    // time this test spent" ranks the same but is readable, and the column
    // sums to 100 across everything in scope.
    format: (v, total) => formatImpactShare(v, total),
    showErrorCount: false,
    valueHeader: 'Impact score',
  },
  { key: 'error_rate', title: 'Highest Error Rate', valueOf: (r) => r.errorRate, format: (v) => formatPercent(v), showErrorCount: true, valueHeader: 'Error rate' },
];

/**
 * Renderer for the Top 10 Lists section — mirrors Performance Analysis Top 10
 * lists for one or more scopes (transactions | requests | urls).
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
    const scopes = resolveScopes(config);
    const scenarios = Array.isArray(config.scenarios) ? (config.scenarios as string[]) : [];
    const excludeRampUp = config.excludeRampUp !== false; // default true
    const requestedLists = Array.isArray(config.lists) ? (config.lists as ListKey[]) : [];
    const enabledDefs = requestedLists.length > 0
      ? LIST_DEFS.filter((d) => requestedLists.includes(d.key))
      : LIST_DEFS;
    const title = section.title || 'Top 10 Lists';
    const text = getSectionText(section);

    const header = `${sectionHeader(title)}${sectionText(text)}`;

    // Sequential rather than Promise.all: each scope is one query against the same
    // run, and the report renderer already runs a section at a time — firing three
    // at once buys nothing and makes a slow database look like three slow databases.
    const perScope: Array<{ scope: Scope; rows: Top10Row[] }> = [];
    for (const scope of scopes) {
      perScope.push({
        scope,
        rows: testRun
          ? await this.fetchRows(scope, testRun, scenarios, excludeRampUp, userId, roles)
          : [],
      });
    }

    const withRows = perScope.filter((s) => s.rows.length > 0);

    // Only when EVERY scope came back empty is the whole section empty. A scope
    // that has no data while a sibling does gets its own note, so "we looked and
    // there was nothing" is not confused with "we never looked".
    if (withRows.length === 0) {
      const missing = scopes.map((s) => SCOPE_LABELS[s]).join(', ');
      return `<section class="top-10-lists-section">${header}${emptyState(`No ${missing} data available for this test run.`)}</section>`;
    }

    // Heading names the scope only when there is more than one, so a single-scope
    // section reads exactly as it did before. With several, every table says which
    // scope it belongs to — they get separated across pages in the PDF.
    const labelScope = scopes.length > 1;

    const body = perScope
      .map(({ scope, rows }) => {
        if (rows.length === 0) {
          return `<div style="margin-top: 24px;">${groupHeader(SCOPE_HEADINGS[scope])}${emptyState(`No ${SCOPE_LABELS[scope]} data available for this test run.`)}</div>`;
        }
        const includeUrl = scope === 'requests' && config.includeUrl === true;
        return enabledDefs
          .map((def) => this.renderList(def, rows, scope, includeUrl, labelScope))
          .join('');
      })
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

  private renderList(
    def: ListDef,
    rows: Top10Row[],
    scope: Scope,
    includeUrl: boolean,
    labelScope = false,
  ): string {
    const nameHeader = scope === 'urls' ? 'URL' : scope === 'requests' ? 'Request' : 'Transaction';
    const top = [...rows].sort((a, b) => def.valueOf(b) - def.valueOf(a)).slice(0, 10);
    // Over every row, not the top ten: the score answers "share of this run",
    // and a denominator of the ten biggest would inflate every one of them.
    const total = rows.reduce((sum, r) => sum + def.valueOf(r), 0);

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
        <td style="${numCell} font-weight: 600;">${def.format(def.valueOf(r), total)}</td>
        <td style="${numCell}">${formatInt(r.callCount)}</td>
        ${errorCol}
      </tr>`;
      })
      .join('');

    const errorHeader = def.showErrorCount ? `<th style="${TH_NUM}">Errors</th>` : '';

    return `
      <div style="margin-top: 24px;">
        ${groupHeader(labelScope ? `${SCOPE_HEADINGS[scope]} · ${def.title}` : def.title)}
        <div class="table-scroll">
          <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="${THEAD_ROW}">
              <th style="${TH_TEXT}">${nameHeader}</th>
              <th style="${TH_TEXT}">Scenario</th>
              <th style="${TH_NUM}">${def.valueHeader}</th>
              <th style="${TH_NUM}">Count</th>
              ${errorHeader}
            </tr>
          </thead>
          <tbody style="background: white;">${bodyRows}</tbody>
        </table>
        </div>
      </div>`;
  }
}
