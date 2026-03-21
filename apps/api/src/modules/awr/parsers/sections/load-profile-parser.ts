/**
 * Load Profile Parser for AWR Reports
 *
 * Extracts Load Profile metrics from Oracle AWR HTML reports.
 * The Load Profile section shows database activity rates:
 * - Per Second values (rate of activity per elapsed second)
 * - Per Transaction values (rate of activity per database transaction)
 *
 * Common metrics include:
 * - DB Time, DB CPU, Background CPU (time-based)
 * - Redo Size, Logical/Physical Reads/Writes (I/O)
 * - User Calls, Parses, Executes (operations)
 * - Transactions, Rollbacks, Logons (sessions)
 */

import type { CheerioAPI, Cheerio } from 'cheerio';
import type { Element } from 'domhandler';
import { BaseSectionParser, type ParserOptions } from '../base-parser';
import type { LoadProfile, LoadProfileMetric } from '../../types/awr-data.types';
import {
  findTableByIdentifier,
  parseTableToArray,
  getTablesInSection,
} from '../../utils/html-utils';
import { parseAwrNumber } from '../../utils/number-utils';

// ==================== Constants ====================

/** Table identifiers used in AWR reports for Load Profile section */
const TABLE_IDENTIFIERS = [
  'load profile',
  'per second',
  'per transaction',
] as const;

/** Section heading variations */
const SECTION_HEADINGS = ['load profile', 'database load profile'] as const;

/**
 * Metric name to property mapping (case-insensitive keys)
 * Maps AWR report metric names to LoadProfile interface properties
 */
const METRIC_MAPPINGS: Record<string, keyof LoadProfile> = {
  'db time(s)': 'dbTimePerSecond',
  'db time (s)': 'dbTimePerSecond',
  'db time': 'dbTimePerSecond',
  'db cpu(s)': 'dbCpuPerSecond',
  'db cpu (s)': 'dbCpuPerSecond',
  'db cpu': 'dbCpuPerSecond',
  'background cpu(s)': 'backgroundCpuPerSecond',
  'background cpu (s)': 'backgroundCpuPerSecond',
  'background cpu': 'backgroundCpuPerSecond',
  'redo size': 'redoSizePerSecond',
  'redo size (bytes)': 'redoSizePerSecond',
  'logical reads': 'logicalReadsPerSecond',
  'logical read (blocks)': 'logicalReadsPerSecond',
  'block changes': 'blockChangesPerSecond',
  'block changes (blocks)': 'blockChangesPerSecond',
  'physical reads': 'physicalReadsPerSecond',
  'physical read (blocks)': 'physicalReadsPerSecond',
  'physical writes': 'physicalWritesPerSecond',
  'physical write (blocks)': 'physicalWritesPerSecond',
  'user calls': 'userCallsPerSecond',
  'parses': 'parsesPerSecond',
  'parses (sql)': 'parsesPerSecond',
  'hard parses': 'hardParsesPerSecond',
  'hard parses (sql)': 'hardParsesPerSecond',
  'executes': 'executesPerSecond',
  'executes (sql)': 'executesPerSecond',
  'w/a mb processed': 'waMbProcessedPerSecond',
  'sql work area (mb)': 'waMbProcessedPerSecond',
  'logons': 'logonsPerSecond',
  'user logons': 'logonsPerSecond',
  'rollbacks': 'rollbacksPerSecond',
  'transactions': 'transactionsPerSecond',
};

// ==================== Load Profile Parser Class ====================

/**
 * Parser for AWR report Load Profile section.
 *
 * Extracts database activity metrics showing per-second and per-transaction
 * rates for key database operations and resources.
 *
 * @example
 * const parser = new LoadProfileParser();
 * const loadProfile = parser.parse(awrHtml);
 * console.log(loadProfile?.transactionsPerSecond);
 */
export class LoadProfileParser extends BaseSectionParser<LoadProfile> {
  constructor(options: ParserOptions = {}) {
    super(options);
  }

  /**
   * Get the section name for logging
   */
  getSectionName(): string {
    return 'Load Profile';
  }

