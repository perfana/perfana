import type { CompareTemplateDefinition } from '@/lib/compare-templates';

/**
 * The ADAPT template dialog's state, and its mapping to and from a template definition.
 *
 * Why not the anomaly card's `MetricConfigForm`: that form always writes every field, and a
 * template's whole meaning is which fields it names. An override a template names is forced onto
 * every row it reaches; one it leaves out keeps each row's own value. So each override here carries
 * a `set` flag, and `higherIsBetter` has a third value, "no direction" (`null`), which the anomaly
 * card cannot express. The option lists are shared (`@/lib/compare-config-options`).
 */

/** A numeric override as typed. `initial` keeps the stored number exact while the text is untouched. */
interface NumberField {
  set: boolean;
  text: string;
  initialText: string;
  initial?: number;
}

export type Direction = 'higher' | 'lower' | 'none';

export interface TemplateFormState {
  dashboardUid: string;
  regex: boolean;
  dashboardLabel: string;
  panelMode: 'id' | 'title';
  panelId: string;
  panelTitle: string;
  metricName: string;
  metricClassification: string;
  direction: { set: boolean; value: Direction };
  ignore: { set: boolean; value: boolean };
  aggregation: { set: boolean; value: string };
  /** Typed as a percent; stored as a fraction (15 -> 0.15). */
  percentageThreshold: NumberField;
  iqrThreshold: NumberField;
  /** `none` forces "no absolute threshold" (`absThreshold: null`). */
  absThreshold: NumberField & { none: boolean };
  minSampleCount: NumberField;
  ignoreMeanDiffSmallerThan: NumberField;
  defaultValueIfControlGroupMissing: NumberField;
}

export type TemplateFormErrors = Partial<Record<keyof TemplateFormState, string>>;

/** A number without float noise: 0.15 * 100 is 15.000000000000002. */
const clean = (n: number): number => Number(n.toPrecision(12));

const numberField = (value: number | null | undefined, display: (n: number) => number = (n) => n): NumberField => {
  const text = typeof value === 'number' ? String(clean(display(value))) : '';
  return { set: typeof value === 'number', text, initialText: text, initial: typeof value === 'number' ? value : undefined };
};

const DIRECTION_OF: Record<string, Direction> = { true: 'higher', false: 'lower', null: 'none' };

export function toFormState(definition?: CompareTemplateDefinition): TemplateFormState {
  const d: Partial<CompareTemplateDefinition> = definition ?? {};
  const has = (k: keyof CompareTemplateDefinition) => Object.prototype.hasOwnProperty.call(d, k);
  return {
    dashboardUid: d.dashboardUid ?? '',
    regex: d.regex === true,
    dashboardLabel: d.dashboardLabel ?? '',
    panelMode: definition && d.panelId == null && d.panelTitle != null ? 'title' : 'id',
    panelId: d.panelId != null ? String(d.panelId) : '',
    panelTitle: d.panelTitle ?? '',
    metricName: d.metricName ?? '',
    metricClassification: d.metricClassification ?? '',
    // Unnamed, the select starts on "lower is better", the anomaly card's own default.
    direction: { set: has('higherIsBetter'), value: has('higherIsBetter') ? DIRECTION_OF[String(d.higherIsBetter)] ?? 'none' : 'lower' },
    ignore: { set: has('ignore'), value: d.ignore === true },
    aggregation: { set: has('aggregation'), value: d.aggregation ?? 'mean' },
    percentageThreshold: numberField(d.percentageThreshold, (f) => f * 100),
    iqrThreshold: numberField(d.iqrThreshold),
    absThreshold: { ...numberField(d.absThreshold), set: has('absThreshold'), none: has('absThreshold') && d.absThreshold === null },
    minSampleCount: numberField(d.minSampleCount),
    ignoreMeanDiffSmallerThan: numberField(d.ignoreMeanDiffSmallerThan),
    defaultValueIfControlGroupMissing: numberField(d.defaultValueIfControlGroupMissing),
  };
}

