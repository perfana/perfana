/**
 * Header Parser for AWR Reports
 *
 * Extracts database information, host information, and snapshot metadata
 * from the header section of Oracle AWR HTML reports.
 *
 * AWR report headers typically contain:
 * - Database instance info (DB Name, DB Id, Instance, Release, RAC/CDB flags)
 * - Host information (Host Name, Platform, CPUs, Cores, Sockets, Memory)
 * - Snapshot range (Begin/End Snap IDs, timestamps, Elapsed time, DB Time)
 */

import type { CheerioAPI, Cheerio } from 'cheerio';
import type { Element } from 'domhandler';
import { BaseSectionParser, type ParserOptions } from '../base-parser';
import type {
  AwrReportHeader,
  DatabaseInfo,
  HostInfo,
  SnapshotInfo,
} from '../../types/awr-data.types';
import {
  findTableByIdentifier,
  parseTableToArray,
  extractLabeledValue,
} from '../../utils/html-utils';
import { parseAwrNumber, parseInteger } from '../../utils/number-utils';
import { parseAwrTimestamp, parseTimeToSeconds } from '../../utils/time-utils';

// ==================== Constants ====================

/** Table identifiers used in AWR reports for header sections */
const TABLE_IDENTIFIERS = {
  DATABASE: ['database instance information', 'db name', 'database information'],
  HOST: ['host information', 'host name', 'platform'],
  SNAPSHOT: ['snapshot information', 'snap id', 'begin snap'],
} as const;

/** Labels used to extract database information */
const DB_LABELS = {
  DB_NAME: ['db name', 'database name'],
  DB_ID: ['db id', 'dbid', 'database id'],
  INSTANCE: ['instance', 'instance name', 'inst name'],
  INSTANCE_NUM: ['inst num', 'instance number', 'inst #'],
  RELEASE: ['release', 'version', 'db version'],
  EDITION: ['edition', 'db edition'],
  RAC: ['rac', 'cluster'],
  CDB: ['cdb', 'container'],
  PDB: ['pdb', 'pluggable'],
} as const;

/** Labels used to extract host information */
const HOST_LABELS = {
  HOST_NAME: ['host name', 'hostname', 'server'],
  PLATFORM: ['platform', 'operating system'],
  CPUS: ['cpus', 'cpu count', 'num cpus'],
  CORES: ['cores', 'core count', 'num cores'],
  SOCKETS: ['sockets', 'socket count', 'num sockets'],
  MEMORY: ['memory', 'memory (gb)', 'physical memory'],
} as const;

/** Labels used to extract snapshot information */
const SNAP_LABELS = {
  BEGIN_ID: ['begin snap', 'begin snap:', 'start snap', 'snap id begin'],
  END_ID: ['end snap', 'end snap:', 'snap id end'],
  BEGIN_TIME: ['begin time', 'start time', 'begin snap time'],
  END_TIME: ['end time', 'end snap time'],
  ELAPSED: ['elapsed', 'elapsed time', 'elapsed (min)'],
  DB_TIME: ['db time', 'db time (min)', 'database time'],
  SESSIONS_BEGIN: ['sessions', 'sessions at begin', 'begin sessions'],
  SESSIONS_END: ['sessions at end', 'end sessions'],
} as const;

// ==================== Header Parser Class ====================

/**
 * Parser for AWR report header section.
 *
 * Extracts database metadata, host information, and snapshot details
 * from the header tables of an AWR HTML report.
 *
 * @example
 * const parser = new HeaderParser();
 * const header = parser.parse(awrHtml);
 * console.log(header?.database.dbName);
 */
export class HeaderParser extends BaseSectionParser<AwrReportHeader> {
  constructor(options: ParserOptions = {}) {
    super(options);
  }

  /**
   * Get the section name for logging
   */
  getSectionName(): string {
    return 'Header';
  }

