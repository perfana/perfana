/**
 * ASH SQL Parser
 *
 * Parses ASH (Active Session History) based SQL sections from AWR reports:
 * - Top SQL with Top Events
 * - Top SQL with Top Row Sources
 *
 * These sections provide critical insights into:
 * - Row source operations (TABLE ACCESS FULL, INDEX SCAN, HASH JOIN, etc.)
 * - Wait events at the row source level
 * - Execution plan inefficiencies
 */

import type { CheerioAPI, Cheerio } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { parsePercentage } from '../../utils/number-utils';
import { findTableByIdentifier } from '../../utils/html-utils';

/**
 * Clean and trim text content
 */
function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Parse number from text
 */
function parseNumber(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/,/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? undefined : num;
}

/**
 * Top SQL with Top Events entry
 */
export interface TopSqlWithEvent {
  /** SQL ID */
  sqlId: string;
  /** Plan hash value */
  planHashValue?: number;
  /** Number of executions sampled */
  executions?: number;
  /** Percentage of DB time (% Activity) */
  percentActivity?: number;
  /** Top wait event */
  event?: string;
  /** Percentage of DB time for the event */
  percentEvent?: number;
  /** Top row source operation */
  topRowSource?: string;
  /** Percentage of DB time for row source */
  percentRowSource?: number;
  /** SQL text (truncated) */
  sqlText?: string;
  /** Container name (for CDB/PDB) */
  containerName?: string;
}

/**
 * Top SQL with Top Row Sources entry
 */
export interface TopSqlWithRowSource {
  /** SQL ID */
  sqlId: string;
  /** Plan hash value */
  planHashValue?: number;
  /** Number of executions sampled */
  executions?: number;
  /** Percentage of DB time (% Activity) */
  percentActivity?: number;
  /** Row source operation */
  rowSource?: string;
  /** Percentage of DB time for row source */
  percentRowSource?: number;
  /** Top event for this row source */
  topEvent?: string;
  /** Percentage of DB time for event */
  percentEvent?: number;
  /** SQL text (truncated) */
  sqlText?: string;
  /** Container name (for CDB/PDB) */
  containerName?: string;
}

/**
 * Parsed ASH SQL data
 */
export interface ParsedAshSqlData {
  /** Top SQL with Top Events */
  topSqlWithEvents?: TopSqlWithEvent[];
  /** Top SQL with Top Row Sources */
  topSqlWithRowSources?: TopSqlWithRowSource[];
}

// ==================== Table Identifiers ====================

const TOP_SQL_WITH_EVENTS_IDENTIFIERS = [
  'top sql by top wait events',
  'top sql with top events',
  'top sql statements by db time along with the top events',
];

const TOP_SQL_WITH_ROW_SOURCES_IDENTIFIERS = [
  'top sqls with top row sources', // Note: Oracle has a typo - "display" not "displays"
  'top sql with top row sources',
  'top sql statements by db time along with the top row sources',
];

// ==================== Parsing Functions ====================

/**
 * Parse Top SQL with Top Events table
 */
function parseTopSqlWithEvents(
  $: CheerioAPI,
  table: Cheerio<Element>,
): TopSqlWithEvent[] {
  const results: TopSqlWithEvent[] = [];
  const rows = table.find('tr');

  // Find header row to determine column indices
  let headerRow: AnyNode | null = null;
  rows.each((_i, row) => {
    const cells = $(row).find('th');
    if (cells.length > 0) {
      headerRow = row;
      return false; // Break
    }
    return undefined;
  });

  if (!headerRow) return results;

  // Map column names to indices
  const headers: string[] = [];
  $(headerRow).find('th').each((_i, cell) => {
    headers.push(cleanText($(cell).text()).toLowerCase());
  });

  const sqlIdIdx = headers.findIndex(h => h.includes('sql id'));
  const planHashIdx = headers.findIndex(h => h.includes('plan hash'));
  const executionsIdx = headers.findIndex(h => h.includes('executions'));
  const activityIdx = headers.findIndex(h => h.includes('% activity'));
  const eventIdx = headers.findIndex(h => h.includes('event') && !h.includes('%'));
  const percentEventIdx = headers.findIndex(h => h.includes('% event'));
  const rowSourceIdx = headers.findIndex(h => h.includes('row source') && !h.includes('%'));
  const percentRowSourceIdx = headers.findIndex(h => h.includes('% row source'));
  const sqlTextIdx = headers.findIndex(h => h.includes('sql text'));
  const containerIdx = headers.findIndex(h => h.includes('container'));

  // Parse data rows
  rows.each((_i, row) => {
    const cells = $(row).find('td');
    if (cells.length === 0) return; // Skip non-data rows

    const sqlId = cleanText($(cells[sqlIdIdx])?.text() || '');
    if (!sqlId) return; // Skip rows without SQL ID

    const entry: TopSqlWithEvent = {
      sqlId,
      planHashValue: parseNumber($(cells[planHashIdx])?.text()),
      executions: parseNumber($(cells[executionsIdx])?.text()),
      percentActivity: parsePercentage($(cells[activityIdx])?.text()),
      event: cleanText($(cells[eventIdx])?.text() || ''),
      percentEvent: parsePercentage($(cells[percentEventIdx])?.text()),
      topRowSource: cleanText($(cells[rowSourceIdx])?.text() || ''),
      percentRowSource: parsePercentage($(cells[percentRowSourceIdx])?.text()),
      sqlText: cleanText($(cells[sqlTextIdx])?.text() || ''),
      containerName: cleanText($(cells[containerIdx])?.text() || ''),
    };

    results.push(entry);
  });

  return results;
}

