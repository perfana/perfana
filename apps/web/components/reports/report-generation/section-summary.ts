import type { ReportSectionConfig } from '@/lib/api/reports';
import type {
  ComparisonsConfig,
  HeaderConfig,
  TextBlockConfig,
  TransactionResponseTimesConfig,
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
  const comment =
    trim(section.comment) ?? trim((section.config as { comment?: unknown } | undefined)?.comment);
  switch (section.type) {
    case 'header': {
      const cfg = (section.config ?? {}) as HeaderConfig;
      const text = trim(cfg.text);
      const level =
        typeof cfg.level === 'number' && Number.isInteger(cfg.level) && cfg.level >= 1 && cfg.level <= 6
          ? cfg.level
          : 1;
      return text ? `H${level} — ${text}` : comment;
    }
    case 'text_block': {
      const cfg = (section.config ?? {}) as TextBlockConfig;
      return trim(cfg.content) ?? comment;
    }
    case 'transaction_response_times': {
      const cfg = (section.config ?? {}) as TransactionResponseTimesConfig;
      const scenario = trim(cfg.scenario);
      return scenario ? `Scenario: ${scenario}` : comment;
    }
    case 'comparisons': {
      const cfg = (section.config ?? {}) as ComparisonsConfig;
      if (cfg.comparisonMode !== 'baseline_run') return comment;
      const panelCount = Array.isArray(cfg.panels) ? cfg.panels.length : 0;
      return [
        'Baseline run',
        trim(cfg.dashboardLabel),
        panelCount ? `${panelCount} panel${panelCount === 1 ? '' : 's'}` : null,
        comment,
      ]
        .filter(Boolean)
        .join(' · ');
    }
    default:
      // ponytail: no naming field in these configs — the comment is the only distinguisher
      return comment;
  }
}
