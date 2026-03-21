/**
 * SQL Parser for AWR Reports
 *
 * Extracts Top SQL statements with execution statistics from Oracle AWR HTML reports.
 * AWR reports contain multiple SQL sections ordered by different metrics:
 * - SQL ordered by Elapsed Time
 * - SQL ordered by CPU Time
 * - SQL ordered by Buffer Gets (Logical Reads)
 * - SQL ordered by Physical Reads (Disk Reads)
 * - SQL ordered by Executions
 * - SQL ordered by Parse Calls
 * - SQL ordered by Cluster Wait Time
 * - Complete List of SQL Text
 */

import type { CheerioAPI, Cheerio } from 'cheerio';
import type { Element } from 'domhandler';
import { BaseSectionParser, type ParserOptions } from '../base-parser';
import type { TopSql, SqlStatement } from '../../types/awr-data.types';
import {
  findTableByIdentifier,
  parseTableToArray,
  findSectionHeading,
  extractText,
} from '../../utils/html-utils';
import { parseAwrNumber, parsePercentage } from '../../utils/number-utils';
import { parseTimeToSeconds } from '../../utils/time-utils';

// ==================== Constants ====================

/** Section identifiers for different SQL ordering types */
const SQL_SECTION_IDENTIFIERS = {
  BY_ELAPSED_TIME: ['sql ordered by elapsed', 'elapsed time', 'top sql by elapsed'],
  BY_CPU_TIME: ['sql ordered by cpu', 'cpu time', 'top sql by cpu'],
  BY_BUFFER_GETS: ['sql ordered by gets', 'buffer gets', 'sql ordered by buffer'],
  BY_DISK_READS: ['sql ordered by reads', 'physical reads', 'disk reads'],
  BY_EXECUTIONS: ['sql ordered by executions', 'executions'],
  BY_PARSE_CALLS: ['sql ordered by parse', 'parse calls'],
  BY_CLUSTER_WAIT: ['sql ordered by cluster', 'cluster wait'],
  SQL_TEXT: ['complete list of sql text', 'sql text', 'sql statements'],
} as const;

/**
 * Column header mappings for SQL statement tables.
 *
 * IMPORTANT: More specific "per exec" entries MUST come before their generic
 * counterparts so that `detectColumnIndices` matches them first (it uses
 * the first-match-wins guard to avoid overwriting).
 */
const COLUMN_MAPPINGS: Record<string, keyof SqlStatement> = {
  'sql id': 'sqlId',
  'sqlid': 'sqlId',
  'sql_id': 'sqlId',
  // Per-exec variants BEFORE generic entries
  'elapsed time per exec': 'elapsedTimePerExec',
  'elapsed per exec': 'elapsedTimePerExec',
  'cpu time per exec': 'cpuTimePerExec',
  'cpu per exec': 'cpuTimePerExec',
  'buffer gets per exec': 'bufferGetsPerExec',
  'disk reads per exec': 'diskReadsPerExec',
  'rows processed per exec': 'rowsProcessedPerExec',
  // Generic entries
  'elapsed time': 'elapsedTime',
  'elapsed time (s)': 'elapsedTime',
  'elapsed(s)': 'elapsedTime',
  'cpu time': 'cpuTime',
  'cpu time (s)': 'cpuTime',
  'cpu(s)': 'cpuTime',
  'executions': 'executions',
  'execs': 'executions',
  'buffer gets': 'bufferGets',
  'gets': 'bufferGets',
  'logical reads': 'bufferGets',
  'disk reads': 'diskReads',
  'physical reads': 'diskReads',
  'reads': 'diskReads',
  'rows processed': 'rowsProcessed',
  'rows': 'rowsProcessed',
  'module': 'module',
  '% total': 'percentDbTime',
  '%total': 'percentDbTime',
  '% db time': 'percentDbTime',
  '% cpu': 'percentCpu',
  '%cpu': 'percentCpu',
  '% io': 'percentIo',
  '%io': 'percentIo',
  'plan hash value': 'planHashValue',
  'plan hash': 'planHashValue',
  'sql text': 'sqlText',
};

// ==================== SQL Parser Class ====================

/**
 * Parser for AWR report Top SQL sections.
 *
 * Extracts SQL statements from multiple sections of the AWR report,
 * organizing them by different performance metrics (elapsed time, CPU, I/O, etc.).
 *
 * @example
 * const parser = new SqlParser();
 * const topSql = parser.parse(awrHtml);
 * console.log(topSql?.byElapsedTime?.[0]?.sqlId);
 */
export class SqlParser extends BaseSectionParser<TopSql> {
  constructor(options: ParserOptions = {}) {
    super(options);
  }

