import { Injectable, Logger } from '@nestjs/common';
import { TestRun, ReportSectionConfig, getSectionText } from '@perfana/shared';
import {
  DEFAULT_DYNATRACE_HOST_COLUMNS,
  DYNATRACE_HOST_COLUMNS,
  DynatraceHostColumn,
} from '@perfana/shared/types';
import { DynatraceService } from '../../dynatrace/dynatrace.service';
import { HostReportRow } from '../../dynatrace/dto/host.dto';
import {
  REPORT_COLORS,
  TH_CENTER,
  TH_NUM,
  TH_TEXT,
  THEAD_ROW,
  chip,
  emptyState,
  escapeHtml,
  formatInt,
  formatMetricValue,
  formatPercent,
  groupHeader,
  markerChip,
  pill,
  sectionHeader,
  sectionText,
  warningState,
} from './report-style';

const TD = `padding:10px 12px; border-bottom:1px solid ${REPORT_COLORS.rowBorder};`;
const TD_NUM = `${TD} text-align:right; font-variant-numeric:tabular-nums;`;

const SEVERITY_KIND: Record<string, 'bad' | 'warn' | 'info'> = {
  AVAILABILITY: 'bad',
  ERROR: 'bad',
  PERFORMANCE: 'warn',
  RESOURCE_CONTENTION: 'warn',
};

/**
 * Renderer for the Dynatrace Hosts section: the Dynatrace card's Hosts tab as a table,
 * with the host detail page's extra columns on request.
 */
@Injectable()
export class DynatraceHostsRenderer {
  private readonly logger = new Logger(DynatraceHostsRenderer.name);

  constructor(private readonly dynatrace: DynatraceService) {}

  async renderDynatraceHostsSection(section: ReportSectionConfig, testRun: TestRun | null): Promise<string> {
    const config = section.config || {};
    const title = section.title || 'Dynatrace Hosts';
    const text = getSectionText(section);
    const columns = pickColumns(config.columns);
    const hostIds = Array.isArray(config.hostIds)
      ? (config.hostIds as unknown[]).filter((h): h is string => typeof h === 'string' && h !== '')
      : [];

    if (!testRun?.startTime || !testRun.endTime) {
      return this.wrap(title, text, [], emptyState('No test run data available for the Dynatrace hosts.'));
    }

    let rows: HostReportRow[];
    try {
      rows = await this.dynatrace.fetchHostsReport(
        testRun.systemUnderTestId,
        testRun.testEnvironment,
        testRun.workload,
        new Date(testRun.startTime),
        new Date(testRun.endTime),
        { hostIds, columns },
      );
    } catch (error) {
      this.logger.warn(`Dynatrace hosts section failed for ${testRun.testRunId}`, error);
      return this.wrap(title, text, [], warningState('Dynatrace host data could not be loaded.'));
    }

    if (rows.length === 0) {
      return this.wrap(title, text, [], emptyState('No Dynatrace hosts are mapped to this test run.'));
    }

    // Same default order as the Hosts tab: hosts with problems first, then CPU descending.
    rows.sort((a, b) => {
      const pa = (a.problemCount ?? 0) > 0 ? 1 : 0;
      const pb = (b.problemCount ?? 0) > 0 ? 1 : 0;
      if (pa !== pb) return pb - pa;
      return (b.cpuAvg ?? -1) - (a.cpuAvg ?? -1);
    });

    const body = config.groupByLabel === true
      ? groupByLabel(rows)
          .map(({ label, hosts }) => `
            <div style="margin-top:24px;">
              ${groupHeader(label, [chip(hostCount(hosts.length), 'neutral')])}
              ${this.renderTable(hosts, columns)}
            </div>`)
          .join('')
      : this.renderTable(rows, columns);

    return this.wrap(title, text, [chip(hostCount(rows.length), 'neutral')], body);
  }

  private wrap(title: string, text: string | undefined, chips: string[], body: string): string {
    return `
      <section class="dynatrace-hosts-section">
        ${sectionHeader(title, { chipsHtml: chips })}
        ${sectionText(text)}
        ${body}
      </section>
    `;
  }