  /**
   * Parse the AWR report header
   *
   * @param html - Full AWR report HTML
   * @returns Parsed header data or null if not found
   */
  parse(html: string): AwrReportHeader | null {
    const $ = this.loadDocument(html);

    this.debug('Starting header parse');

    // Extract each section
    const database = this.extractDatabaseInfo($, html);
    const host = this.extractHostInfo($, html);
    const snapshot = this.extractSnapshotInfo($, html);

    // Require at least database and snapshot info for a valid header
    if (!database || !snapshot) {
      this.debug('Missing required header sections', { database: !!database, snapshot: !!snapshot });
      return null;
    }

    const header: AwrReportHeader = {
      database,
      host: host || this.createDefaultHostInfo(),
      snapshot,
      reportGeneratedAt: this.extractReportGenerationTime($),
    };

    this.debug('Header parse complete', {
      dbName: header.database.dbName,
      snapRange: `${header.snapshot.snapIdBegin}-${header.snapshot.snapIdEnd}`,
    });

    return header;
  }

  /**
   * Validate the parsed header data
   */
  protected validate(data: AwrReportHeader): boolean {
    return (
      data.database?.dbName !== undefined &&
      data.database?.dbId !== undefined &&
      data.snapshot?.snapIdBegin !== undefined &&
      data.snapshot?.snapIdEnd !== undefined
    );
  }

  // ==================== Database Info Extraction ====================

  /**
   * Extract database information from AWR header
   */
  private extractDatabaseInfo($: CheerioAPI, html: string): DatabaseInfo | null {
    // Try to find the database info table
    const table = this.findHeaderTable($, TABLE_IDENTIFIERS.DATABASE);

    if (table) {
      return this.parseDatabaseInfoFromTable($, table);
    }

    // Fallback: extract from labeled values in the document
    return this.parseDatabaseInfoFromLabels($, html);
  }

  /**
   * Parse database info from a table element
   */
  private parseDatabaseInfoFromTable(
    $: CheerioAPI,
    table: Cheerio<Element>,
  ): DatabaseInfo | null {
    const rows = parseTableToArray($, table);
    const values = this.flattenTableToMap(rows);

    const dbName = this.findValue(values, DB_LABELS.DB_NAME);
    const dbId = this.findValue(values, DB_LABELS.DB_ID);

    if (!dbName || !dbId) {
      return null;
    }

    return {
      dbName,
      dbId,
      instanceName: this.findValue(values, DB_LABELS.INSTANCE),
      instanceNumber: this.parseOptionalInt(this.findValue(values, DB_LABELS.INSTANCE_NUM)),
      dbRelease: this.findValue(values, DB_LABELS.RELEASE),
      dbEdition: this.findValue(values, DB_LABELS.EDITION),
      isRac: this.parseYesNo(this.findValue(values, DB_LABELS.RAC)),
      isCdb: this.parseYesNo(this.findValue(values, DB_LABELS.CDB)),
      pdbName: this.findValue(values, DB_LABELS.PDB),
    };
  }

  /**
   * Parse database info from labeled values (fallback)
   */
  private parseDatabaseInfoFromLabels($: CheerioAPI, _html: string): DatabaseInfo | null {
    const dbName = this.extractAnyLabeledValue($, DB_LABELS.DB_NAME);
    const dbId = this.extractAnyLabeledValue($, DB_LABELS.DB_ID);

    if (!dbName || !dbId) {
      return null;
    }

    return {
      dbName,
      dbId,
      instanceName: this.extractAnyLabeledValue($, DB_LABELS.INSTANCE),
      instanceNumber: this.parseOptionalInt(
        this.extractAnyLabeledValue($, DB_LABELS.INSTANCE_NUM),
      ),
      dbRelease: this.extractAnyLabeledValue($, DB_LABELS.RELEASE),
      dbEdition: this.extractAnyLabeledValue($, DB_LABELS.EDITION),
      isRac: this.parseYesNo(this.extractAnyLabeledValue($, DB_LABELS.RAC)),
      isCdb: this.parseYesNo(this.extractAnyLabeledValue($, DB_LABELS.CDB)),
      pdbName: this.extractAnyLabeledValue($, DB_LABELS.PDB),
    };
  }