  /**
   * Get the section name for logging
   */
  getSectionName(): string {
    return 'Top SQL';
  }

  /**
   * Parse Top SQL sections from AWR report
   *
   * @param html - Full AWR report HTML
   * @returns Parsed Top SQL data or null if not found
   */
  parse(html: string): TopSql | null {
    const $ = this.loadDocument(html);

    this.debug('Starting Top SQL parse');

    const topSql: TopSql = {};

    // Parse each SQL section
    topSql.byElapsedTime = this.parseSqlSection($, SQL_SECTION_IDENTIFIERS.BY_ELAPSED_TIME);
    topSql.byCpuTime = this.parseSqlSection($, SQL_SECTION_IDENTIFIERS.BY_CPU_TIME);
    topSql.byBufferGets = this.parseSqlSection($, SQL_SECTION_IDENTIFIERS.BY_BUFFER_GETS);
    topSql.byDiskReads = this.parseSqlSection($, SQL_SECTION_IDENTIFIERS.BY_DISK_READS);
    topSql.byExecutions = this.parseSqlSection($, SQL_SECTION_IDENTIFIERS.BY_EXECUTIONS);
    topSql.byParseCalls = this.parseSqlSection($, SQL_SECTION_IDENTIFIERS.BY_PARSE_CALLS);
    topSql.byClusterWait = this.parseSqlSection($, SQL_SECTION_IDENTIFIERS.BY_CLUSTER_WAIT);

    // Parse SQL text section and build lookup map
    topSql.sqlTextById = this.parseSqlTextSection($);

    // Enrich SQL statements with full text if available
    this.enrichWithSqlText(topSql);

    // Add rankings
    this.addRankings(topSql);

    const totalStatements = this.countStatements(topSql);
    this.debug('Top SQL parse complete', {
      byElapsedTime: topSql.byElapsedTime?.length ?? 0,
      byCpuTime: topSql.byCpuTime?.length ?? 0,
      byBufferGets: topSql.byBufferGets?.length ?? 0,
      totalStatements,
    });

    // Return null if no SQL sections found
    if (totalStatements === 0) {
      return null;
    }

    return topSql;
  }

  /**
   * Validate the parsed Top SQL data
   */
  protected validate(data: TopSql): boolean {
    return this.countStatements(data) > 0;
  }

  // ==================== Section Parsing Methods ====================

  /**
   * Parse a SQL section using multiple identifier variations
   */
  private parseSqlSection(
    $: CheerioAPI,
    identifiers: readonly string[],
  ): SqlStatement[] | undefined {
    for (const identifier of identifiers) {
      const table = this.findSqlTable($, identifier);
      if (table) {
        const statements = this.parseSqlTable($, table);
        if (statements.length > 0) {
          return statements;
        }
      }
    }
    return undefined;
  }

  /**
   * Find a SQL table by identifier
   */
  private findSqlTable($: CheerioAPI, identifier: string): Cheerio<Element> | null {
    // Try finding by table summary/caption
    const table = findTableByIdentifier($, identifier);
    if (table && table.length > 0) {
      return table;
    }

    // Try finding table after section heading
    const heading = findSectionHeading($, identifier);
    if (heading) {
      return this.findNextTable($, heading);
    }

    return null;
  }

  /**
   * Find the next table element after a heading
   */
  private findNextTable(_$: CheerioAPI, heading: Cheerio<Element>): Cheerio<Element> | null {
    let current = heading.next();

    while (current.length > 0) {
      if (current.is('table')) {
        return current;
      }
      // Check for table inside container
      const nestedTable = current.find('table').first();
      if (nestedTable.length > 0) {
        return nestedTable;
      }
      // Stop at next heading
      if (current.is('h1, h2, h3, h4, h5, h6')) {
        break;
      }
      current = current.next();
    }

    return null;
  }

  // ==================== Table Parsing Methods ====================

  /**
   * Parse a SQL statements table
   */
  private parseSqlTable($: CheerioAPI, table: Cheerio<Element>): SqlStatement[] {
    const rows = parseTableToArray($, table);

    if (rows.length < 2) {
      return [];
    }

    // Detect column indices from header row
    const firstRow = rows[0];
    if (!firstRow) {
      return [];
    }
    const columnIndices = this.detectColumnIndices(firstRow);

    if (columnIndices.sqlId === undefined) {
      return [];
    }

    // Parse data rows
    const statements: SqlStatement[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const statement = this.parseStatementRow(row, columnIndices);

      if (statement && statement.sqlId) {
        statements.push(statement);
      }
    }

    return statements;
  }

