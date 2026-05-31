/**
 * HTML Parsing Utilities for AWR Reports
 *
 * Utility functions for parsing HTML content from Oracle AWR reports using Cheerio.
 * These helpers extract text, tables, and specific elements from AWR HTML structure.
 *
 * @requires cheerio - npm install cheerio
 */

import * as cheerio from 'cheerio';
import type { CheerioAPI, Cheerio } from 'cheerio';
import type { Element, AnyNode } from 'domhandler';

// ==================== Types ====================

/**
 * Options for table parsing
 */
export interface TableParseOptions {
  /** Use first row as headers (default: true) */
  hasHeaders?: boolean;
  /** Trim whitespace from cells (default: true) */
  trimCells?: boolean;
  /** Skip empty rows (default: true) */
  skipEmptyRows?: boolean;
  /** Maximum rows to parse (default: unlimited) */
  maxRows?: number;
}

// ==================== Core Functions ====================

/**
 * Load HTML content into a Cheerio instance for parsing
 *
 * @param html - Raw HTML string to parse
 * @returns CheerioAPI instance for querying
 */
export function loadHtml(html: string): CheerioAPI {
  return cheerio.load(html, {
    xml: false,
  });
}

/**
 * Extract clean text content from an element, removing extra whitespace
 *
 * @param $element - Cheerio element selection
 * @returns Cleaned text string
 */
export function extractText($element: Cheerio<Element>): string {
  if (!$element || $element.length === 0) {
    return '';
  }
  return $element.text().replace(/\s+/g, ' ').trim();
}

/**
 * Find a table by its summary attribute or caption text
 *
 * @param $ - CheerioAPI instance
 * @param identifier - Table summary attribute or caption text to match
 * @returns Table element or null if not found
 */
export function findTableByIdentifier(
  $: CheerioAPI,
  identifier: string,
): Cheerio<Element> | null {
  const lowerIdentifier = identifier.toLowerCase();

  // Try finding by summary attribute (case-insensitive)
  const tables = $('table[summary]');
  for (let i = 0; i < tables.length; i++) {
    const table = $(tables[i]);
    const summary = table.attr('summary') || '';
    if (summary.toLowerCase().includes(lowerIdentifier)) {
      return table;
    }
  }

  // Try finding by caption text
  const captions = $('table caption');
  for (let i = 0; i < captions.length; i++) {
    const caption = $(captions[i]);
    if (caption.text().toLowerCase().includes(lowerIdentifier)) {
      return caption.closest('table') as Cheerio<Element>;
    }
  }

  return null;
}

/**
 * Find a section by its heading text
 *
 * Searches for headings (h1-h6) first, then falls back to searching all elements
 * for text content. This handles AWR reports that use both heading tags and plain text.
 *
 * @param $ - CheerioAPI instance
 * @param headingText - Text to search for in headings
 * @param headingLevel - Optional heading level (h1-h6)
 * @returns First matching heading element or null
 */
export function findSectionHeading(
  $: CheerioAPI,
  headingText: string,
  headingLevel?: number,
): Cheerio<Element> | null {
  const selector = headingLevel ? `h${headingLevel}` : 'h1, h2, h3, h4, h5, h6';
  const headings = $(selector);

  // First try to find in heading tags
  for (let i = 0; i < headings.length; i++) {
    const heading = $(headings[i]);
    if (heading.text().toLowerCase().includes(headingText.toLowerCase())) {
      return heading as Cheerio<Element>;
    }
  }

  // Fallback: Search for text content in common AWR report containers
  // Oracle AWR reports often use plain text followed by <p /> tags
  const bodyText = $('body').html() || '';
  const searchText = headingText.toLowerCase();

  if (bodyText.toLowerCase().includes(searchText)) {
    // Find all elements and check their direct text content
    const candidates = $('body').find('*').filter(function(this: AnyNode) {
      const elem = $(this as Element);
      // Get only direct text nodes, not nested text
      const directText = elem.contents().filter(function(this: AnyNode) {
        return this.type === 'text';
      }).text().trim();

      return directText.toLowerCase().includes(searchText);
    });

    if (candidates.length > 0) {
      return candidates.first() as Cheerio<Element>;
    }
  }

  return null;
}

