import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsEnum, IsArray, IsUUID, IsBoolean } from 'class-validator';

export enum TrackedRegressionStatus {
  UNRESOLVED = 'unresolved',
  ACCEPTED = 'accepted',
  DENIED = 'denied',
}

export class TrackedRegressionDto {
  @ApiProperty({ description: 'Unique identifier for the tracked regression' })
  @IsUUID()
  id!: string;

  @ApiProperty({ description: 'Test run ID where regression is being tracked' })
  @IsString()
  testRunId!: string;

  @ApiProperty({ description: 'Control group ID' })
  @IsString()
  controlGroupId!: string;

  @ApiProperty({ description: 'Test run ID where regression was first detected' })
  @IsString()
  trackedTestRunId!: string;

  @ApiProperty({ description: 'Tracked difference ID', required: false })
  @IsOptional()
  @IsString()
  trackedDifferenceId?: string;

  @ApiProperty({ description: 'Application dashboard ID' })
  @IsUUID()
  applicationDashboardId!: string;

  @ApiProperty({ description: 'Panel ID' })
  @IsString()
  panelId!: string;

  @ApiProperty({ description: 'Metric name' })
  @IsString()
  metricName!: string;

  @ApiProperty({ description: 'Dashboard UID', required: false })
  @IsOptional()
  @IsString()
  dashboardUid?: string;

  @ApiProperty({ description: 'Dashboard label', required: false })
  @IsOptional()
  @IsString()
  dashboardLabel?: string;

  @ApiProperty({ description: 'Panel title', required: false })
  @IsOptional()
  @IsString()
  panelTitle?: string;

  @ApiProperty({ description: 'Metric unit', required: false })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiProperty({ description: 'Benchmark IDs', required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  benchmarkIds?: string[];

  @ApiProperty({ description: 'Test run start timestamp' })
  testRunStart!: Date;

  @ApiProperty({ description: 'When record was last updated' })
  updatedAt!: Date;

  @ApiProperty({ description: 'Statistical measures', required: false })
  @IsOptional()
  mean?: any;

  @ApiProperty({ description: 'Statistical measures', required: false })
  @IsOptional()
  median?: any;

  @ApiProperty({ description: 'Statistical measures', required: false })
  @IsOptional()
  minValue?: any;

  @ApiProperty({ description: 'Statistical measures', required: false })
  @IsOptional()
  maxValue?: any;

  @ApiProperty({ description: 'Statistical measures', required: false })
  @IsOptional()
  stdDev?: any;

  @ApiProperty({ description: 'Statistical measures', required: false })
  @IsOptional()
  q95?: any;

  @ApiProperty({ description: 'Compare configuration', required: false })
  @IsOptional()
  compareConfig?: any;

  @ApiProperty({ description: 'Metric classification', required: false })
  @IsOptional()
  metricClassification?: any;

  @ApiProperty({ description: 'Thresholds configuration', required: false })
  @IsOptional()
  thresholds?: any;

  @ApiProperty({ description: 'Checks configuration', required: false })
  @IsOptional()
  checks?: any;

  @ApiProperty({ description: 'Conclusion data from anomaly detection', required: false })
  @IsOptional()
  conclusion?: any;

  @ApiProperty({ description: 'Tracked conclusion data', required: false })
  @IsOptional()
  trackedConclusion?: any;

  // Computed fields for UI
  @ApiProperty({ description: 'Computed regression status', required: false })
  @IsOptional()
  status?: TrackedRegressionStatus;

  @ApiProperty({ description: 'Computed percentage change', required: false })
  @IsOptional()
  percentageChange?: number;

  @ApiProperty({ description: 'Computed severity', required: false })
  @IsOptional()
  severity?: string;

  @ApiProperty({ description: 'Computed test runs affected count', required: false })
  @IsOptional()
  testRunsAffected?: number;

  @ApiProperty({ description: 'Computed tracked test runs', required: false })
  @IsOptional()
  trackedTestRuns?: string[];

  // Test run metadata fields
  @ApiProperty({ description: 'Application version', required: false })
  @IsOptional()
  @IsString()
  version?: string;

  @ApiProperty({ description: 'Test run annotations', required: false })
  @IsOptional()
  @IsString()
  annotations?: string;

  @ApiProperty({ description: 'System under test', required: false })
  @IsOptional()
  @IsString()
  systemUnderTest?: string;

  @ApiProperty({ description: 'Environment', required: false })
  @IsOptional()
  @IsString()
  environment?: string;

  @ApiProperty({ description: 'Workload', required: false })
  @IsOptional()
  @IsString()
  workload?: string;
}

export class ResolveTrackedRegressionDto {
  @ApiProperty({
    description: 'Resolution decision',
    enum: ['accepted', 'denied']
  })
  @IsEnum(['accepted', 'denied'])
  resolution!: 'accepted' | 'denied';

  @ApiProperty({
    description: 'Whether to exclude from baseline (true for denied regressions)',
    default: false
  })
  @IsBoolean()
  excludeFromBaseline!: boolean;

  @ApiProperty({ description: 'Optional comment explaining the resolution', required: false })
  @IsOptional()
  @IsString()
  comment?: string;
}

export class TrackedRegressionsCountDto {
  @ApiProperty({ description: 'Number of unresolved tracked regressions' })
  @IsNumber()
  count!: number;
}

export class TrackedRegressionsResponseDto {
  @ApiProperty({
    description: 'List of tracked regressions',
    type: [TrackedRegressionDto]
  })
  regressions!: TrackedRegressionDto[];

  @ApiProperty({ description: 'Number of unresolved regressions' })
  @IsNumber()
  unresolvedCount!: number;

  @ApiProperty({ description: 'Total number of tracked regressions' })
  @IsNumber()
  totalTracked!: number;
}