  /**
   * Detect column indices from header row.
   *
   * Uses a first-match-wins guard: once a property is mapped to a column index,
   * it is NOT overwritten by later, more generic matches. This is critical
   * because COLUMN_MAPPINGS lists specific entries (e.g. "elapsed time per exec")
   * before generic ones (e.g. "elapsed time"), so a header like
   * "Elapsed Time per Exec (s)" correctly maps to `elapsedTimePerExec` and
   * does NOT overwrite the `elapsedTime` mapping from an earlier column.
   */
  private detectColumnIndices(headerRow: string[]): Record<string, number> {
    const indices: Record<string, number> = {};

    for (let i = 0; i < headerRow.length; i++) {
      const header = headerRow[i]?.toLowerCase().trim();
      if (!header) continue;

      for (const [key, property] of Object.entries(COLUMN_MAPPINGS)) {
        if (header.includes(key)) {
          // Don't overwrite an already-set property index
          if (indices[property] === undefined) {
            indices[property] = i;
          }
          break;
        }
      }
    }

    return indices;
  }

  /**
   * Parse a single SQL statement row
   */
  private parseStatementRow(
    row: string[],
    indices: Record<string, number>,
  ): SqlStatement | null {
    const getValue = (property: string): string | undefined => {
      const idx = indices[property];
      return idx !== undefined ? row[idx]?.trim() : undefined;
    };

    const sqlId = getValue('sqlId');

    if (!sqlId || this.isHeaderValue(sqlId)) {
      return null;
    }

    return {
      sqlId,
      sqlText: getValue('sqlText'),
      planHashValue: this.parseOptionalNumber(getValue('planHashValue')),
      module: getValue('module'),
      executions: this.parseOptionalNumber(getValue('executions')),
      elapsedTime: this.parseTimeValue(getValue('elapsedTime')),
      elapsedTimePerExec: this.parseTimeValue(getValue('elapsedTimePerExec')),
      cpuTime: this.parseTimeValue(getValue('cpuTime')),
      cpuTimePerExec: this.parseTimeValue(getValue('cpuTimePerExec')),
      bufferGets: this.parseOptionalNumber(getValue('bufferGets')),
      bufferGetsPerExec: this.parseOptionalNumber(getValue('bufferGetsPerExec')),
      diskReads: this.parseOptionalNumber(getValue('diskReads')),
      diskReadsPerExec: this.parseOptionalNumber(getValue('diskReadsPerExec')),
      rowsProcessed: this.parseOptionalNumber(getValue('rowsProcessed')),
      rowsProcessedPerExec: this.parseOptionalNumber(getValue('rowsProcessedPerExec')),
      percentDbTime: this.parsePercentValue(getValue('percentDbTime')),
      percentCpu: this.parsePercentValue(getValue('percentCpu')),
      percentIo: this.parsePercentValue(getValue('percentIo')),
    };
  }

  /**
   * Check if a value appears to be a header rather than data
   */
  private isHeaderValue(value: string): boolean {
    const lower = value.toLowerCase().trim();
    return (
      lower.includes('sql id') ||
      lower === 'elapsed time' ||
      lower === 'elapsed time (s)' ||
      lower === '' ||
      lower === '-'
    );
  }

  // ==================== SQL Text Parsing ====================

  /**
   * Parse the SQL Text section to build a lookup map
   */
  private parseSqlTextSection($: CheerioAPI): Record<string, string> | undefined {
    const sqlTextById: Record<string, string> = {};

    // Find SQL text section
    for (const identifier of SQL_SECTION_IDENTIFIERS.SQL_TEXT) {
      const table = this.findSqlTable($, identifier);
      if (table) {
        this.extractSqlTextFromTable($, table, sqlTextById);
      }
    }

    // Also try to find SQL text in other formats (div-based)
    this.extractSqlTextFromDivs($, sqlTextById);

    return Object.keys(sqlTextById).length > 0 ? sqlTextById : undefined;
  }

