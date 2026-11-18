import { SERIES_GROUPING_AGGREGATION_VALUES, SERIES_GROUPING_PRESET_VALUES } from './create-series-grouping-rule.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { SeriesGroupingAggregation, SeriesGroupingPreset } from '@perfana/shared/utils';
import type { SeriesGroupingRuleOrigin } from '@perfana/shared/entities';

export class SeriesGroupingRuleResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() systemUnderTestId!: string;
  @ApiProperty() testEnvironment!: string;
  @ApiProperty() workload!: string;
  @ApiProperty() applicationDashboardId!: string;
  @ApiProperty({ nullable: true, type: Number, description: 'null = every panel on the dashboard' })
  panelId!: number | null;
  @ApiProperty({ enum: SERIES_GROUPING_PRESET_VALUES }) preset!: SeriesGroupingPreset;
  @ApiProperty({ nullable: true, type: String }) pattern!: string | null;
  @ApiProperty() replacement!: string;
  @ApiProperty({ enum: SERIES_GROUPING_AGGREGATION_VALUES, isArray: true })
  aggregations!: SeriesGroupingAggregation[];
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ enum: ['manual', 'suggestion', 'copy', 'profile'] }) origin!: SeriesGroupingRuleOrigin;
  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'The profile rule this row was provisioned from. It follows that rule while `updatedBy` is null; any save here detaches it.',
  })
  profileRuleId!: string | null;
  @ApiPropertyOptional() createdBy?: string;
  @ApiPropertyOptional() updatedBy?: string;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export type SeriesGroupingCopySkipReason =
  | 'exists'
  | 'no-dashboard'
  | 'ambiguous-dashboard'
  | 'unknown-workload'
  | 'not-writable'
  | 'same-slot';

export class SeriesGroupingCopySkipDto {
  @ApiProperty() testEnvironment!: string;
  @ApiProperty() workload!: string;
  @ApiProperty({ enum: ['exists', 'no-dashboard', 'ambiguous-dashboard', 'unknown-workload', 'not-writable', 'same-slot'] })
  reason!: SeriesGroupingCopySkipReason;
}

export class SeriesGroupingCreateResultDto {
  @ApiProperty({ type: SeriesGroupingRuleResponseDto }) rule!: SeriesGroupingRuleResponseDto;
  @ApiProperty({ description: 'Copies created and skipped for `copyTo`' })
  copies!: { created: SeriesGroupingRuleResponseDto[]; skipped: SeriesGroupingCopySkipDto[] };
}
