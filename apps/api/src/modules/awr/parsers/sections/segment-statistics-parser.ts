/**
 * Segment Statistics Parser for AWR Reports
 *
 * Extracts segment-level performance statistics from Oracle AWR HTML reports.
 * AWR reports contain multiple segment statistics sections:
 * - Segments by Logical Reads
 * - Segments by Physical Reads
 * - Segments by Physical Read Requests
 * - Segments by Table Scans (FTS)
 * - Segments by Row Lock Waits
 * - Segments by Buffer Busy Waits
 *
 * Each segment includes:
 * - Owner, tablespace, object name, and type
 * - Statistic value (reads, scans, waits, etc.)
 * - Percentage of total
 */

import type { CheerioAPI, Cheerio } from 'cheerio';
import type { Element } from 'domhandler';
import { BaseSectionParser, type ParserOptions } from '../base-parser';
import type {
  SegmentStatistics,
  SegmentStatistic,
} from '../../types/awr-data.types';
import {
  findTableByIdentifier,
  parseTableToArray,
  findSectionHeading,
} from '../../utils/html-utils';
import { parseAwrNumber } from '../../utils/number-utils';

// ==================== Constants ====================

/** Section identifiers for segment statistics tables */
const SEGMENT_SECTION_IDENTIFIERS = {
  LOGICAL_READS: [
    'segments by logical reads',
    'logical reads',
    'top segments by logical reads',
  ],
  PHYSICAL_READS: [
    'segments by physical reads',
    'physical reads',
    'top segments by physical reads',
  ],
  PHYSICAL_READ_REQUESTS: [
    'segments by physical read requests',
    'physical read requests',
  ],
  TABLE_SCANS: [
    'segments by table scans',
    'table scans',
    'top segments by table scans',
  ],
  ROW_LOCK_WAITS: [
    'segments by row lock waits',
    'row lock waits',
    'top segments by row lock waits',
  ],
  BUFFER_BUSY_WAITS: [
    'segments by buffer busy waits',
    'buffer busy waits',
    'top segments by buffer busy waits',
  ],
} as const;

// ==================== Segment Statistics Parser Class ====================

/**
 * Parser for AWR report Segment Statistics sections.
 *
 * Extracts segment-level performance metrics including table scans,
 * reads, and wait statistics.
 *
 * @example
 * const parser = new SegmentStatisticsParser();
 * const segmentStats = parser.parse(awrHtml);
 * console.log(segmentStats?.byTableScans?.[0]?.objectName);
 */
export class SegmentStatisticsParser extends BaseSectionParser<SegmentStatistics> {
  constructor(options: ParserOptions = {}) {
    super(options);
  }

  /**
   * Get the section name for logging
   */
  getSectionName(): string {
    return 'Segment Statistics';
  }

