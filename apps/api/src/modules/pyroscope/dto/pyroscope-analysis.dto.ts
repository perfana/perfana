import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsNumber, Min, IsOptional } from 'class-validator';

/**
 * Request DTO for analyzing Pyroscope flamegraphs between two test runs
 */
export class AnalyzeFlamegraphDto {
  @ApiProperty({
    description: 'Pyroscope backend API URL for programmatic access',
    example: 'http://localhost:4040'
  })
  @IsString()
  @IsNotEmpty()
  backendUrl: string;

  @ApiProperty({
    description: 'Application name in Pyroscope',
    example: 'my-application'
  })
  @IsString()
  @IsNotEmpty()
  application: string;

  @ApiProperty({
    description: 'Profiler label (e.g., process_cpu)',
    example: 'process_cpu'
  })
  @IsString()
  @IsNotEmpty()
  profilerLabel: string;

  @ApiProperty({
    description: 'Baseline start time (Unix timestamp in milliseconds)',
    example: 1704067200000
  })
  @IsNumber()
  @Min(0)
  baselineStartTime: number;

  @ApiProperty({
    description: 'Baseline end time (Unix timestamp in milliseconds)',
    example: 1704070800000
  })
  @IsNumber()
  @Min(0)
  baselineEndTime: number;

  @ApiProperty({
    description: 'Current test start time (Unix timestamp in milliseconds)',
    example: 1704153600000
  })
  @IsNumber()
  @Min(0)
  currentStartTime: number;

  @ApiProperty({
    description: 'Current test end time (Unix timestamp in milliseconds)',
    example: 1704157200000
  })
  @IsNumber()
  @Min(0)
  currentEndTime: number;

  @ApiProperty({
    description: 'Minimum sample count delta to be considered significant',
    example: 100,
    required: false,
    default: 100
  })
  @IsNumber()
  @Min(0)
  significanceThreshold?: number;

  @ApiProperty({
    description: 'Optional symbol filter to include only functions matching this pattern',
    example: 'java.lang.',
    required: false
  })
  @IsOptional()
  @IsString()
  symbolFilter?: string;
}

/**
 * Individual function difference in flamegraph comparison
 */
export class FlamegraphDiffDto {
  @ApiProperty({
    description: 'Function name',
    example: 'com.example.Service.processRequest'
  })
  function: string;

  @ApiProperty({
    description: 'Number of samples in baseline',
    example: 1500
  })
  baselineSamples: number;

  @ApiProperty({
    description: 'Number of samples in current test',
    example: 2300
  })
  currentSamples: number;

  @ApiProperty({
    description: 'Absolute difference in samples',
    example: 800
  })
  delta: number;

  @ApiProperty({
    description: 'Percentage change',
    example: 53.33
  })
  deltaPercent: number;

  @ApiProperty({
    description: 'Significance level of the change',
    example: 'high',
    enum: ['high', 'medium', 'low']
  })
  significance: 'high' | 'medium' | 'low';

  @ApiProperty({
    description: 'Change type classification for differential flame graph visualization',
    example: 'regression',
    enum: ['regression', 'improvement', 'new', 'removed', 'stable']
  })
  changeType: 'regression' | 'improvement' | 'new' | 'removed' | 'stable';

  @ApiProperty({
    description: 'Proportion of baseline total samples (%)',
    example: 15.0,
    required: false
  })
  baselinePercent?: number;

  @ApiProperty({
    description: 'Proportion of current total samples (%)',
    example: 15.3,
    required: false
  })
  currentPercent?: number;
}

/**
 * Summary statistics for flamegraph comparison
 */
export class FlamegraphSummaryDto {
  @ApiProperty({
    description: 'Total samples in baseline profile',
    example: 10000
  })
  baselineTotal: number;

  @ApiProperty({
    description: 'Total samples in current profile',
    example: 15000
  })
  currentTotal: number;

  @ApiProperty({
    description: 'Absolute difference in total samples',
    example: 5000
  })
  totalDelta: number;

  @ApiProperty({
    description: 'Percentage change in total samples',
    example: 50.0
  })
  totalDeltaPercent: number;
}

/**
 * Response DTO for flamegraph analysis
 */
export class FlamegraphAnalysisResponseDto {
  @ApiProperty({
    description: 'Summary statistics',
    type: FlamegraphSummaryDto
  })
  summary: FlamegraphSummaryDto;

  @ApiProperty({
    description: 'Top function changes (sorted by absolute delta)',
    type: [FlamegraphDiffDto]
  })
  topFunctionChanges: FlamegraphDiffDto[];

  @ApiProperty({
    description: 'Performance regressions - widened or new hot paths (red in differential flame graph)',
    type: [FlamegraphDiffDto],
    required: false
  })
  regressions?: FlamegraphDiffDto[];

  @ApiProperty({
    description: 'Performance improvements - narrowed or removed paths (blue in differential flame graph)',
    type: [FlamegraphDiffDto],
    required: false
  })
  improvements?: FlamegraphDiffDto[];

  @ApiProperty({
    description: 'New hotspots (functions with significant increase)',
    type: [String],
    example: ['com.example.NewService.slowMethod']
  })
  newHotspots: string[];

  @ApiProperty({
    description: 'Improved functions (functions with significant decrease)',
    type: [String],
    example: ['com.example.OldService.optimizedMethod']
  })
  improvedFunctions: string[];

  @ApiProperty({
    description: 'Formatted markdown table report',
    example: '| Function | Baseline | Current | Delta | % Change | Significance |\\n|---|---|---|---|---|---|\\n| ... | ... | ... | ... | ... | ... |'
  })
  tableReport: string;

  @ApiProperty({
    description: 'Error message if analysis failed',
    required: false
  })
  error?: string;
}
