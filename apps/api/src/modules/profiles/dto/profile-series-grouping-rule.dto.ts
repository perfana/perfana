import { ApiProperty, ApiPropertyOptional, OmitType, PartialType, PickType } from '@nestjs/swagger';
import type { SeriesGroupingAggregation, SeriesGroupingPreset } from '@perfana/shared/utils';
import {
  CreateSeriesGroupingRuleDto,
  SERIES_GROUPING_AGGREGATION_VALUES,
  SERIES_GROUPING_PRESET_VALUES,
} from '../../series-grouping/dto/create-series-grouping-rule.dto';

/** The rule fields of a workload rule, with the slot reduced to a panel of the profile dashboard. */
export class CreateProfileSeriesGroupingRuleDto extends PickType(CreateSeriesGroupingRuleDto, [
  'panelId',
  'preset',
  'pattern',
  'replacement',
  'aggregations',
  'enabled',
] as const) {}

/** Every rule field except the panel: the slot is what the rule IS, so moving it is a delete and a create. */
export class UpdateProfileSeriesGroupingRuleDto extends PartialType(
  OmitType(CreateProfileSeriesGroupingRuleDto, ['panelId'] as const),
) {}

export class ProfileSeriesGroupingRuleResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() profileDashboardId!: string;
  @ApiProperty({ nullable: true, type: Number, description: 'null = every panel on the dashboard' })
  panelId!: number | null;
  @ApiProperty({ enum: SERIES_GROUPING_PRESET_VALUES }) preset!: SeriesGroupingPreset;
  @ApiProperty({ nullable: true, type: String }) pattern!: string | null;
  @ApiProperty() replacement!: string;
  @ApiProperty({ enum: SERIES_GROUPING_AGGREGATION_VALUES, isArray: true })
  aggregations!: SeriesGroupingAggregation[];
  @ApiProperty() enabled!: boolean;
  @ApiPropertyOptional() createdBy?: string;
  @ApiPropertyOptional() updatedBy?: string;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}