  // ==================== Host Info Extraction ====================

  /**
   * Extract host information from AWR header
   */
  private extractHostInfo($: CheerioAPI, _html: string): HostInfo | null {
    const table = this.findHeaderTable($, TABLE_IDENTIFIERS.HOST);

    if (table) {
      return this.parseHostInfoFromTable($, table);
    }

    return this.parseHostInfoFromLabels($);
  }

  /**
   * Parse host info from a table element
   */
  private parseHostInfoFromTable(
    $: CheerioAPI,
    table: Cheerio<Element>,
  ): HostInfo | null {
    const rows = parseTableToArray($, table);
    const values = this.flattenTableToMap(rows);

    const hostName = this.findValue(values, HOST_LABELS.HOST_NAME);

    if (!hostName) {
      return null;
    }

    return {
      hostName,
      platform: this.findValue(values, HOST_LABELS.PLATFORM),
      cpus: this.parseOptionalInt(this.findValue(values, HOST_LABELS.CPUS)),
      cores: this.parseOptionalInt(this.findValue(values, HOST_LABELS.CORES)),
      sockets: this.parseOptionalInt(this.findValue(values, HOST_LABELS.SOCKETS)),
      memoryGb: this.parseOptionalNumber(this.findValue(values, HOST_LABELS.MEMORY)),
    };
  }

  /**
   * Parse host info from labeled values (fallback)
   */
  private parseHostInfoFromLabels($: CheerioAPI): HostInfo | null {
    const hostName = this.extractAnyLabeledValue($, HOST_LABELS.HOST_NAME);

    if (!hostName) {
      return null;
    }

    return {
      hostName,
      platform: this.extractAnyLabeledValue($, HOST_LABELS.PLATFORM),
      cpus: this.parseOptionalInt(this.extractAnyLabeledValue($, HOST_LABELS.CPUS)),
      cores: this.parseOptionalInt(this.extractAnyLabeledValue($, HOST_LABELS.CORES)),
      sockets: this.parseOptionalInt(this.extractAnyLabeledValue($, HOST_LABELS.SOCKETS)),
      memoryGb: this.parseOptionalNumber(
        this.extractAnyLabeledValue($, HOST_LABELS.MEMORY),
      ),
    };
  }

  /**
   * Create default host info when extraction fails
   */
  private createDefaultHostInfo(): HostInfo {
    return {
      hostName: 'unknown',
    };
  }

  // ==================== Snapshot Info Extraction ====================

  /**
   * Extract snapshot information from AWR header
   */
  private extractSnapshotInfo($: CheerioAPI, _html: string): SnapshotInfo | null {
    const table = this.findHeaderTable($, TABLE_IDENTIFIERS.SNAPSHOT);

    if (table) {
      return this.parseSnapshotInfoFromTable($, table);
    }

    return this.parseSnapshotInfoFromLabels($);
  }