  /**
   * Parse Segment Statistics sections from AWR report
   *
   * @param html - Full AWR report HTML
   * @returns Parsed Segment Statistics data or null if not found
   */
  parse(html: string): SegmentStatistics | null {
    const $ = this.loadDocument(html);

    this.debug('Starting Segment Statistics parse');

    const segmentStats: SegmentStatistics = {};

    // Parse logical reads
    segmentStats.byLogicalReads = this.parseSegmentSection(
      $,
      SEGMENT_SECTION_IDENTIFIERS.LOGICAL_READS,
    );

    // Parse physical reads
    segmentStats.byPhysicalReads = this.parseSegmentSection(
      $,
      SEGMENT_SECTION_IDENTIFIERS.PHYSICAL_READS,
    );

    // Parse physical read requests
    segmentStats.byPhysicalReadRequests = this.parseSegmentSection(
      $,
      SEGMENT_SECTION_IDENTIFIERS.PHYSICAL_READ_REQUESTS,
    );

    // Parse table scans
    segmentStats.byTableScans = this.parseSegmentSection(
      $,
      SEGMENT_SECTION_IDENTIFIERS.TABLE_SCANS,
    );

    // Parse row lock waits
    segmentStats.byRowLockWaits = this.parseSegmentSection(
      $,
      SEGMENT_SECTION_IDENTIFIERS.ROW_LOCK_WAITS,
    );

    // Parse buffer busy waits
    segmentStats.byBufferBusyWaits = this.parseSegmentSection(
      $,
      SEGMENT_SECTION_IDENTIFIERS.BUFFER_BUSY_WAITS,
    );

    // Extract totals from section headings
    this.extractTotals($, segmentStats);

    const totalSegments = this.countSegments(segmentStats);
    this.debug('Segment Statistics parse complete', {
      byLogicalReads: segmentStats.byLogicalReads?.length ?? 0,
      byPhysicalReads: segmentStats.byPhysicalReads?.length ?? 0,
      byTableScans: segmentStats.byTableScans?.length ?? 0,
      byRowLockWaits: segmentStats.byRowLockWaits?.length ?? 0,
      byBufferBusyWaits: segmentStats.byBufferBusyWaits?.length ?? 0,
      totalSegments,
    });

    // Return null if no segments found
    if (totalSegments === 0) {
      return null;
    }

    return segmentStats;
  }

  /**
   * Validate the parsed Segment Statistics data
   */
  protected validate(data: SegmentStatistics): boolean {
    return this.countSegments(data) > 0;
  }

  // ==================== Section Parsing Methods ====================

  /**
   * Parse a segment statistics section using multiple identifier variations
   */
  private parseSegmentSection(
    $: CheerioAPI,
    identifiers: readonly string[],
  ): SegmentStatistic[] | undefined {
    for (const identifier of identifiers) {
      const table = this.findSegmentTable($, identifier);
      if (table) {
        const segments = this.parseSegmentTable($, table);
        if (segments.length > 0) {
          return segments;
        }
      }
    }
    return undefined;
  }

