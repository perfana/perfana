/**
 * AWR Parsers Barrel Export
 *
 * Re-exports all AWR parser classes and types for convenient importing.
 * The main entry point is the HtmlAwrParser class which orchestrates
 * all section parsers using the Strategy pattern.
 *
 * @example
 * import { HtmlAwrParser, HeaderParser, BaseSectionParser } from '../parsers';
 *
 * // Using the main orchestrator
 * const parser = new HtmlAwrParser();
 * const result = parser.parse(awrHtml);
 *
 * // Using individual section parsers
 * const headerParser = new HeaderParser();
 * const header = headerParser.parse(awrHtml);
 */

// Main parser orchestrator
export { HtmlAwrParser } from './html-parser';
export type { HtmlAwrParserOptions } from './html-parser';

// Base parser class and types
export { BaseSectionParser } from './base-parser';
export type {
  SectionParseResult,
  ParserOptions,
  ParserConstructor,
  ParserRegistryEntry,
} from './base-parser';

// Section parsers
export {
  HeaderParser,
  LoadProfileParser,
  SqlParser,
  WaitEventsParser,
} from './sections';
