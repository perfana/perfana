/**
 * Wait Events Parser for AWR Reports
 *
 * Extracts Wait Events statistics from Oracle AWR HTML reports.
 * AWR reports contain multiple wait events sections:
 * - Top 10 Foreground Events by Total Wait Time
 * - Top Background Wait Events
 * - Wait Event Histogram
 * - Wait Events Statistics
 *
 * Each wait event includes:
 * - Event name and wait class
 * - Number of waits and timeouts
 * - Total wait time and average wait time
 * - Percentage of DB time and total wait time
 */

import type { CheerioAPI, Cheerio } from 'cheerio';
import type { Element } from 'domhandler';
import { BaseSectionParser, type ParserOptions } from '../base-parser';
import type { WaitEvents, WaitEvent } from '../../types/awr-data.types';
import {
  findTableByIdentifier,
  parseTableToArray,
  findSectionHeading,
  getTablesInSection,
} from '../../utils/html-utils';
import { parseAwrNumber, parsePercentage } from '../../utils/number-utils';
import { parseTimeToSeconds } from '../../utils/time-utils';

// ==================== Constants ====================

/** Section identifiers for wait events tables */
const WAIT_EVENT_IDENTIFIERS = {
  FOREGROUND: [
    'top 10 foreground',
    'top 10 wait events',
    'wait events by total wait time',
    'foreground events',
    'top timed foreground',
    'foreground wait events',
    'top foreground events',
  ],
  BACKGROUND: [
    'background wait events',
    'background events',
    'top background',
  ],
  ALL_EVENTS: [
    'wait events',
    'wait statistics',
    'system events',
  ],
  BY_CLASS: [
    'wait class',
    'wait events by class',
    'wait class statistics',
    'wait classes by total wait time',
  ],
} as const;

/** Column header mappings for wait events tables */
const COLUMN_MAPPINGS: Record<string, keyof WaitEvent> = {
  'event': 'event',
  'event name': 'event',
  'wait event': 'event',
  'wait class': 'waitClass',
  'class': 'waitClass',
  'waits': 'waits',
  'total waits': 'waits',
  '# waits': 'waits',
  'timeouts': 'timeouts',
  'time outs': 'timeouts',
  'total time': 'totalWaitTime',
  'total wait time': 'totalWaitTime',
  'wait time': 'totalWaitTime',
  'time (s)': 'totalWaitTime',
  'time(s)': 'totalWaitTime',
  'waited (s)': 'totalWaitTime',
  'avg wait': 'avgWaitMs',
  'avg wait (ms)': 'avgWaitMs',
  'avg wait(ms)': 'avgWaitMs',
  'average wait': 'avgWaitMs',
  '% db time': 'percentDbTime',
  '%db time': 'percentDbTime',
  '% of db time': 'percentDbTime',
  '% time': 'percentWaitTime',
  '% total': 'percentWaitTime',
  '% wait': 'percentWaitTime',
  'waits/sec': 'waitsPerSecond',
  'waits per sec': 'waitsPerSecond',
};

/** Known wait classes in Oracle */
// Currently unused but kept for reference
// const WAIT_CLASSES = [
//   'User I/O',
//   'System I/O',
//   'Concurrency',
//   'Commit',
//   'Application',
//   'Configuration',
//   'Administrative',
//   'Network',
//   'Scheduler',
//   'Cluster',
//   'Other',
//   'Idle',
// ] as const;

// ==================== Wait Events Parser Class ====================

/**
 * Parser for AWR report Wait Events sections.
 *
 * Extracts wait events from multiple sections of the AWR report,
 * organizing them by foreground/background and by wait class.
 *
 * @example
 * const parser = new WaitEventsParser();
 * const waitEvents = parser.parse(awrHtml);
 * console.log(waitEvents?.foreground?.[0]?.event);
 */
export class WaitEventsParser extends BaseSectionParser<WaitEvents> {
  constructor(options: ParserOptions = {}) {
    super(options);
  }

  /**
   * Get the section name for logging
   */
  getSectionName(): string {
    return 'Wait Events';
  }