/**
 * Parse Top SQL with Top Row Sources table
 */
function parseTopSqlWithRowSources(
  $: CheerioAPI,
  table: Cheerio<Element>,
): TopSqlWithRowSource[] {
  const results: TopSqlWithRowSource[] = [];
  const rows = table.find('tr');

  // Find header row
  let headerRow: AnyNode | null = null;
  rows.each((_i, row) => {
    const cells = $(row).find('th');
    if (cells.length > 0) {
      headerRow = row;
      return false;
    }
    return undefined;
  });

  if (!headerRow) return results;

  // Map column names to indices
  const headers: string[] = [];
  $(headerRow).find('th').each((_i, cell) => {
    headers.push(cleanText($(cell).text()).toLowerCase());
  });

  const sqlIdIdx = headers.findIndex(h => h.includes('sql id'));
  const planHashIdx = headers.findIndex(h => h.includes('plan hash'));
  const executionsIdx = headers.findIndex(h => h.includes('executions'));
  const activityIdx = headers.findIndex(h => h.includes('% activity'));
  const rowSourceIdx = headers.findIndex(h => h.includes('row source') && !h.includes('%') && !h.includes('top'));
  const percentRowSourceIdx = headers.findIndex(h => h.includes('% row source'));
  const eventIdx = headers.findIndex(h => h.includes('event') && !h.includes('%'));
  const percentEventIdx = headers.findIndex(h => h.includes('% event'));
  const sqlTextIdx = headers.findIndex(h => h.includes('sql text'));
  const containerIdx = headers.findIndex(h => h.includes('container'));

  // Parse data rows
  rows.each((_i, row) => {
    const cells = $(row).find('td');
    if (cells.length === 0) return;

    const sqlId = cleanText($(cells[sqlIdIdx])?.text() || '');
    if (!sqlId) return;

    const entry: TopSqlWithRowSource = {
      sqlId,
      planHashValue: parseNumber($(cells[planHashIdx])?.text()),
      executions: parseNumber($(cells[executionsIdx])?.text()),
      percentActivity: parsePercentage($(cells[activityIdx])?.text()),
      rowSource: cleanText($(cells[rowSourceIdx])?.text() || ''),
      percentRowSource: parsePercentage($(cells[percentRowSourceIdx])?.text()),
      topEvent: cleanText($(cells[eventIdx])?.text() || ''),
      percentEvent: parsePercentage($(cells[percentEventIdx])?.text()),
      sqlText: cleanText($(cells[sqlTextIdx])?.text() || ''),
      containerName: cleanText($(cells[containerIdx])?.text() || ''),
    };

    results.push(entry);
  });

  return results;
}

// ==================== Main Parser ====================

/**
 * Parse ASH SQL sections from AWR report
 */
export function parseAshSql($: CheerioAPI): ParsedAshSqlData {
  const result: ParsedAshSqlData = {};

  // Parse Top SQL with Top Events
  for (const identifier of TOP_SQL_WITH_EVENTS_IDENTIFIERS) {
    const table = findTableByIdentifier($, identifier);
    if (table && table.length > 0) {
      result.topSqlWithEvents = parseTopSqlWithEvents($, table);
      break;
    }
  }

  // Parse Top SQL with Top Row Sources
  for (const identifier of TOP_SQL_WITH_ROW_SOURCES_IDENTIFIERS) {
    const table = findTableByIdentifier($, identifier);
    if (table && table.length > 0) {
      result.topSqlWithRowSources = parseTopSqlWithRowSources($, table);
      break;
    }
  }

  return result;
}