  /**
   * Parse snapshot info from a table element.
   *
   * Supports two table layouts:
   *
   * **AWR 19c columnar layout** (3+ columns with headers like "Snap Id", "Snap Time"):
   *   Row 0 (header): ["", "Snap Id", "Snap Time", "Sessions", ...]
   *   Row 1: ["Begin Snap:", "28091", "10-Feb-26 07:00:13", "431"]
   *   Row 2: ["End Snap:", "28092", "10-Feb-26 08:00:30", "468"]
   *   Row 3: ["Elapsed:", "", "60.29 (mins)", ""]
   *   Row 4: ["DB Time:", "", "145.28 (mins)", ""]
   *
   * **Key-value layout** (2 columns, label + value):
   *   Row 0: ["Begin Snap", "100"]
   *   Row 1: ["End Snap", "110"]
   *   Row 2: ["Elapsed", "60"]
   *
   * We detect the columnar layout by looking for "snap id" in the header row.
   * If not found, we fall back to the key-value map approach.
   */
  private parseSnapshotInfoFromTable(
    $: CheerioAPI,
    table: Cheerio<Element>,
  ): SnapshotInfo | null {
    const rows = parseTableToArray($, table);
    if (rows.length < 2) {
      return null;
    }

    // Detect columnar layout by looking for column headers
    const headers = rows[0] ?? [];
    const snapIdCol = headers.findIndex(h => h.toLowerCase().includes('snap id'));
    const snapTimeCol = headers.findIndex(h => h.toLowerCase().includes('snap time'));
    const sessionsCol = headers.findIndex(h => h.toLowerCase().includes('sessions'));

    // If we find column headers, use columnar extraction
    const isColumnar = snapIdCol >= 0 || snapTimeCol >= 0;

    if (isColumnar) {
      return this.parseSnapshotColumnar(rows, snapIdCol, snapTimeCol, sessionsCol);
    }

    // Fall back to key-value map approach
    const values = this.flattenTableToMap(rows);
    return this.parseSnapshotFromMap(values);
  }

  /**
   * Parse snapshot info from columnar AWR 19c layout
   */
  private parseSnapshotColumnar(
    rows: string[][],
    snapIdCol: number,
    snapTimeCol: number,
    sessionsCol: number,
  ): SnapshotInfo | null {
    const idCol = snapIdCol >= 0 ? snapIdCol : 1;
    const timeCol = snapTimeCol >= 0 ? snapTimeCol : 2;
    const sessCol = sessionsCol >= 0 ? sessionsCol : 3;

    let snapIdBegin: number | undefined;
    let snapIdEnd: number | undefined;
    let beginTime: Date | undefined;
    let endTime: Date | undefined;
    let elapsedMinutes = 0;
    let dbTimeMinutes: number | undefined;
    let sessionsBegin: number | undefined;
    let sessionsEnd: number | undefined;

    for (const row of rows.slice(1)) {
      const label = (row[0] ?? '').toLowerCase().trim();

      if (label.includes('begin snap') || (label.includes('begin') && !label.includes('session'))) {
        snapIdBegin = this.parseOptionalInt(row[idCol]);
        beginTime = this.parseTimestamp(row[timeCol]) ?? undefined;
        sessionsBegin = this.parseOptionalInt(row[sessCol]);
      } else if (label.includes('end snap') || (label.includes('end') && !label.includes('session'))) {
        snapIdEnd = this.parseOptionalInt(row[idCol]);
        endTime = this.parseTimestamp(row[timeCol]) ?? undefined;
        sessionsEnd = this.parseOptionalInt(row[sessCol]);
      } else if (label.includes('elapsed')) {
        // Elapsed value may be in timeCol, idCol, or column 1
        elapsedMinutes = this.parseElapsedMinutes(row[timeCol]) ||
          this.parseElapsedMinutes(row[idCol]) ||
          this.parseElapsedMinutes(row[1]);
      } else if (label.includes('db time')) {
        const val = this.parseOptionalNumber(this.extractMinutesValue(row[timeCol])) ??
          this.parseOptionalNumber(this.extractMinutesValue(row[idCol])) ??
          this.parseOptionalNumber(this.extractMinutesValue(row[1]));
        dbTimeMinutes = val;
      }
    }

    if (snapIdBegin === undefined || snapIdEnd === undefined) {
      // Fall back to map-based approach
      const values = this.flattenTableToMap(rows);
      return this.parseSnapshotFromMap(values);
    }

    return {
      snapIdBegin,
      snapIdEnd,
      beginTime: beginTime ?? new Date(),
      endTime: endTime ?? new Date(),
      elapsedMinutes,
      dbTimeMinutes,
      sessionsBegin,
      sessionsEnd,
    };
  }

