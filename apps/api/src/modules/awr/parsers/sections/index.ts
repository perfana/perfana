/**
 * Section Parsers Barrel Export
 *
 * Re-exports all AWR section parsers for convenient importing.
 * Each parser implements the Strategy pattern and extends BaseSectionParser.
 *
 * @example
 * import { HeaderParser, LoadProfileParser, SqlParser, WaitEventsParser } from './sections';
 */

// Section parsers
export { HeaderParser } from './header-parser';
export { LoadProfileParser } from './load-profile-parser';
export { SqlParser } from './sql-parser';
export { WaitEventsParser } from './wait-events-parser';
export { SegmentStatisticsParser } from './segment-statistics-parser';

// ASH SQL parsers
export { parseAshSql } from './ash-sql-parser';
export type { TopSqlWithEvent, TopSqlWithRowSource, ParsedAshSqlData } from './ash-sql-parser';

// SQL Text parser
export { parseSqlText } from './sql-text-parser';
export type { SqlTextMap, ParsedSqlTextData } from './sql-text-parser';
