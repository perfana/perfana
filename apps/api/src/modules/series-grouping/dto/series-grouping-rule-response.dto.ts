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
  @ApiProperty() preset!: SeriesGroupingPreset;
  @ApiProperty({ nullable: true, type: String }) pattern!: string | null;
  @ApiProperty() replacement!: string;
  @ApiProperty() aggregation!: SeriesGroupingAggregation;
  @ApiProperty() trackMemberCount!: boolean;
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ enum: ['manual', 'suggestion', 'copy'] }) origin!: SeriesGroupingRuleOrigin;
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