  /**
   * Extract SQL text from a table format
   */
  private extractSqlTextFromTable(
    $: CheerioAPI,
    table: Cheerio<Element>,
    sqlTextById: Record<string, string>,
  ): void {
    const rows = parseTableToArray($, table);

    if (rows.length < 2) {
      return;
    }

    // Find SQL ID and SQL Text column indices
    const firstRow = rows[0];
    if (!firstRow) return;
    const headerRow = firstRow.map((h) => h.toLowerCase());
    let sqlIdIdx = -1;
    let sqlTextIdx = -1;

    for (let i = 0; i < headerRow.length; i++) {
      const header = headerRow[i];
      if (!header) continue;
      if (header.includes('sql id') || header === 'sqlid') {
        sqlIdIdx = i;
      } else if (header.includes('sql text') || header === 'text') {
        sqlTextIdx = i;
      }
    }

    // Default layout: SQL ID in first column, text in second
    if (sqlIdIdx === -1) {
      sqlIdIdx = 0;
    }
    if (sqlTextIdx === -1) {
      sqlTextIdx = 1;
    }

    // Extract text for each SQL ID
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const sqlId = row[sqlIdIdx]?.trim();
      const sqlText = row[sqlTextIdx]?.trim();

      if (sqlId && sqlText && !this.isHeaderValue(sqlId)) {
        sqlTextById[sqlId] = sqlText;
      }
    }
  }

  /**
   * Extract SQL text from div-based formats (alternate AWR layout)
   */
  private extractSqlTextFromDivs(
    $: CheerioAPI,
    sqlTextById: Record<string, string>,
  ): void {
    // Look for patterns like "SQL ID: xyz ... SQL Text: ..."
    $('pre, code, .sql-text').each((_idx: number, elem: Element) => {
      const text = extractText($(elem));
      const sqlIdMatch = text.match(/sql\s*id[:\s]+([a-z0-9]+)/i);

      if (sqlIdMatch) {
        const sqlId = sqlIdMatch[1];
        if (!sqlId) return;
        // Extract the SQL text following the ID
        const textMatch = text.match(/sql\s*text[:\s]+(.+)/is);
        const sqlText = textMatch?.[1];
        if (sqlText && !sqlTextById[sqlId]) {
          sqlTextById[sqlId] = sqlText.trim();
        }
      }
    });
  }

  // ==================== Data Enrichment Methods ====================

  /**
   * Enrich SQL statements with full SQL text from lookup map
   */
  private enrichWithSqlText(topSql: TopSql): void {
    if (!topSql.sqlTextById) {
      return;
    }

    const enrichStatements = (statements: SqlStatement[] | undefined): void => {
      if (!statements) {
        return;
      }
      for (const stmt of statements) {
        if (!stmt.fullSqlText && topSql.sqlTextById?.[stmt.sqlId]) {
          stmt.fullSqlText = topSql.sqlTextById[stmt.sqlId];
        }
      }
    };

    enrichStatements(topSql.byElapsedTime);
    enrichStatements(topSql.byCpuTime);
    enrichStatements(topSql.byBufferGets);
    enrichStatements(topSql.byDiskReads);
    enrichStatements(topSql.byExecutions);
    enrichStatements(topSql.byParseCalls);
    enrichStatements(topSql.byClusterWait);
  }

  /**
   * Add ranking positions to SQL statements
   */
  private addRankings(topSql: TopSql): void {
    this.addRankToStatements(topSql.byElapsedTime, 'rankByElapsedTime');
    this.addRankToStatements(topSql.byCpuTime, 'rankByCpuTime');
    this.addRankToStatements(topSql.byBufferGets, 'rankByBufferGets');
    this.addRankToStatements(topSql.byDiskReads, 'rankByDiskReads');
  }

  /**
   * Add rank property to an array of statements
   */
  private addRankToStatements(
    statements: SqlStatement[] | undefined,
    rankProperty: keyof SqlStatement,
  ): void {
    if (!statements) {
      return;
    }
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement) {
        (statement as unknown as Record<string, unknown>)[rankProperty] = i + 1;
      }
    }
  }

  // ==================== Helper Methods ====================

  /**
   * Parse optional number value
   */
  private parseOptionalNumber(value: string | undefined): number | undefined {
    if (!value) {
      return undefined;
    }
    const parsed = parseAwrNumber(value);
    return isNaN(parsed) ? undefined : parsed;
  }

  /**
   * Parse time value to seconds
   */
  private parseTimeValue(value: string | undefined): number | undefined {
    if (!value) {
      return undefined;
    }
    const parsed = parseTimeToSeconds(value);
    return parsed === 0 && !value.includes('0') ? undefined : parsed;
  }

  /**
   * Parse percentage value
   */
  private parsePercentValue(value: string | undefined): number | undefined {
    if (!value) {
      return undefined;
    }
    const parsed = parsePercentage(value);
    return isNaN(parsed) ? undefined : parsed;
  }

  /**
   * Count total SQL statements across all sections
   */
  private countStatements(topSql: TopSql): number {
    return (
      (topSql.byElapsedTime?.length ?? 0) +
      (topSql.byCpuTime?.length ?? 0) +
      (topSql.byBufferGets?.length ?? 0) +
      (topSql.byDiskReads?.length ?? 0) +
      (topSql.byExecutions?.length ?? 0) +
      (topSql.byParseCalls?.length ?? 0) +
      (topSql.byClusterWait?.length ?? 0)
    );
  }
}
