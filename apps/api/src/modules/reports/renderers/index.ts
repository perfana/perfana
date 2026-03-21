/**
 * Section Renderers
 *
 * This module exports all section-specific renderer services.
 * Each renderer is responsible for generating HTML for a specific report section type.
 */

export { HeaderRenderer } from './header-renderer';
export { TextBlockRenderer } from './text-block-renderer';
export { SloRenderer } from './slo-renderer';
export { ApdexRenderer } from './apdex-renderer';
export { TransactionResponseTimesRenderer } from './transaction-response-times-renderer';
export { RegressionsRenderer } from './regressions-renderer';
export { AwrRenderer } from './awr-renderer';
export { TrendsRenderer } from './trends-renderer';
export { ComparisonsRenderer } from './comparisons-renderer';
export { GraphsRenderer } from './graphs-renderer';
export { PlaceholderRenderer } from './placeholder-renderer';
