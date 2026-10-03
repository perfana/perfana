import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig, getSectionText } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService, ScenarioData, ReportTransaction } from '../services/report-data-fetcher.service';
import { buildSampleSections, ControllerKind, SampleSection } from './controller-sections';
import {
  REPORT_COLORS,
  TH_NUM,
  TH_TEXT,
  THEAD_ROW,
  chip,
  groupHeader,
  sectionHeader,
  sectionText,
  formatInt,
  formatNum,
  formatPercent,
  markerChip,
} from './report-style';
import {
  CHART_INK,
  CHART_SANS,
  CHART_SIZE,
  axisUnitLabel,
  chartCard,
  chartColor,
  chartSeriesTable,
  hoverSlot,
  gridLine,
  legendStats,
  tickLabel,
  type ChartLegendRow,
} from './chart-tokens';

/**
 * What a band is telling the reader. `transaction` is unlabelled: the band is already inside a
 * transaction's own request table, so naming it that twice says nothing. `other` is currently
 * unreachable — `meaningfulChain` drops those controllers before a band is built — but stays so
 * the Record remains exhaustive.
 */
const CONTROLLER_LABEL: Record<ControllerKind, string> = {
  parallel: 'parallel',
  loop: 'loop',
  conditional: 'conditional',
  alternating: 'one per pass',
  transaction: '',
  other: '',
};

/** Time series row from database query */
interface TimeSeriesRow {
  transaction_name: string;
  time_bucket: string;
  avg_response_time: string;
}

/**
 * Renderer for Transaction Response Times section
 *
 * Generates response time analysis with:
 * - Time series charts showing response times over time
 * - Transaction summary table with percentiles
 * - Scenario-specific breakdowns
 */
@Injectable()
export class TransactionResponseTimesRenderer {
  constructor(
    private readonly utils: ReportUtilsService,
    private readonly dataFetcher: ReportDataFetcherService,
  ) {}

  /**
   * Render Transaction Response Times section
   * Fetches real transaction data from the transactions table
   */
  async renderTransactionResponseTimesSection(
    section: ReportSectionConfig,
    testRun: TestRun | null,
    userId: string = '',
    roles: string[] = [],
  ): Promise<string> {
    const config = section.config || {};
    const includeChart = config.includeChart !== false;
    const includeChildRequests = config.includeChildRequests === true;
    const title = section.title || 'Transaction Response Times';
    const text = getSectionText(section);

    const requested = this.requestedScenarios(config);
    // No selection means every scenario in the run, the way the Top 10 section
    // reads an empty scenario list. Templates written before the section took a
    // list stored the literal "all", which meant the same thing and matched no
    // row — it resolves here rather than 404ing against a scenario name.
    const scenarioNames = requested.length > 0
      ? requested
      : testRun
        ? await this.dataFetcher.listScenarioNames(testRun, userId, roles)
        : ['all'];

    const scenarios = (
      await Promise.all(
        scenarioNames.map((name) =>
          testRun
            ? this.dataFetcher.getScenarioDataFromDatabase(testRun, name, userId, roles, includeChildRequests)
            : Promise.resolve(this.dataFetcher.getMockScenarioData(name)),
        ),
      )
    ).filter((d): d is ScenarioData => d != null);

    if (scenarios.length === 0) {
      return `
        <section class="response-times-section">
          ${sectionHeader(title)}
          ${sectionText(text)}
          <div class="placeholder-message">
            Scenario "${this.utils.escapeHtml(scenarioNames.join(', ') || 'all')}" not found. Available scenarios will be listed here when transaction data is available.
          </div>
        </section>
      `;
    }

    // The aggregate is a property of the run, not of a scenario, so it heads the
    // first block only — repeating identical "All aggregated" rows under every
    // scenario would read as per-scenario totals that do not add up.
    const withAggregate = testRun && config.includeAggregated === true
      ? await this.withAggregatedRow(scenarios[0]!, testRun, config, userId, roles)
      : scenarios[0]!;
    const blocks = [withAggregate, ...scenarios.slice(1)];
    const named = blocks.length > 1;

    return `
      <section class="response-times-section">
        ${sectionHeader(title, { kicker: blocks.map((d) => d.scenario).join(', ') })}

        ${sectionText(text)}

        ${blocks.map((data) => `
          ${named ? groupHeader(data.scenario, [chip(`${formatInt(data.transactions.length)} transactions`, 'neutral')]) : ''}
          ${includeChart ? this.renderResponseTimesChart(data) : ''}
          ${this.renderTransactionsTable(data)}
        `).join('\n')}
      </section>
    `;
  }