const parseNumber = (text: string): number | null => {
  if (text.trim() === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
};

/**
 * The definition the dialog describes, or the errors that stop it. The server runs the same rules
 * the YAML file is held to and is the authority; these catch the obvious ones before a round trip.
 */
export function toDefinition(state: TemplateFormState): { definition?: CompareTemplateDefinition; errors: TemplateFormErrors } {
  const errors: TemplateFormErrors = {};
  const def: CompareTemplateDefinition = { metricClassification: state.metricClassification.trim() };
  if (!def.metricClassification) errors.metricClassification = 'Choose a classification';

  const uid = state.dashboardUid.trim();
  if (uid) def.dashboardUid = uid;
  // Written only when true, as the export writes it. Part of the template's identity, so it is kept
  // exactly as toggled even where there is no pattern for it to apply to.
  if (state.regex) def.regex = true;
  const label = state.dashboardLabel.trim();
  if (label) def.dashboardLabel = label;

  const title = state.panelTitle.trim();
  if (state.panelMode === 'id') {
    const id = Number(state.panelId);
    if (state.panelId.trim() === '' || !Number.isInteger(id)) errors.panelId = 'A panel id is a whole number';
    else def.panelId = id;
    // Beside an id the title is a label, kept so the table can say which panel it is.
    if (title) def.panelTitle = title;
  } else if (!title) {
    errors.panelTitle = 'Enter the panel title to match';
  } else {
    def.panelTitle = title;
  }

  const metric = state.metricName.trim();
  if (metric) def.metricName = metric;

  if (state.direction.set) def.higherIsBetter = state.direction.value === 'none' ? null : state.direction.value === 'higher';
  if (state.ignore.set) def.ignore = state.ignore.value;
  if (state.aggregation.set) def.aggregation = state.aggregation.value;

  /** A set numeric field: the stored number while untouched, else the typed one, validated. */
  const read = (
    key: 'percentageThreshold' | 'iqrThreshold' | 'absThreshold' | 'minSampleCount' | 'ignoreMeanDiffSmallerThan' | 'defaultValueIfControlGroupMissing',
    check: (n: number) => string | null,
    store: (n: number) => number = (n) => n,
  ): number | undefined => {
    const field = state[key];
    if (field.text === field.initialText && field.initial !== undefined) return field.initial;
    const n = parseNumber(field.text);
    const problem = n === null ? 'Enter a number' : check(n);
    if (problem) {
      errors[key] = problem;
      return undefined;
    }
    return store(n!);
  };

  if (state.percentageThreshold.set) {
    const v = read('percentageThreshold', (n) => (n < 0 || n > 100 ? 'A percentage from 0 to 100' : null), (n) => clean(n / 100));
    if (v !== undefined) def.percentageThreshold = v;
  }
  if (state.iqrThreshold.set) {
    const v = read('iqrThreshold', (n) => (n < 0 ? 'At least 0' : null));
    if (v !== undefined) def.iqrThreshold = v;
  }
  if (state.absThreshold.set) {
    if (state.absThreshold.none) def.absThreshold = null;
    else {
      const v = read('absThreshold', (n) => (n < 0 ? 'At least 0' : null));
      if (v !== undefined) def.absThreshold = v;
    }
  }
  if (state.minSampleCount.set) {
    const v = read('minSampleCount', (n) => (!Number.isInteger(n) || n < 1 ? 'A whole number of at least 1' : null));
    if (v !== undefined) def.minSampleCount = v;
  }
  if (state.ignoreMeanDiffSmallerThan.set) {
    const v = read('ignoreMeanDiffSmallerThan', (n) => (n < 0 ? 'At least 0' : null));
    if (v !== undefined) def.ignoreMeanDiffSmallerThan = v;
  }
  if (state.defaultValueIfControlGroupMissing.set) {
    const v = read('defaultValueIfControlGroupMissing', () => null);
    if (v !== undefined) def.defaultValueIfControlGroupMissing = v;
  }

  return Object.keys(errors).length > 0 ? { errors } : { definition: def, errors };
}
