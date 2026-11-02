import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { SeriesGroupingAggregation, SeriesGroupingPreset } from '@perfana/shared/utils';

export const SERIES_GROUPING_PRESET_VALUES: readonly SeriesGroupingPreset[] = [
  'k8s-pod',
  'k8s-daemonset',
  'ip-port',
  'trailing-id',
  'custom',
];
export const SERIES_GROUPING_AGGREGATION_VALUES: readonly SeriesGroupingAggregation[] = ['avg', 'sum', 'max'];

/** Another workload of the SAME system to create the rule for as well (design Decision 2). */
export class SeriesGroupingCopyTargetDto {
  @ApiProperty({ example: 'acceptance' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  testEnvironment!: string;

  @ApiProperty({ example: 'peak-load' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  workload!: string;
}

export class CreateSeriesGroupingRuleDto {
  @ApiProperty({ description: 'System under test the rule belongs to' })
  @IsUUID()
  systemUnderTestId!: string;

  @ApiProperty({ example: 'acceptance' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  testEnvironment!: string;

  @ApiProperty({ example: 'peak-load', description: 'Rules are per workload, like the analysis window.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  workload!: string;

  @ApiProperty({ description: 'Application dashboard of that system and environment' })
  @IsUUID()
  applicationDashboardId!: string;

  @ApiPropertyOptional({
    description: 'Panel the rule applies to. Omit or null for every panel on the dashboard; a panel rule overrides it.',
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  panelId?: number | null;

  @ApiProperty({ enum: SERIES_GROUPING_PRESET_VALUES })
  @IsIn(SERIES_GROUPING_PRESET_VALUES as string[])
  preset!: SeriesGroupingPreset;

  @ApiPropertyOptional({ description: 'Regular expression, required for and only used by the custom preset' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  pattern?: string;

  @ApiPropertyOptional({ description: 'Replacement for a custom pattern (`$1` allowed); presets carry their own' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  replacement?: string;

  @ApiProperty({ enum: SERIES_GROUPING_AGGREGATION_VALUES, description: 'How members combine per timestamp' })
  @IsIn(SERIES_GROUPING_AGGREGATION_VALUES as string[])
  aggregation!: SeriesGroupingAggregation;

  @ApiProperty({ description: 'Also write a "<group> (pod count)" series per group' })
  @IsBoolean()
  trackMemberCount!: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    enum: ['manual', 'suggestion'],
    description: 'How the rule was created; `copy` is set by the server for copies. Feeds suggestion tuning.',
  })
  @IsOptional()
  @IsIn(['manual', 'suggestion'])
  origin?: 'manual' | 'suggestion';

  @ApiPropertyOptional({ type: [SeriesGroupingCopyTargetDto], description: 'Other workloads of the same system' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SeriesGroupingCopyTargetDto)
  copyTo?: SeriesGroupingCopyTargetDto[];
}
