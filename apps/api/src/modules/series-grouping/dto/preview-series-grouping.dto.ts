import { Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { CreateSeriesGroupingRuleDto } from './create-series-grouping-rule.dto';

/**
 * The rule being previewed: the five fields that define what a rule DOES, with the very same
 * validators the create body uses (`PickType` carries the class-validator metadata along), so a
 * body the preview accepts is one the create route accepts too.
 */
export class SeriesGroupingRuleSpecDto extends PickType(CreateSeriesGroupingRuleDto, [
  'preset',
  'pattern',
  'replacement',
  'aggregation',
  'trackMemberCount',
] as const) {}

export class PreviewSeriesGroupingDto {
  @ApiPropertyOptional({
    description:
      'Run to preview against (its `test_run_id`, or the entity UUID). Omit it, and name systemId + ' +
      'environment + workload instead, to use the workload\'s most recent completed run: the system ' +
      'configuration entry point has no run in hand.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  testRunId?: string;

  @ApiPropertyOptional({ description: 'System under test; used only when `testRunId` is omitted' })
  @IsOptional()
  @IsUUID()
  systemId?: string;

  @ApiPropertyOptional({ description: 'Test environment; used only when `testRunId` is omitted' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  environment?: string;

  @ApiPropertyOptional({ description: 'Workload; used only when `testRunId` is omitted' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  workload?: string;

  @ApiProperty({ description: 'Application dashboard of the run\'s system and environment' })
  @IsUUID()
  applicationDashboardId!: string;

  @ApiPropertyOptional({ nullable: true, description: 'One panel; omit or null for every panel of the dashboard' })
  @IsOptional()
  @IsInt()
  @Min(0)
  panelId?: number | null;

  // `@ValidateNested()` alone lets a MISSING rule through (it only looks inside an object it is
  // given), and the service would then fail on `undefined.preset` with a 500.
  @ApiProperty({ type: SeriesGroupingRuleSpecDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => SeriesGroupingRuleSpecDto)
  rule!: SeriesGroupingRuleSpecDto;
}