  /**
   * The scenarios this section asked for. `scenarios` is the list the config
   * form writes; `scenario` is the single name older templates stored, where
   * "all" was the do-not-filter placeholder.
   */
  private requestedScenarios(config: Record<string, unknown>): string[] {
    const list = config.scenarios;
    if (Array.isArray(list)) {
      const names = list.filter((n): n is string => typeof n === 'string' && n.trim() !== '');
      if (names.length > 0) return names;
    }
    const single = typeof config.scenario === 'string' ? config.scenario.trim() : '';
    return single && single !== 'all' ? [single] : [];
  }

  /** Prepend the run-wide aggregate row and its series to a scenario block. */
  private async withAggregatedRow(
    data: ScenarioData,
    testRun: TestRun,
    config: Record<string, unknown>,
    userId: string,
    roles: string[],
  ): Promise<ScenarioData> {
    const excludeRampUp = config.excludeRampUp !== false;
    const [series, scalars] = await Promise.all([
      this.dataFetcher.getAggregatedSeries(testRun.testRunId, 'transaction_response_time', 'avg', excludeRampUp, userId, roles),
      this.dataFetcher.getAggregatedScalars(testRun.testRunId, userId, roles),
    ]);
    if (series.length === 0 && scalars.avg == null) return data;

    const total = scalars.pass + scalars.fail;
    return {
      ...data,
      transactions: [
        {
          name: 'All aggregated',
          avgMs: scalars.avg ?? 0,
          p95Ms: scalars.p95 ?? 0,
          p99Ms: scalars.p99 ?? 0,
          pass: scalars.pass,
          fail: scalars.fail,
          errPct: total > 0 ? (scalars.fail / total) * 100 : 0,
        },
        ...data.transactions,
      ],
      timeSeries: [
        ...series.map((p) => ({
          transaction_name: 'All aggregated',
          time_bucket: p.time.toISOString(),
          avg_response_time: String(p.value),
        })),
        ...(data.timeSeries ?? []),
      ],
    };
  }