  /**
   * Parse Wait Events sections from AWR report
   *
   * @param html - Full AWR report HTML
   * @returns Parsed Wait Events data or null if not found
   */
  parse(html: string): WaitEvents | null {
    const $ = this.loadDocument(html);

    this.debug('Starting Wait Events parse');

    const waitEvents: WaitEvents = {};

    // Parse foreground events
    waitEvents.foreground = this.parseWaitEventSection(
      $,
      WAIT_EVENT_IDENTIFIERS.FOREGROUND,
    );

    // Parse background events
    waitEvents.background = this.parseWaitEventSection(
      $,
      WAIT_EVENT_IDENTIFIERS.BACKGROUND,
    );

    // Try to parse additional events from general sections
    const allEvents = this.parseWaitEventSection(
      $,
      WAIT_EVENT_IDENTIFIERS.ALL_EVENTS,
    );

    // Build topEvents from foreground (if available) or all events
    if (waitEvents.foreground && waitEvents.foreground.length > 0) {
      waitEvents.topEvents = [...waitEvents.foreground];
    } else if (allEvents && allEvents.length > 0) {
      waitEvents.topEvents = allEvents;
    }

    // Group events by wait class
    waitEvents.byClass = this.groupEventsByClass(waitEvents);

    // Calculate total wait time
    waitEvents.totalWaitTime = this.calculateTotalWaitTime(waitEvents);

    const totalEvents = this.countEvents(waitEvents);
    this.debug('Wait Events parse complete', {
      foreground: waitEvents.foreground?.length ?? 0,
      background: waitEvents.background?.length ?? 0,
      byClassCount: Object.keys(waitEvents.byClass ?? {}).length,
      totalEvents,
    });

    // Return null if no events found
    if (totalEvents === 0) {
      return null;
    }

    return waitEvents;
  }

  /**
   * Validate the parsed Wait Events data
   */
  protected validate(data: WaitEvents): boolean {
    return this.countEvents(data) > 0;
  }

  // ==================== Section Parsing Methods ====================

  /**
   * Parse a wait events section using multiple identifier variations
   */
  private parseWaitEventSection(
    $: CheerioAPI,
    identifiers: readonly string[],
  ): WaitEvent[] | undefined {
    for (const identifier of identifiers) {
      const table = this.findWaitEventsTable($, identifier);
      if (table) {
        const events = this.parseWaitEventsTable($, table);
        if (events.length > 0) {
          return events;
        }
      }
    }
    return undefined;
  }