  /**
   * Parse the AWR report Load Profile section
   *
   * @param html - Full AWR report HTML
   * @returns Parsed load profile data or null if not found
   */
  parse(html: string): LoadProfile | null {
    const $ = this.loadDocument(html);

    this.debug('Starting Load Profile parse');

    // Try to find the Load Profile table
    const table = this.findLoadProfileTable($);

    if (!table) {
      this.debug('Load Profile table not found');
      return null;
    }

    // Parse the table
    const loadProfile = this.parseLoadProfileTable($, table);

    if (!loadProfile) {
      this.debug('Failed to parse Load Profile table');
      return null;
    }

    this.debug('Load Profile parse complete', {
      metricsCount: loadProfile.metrics?.length ?? 0,
      transactionsPerSec: loadProfile.transactionsPerSecond,
    });

    return loadProfile;
  }

  /**
   * Validate the parsed load profile data
   */
  protected validate(data: LoadProfile): boolean {
    // Consider valid if we have at least some metrics or the transactions metric
    const hasMetrics = data.metrics && data.metrics.length > 0;
    const hasKeyMetric = data.transactionsPerSecond !== undefined;

    return hasMetrics || hasKeyMetric;
  }

  // ==================== Table Finding Methods ====================

  /**
   * Find the Load Profile table in the AWR HTML
   */
  private findLoadProfileTable($: CheerioAPI): Cheerio<Element> | null {
    // Method 1: Find by table identifier
    for (const identifier of TABLE_IDENTIFIERS) {
      const table = findTableByIdentifier($, identifier);
      if (table && this.isLoadProfileTable($, table)) {
        return table;
      }
    }

    // Method 2: Find table after section heading
    for (const heading of SECTION_HEADINGS) {
      const tables = getTablesInSection($, heading);
      if (tables.length > 0 && tables[0]) {
        return tables[0];
      }
    }

    // Method 3: Search for table with expected columns
    const allTables = $('table');
    for (let i = 0; i < allTables.length; i++) {
      const table = $(allTables[i]);
      if (this.isLoadProfileTable($, table)) {
        return table;
      }
    }

    return null;
  }

  /**
   * Check if a table appears to be a Load Profile table
   */
  private isLoadProfileTable($: CheerioAPI, table: Cheerio<Element>): boolean {
    const rows = parseTableToArray($, table, { maxRows: 3 });

    if (rows.length < 2) {
      return false;
    }

    // Check headers or first row for expected columns
    const headerRow = rows[0]?.map((cell) => cell.toLowerCase()) ?? [];
    const hasPerSecond = headerRow.some((cell) =>
      cell.includes('per second') || cell.includes('/second') || cell.includes('per sec'),
    );
    const hasPerTrans = headerRow.some((cell) =>
      cell.includes('per trans') || cell.includes('/trans') || cell.includes('per txn'),
    );

    // Also check if rows contain expected metric names
    const allText = rows.flat().join(' ').toLowerCase();
    const hasMetricNames =
      allText.includes('redo size') ||
      allText.includes('logical read') ||
      allText.includes('user call') ||
      allText.includes('transaction') ||
      allText.includes('db time');

    return (hasPerSecond || hasPerTrans) || hasMetricNames;
  }

  // ==================== Table Parsing Methods ====================

  /**
   * Parse the Load Profile table into structured data
   */
  private parseLoadProfileTable(
    $: CheerioAPI,
    table: Cheerio<Element>,
  ): LoadProfile | null {
    const rows = parseTableToArray($, table);

    if (rows.length < 2) {
      return null;
    }

    // Determine column indices
    const firstRow = rows[0];
    if (!firstRow) {
      return null;
    }
    const columnIndices = this.detectColumnIndices(firstRow);

    if (!columnIndices) {
      return null;
    }

    // Parse data rows
    const metrics: LoadProfileMetric[] = [];
    const loadProfile: LoadProfile = { metrics };

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const metric = this.parseMetricRow(row, columnIndices);

      if (metric) {
        metrics.push(metric);
        this.applyMetricToProfile(loadProfile, metric);
      }
    }

