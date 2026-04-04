/**
 * SQL Text Parser
 *
 * Parses the "Complete List of SQL Text" section from AWR reports.
 * This section contains full SQL statements (not truncated) keyed by SQL ID.
 *
 * AWR reports have two sources of SQL text:
 * 1. Summary tables (Top SQL, etc.) - Truncated to ~30-50 chars
 * 2. "Complete List of SQL Text" - Full statements
 *
 * This parser extracts full SQL text for later enrichment of insights.
 */

import type { CheerioAPI, Cheerio } from 'cheerio';
import type { Element } from 'domhandler';
import { findTableByIdentifier, findSectionHeading, parseTableToArray } from '../../utils/html-utils';

/**
 * Map of SQL ID to full SQL text
 */
export interface SqlTextMap {
  [sqlId: string]: string;
}

/**
 * Parsed SQL text data
 */
export interface ParsedSqlTextData {
  /** Map of SQL ID to full SQL text */
  sqlTextMap: SqlTextMap;
  /** Number of SQL statements found */
  count: number;
}

// ==================== Table Identifiers ====================

const SQL_TEXT_IDENTIFIERS = [
  'complete list of sql text',
  'sql text',
  'complete sql text',
  'displays the text of the sql statements', // Actual table summary in AWR reports
  'text of the sql statements',
];

// ==================== Parsing Functions ====================

/**
 * Extract SQL ID and text from a table using parseTableToArray utility
 *
 * This follows the same pattern as sql-parser.ts which successfully extracts
 * full SQL text from <pre_sqltext> tags.
 */
function extractSqlEntries($: CheerioAPI, table: Cheerio<Element>): SqlTextMap {
  const sqlMap: SqlTextMap = {};

  // Use the same utility function that sql-parser.ts uses successfully
  const rows = parseTableToArray($, table);

  if (rows.length < 2) {
    return sqlMap; // Need at least header + 1 data row
  }

  // Parse header row to find column indices
  const firstRow = rows[0];
  if (!firstRow) return sqlMap;

  const headerRow = firstRow.map((h) => h.toLowerCase());
  let sqlIdIdx = -1;
  let sqlTextIdx = -1;

  for (let i = 0; i < headerRow.length; i++) {
    const header = headerRow[i];
    if (!header) continue;

    if (header.includes('sql id') || header === 'sqlid') {
      sqlIdIdx = i;
    } else if (header.includes('sql text') || header.includes('text')) {
      sqlTextIdx = i;
    }
  }

  // Validate we found both columns
  if (sqlIdIdx === -1 || sqlTextIdx === -1) {
    return sqlMap;
  }

  // Extract SQL ID and text from data rows
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const sqlId = row[sqlIdIdx]?.trim();
    const sqlText = row[sqlTextIdx]?.trim();

    // Only add valid SQL entries (SQL ID should be 13 chars, SQL text should be substantial)
    if (sqlId && sqlText && sqlId.length === 13 && sqlText.length > 10) {
      sqlMap[sqlId] = sqlText;
    }
  }

  return sqlMap;
}

// ==================== Main Parser ====================

/**
 * Parse SQL text section from AWR report
 *
 * Extracts full SQL statements and builds a map of SQL ID to SQL text
 * for enriching insights with complete SQL text.
 */
export function parseSqlText($: CheerioAPI): ParsedSqlTextData {
  const sqlMap: SqlTextMap = {};

  // Try to find the SQL Text section by table identifier
  for (const identifier of SQL_TEXT_IDENTIFIERS) {
    const table = findTableByIdentifier($, identifier);
    if (table && table.length > 0) {
      const extracted = extractSqlEntries($, table);
      Object.assign(sqlMap, extracted);

      if (Object.keys(sqlMap).length > 0) {
        break; // Found SQL text, stop searching
      }
    }
  }

  // If no table found, try finding by section heading and then look for a table
  if (Object.keys(sqlMap).length === 0) {
    for (const identifier of SQL_TEXT_IDENTIFIERS) {
      const section = findSectionHeading($, identifier);
      if (section && section.length > 0) {
        // Look for a table after the section heading
        const table = section.nextAll('table').first();
        if (table && table.length > 0) {
          const extracted = extractSqlEntries($, table);
          if (Object.keys(extracted).length > 0) {
            Object.assign(sqlMap, extracted);
            break;
          }
        }
      }
    }
  }

  return {
    sqlTextMap: sqlMap,
    count: Object.keys(sqlMap).length,
  };
}
