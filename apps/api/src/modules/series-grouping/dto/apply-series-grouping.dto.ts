import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export const SERIES_GROUPING_APPLY_SCOPES = ['baseline', 'recent'] as const;
export type SeriesGroupingApplyScope = (typeof SERIES_GROUPING_APPLY_SCOPES)[number];

export class ApplySeriesGroupingDto {
  @ApiProperty({ description: 'The run being looked at (its `test_run_id`, or the entity UUID)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  testRunId!: string;

  @ApiProperty({
    enum: SERIES_GROUPING_APPLY_SCOPES,
    description:
      '`baseline`: the run plus its current baseline runs. `recent`: the run plus the workload\'s most ' +
      'recent completed runs, truncated at the bulk cap.',
  })
  @IsIn(SERIES_GROUPING_APPLY_SCOPES as unknown as string[])
  scope!: SeriesGroupingApplyScope;
}