  private renderTable(rows: HostReportRow[], columns: readonly DynatraceHostColumn[]): string {
    const has = (c: DynatraceHostColumn) => columns.includes(c);
    const head = [
      `<th style="${TH_TEXT}">Host</th>`,
      `<th style="${TH_TEXT}">Labels</th>`,
      has('cpu') ? `<th style="${TH_NUM}">CPU avg</th><th style="${TH_NUM}">CPU cores</th>` : '',
      has('memory') ? `<th style="${TH_NUM}">Memory avg</th><th style="${TH_NUM}">Memory total</th>` : '',
      has('disk') ? `<th style="${TH_NUM}">Disk util avg</th>` : '',
      has('network') ? `<th style="${TH_NUM}">Network traffic avg</th>` : '',
      has('problems') ? `<th style="${TH_CENTER}">Problems</th>` : '',
    ].join('');

    const body = rows.map((r, idx) => `
      <tr style="background:${idx % 2 === 1 ? '#fbfcfd' : '#ffffff'};">
        <td style="${TD} font-size:12.5px; font-weight:600; color:${REPORT_COLORS.ink};">${escapeHtml(r.displayName)}</td>
        <td style="${TD}">${r.labels.map((l) => markerChip(l, 'info')).join(' ')}</td>
        ${has('cpu') ? `<td style="${TD_NUM}">${formatPercent(r.cpuAvg)}</td><td style="${TD_NUM}">${formatInt(r.cpuCores)}</td>` : ''}
        ${has('memory') ? `<td style="${TD_NUM}">${formatPercent(r.memAvg)}</td><td style="${TD_NUM}">${formatMetricValue(r.memoryTotal, 'bytes')}</td>` : ''}
        ${has('disk') ? `<td style="${TD_NUM}">${formatPercent(r.diskAvg)}</td>` : ''}
        ${has('network') ? `<td style="${TD_NUM}">${r.networkAvg == null ? '—' : `${formatMetricValue(r.networkAvg, 'bytes')}/s`}</td>` : ''}
        ${has('problems') ? `<td style="${TD} text-align:center;">${this.problems(r)}</td>` : ''}
      </tr>`).join('');

    return `
      <div class="table-scroll" style="margin-top:16px;">
        <table style="width:100%; border-collapse:collapse;">
          <thead><tr style="${THEAD_ROW}">${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    `;
  }

  private problems(r: HostReportRow): string {
    if (!r.problemCount) return `<span style="color:${REPORT_COLORS.mutedInk}; font-size:12px;">healthy</span>`;
    return pill(String(r.problemCount), (r.worstSeverity && SEVERITY_KIND[r.worstSeverity]) || 'info');
  }
}

const hostCount = (n: number) => `${formatInt(n)} host${n === 1 ? '' : 's'}`;

export const NO_LABEL_GROUP = 'No label';

/**
 * One group per label, labels sorted, hosts keeping their incoming order. A host with several
 * labels is listed under each; hosts with none go last under NO_LABEL_GROUP.
 */
export function groupByLabel(rows: HostReportRow[]): Array<{ label: string; hosts: HostReportRow[] }> {
  const groups = new Map<string, HostReportRow[]>();
  const unlabelled: HostReportRow[] = [];
  for (const r of rows) {
    if (r.labels.length === 0) unlabelled.push(r);
    for (const l of r.labels) groups.set(l, [...(groups.get(l) ?? []), r]);
  }
  const out = [...groups.keys()].sort().map((label) => ({ label, hosts: groups.get(label)! }));
  if (unlabelled.length > 0) out.push({ label: NO_LABEL_GROUP, hosts: unlabelled });
  return out;
}

/** Untrusted config → the known column set, in canonical order; empty/invalid → the default. */
export function pickColumns(raw: unknown): readonly DynatraceHostColumn[] {
  if (!Array.isArray(raw)) return DEFAULT_DYNATRACE_HOST_COLUMNS;
  const wanted = new Set(raw.filter((c): c is DynatraceHostColumn => (DYNATRACE_HOST_COLUMNS as readonly unknown[]).includes(c)));
  const picked = DYNATRACE_HOST_COLUMNS.filter((c) => wanted.has(c));
  return picked.length > 0 ? picked : DEFAULT_DYNATRACE_HOST_COLUMNS;
}