    return loadProfile;
  }

  /**
   * Detect the column indices for name, per-second, and per-transaction values
   */
  private detectColumnIndices(
    headerRow: string[],
  ): { name: number; perSecond: number; perTransaction: number } | null {
    let nameIdx = -1;
    let perSecondIdx = -1;
    let perTransIdx = -1;

    for (let i = 0; i < headerRow.length; i++) {
      const cell = headerRow[i]?.toLowerCase();
      if (!cell) continue;

      if (
        cell.includes('per second') ||
        cell.includes('/second') ||
        cell.includes('per sec')
      ) {
        perSecondIdx = i;
      } else if (
        cell.includes('per trans') ||
        cell.includes('/trans') ||
        cell.includes('per txn')
      ) {
        perTransIdx = i;
      } else if (
        nameIdx === -1 &&
        !cell.includes('per ')
      ) {
        // First non-"per" column is likely the name
        nameIdx = i;
      }
    }

    // Default layout if headers not detected: name=0, perSecond=1, perTransaction=2
    if (nameIdx === -1) {
      nameIdx = 0;
    }
    if (perSecondIdx === -1) {
      perSecondIdx = 1;
    }
    if (perTransIdx === -1) {
      perTransIdx = 2;
    }

    return { name: nameIdx, perSecond: perSecondIdx, perTransaction: perTransIdx };
  }

  /**
   * Parse a single metric row
   */
  private parseMetricRow(
    row: string[],
    indices: { name: number; perSecond: number; perTransaction: number },
  ): LoadProfileMetric | null {
    const name = row[indices.name]?.trim();

    if (!name || this.isHeaderRow(name)) {
      return null;
    }

    const perSecondStr = row[indices.perSecond];
    const perTransStr = row[indices.perTransaction];

    const perSecond = parseAwrNumber(perSecondStr);
    const perTransaction = parseAwrNumber(perTransStr);

    // Skip if both values are missing
    if (isNaN(perSecond) && isNaN(perTransaction)) {
      return null;
    }

    return {
      name,
      perSecond: isNaN(perSecond) ? 0 : perSecond,
      perTransaction: isNaN(perTransaction) ? 0 : perTransaction,
      unit: this.detectUnit(name),
    };
  }

  /**
   * Check if a row appears to be a header row
   */
  private isHeaderRow(name: string): boolean {
    const lower = name.toLowerCase();
    return (
      lower.includes('per second') ||
      lower.includes('per trans') ||
      lower === '' ||
      lower === 'statistic'
    );
  }

  /**
   * Detect the unit for a metric based on its name
   */
  private detectUnit(name: string): string | undefined {
    const lower = name.toLowerCase();

    if (lower.includes('(s)') || lower.includes('time')) {
      return 'seconds';
    }
    if (lower.includes('(bytes)') || lower.includes('redo size')) {
      return 'bytes';
    }
    if (lower.includes('(blocks)') || lower.includes('read') || lower.includes('write')) {
      return 'blocks';
    }
    if (lower.includes('mb')) {
      return 'MB';
    }

    return undefined;
  }

  /**
   * Apply a parsed metric to the typed LoadProfile properties
   */
  private applyMetricToProfile(
    profile: LoadProfile,
    metric: LoadProfileMetric,
  ): void {
    // Strip trailing colon (AWR 19c uses "Parses (SQL):" with trailing colon)
    const normalizedName = metric.name.toLowerCase().trim().replace(/:$/, '');

    // Look for matching property
    const propertyName = METRIC_MAPPINGS[normalizedName];

    if (propertyName) {
      (profile as Record<string, number | undefined>)[propertyName] = metric.perSecond;
      return;
    }

    // Try partial matching for flexibility
    for (const [key, prop] of Object.entries(METRIC_MAPPINGS)) {
      if (normalizedName.includes(key) || key.includes(normalizedName)) {
        (profile as Record<string, number | undefined>)[prop] = metric.perSecond;
        return;
      }
    }
  }
}