  /**
   * Extract numeric minutes from a string like "60.29 (mins)" or "145.28 (mins)"
   */
  private extractMinutesValue(value: string | undefined): string | undefined {
    if (!value) return undefined;
    // Strip "(mins)" or "(min)" suffix and return the numeric part
    return value.replace(/\(mins?\)/gi, '').trim() || undefined;
  }

  /**
   * Parse snapshot info from a flattened map (fallback for non-standard layouts)
   */
  private parseSnapshotFromMap(values: Map<string, string>): SnapshotInfo | null {
    const snapIdBegin = this.parseOptionalInt(this.findValue(values, SNAP_LABELS.BEGIN_ID));
    const snapIdEnd = this.parseOptionalInt(this.findValue(values, SNAP_LABELS.END_ID));

    if (snapIdBegin === undefined || snapIdEnd === undefined) {
      return null;
    }

    const beginTimeStr = this.findValue(values, SNAP_LABELS.BEGIN_TIME);
    const endTimeStr = this.findValue(values, SNAP_LABELS.END_TIME);

    return {
      snapIdBegin,
      snapIdEnd,
      beginTime: this.parseTimestamp(beginTimeStr),
      endTime: this.parseTimestamp(endTimeStr),
      elapsedMinutes: this.parseElapsedMinutes(this.findValue(values, SNAP_LABELS.ELAPSED)),
      dbTimeMinutes: this.parseOptionalNumber(this.findValue(values, SNAP_LABELS.DB_TIME)),
      sessionsBegin: this.parseOptionalInt(
        this.findValue(values, SNAP_LABELS.SESSIONS_BEGIN),
      ),
      sessionsEnd: this.parseOptionalInt(this.findValue(values, SNAP_LABELS.SESSIONS_END)),
    };
  }

  /**
   * Parse snapshot info from labeled values (fallback)
   */
  private parseSnapshotInfoFromLabels($: CheerioAPI): SnapshotInfo | null {
    const snapIdBegin = this.parseOptionalInt(
      this.extractAnyLabeledValue($, SNAP_LABELS.BEGIN_ID),
    );
    const snapIdEnd = this.parseOptionalInt(
      this.extractAnyLabeledValue($, SNAP_LABELS.END_ID),
    );

    if (snapIdBegin === undefined || snapIdEnd === undefined) {
      return null;
    }

    const beginTimeStr = this.extractAnyLabeledValue($, SNAP_LABELS.BEGIN_TIME);
    const endTimeStr = this.extractAnyLabeledValue($, SNAP_LABELS.END_TIME);

    return {
      snapIdBegin,
      snapIdEnd,
      beginTime: this.parseTimestamp(beginTimeStr),
      endTime: this.parseTimestamp(endTimeStr),
      elapsedMinutes: this.parseElapsedMinutes(
        this.extractAnyLabeledValue($, SNAP_LABELS.ELAPSED),
      ),
      dbTimeMinutes: this.parseOptionalNumber(
        this.extractAnyLabeledValue($, SNAP_LABELS.DB_TIME),
      ),
      sessionsBegin: this.parseOptionalInt(
        this.extractAnyLabeledValue($, SNAP_LABELS.SESSIONS_BEGIN),
      ),
      sessionsEnd: this.parseOptionalInt(
        this.extractAnyLabeledValue($, SNAP_LABELS.SESSIONS_END),
      ),
    };
  }

  // ==================== Helper Methods ====================

  /**
   * Find a header table by multiple possible identifiers
   */
  private findHeaderTable(
    $: CheerioAPI,
    identifiers: readonly string[],
  ): Cheerio<Element> | null {
    for (const identifier of identifiers) {
      const table = findTableByIdentifier($, identifier);
      if (table) {
        return table;
      }
    }
    return null;
  }