  /**
   * Render response times chart with SVG line chart
   */
  renderResponseTimesChart(scenarioData: ScenarioData): string {
    const chartTitle = `Response Times Over Time - ${scenarioData.scenario}`;

    // Chart dimensions
    const width = 1000;
    const height = 320;
    // `top` holds the unit caption the standard prints above the axis, in place of the
    // rotated axis title; `left` no longer has to hold that rotated text.
    const padding = { top: 28, right: 40, bottom: 90, left: 62 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Process real time series data from database
    const timeSeriesData = scenarioData.timeSeries || [];

    // Group time series data by transaction name
    const dataByTransaction: Map<string, Array<{ time: Date; value: number }>> = new Map();
    timeSeriesData.forEach((row: unknown) => {
      const tsRow = row as TimeSeriesRow;
      if (!dataByTransaction.has(tsRow.transaction_name)) {
        dataByTransaction.set(tsRow.transaction_name, []);
      }
      dataByTransaction.get(tsRow.transaction_name)!.push({
        time: new Date(tsRow.time_bucket),
        value: parseFloat(tsRow.avg_response_time) || 0,
      });
    });

    // Get unique time buckets for X-axis (dedup/sort by epoch ms so synthetic
    // aggregated rows using a different time_bucket representation still align
    // with real DB rows for the same instant)
    const uniqueTimes = Array.from(
      new Map(
        timeSeriesData.map((row: unknown) => {
          const d = new Date((row as TimeSeriesRow).time_bucket);
          return [d.getTime(), d] as const;
        }),
      ).values(),
    ).sort((a, b) => a.getTime() - b.getTime());

    const timePoints = uniqueTimes.length;

    // If no time series data, show message
    if (timePoints === 0) {
      return `
        <div style="margin: 24px 0;">
          ${groupHeader(chartTitle)}
          ${chartCard(`<div style="padding: 40px; text-align: center; font-family: ${CHART_SANS}; font-size: 10pt; color: ${CHART_INK.faint};">
            No time series data available for this scenario.
          </div>`)}
        </div>
      `;
    }

    // Create data points array for each transaction
    const dataPoints: number[][] = [];
    scenarioData.transactions.forEach((txn: ReportTransaction) => {
      const transactionData = dataByTransaction.get(txn.name) || [];
      const points = uniqueTimes.map((time) => {
        const dataPoint = transactionData.find(
          (d) => d.time.getTime() === time.getTime()
        );
        return dataPoint ? dataPoint.value : 0;
      });
      dataPoints.push(points);
    });

    // Find max value for Y-axis scaling
    const maxValue = Math.max(...dataPoints.flat().filter((v) => v > 0));
    const yMin = 0;
    const yMax = Math.ceil(maxValue / 20) * 20 + 20; // Round up to nearest 20 and add buffer

    // Generate time labels
    const timeLabels = uniqueTimes.map((time) => {
      return time.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
    });

    // Generate grid lines (from top to bottom, max to min)
    const gridLines: string[] = [];
    const numGridLines = 5;
    for (let i = 0; i <= numGridLines; i++) {
      const y = padding.top + (chartHeight / numGridLines) * i;
      const value = yMax - ((yMax - yMin) / numGridLines) * i;
      gridLines.push(
        gridLine(padding.left, width - padding.right, y)
        + tickLabel(String(Math.round(value)), padding.left - 10, y + 4, 'end'),
      );
    }

    // Generate lines and data points for each transaction
    const linesAndPoints: string[] = [];
    dataPoints.forEach((points, txnIdx) => {
      const color = chartColor(txnIdx);

      // Generate line path
      const pathData = points
        .map((value: number, i: number) => {
          const x = padding.left + (chartWidth / (timePoints - 1)) * i;
          // Calculate Y position: higher values should be higher on chart (lower Y coordinate)
          const normalizedValue = (value - yMin) / (yMax - yMin); // 0 to 1
          const y = padding.top + chartHeight - (normalizedValue * chartHeight);
          return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
        })
        .join(' ');

      // `markedLine`, not `line`: this chart draws a marker on every point below, and the
      // standard pairs the two — a 2.5px dot on a 1.25px stroke reads as a bead chain.
      const line = `<path d="${pathData}" stroke="${color}" stroke-width="${CHART_SIZE.markedLine}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
      // Data point circles
      const markers = points.map((value: number, i: number) => {
        const x = padding.left + (chartWidth / (timePoints - 1)) * i;
        const normalizedValue = (value - yMin) / (yMax - yMin);
        const y = padding.top + chartHeight - (normalizedValue * chartHeight);
        return `<circle cx="${x}" cy="${y}" r="${CHART_SIZE.marker}" fill="${color}"/>`;
      }).join('');

      // One group per transaction, indexed like its series-table row: that attribute is
      // the whole dim-the-others pairing — see CHART_HOVER_CSS. Built as ONE string: an
      // open and a close pushed ten lines apart drift the moment anything returns early,
      // and an unbalanced <g> corrupts the rest of the SVG.
      linesAndPoints.push(`<g${hoverSlot(txnIdx)}>${line}${markers}</g>`);
    });
    const lines = linesAndPoints.join('');

    // Generate X-axis labels (rotated for readability)
    const xLabels = timeLabels.map((label, i) => {
      const x = padding.left + (chartWidth / (timePoints - 1)) * i;
      const yPos = padding.top + chartHeight + 10;
      return tickLabel(label, x, yPos, 'end', `transform="rotate(-45 ${x} ${yPos})"`);
    }).join('');

    // The legend is the app's series table, below the chart: per transaction, the
    // min/mean/max of the response times drawn. Its row order is `dataPoints`' order, which
    // is what `data-series` pairs on. A bucket the transaction did not run in reads as 0 in the
    // line (see `dataPoints` above), so the stats skip those rather than reporting a
    // minimum of zero for every transaction.
    const legendRows: ChartLegendRow[] = scenarioData.transactions.map(
      (txn: ReportTransaction, idx: number) => {
        const sampled = (dataPoints[idx] ?? []).filter((v) => v > 0);
        return {
          name: txn.name,
          color: chartColor(idx),
          unit: 'ms',
          ...legendStats(sampled, formatNum),
        };
      },
    );

    return `
      <div class="chart-hover" style="margin: 24px 0;">
        ${groupHeader(chartTitle)}
        ${chartCard(`
          <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: auto;" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
            <!-- The plot area. A fill, not a frame: the standard has no plot border. -->
            <rect x="${padding.left}" y="${padding.top}" width="${chartWidth}" height="${chartHeight}"
                  fill="${CHART_INK.plotBg}"/>

            <!-- The unit, named once above its own axis -->
            ${axisUnitLabel('ms', padding.left, padding.top - 8, 'start')}

            <!-- Grid lines -->
            ${gridLines.join('')}

            <!-- Data lines and points -->
            ${lines}

            <!-- X-axis labels -->
            ${xLabels}
          </svg>
        `)}
        ${chartSeriesTable(legendRows, (text) => this.utils.escapeHtml(text))}
      </div>
    `;
  }

  /**
   * Render transactions table with blue header styling
   */
  renderTransactionsTable(scenarioData: ScenarioData): string {
    const { transactions } = scenarioData;

    const tableRows = transactions
      .map(
        (txn: ReportTransaction, idx: number) => {
          const rowBg = txn.fail > 0 ? '#fff8f8' : (idx % 2 === 1 ? '#fbfcfd' : '#ffffff');
          return `
      <tr style="background: ${rowBg};">
        <td style="padding: 12px 16px; border-bottom: 1px solid ${REPORT_COLORS.rowBorder};">${this.utils.escapeHtml(txn.name)}</td>
        <td style="padding: 12px 16px; text-align: right; font-variant-numeric: tabular-nums; border-bottom: 1px solid ${REPORT_COLORS.rowBorder};">${formatNum(txn.avgMs)}</td>
        <td style="padding: 12px 16px; text-align: right; font-variant-numeric: tabular-nums; border-bottom: 1px solid ${REPORT_COLORS.rowBorder};">${formatNum(txn.p95Ms)}</td>
        <td style="padding: 12px 16px; text-align: right; font-variant-numeric: tabular-nums; border-bottom: 1px solid ${REPORT_COLORS.rowBorder};">${formatNum(txn.p99Ms)}</td>
        <td style="padding: 12px 16px; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; color: ${REPORT_COLORS.dot.good}; border-bottom: 1px solid ${REPORT_COLORS.rowBorder};">${formatInt(txn.pass)}</td>
        <td style="padding: 12px 16px; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; color: ${txn.fail > 0 ? REPORT_COLORS.dot.bad : REPORT_COLORS.ink}; border-bottom: 1px solid ${REPORT_COLORS.rowBorder};">${formatInt(txn.fail)}</td>
        <td style="padding: 12px 16px; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; color: ${txn.errPct > 0 ? REPORT_COLORS.dot.warn : REPORT_COLORS.dot.good}; border-bottom: 1px solid ${REPORT_COLORS.rowBorder};">${formatPercent(txn.errPct)}</td>
      </tr>
      ${this.renderChildRequests(txn)}
    `;
        },
      )
      .join('');

    return `
      <div style="margin-top: 24px;">
        <div class="table-scroll">
          <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="${THEAD_ROW}">
              <th style="${TH_TEXT}">Transaction</th>
            <th style="${TH_NUM}">Avg (ms)</th>
            <th style="${TH_NUM}">P95 (ms)</th>
            <th style="${TH_NUM}">P99 (ms)</th>
            <th style="${TH_NUM}">Pass</th>
            <th style="${TH_NUM}">Fail</th>
            <th style="${TH_NUM}">Err %</th>
          </tr>
        </thead>
        <tbody style="background: white;">
          ${tableRows}
        </tbody>
      </table>
        </div>
      </div>
    `;
  }

  /**
   * The samplers that ran inside a transaction, as a nested table in a detail
   * row directly beneath it.
   *
   * A detail row rather than more sibling rows: the report's table script sorts
   * and filters by row, and it keeps a single-cell colspan row attached to the
   * row above — so a request never drifts away from the transaction it belongs
   * to. Same idiom as the SLO section's failing targets.
   */
  private renderChildRequests(txn: ReportTransaction): string {
    const children = txn.children ?? [];
    if (children.length === 0) return '';

    // Banded by the controllers the requests ran under — the same slice of the
    // test plan the Performance Analysis card draws. A run whose engine records
    // no chain yields one section per request, i.e. the flat table.
    const sections = buildSampleSections(children, txn.name);
    let zebra = 0;
    const rows = sections.map((section) => this.renderSampleSection(section, 0, () => zebra++)).join('');

    return `
      <tr>
        <td colspan="7" style="padding: 0 16px 12px 32px; border-bottom: 1px solid ${REPORT_COLORS.rowBorder}; background: #fcfcfd;">
          <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: ${REPORT_COLORS.faintInk}; padding: 8px 0 6px;">${formatInt(children.length)} requests</div>
          <div class="table-scroll">
            <table style="width: 100%; border-collapse: collapse; background: #ffffff; border: 1px solid ${REPORT_COLORS.cardBorder}; border-radius: 6px;">
              <thead><tr style="${THEAD_ROW}">
                <th style="${TH_TEXT}">Request</th>
                <th style="${TH_NUM}">Avg (ms)</th>
                <th style="${TH_NUM}">P95 (ms)</th>
                <th style="${TH_NUM}">P99 (ms)</th>
                <th style="${TH_NUM}">Pass</th>
                <th style="${TH_NUM}">Fail</th>
                <th style="${TH_NUM}">Err %</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </td>
      </tr>`;
  }

  /**
   * One controller band, or one request row, at `depth` levels of indent.
   *
   * `nextZebra` is threaded through rather than using the index within a section: striping has to
   * alternate down the visible table, and a section only knows its own children.
   */
  private renderSampleSection(section: SampleSection<ReportTransaction>, depth: number, nextZebra: () => number): string {
    if (section.kind === 'single') {
      return this.renderChildRow(section.sample, depth, nextZebra());
    }

    const indent = 12 + depth * 14;
    const label = CONTROLLER_LABEL[section.controller];
    return `
      <tr>
        <td colspan="7" style="padding: 8px 12px 4px ${indent}px; background: #fbfbfc; border-bottom: 1px solid ${REPORT_COLORS.rowBorder};">
          <span style="font-size: 11px; font-weight: 700; color: ${REPORT_COLORS.mutedInk};">${this.utils.escapeHtml(section.name)}</span>
          ${label ? ` ${markerChip(label, 'neutral')}` : ''}
        </td>
      </tr>
      ${section.children.map((child) => this.renderSampleSection(child, depth + 1, nextZebra)).join('')}`;
  }

  /** A single request row inside the child-request table. */
  private renderChildRow(child: ReportTransaction, depth: number, zebra: number): string {
    const indent = 12 + depth * 14;
    const cell = 'padding: 7px 12px; text-align: right; font-size: 11.5px; font-variant-numeric: tabular-nums;';
    return `
      <tr style="background: ${zebra % 2 === 1 ? '#fbfcfd' : '#ffffff'};">
        <td style="padding: 7px 12px 7px ${indent}px; font-size: 11.5px; color: ${REPORT_COLORS.mutedInk}; border-bottom: 1px solid ${REPORT_COLORS.rowBorder}; overflow-wrap: anywhere;">${this.utils.escapeHtml(child.name)}</td>
        <td style="${cell} border-bottom: 1px solid ${REPORT_COLORS.rowBorder};">${formatNum(child.avgMs)}</td>
        <td style="${cell} border-bottom: 1px solid ${REPORT_COLORS.rowBorder};">${formatNum(child.p95Ms)}</td>
        <td style="${cell} border-bottom: 1px solid ${REPORT_COLORS.rowBorder};">${formatNum(child.p99Ms)}</td>
        <td style="${cell} border-bottom: 1px solid ${REPORT_COLORS.rowBorder};">${formatInt(child.pass)}</td>
        <td style="${cell} color: ${child.fail > 0 ? REPORT_COLORS.dot.bad : REPORT_COLORS.ink}; border-bottom: 1px solid ${REPORT_COLORS.rowBorder};">${formatInt(child.fail)}</td>
        <td style="${cell} color: ${child.errPct > 0 ? REPORT_COLORS.dot.warn : REPORT_COLORS.dot.good}; border-bottom: 1px solid ${REPORT_COLORS.rowBorder};">${formatPercent(child.errPct)}</td>
      </tr>`;
  }
}
