import { getSectionText, type ReportSectionConfig } from '@/lib/api/reports';
import type {
  ComparisonsConfig,
  HeaderConfig,
  TextBlockConfig,
  TransactionResponseTimesConfig,
  ErrorAnalysisConfig,
  Top10ListsConfig,
} from './SectionConfigs';

export const SUMMARY_MAX_LENGTH = 90;

// Config values come from DB-stored templates that can also be written via the
// API, so treat every field as untrusted JSON rather than validated form output.
const trim = (v: unknown, max = SUMMARY_MAX_LENGTH): string | null => {
  if (typeof v !== 'string') return null;
  const t = v
    .slice(0, max * 8) // bound the regex work; this runs in the render path
    .replace(/[\uD800-\uDBFF]$/, '') // don't leave a split surrogate pair at the cut
    .trim()
    .replace(/\s+/g, ' ');
  if (!t) return null;
  const chars = [...t];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : t;
};

// Collapsed-header summary derived from the section's own config, so multiple
// instances of the same section type can be told apart without expanding them.
export function sectionSummary(section: ReportSectionConfig): string | null {
  const text = trim(getSectionText(section));
  switch (section.type) {
    case 'header': {
      const cfg = (section.config ?? {}) as HeaderConfig;
      const caption = trim(cfg.text);
      const level =
        typeof cfg.level === 'number' && Number.isInteger(cfg.level) && cfg.level >= 1 && cfg.level <= 6
          ? cfg.level
          : 1;
      return caption ? `H${level} — ${caption}` : text;
    }
    case 'text_block': {
      const cfg = (section.config ?? {}) as TextBlockConfig;
      return trim(cfg.content) ?? text;
    }
    case 'transaction_response_times': {
      const cfg = (section.config ?? {}) as TransactionResponseTimesConfig;
      const scenarios = Array.isArray(cfg.scenarios) && cfg.scenarios.length > 0
        ? cfg.scenarios
        : trim(cfg.scenario) && trim(cfg.scenario) !== 'all' ? [trim(cfg.scenario)] : [];
      const parts = [
        scenarios.length > 0 ? `Scenarios: ${scenarios.join(', ')}` : 'All scenarios',
        cfg.includeChildRequests ? 'with child requests' : '',
      ].filter(Boolean);
      return parts.join(' · ') || text;
    }
    case 'error_analysis': {
      const cfg = (section.config ?? {}) as ErrorAnalysisConfig;
      const scenarios = Array.isArray(cfg.scenarios) && cfg.scenarios.length > 0 ? cfg.scenarios : [];
      return [
        scenarios.length > 0 ? `Scenarios: ${scenarios.join(', ')}` : 'All scenarios',
        cfg.includeChart === false ? 'no chart' : '',
      ].filter(Boolean).join(' · ');
    }
    case 'comparisons': {
      const cfg = (section.config ?? {}) as ComparisonsConfig;
      const dashboards = Array.isArray(cfg.dashboardLabels)
        ? cfg.dashboardLabels
        : cfg.dashboardLabel ? [cfg.dashboardLabel] : [];
      const panelCount = Array.isArray(cfg.panels) ? cfg.panels.length : 0;
      const seriesCount = Array.isArray(cfg.series) ? cfg.series.length : 0;
      return [
        'Baseline run',
        dashboards.length === 1 ? trim(dashboards[0]) : dashboards.length ? `${dashboards.length} dashboards` : null,
        panelCount ? `${panelCount} panel${panelCount === 1 ? '' : 's'}` : null,
        seriesCount ? `${seriesCount} series` : null,
        text,
      ]
        .filter(Boolean)
        .join(' · ');
    }
    case 'top_10_lists': {
      const cfg = (section.config ?? {}) as Top10ListsConfig;
      const scopeLabel =
        cfg.scope === 'requests' ? 'Requests' : cfg.scope === 'urls' ? 'URLs' : 'Transactions';
      const count = Array.isArray(cfg.lists) && cfg.lists.length > 0 ? cfg.lists.length : 4;
      return `${scopeLabel} · ${count} list${count === 1 ? '' : 's'}`;
    }
    default:
      // ponytail: no naming field in these configs — the text is the only distinguisher
      return text;
  }
}