// ==================== Table Parsing ====================

/**
 * Parse a table row into an array of cell values
 *
 * @param $ - CheerioAPI instance
 * @param row - Table row element
 * @param trim - Whether to trim whitespace (default: true)
 * @returns Array of cell values
 */
function parseTableRowToArray(
  $: CheerioAPI,
  row: Cheerio<Element>,
  trim: boolean = true,
): string[] {
  const values: string[] = [];
  const cells = row.find('td, th');

  cells.each((_index: number, cell: Element) => {
    let text = $(cell).text();
    if (trim) {
      text = text.replace(/\s+/g, ' ').trim();
    }
    values.push(text);
  });

  return values;
}

/**
 * Parse an HTML table into a 2D array of strings
 *
 * @param $ - CheerioAPI instance
 * @param table - Table element to parse
 * @param options - Parsing options
 * @returns 2D array of cell values
 */
export function parseTableToArray(
  $: CheerioAPI,
  table: Cheerio<Element>,
  options: TableParseOptions = {},
): string[][] {
  const { trimCells = true, skipEmptyRows = true, maxRows } = options;

  const rows = table.find('tr');
  const result: string[][] = [];

  for (let i = 0; i < rows.length; i++) {
    if (maxRows !== undefined && result.length >= maxRows) {
      break;
    }

    const row = $(rows[i]);
    const values = parseTableRowToArray($, row, trimCells);

    if (skipEmptyRows && values.every((v) => v === '')) {
      continue;
    }

    result.push(values);
  }

  return result;
}

// ==================== AWR-Specific Helpers ====================

/**
 * Extract a value from a labeled cell in AWR format
 * AWR often uses "Label: Value" or adjacent cells
 *
 * @param $ - CheerioAPI instance
 * @param labelText - Label text to search for
 * @returns Value string or null if not found
 */
export function extractLabeledValue(
  $: CheerioAPI,
  labelText: string,
): string | null {
  // Method 1: Look for "Label: Value" format
  const allText = $('body').text();
  const labelRegex = new RegExp(`${labelText}\\s*:\\s*([^\\n]+)`, 'i');
  const match = allText.match(labelRegex);
  if (match && match[1]) {
    return match[1].trim();
  }

  // Method 2: Look for adjacent cells in tables
  const cells = $('td, th');
  for (let i = 0; i < cells.length - 1; i++) {
    const cell = $(cells[i]);
    const cellText = extractText(cell);
    if (cellText.toLowerCase().includes(labelText.toLowerCase())) {
      const nextCell = $(cells[i + 1]);
      return extractText(nextCell);
    }
  }

  return null;
}

/**
 * Extract all tables from a section between two headings
 *
 * @param $ - CheerioAPI instance
 * @param startHeading - Starting heading text
 * @param endHeading - Optional ending heading text
 * @returns Array of table elements
 */
export function getTablesInSection(
  $: CheerioAPI,
  startHeading: string,
  endHeading?: string,
): Cheerio<Element>[] {
  const tables: Cheerio<Element>[] = [];
  const heading = findSectionHeading($, startHeading);

  if (!heading) {
    return tables;
  }

  let current = heading.next();

  while (current.length > 0) {
    // Stop at end heading if specified
    if (endHeading && current.is('h1, h2, h3, h4, h5, h6')) {
      if (extractText(current).toLowerCase().includes(endHeading.toLowerCase())) {
        break;
      }
    }

    // Collect tables
    if (current.is('table')) {
      tables.push(current);
    }

    // Also check for nested tables
    const nestedTables = current.find('table');
    nestedTables.each((_index: number, table: Element) => {
      tables.push($(table));
    });

    current = current.next();
  }

  return tables;
}