  /**
   * Find a segment statistics table by identifier
   */
  private findSegmentTable(
    $: CheerioAPI,
    identifier: string,
  ): Cheerio<Element> | null {
    // Try finding by table summary
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
  private findNextTable(
    _$: CheerioAPI,
    heading: Cheerio<Element>,
  ): Cheerio<Element> | null {
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
   * Parse a segment statistics table
   */
  private parseSegmentTable(
    $: CheerioAPI,
    table: Cheerio<Element>,
  ): SegmentStatistic[] {
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

    if (columnIndices.owner === undefined || columnIndices.objectName === undefined) {
      return [];
    }

    // Parse data rows
    const segments: SegmentStatistic[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;

      const segment = this.parseSegmentRow(row, columnIndices);
      if (segment && segment.objectName) {
        segments.push(segment);
      }
    }

    return segments;
  }

  /**
   * Detect column indices from header row
   */
  private detectColumnIndices(headerRow: string[]): Record<string, number> {
    const indices: Record<string, number> = {};

    for (let i = 0; i < headerRow.length; i++) {
      const header = headerRow[i]?.toLowerCase().trim();
      if (!header) continue;

      // Owner/schema
      if (header === 'owner' || header === 'schema') {
        indices.owner = i;
      }
      // Tablespace
      else if (header.includes('tablespace')) {
        indices.tablespaceName = i;
      }
      // Object name
      else if (
        header === 'object name' ||
        header === 'segment name' ||
        header === 'name'
      ) {
        indices.objectName = i;
      }
      // Subobject name
      else if (header.includes('subobject')) {
        indices.subobjectName = i;
      }
      // Object type
      else if (header.includes('obj') && header.includes('type')) {
        indices.objectType = i;
      }
      // Object ID
      else if (header === 'obj#' || header === 'object id') {
        indices.objectId = i;
      }
      // Data object ID
      else if (header === 'dataobj#' || header === 'data object id') {
        indices.dataObjectId = i;
      }
      // PDB name
      else if (header === 'pdb name' || header === 'pdb') {
        indices.pdbName = i;
      }
      // Percentage
      else if (header.includes('%')) {
        indices.percentTotal = i;
      }
      // Value columns (logical reads, physical reads, table scans, etc.)
      else if (
        header.includes('logical reads') ||
        header.includes('physical reads') ||
        header.includes('table scans') ||
        header.includes('row lock waits') ||
        header.includes('buffer busy waits') ||
        header.includes('read requests')
      ) {
        indices.value = i;
      }
    }

    return indices;
  }

  /**
   * Parse a single segment row
   */
  private parseSegmentRow(
    row: string[],
    indices: Record<string, number>,
  ): SegmentStatistic | null {
    const getValue = (property: string): string | undefined => {
      const idx = indices[property];
      return idx !== undefined ? row[idx]?.trim() : undefined;
    };

    const owner = getValue('owner');
    const objectName = getValue('objectName');
    const objectType = getValue('objectType');

    if (!owner || !objectName) {
      return null;
    }

    const valueStr = getValue('value');
    const value = valueStr ? parseAwrNumber(valueStr) : 0;

    const percentStr = getValue('percentTotal');
    const percentTotal = percentStr ? parseAwrNumber(percentStr) : undefined;

    const objectIdStr = getValue('objectId');
    const objectId = objectIdStr ? parseAwrNumber(objectIdStr) : undefined;

    const dataObjectIdStr = getValue('dataObjectId');
    const dataObjectId = dataObjectIdStr
      ? parseAwrNumber(dataObjectIdStr)
      : undefined;

    return {
      owner,
      tablespaceName: getValue('tablespaceName'),
      objectName,
      subobjectName: getValue('subobjectName'),
      objectType: objectType || 'UNKNOWN',
      objectId: objectId !== undefined && !isNaN(objectId) ? objectId : undefined,
      dataObjectId:
        dataObjectId !== undefined && !isNaN(dataObjectId)
          ? dataObjectId
          : undefined,
      pdbName: getValue('pdbName'),
      value,
      percentTotal,
    };
  }

  // ==================== Totals Extraction ====================

  /**
   * Extract total values from section headings and lists
   */
  private extractTotals($: CheerioAPI, segmentStats: SegmentStatistics): void {
    // Look for totals in <ul> lists following section headings
    $('h3').each((_, elem) => {
      const heading = $(elem).text();
      const list = $(elem).next('ul');

      if (list.length > 0) {
        const listText = list.text();

        // Total Logical Reads
        if (heading.includes('Logical Reads')) {
          const match = listText.match(/Total.*?Logical Reads:?\s*([\d,]+)/i);
          if (match && match[1]) {
            segmentStats.totalLogicalReads = parseAwrNumber(match[1]);
          }
        }

        // Total Physical Reads
        if (heading.includes('Physical Reads') && !heading.includes('Requests')) {
          const match = listText.match(/Total.*?Physical Reads:?\s*([\d,]+)/i);
          if (match && match[1]) {
            segmentStats.totalPhysicalReads = parseAwrNumber(match[1]);
          }
        }

        // Total Table Scans
        if (heading.includes('Table Scans')) {
          const match = listText.match(/Total.*?Table Scans:?\s*([\d,]+)/i);
          if (match && match[1]) {
            segmentStats.totalTableScans = parseAwrNumber(match[1]);
          }
        }
      }
    });
  }

  // ==================== Helper Methods ====================

  /**
   * Count total segments across all sections
   */
  private countSegments(segmentStats: SegmentStatistics): number {
    return (
      (segmentStats.byLogicalReads?.length ?? 0) +
      (segmentStats.byPhysicalReads?.length ?? 0) +
      (segmentStats.byPhysicalReadRequests?.length ?? 0) +
      (segmentStats.byTableScans?.length ?? 0) +
      (segmentStats.byRowLockWaits?.length ?? 0) +
      (segmentStats.byBufferBusyWaits?.length ?? 0)
    );
  }
}
