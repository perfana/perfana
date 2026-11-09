/**
 * The template dialog's state <-> definition mapping. A template's meaning is which fields it
 * names, so the mapping has to keep presence exactly: an unticked field is omitted (each panel keeps
 * its own value), a ticked one is sent, and "no direction" / "no absolute threshold" are `null`.
 */
import { toDefinition, toFormState } from '../template-form';
import type { CompareTemplateDefinition } from '@/lib/compare-templates';

const full: CompareTemplateDefinition = {
  dashboardUid: '^jvm-',
  regex: true,
  dashboardLabel: 'JVM',
  panelId: 7,
  panelTitle: 'Heap',
  metricName: 'heap used',
  metricClassification: 'USE_saturation',
  higherIsBetter: null,
  absThreshold: null,
  ignore: false,
  ignoreMeanDiffSmallerThan: 0,
  percentageThreshold: 0.15,
  iqrThreshold: 2,
  aggregation: 'q95',
  minSampleCount: 3,
  defaultValueIfControlGroupMissing: 0,
};

describe('template form', () => {
  it('round-trips every field a template can name, explicit nulls and defaults included', () => {
    expect(toDefinition(toFormState(full))).toEqual({ definition: full, errors: {} });
  });

  it('omits every override that is not ticked', () => {
    const minimal: CompareTemplateDefinition = { panelTitle: 'CPU Usage', metricClassification: 'USE_utilization' };
    expect(toDefinition(toFormState(minimal)).definition).toEqual(minimal);
  });

  it('shows a stored fraction as a percent and stores a typed percent as a fraction', () => {
    const state = toFormState({ panelId: 1, metricClassification: 'x', percentageThreshold: 0.15 });
    expect(state.percentageThreshold.text).toBe('15'); // not 15.000000000000002
    state.percentageThreshold.text = '7.5';
    expect(toDefinition(state).definition?.percentageThreshold).toBe(0.075);
  });

  /**
   * Value: protects=opening and saving a template without touching a number does not rewrite it,
   *   so a provisioned value with more precision than the field shows survives a copy unchanged;
   * fails_when=the stored value is re-derived from the displayed text;
   * why_new=new dialog; seam=none
   */
  it('keeps a stored number exact while its text is untouched', () => {
    const state = toFormState({ panelId: 1, metricClassification: 'x', percentageThreshold: 0.1234567890123456 });
    expect(toDefinition(state).definition?.percentageThreshold).toBe(0.1234567890123456);
  });

  it('maps the three directions, and ticking a field with its default still names it', () => {
    const state = toFormState({ panelId: 1, metricClassification: 'x' });
    state.direction = { set: true, value: 'higher' };
    expect(toDefinition(state).definition?.higherIsBetter).toBe(true);
    state.direction = { set: true, value: 'lower' };
    expect(toDefinition(state).definition?.higherIsBetter).toBe(false);
    state.direction = { set: true, value: 'none' };
    expect(toDefinition(state).definition).toHaveProperty('higherIsBetter', null);
    state.aggregation = { set: true, value: 'mean' };
    expect(toDefinition(state).definition?.aggregation).toBe('mean');
  });

  it('selects by title: the title is the key and a panel id is not sent', () => {
    const state = toFormState({ panelId: 1, metricClassification: 'x' });
    state.panelMode = 'title';
    state.panelTitle = 'CPU.*';
    state.regex = true;
    expect(toDefinition(state).definition).toEqual({ regex: true, panelTitle: 'CPU.*', metricClassification: 'x' });
  });

  it('opens a title template in title mode and an id template in id mode', () => {
    expect(toFormState({ panelTitle: 'CPU', metricClassification: 'x' }).panelMode).toBe('title');
    expect(toFormState({ panelId: 3, panelTitle: 'CPU', metricClassification: 'x' }).panelMode).toBe('id');
    expect(toFormState().panelMode).toBe('id');
  });

  it.each([
    ['no classification', (s: ReturnType<typeof toFormState>) => { s.metricClassification = ''; }, 'metricClassification'],
    ['a fractional panel id', (s: ReturnType<typeof toFormState>) => { s.panelId = '1.5'; }, 'panelId'],
    ['an empty title in title mode', (s: ReturnType<typeof toFormState>) => { s.panelMode = 'title'; s.panelTitle = ' '; }, 'panelTitle'],
    ['a percent over 100', (s: ReturnType<typeof toFormState>) => { s.percentageThreshold = { ...s.percentageThreshold, set: true, text: '150' }; }, 'percentageThreshold'],
    ['a fractional sample count', (s: ReturnType<typeof toFormState>) => { s.minSampleCount = { ...s.minSampleCount, set: true, text: '2.5' }; }, 'minSampleCount'],
    ['a ticked number left empty', (s: ReturnType<typeof toFormState>) => { s.iqrThreshold = { ...s.iqrThreshold, set: true, text: '' }; }, 'iqrThreshold'],
  ] as const)('refuses %s', (_label, mutate, field) => {
    const state = toFormState({ panelId: 1, metricClassification: 'x' });
    mutate(state);
    const { definition, errors } = toDefinition(state);
    expect(definition).toBeUndefined();
    expect(errors).toHaveProperty(field);
  });

  it('ignores a number typed into a field that is not ticked', () => {
    const state = toFormState({ panelId: 1, metricClassification: 'x' });
    state.iqrThreshold = { ...state.iqrThreshold, set: false, text: 'garbage' };
    expect(toDefinition(state).definition).toEqual({ panelId: 1, metricClassification: 'x' });
  });
});