  /**
   * Flatten a 2D array of table values into a key-value map
   * Handles both horizontal and vertical table layouts
   */
  private flattenTableToMap(rows: string[][]): Map<string, string> {
    const map = new Map<string, string>();

    for (const row of rows) {
      // Process pairs of cells (label, value)
      for (let i = 0; i < row.length - 1; i += 2) {
        const key = row[i]?.toLowerCase().trim();
        const value = row[i + 1]?.trim();
        if (key && value) {
          map.set(key, value);
        }
      }

      // Also handle vertical layout (first cell is label)
      if (row.length >= 2) {
        const key = row[0]?.toLowerCase().trim();
        const value = row[1]?.trim();
        if (key && value && !map.has(key)) {
          map.set(key, value);
        }
      }
    }

    return map;
  }

  /**
   * Find a value in the map using multiple possible key labels
   */
  private findValue(
    values: Map<string, string>,
    labels: readonly string[],
  ): string | undefined {
    for (const label of labels) {
      const key = label.toLowerCase();
      // Try exact match first
      if (values.has(key)) {
        return values.get(key);
      }
      // Try partial match
      for (const [mapKey, value] of values) {
        if (mapKey.includes(key) || key.includes(mapKey)) {
          return value;
        }
      }
    }
    return undefined;
  }

  /**
   * Extract a labeled value trying multiple label variations
   */
  private extractAnyLabeledValue(
    $: CheerioAPI,
    labels: readonly string[],
  ): string | undefined {
    for (const label of labels) {
      const value = extractLabeledValue($, label);
      if (value) {
        return value;
      }
    }
    return undefined;
  }

  /**
   * Parse a Yes/No value to boolean
   */
  private parseYesNo(value: string | undefined): boolean | undefined {
    if (!value) {
      return undefined;
    }
    const lower = value.toLowerCase().trim();
    if (lower === 'yes' || lower === 'y' || lower === 'true' || lower === '1') {
      return true;
    }
    if (lower === 'no' || lower === 'n' || lower === 'false' || lower === '0') {
      return false;
    }
    return undefined;
  }

  /**
   * Parse optional integer value
   */
  private parseOptionalInt(value: string | undefined): number | undefined {
    if (!value) {
      return undefined;
    }
    const parsed = parseInteger(value);
    return parsed === 0 && !value.includes('0') ? undefined : parsed;
  }

  /**
   * Parse optional numeric value
   */
  private parseOptionalNumber(value: string | undefined): number | undefined {
    if (!value) {
      return undefined;
    }
    const parsed = parseAwrNumber(value);
    return isNaN(parsed) ? undefined : parsed;
  }

  /**
   * Parse timestamp string to Date
   */
  private parseTimestamp(value: string | undefined): Date {
    if (!value) {
      return new Date();
    }
    const parsed = parseAwrTimestamp(value);
    return parsed || new Date();
  }

  /**
   * Parse elapsed time which may be in various formats
   */
  private parseElapsedMinutes(value: string | undefined): number {
    if (!value) {
      return 0;
    }

    // Check if already in minutes (common AWR format)
    const numOnly = value.replace(/[^\d.]/g, '');
    const num = parseFloat(numOnly);

    // If value contains "min" or looks like minutes, use as-is
    if (value.toLowerCase().includes('min') || (!value.includes(':') && !isNaN(num))) {
      return num;
    }

    // Otherwise parse as time string and convert to minutes
    const seconds = parseTimeToSeconds(value);
    return seconds / 60;
  }

  /**
   * Extract report generation timestamp
   */
  private extractReportGenerationTime($: CheerioAPI): Date | undefined {
    const generatedLabels = ['generated', 'report generated', 'created'];

    for (const label of generatedLabels) {
      const value = extractLabeledValue($, label);
      if (value) {
        const parsed = parseAwrTimestamp(value);
        if (parsed) {
          return parsed;
        }
      }
    }

    return undefined;
  }
}
