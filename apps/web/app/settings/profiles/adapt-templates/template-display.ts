import type { CompareTemplateDefinition } from '@/lib/compare-templates';
import { AGGREGATION_OPTIONS, CLASSIFICATION_OPTIONS, optionLabel } from '@/lib/compare-config-options';

/** How the ADAPT templates table reads a definition. Pure, so the wording is tested in one place. */

export function dashboardText(d: CompareTemplateDefinition): string {
  return d.dashboardUid ?? 'Every dashboard';
}

export function panelText(d: CompareTemplateDefinition): string {
  if (d.panelId != null) return d.panelTitle ? `#${d.panelId} ${d.panelTitle}` : `#${d.panelId}`;
  return d.panelTitle ?? '';
}

/** Whether the panel title is a pattern: only when there is no panel id to match on. */
export function panelIsPattern(d: CompareTemplateDefinition): boolean {
  return d.regex === true && d.panelId == null;
}

export function metricText(d: CompareTemplateDefinition): string {
  return d.metricName ?? 'Whole panel';
}

/** The template's identity in one line: which dashboards, which panel, which series. */
export function describeKey(d: CompareTemplateDefinition): string {
  const dashboard = d.dashboardUid ? `${d.regex ? 'Dashboards matching' : 'Dashboard'} ${d.dashboardUid}` : 'Every dashboard';
  const panel =
    d.panelId != null ? `panel ${panelText(d)}` : `panel ${panelIsPattern(d) ? 'titles matching' : 'titled'} "${d.panelTitle ?? ''}"`;
  return `${dashboard} · ${panel} · ${metricText(d)}`;
}

export function classificationText(d: CompareTemplateDefinition): string {
  return optionLabel(CLASSIFICATION_OPTIONS, d.metricClassification);
}

const percent = (fraction: number) => `${Number((fraction * 100).toPrecision(12))} %`;

/**
 * One phrase per field the template forces, in the export's key order. A field it leaves out is not
 * listed, because it leaves each row's own value alone.
 */
export function forcedFields(d: CompareTemplateDefinition): string[] {
  const out: string[] = [];
  const has = (k: keyof CompareTemplateDefinition) => Object.prototype.hasOwnProperty.call(d, k);
  if (has('higherIsBetter')) {
    out.push(d.higherIsBetter === true ? 'Higher is better' : d.higherIsBetter === false ? 'Lower is better' : 'No direction');
  }
  if (has('absThreshold')) out.push(d.absThreshold === null ? 'No absolute threshold' : `Absolute threshold ${d.absThreshold}`);
  if (has('ignore')) out.push(d.ignore ? 'Ignored' : 'Not ignored');
  if (has('percentageThreshold')) out.push(`Percentage ${percent(d.percentageThreshold!)}`);
  if (has('iqrThreshold')) out.push(`IQR × ${d.iqrThreshold}`);
  if (has('aggregation')) out.push(optionLabel(AGGREGATION_OPTIONS, d.aggregation!));
  if (has('minSampleCount')) out.push(`At least ${d.minSampleCount} sample${d.minSampleCount === 1 ? '' : 's'}`);
  if (has('defaultValueIfControlGroupMissing')) out.push(`Default without control group ${d.defaultValueIfControlGroupMissing}`);
  return out;
}
