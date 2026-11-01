import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateSeriesGroupingRuleDto } from './create-series-grouping-rule.dto';

/**
 * Every rule field, all optional — except the slot. The slot (system, environment, workload,
 * dashboard, panel) is what the rule IS: moving it would silently regroup a different panel and
 * leave the old one's membership stale. Re-scoping is a delete and a create. `origin` and
 * `copyTo` are create-time only.
 *
 * `PartialType` + `@IsOptional()` lets an explicit `null` through as well as an absent key, so the
 * service treats `null` like "absent" for every field here (none of them is nullable).
 */
export class UpdateSeriesGroupingRuleDto extends PartialType(
  OmitType(CreateSeriesGroupingRuleDto, [
    'systemUnderTestId',
    'testEnvironment',
    'workload',
    'applicationDashboardId',
    'panelId',
    'origin',
    'copyTo',
  ] as const),
) {}