  /**
   * Find a wait events table by identifier
   */
  private findWaitEventsTable(
    $: CheerioAPI,
    identifier: string,
  ): Cheerio<Element> | null {
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

    // Try finding tables within section
    const tables = getTablesInSection($, identifier);
    if (tables.length > 0 && tables[0]) {
      return tables[0];
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
   * Parse a wait events table
   */
  private parseWaitEventsTable(
    $: CheerioAPI,
    table: Cheerio<Element>,
  ): WaitEvent[] {
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

    if (columnIndices.event === undefined) {
      return [];
    }

    // Parse data rows
    const events: WaitEvent[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const event = this.parseEventRow(row, columnIndices);

      if (event && event.event) {
        events.push(event);
      }
    }

    return events;
  }

  /**
   * Detect column indices from header row
   */
  private detectColumnIndices(headerRow: string[]): Record<string, number> {
    const indices: Record<string, number> = {};

    for (let i = 0; i < headerRow.length; i++) {
      const header = headerRow[i]?.toLowerCase().trim();
      if (!header) continue;

      for (const [key, property] of Object.entries(COLUMN_MAPPINGS)) {
        if (header === key || header.includes(key)) {
          // Prioritize exact matches
          if (!indices[property] || header === key) {
            indices[property] = i;
          }
        }
      }
    }

    return indices;
  }

  /**
   * Parse a single wait event row
   */
  private parseEventRow(
    row: string[],
    indices: Record<string, number>,
  ): WaitEvent | null {
    const getValue = (property: string): string | undefined => {
      const idx = indices[property];
      return idx !== undefined ? row[idx]?.trim() : undefined;
    };

    const eventName = getValue('event');

    if (!eventName || this.isHeaderValue(eventName)) {
      return null;
    }

    const waitsStr = getValue('waits');
    const totalTimeStr = getValue('totalWaitTime');

    // Need at least event name and waits or time
    const waits = this.parseOptionalNumber(waitsStr) ?? 0;
    const totalWaitTime = this.parseTimeValue(totalTimeStr) ?? 0;

    return {
      event: eventName,
      waitClass: getValue('waitClass') || this.detectWaitClass(eventName),
      waits,
      timeouts: this.parseOptionalNumber(getValue('timeouts')),
      totalWaitTime,
      avgWaitMs: this.parseAvgWaitMs(getValue('avgWaitMs')),
      percentWaitTime: this.parsePercentValue(getValue('percentWaitTime')),
      percentDbTime: this.parsePercentValue(getValue('percentDbTime')),
      waitsPerSecond: this.parseOptionalNumber(getValue('waitsPerSecond')),
    };
  }

  /**
   * Check if a value appears to be a header rather than data
   */
  private isHeaderValue(value: string): boolean {
    const lower = value.toLowerCase();
    return (
      lower.includes('event name') ||
      lower.includes('wait class') ||
      lower === 'event' ||
      lower === '' ||
      lower === '-'
    );
  }

  // ==================== Wait Class Detection ====================

  /**
   * Detect wait class from event name
   */
  private detectWaitClass(eventName: string): string | undefined {
    const lowerEvent = eventName.toLowerCase();

    // System I/O events (must be checked before generic I/O)
    if (
      lowerEvent.includes('db file parallel write') ||
      lowerEvent.includes('log file parallel write')
    ) {
      return 'System I/O';
    }

    // Commit events (must be checked before generic 'log file' match)
    if (
      lowerEvent.includes('log file sync') ||
      lowerEvent.includes('commit')
    ) {
      return 'Commit';
    }

    // I/O related events (generic, after specific I/O patterns)
    if (
      lowerEvent.includes('db file') ||
      lowerEvent.includes('direct path') ||
      lowerEvent.includes('control file') ||
      lowerEvent.includes('log file')
    ) {
      return 'User I/O';
    }

    // Cluster events (must be checked before Concurrency for 'gc buffer busy')
    if (
      lowerEvent.includes('gc ') ||
      lowerEvent.includes('global cache') ||
      lowerEvent.includes('ges ')
    ) {
      return 'Cluster';
    }

    // Concurrency events
    if (
      lowerEvent.includes('latch') ||
      lowerEvent.includes('enq:') ||
      lowerEvent.includes('buffer busy') ||
      lowerEvent.includes('row lock')
    ) {
      return 'Concurrency';
    }

    // Network events
    if (
      lowerEvent.includes('sql*net') ||
      lowerEvent.includes('net message')
    ) {
      return 'Network';
    }

    return undefined;
  }

  // ==================== Data Grouping Methods ====================

  /**
   * Group events by wait class
   */
  private groupEventsByClass(
    waitEvents: WaitEvents,
  ): Record<string, WaitEvent[]> {
    const byClass: Record<string, WaitEvent[]> = {};

    const addToClass = (events: WaitEvent[] | undefined): void => {
      if (!events) {
        return;
      }
      for (const event of events) {
        const waitClass = event.waitClass || 'Other';
        if (!byClass[waitClass]) {
          byClass[waitClass] = [];
        }
        // Avoid duplicates
        if (!byClass[waitClass].find((e) => e.event === event.event)) {
          byClass[waitClass].push(event);
        }
      }
    };

    addToClass(waitEvents.foreground);
    addToClass(waitEvents.background);

    return Object.keys(byClass).length > 0 ? byClass : {};
  }

  /**
   * Calculate total wait time from all events
   */
  private calculateTotalWaitTime(waitEvents: WaitEvents): number {
    let total = 0;

    const addTime = (events: WaitEvent[] | undefined): void => {
      if (!events) {
        return;
      }
      for (const event of events) {
        total += event.totalWaitTime || 0;
      }
    };

    // Prefer foreground events for total calculation
    if (waitEvents.foreground && waitEvents.foreground.length > 0) {
      addTime(waitEvents.foreground);
    } else {
      addTime(waitEvents.topEvents);
    }

    return total;
  }

  // ==================== Helper Methods ====================

  /**
   * Parse average wait time to milliseconds.
   *
   * AWR reports may express avg wait with a unit suffix like "144.21us",
   * "706.55ns", or "5.06ms". Using parseTimeToSeconds handles the unit
   * correctly, then we convert to ms.
   *
   * For plain numbers without a unit suffix (e.g. "5.05"), parseTimeToSeconds
   * defaults to seconds, and the column header says "Avg Wait (ms)". We detect
   * this case by checking if the original string has a unit suffix: if not,
   * we treat the plain number as already in ms (matching the column header).
   */
  private parseAvgWaitMs(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (trimmed === '' || trimmed === '-' || trimmed === 'N/A') return undefined;

    // Check if value has a time unit suffix (letters after digits)
    const hasUnitSuffix = /[a-z\u00b5]+$/i.test(trimmed);

    if (hasUnitSuffix) {
      // Parse with unit awareness and convert to ms
      const seconds = parseTimeToSeconds(trimmed);
      if (seconds === 0 && !trimmed.includes('0')) return undefined;
      return seconds * 1000;
    }

    // Plain number — column header says ms, treat as ms
    const parsed = parseAwrNumber(trimmed);
    return isNaN(parsed) ? undefined : parsed;
  }

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
   * Count total events across all sections
   */
  private countEvents(waitEvents: WaitEvents): number {
    return (
      (waitEvents.foreground?.length ?? 0) +
      (waitEvents.background?.length ?? 0)
    );
  }
}
