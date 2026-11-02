/**
 * The preview and apply bodies are validated by the global ValidationPipe; these pin that the rule
 * inside the preview body is held to the SAME validators as the create body (PickType carries the
 * class-validator metadata), including through the nested object.
 */

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ApplySeriesGroupingDto } from './apply-series-grouping.dto';
import { CreateSeriesGroupingRuleDto } from './create-series-grouping-rule.dto';
import { PreviewSeriesGroupingDto } from './preview-series-grouping.dto';

const DASHBOARD = '5f1c0f9e-0000-4000-8000-000000000001';
const rule = { preset: 'k8s-pod', aggregation: 'avg', trackMemberCount: false };

async function errorsOf<T extends object>(cls: new () => T, plain: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain));
  const flat = (list: typeof errors, prefix = ''): string[] =>
    list.flatMap((e) => [
      ...(e.constraints ? [`${prefix}${e.property}`] : []),
      ...flat(e.children ?? [], `${prefix}${e.property}.`),
    ]);
  return flat(errors);
}

describe('PreviewSeriesGroupingDto', () => {
  it('accepts a run-based body and a workload-based body', async () => {
    expect(await errorsOf(PreviewSeriesGroupingDto, { testRunId: 'run-001', applicationDashboardId: DASHBOARD, rule })).toEqual([]);
    expect(
      await errorsOf(PreviewSeriesGroupingDto, {
        systemId: DASHBOARD,
        environment: 'acc',
        workload: 'peak',
        applicationDashboardId: DASHBOARD,
        panelId: null,
        rule,
      }),
    ).toEqual([]);
  });

  it('holds the nested rule to the create body\'s validators', async () => {
    const bad = (patch: Record<string, unknown>) =>
      errorsOf(PreviewSeriesGroupingDto, { testRunId: 'r', applicationDashboardId: DASHBOARD, rule: { ...rule, ...patch } });

    expect(await bad({ preset: 'nonsense' })).toEqual(['rule.preset']);
    expect(await bad({ aggregation: 'median' })).toEqual(['rule.aggregation']);
    expect(await bad({ trackMemberCount: 'yes' })).toEqual(['rule.trackMemberCount']);
    expect(await bad({ pattern: 'x'.repeat(501) })).toEqual(['rule.pattern']);
    expect(await bad({ replacement: 'x'.repeat(256) })).toEqual(['rule.replacement']);
  });

  it('requires a rule and a dashboard id', async () => {
    expect(await errorsOf(PreviewSeriesGroupingDto, { testRunId: 'r', applicationDashboardId: DASHBOARD })).toEqual(['rule']);
    expect(await errorsOf(PreviewSeriesGroupingDto, { testRunId: 'r', applicationDashboardId: 'nope', rule })).toEqual([
      'applicationDashboardId',
    ]);
  });

  it('rejects a negative or fractional panel id', async () => {
    expect(await errorsOf(PreviewSeriesGroupingDto, { testRunId: 'r', applicationDashboardId: DASHBOARD, panelId: -1, rule })).toEqual(['panelId']);
    expect(await errorsOf(PreviewSeriesGroupingDto, { testRunId: 'r', applicationDashboardId: DASHBOARD, panelId: 1.5, rule })).toEqual(['panelId']);
  });

  it('uses the very same rule validators as the create body', () => {
    // A field added to the create body's rule must reach the preview, or a body one route accepts
    // the other would refuse.
    const fields = ['preset', 'pattern', 'replacement', 'aggregation', 'trackMemberCount'];
    const meta = (cls: object, field: string) =>
      Reflect.getMetadata('swagger/apiModelProperties', (cls as { prototype: object }).prototype, field);
    for (const field of fields) {
      expect(meta(CreateSeriesGroupingRuleDto, field)).toBeDefined();
    }
  });
});

describe('ApplySeriesGroupingDto', () => {
  it('accepts both scopes', async () => {
    expect(await errorsOf(ApplySeriesGroupingDto, { testRunId: 'run-001', scope: 'baseline' })).toEqual([]);
    expect(await errorsOf(ApplySeriesGroupingDto, { testRunId: 'run-001', scope: 'recent' })).toEqual([]);
  });

  it('rejects an unknown scope and a missing run', async () => {
    expect(await errorsOf(ApplySeriesGroupingDto, { testRunId: 'run-001', scope: 'all' })).toEqual(['scope']);
    expect(await errorsOf(ApplySeriesGroupingDto, { scope: 'baseline' })).toEqual(['testRunId']);
  });
});
