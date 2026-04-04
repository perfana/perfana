import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsNumber, IsArray, IsUUID } from 'class-validator';

/**
 * DTO for creating a new profile benchmark
 */
export class CreateProfileBenchmarkDto {
  @ApiProperty({
    description: 'Profile dashboard ID to attach benchmark to',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  @IsUUID()
  profileDashboardId!: string;

  @ApiProperty({
    description: 'Workload pattern regex',
    example: '.*',
    default: '.*',
    required: false
  })
  @IsOptional()
  @IsString()
  workloadPattern?: string;

  @ApiProperty({
    description: 'Source type',
    enum: ['grafana', 'dynatrace'],
    example: 'grafana',
    required: false
  })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiProperty({
    description: 'Grafana instance name',
    example: 'Default',
    required: false
  })
  @IsOptional()
  @IsString()
  grafanaInstance?: string;

  @ApiProperty({
    description: 'Dashboard UID',
    example: 'abc123def',
    required: false
  })
  @IsOptional()
  @IsString()
  dashboardUid?: string;

  @ApiProperty({
    description: 'Panel ID',
    example: 1,
    required: false
  })
  @IsOptional()
  @IsNumber()
  panelId?: number;

  @ApiProperty({
    description: 'Panel title',
    example: 'Heap Memory Usage',
    required: false
  })
  @IsOptional()
  @IsString()
  panelTitle?: string;

  @ApiProperty({
    description: 'Panel type',
    example: 'graph',
    required: false
  })
  @IsOptional()
  @IsString()
  panelType?: string;

  @ApiProperty({
    description: 'Panel description',
    example: 'Displays heap memory usage over time',
    required: false
  })
  @IsOptional()
  @IsString()
  panelDescription?: string;

  @ApiProperty({
    description: 'Evaluation type',
    enum: ['avg', 'max', 'min', 'last', 'fit', 'q50', 'q90', 'q95', 'q99'],
    example: 'avg',
    required: false
  })
  @IsOptional()
  @IsString()
  evaluateType?: string;

  @ApiProperty({
    description: 'Metric unit',
    example: 'ms',
    required: false
  })
  @IsOptional()
  @IsString()
  metricUnit?: string;

  @ApiProperty({
    description: 'Requirement operator for Service Level Objective',
    enum: ['gt', 'lt', 'gte', 'lte', 'eq', 'ne'],
    example: 'lt',
    required: false
  })
  @IsOptional()
  @IsString()
  requirementOperator?: string;

  @ApiProperty({
    description: 'Requirement value for Service Level Objective',
    example: 500,
    required: false
  })
  @IsOptional()
  @IsNumber()
  requirementValue?: number;

  @ApiProperty({
    description: 'Exclude ramp-up time from evaluation',
    example: true,
    default: true,
    required: false
  })
  @IsOptional()
  @IsBoolean()
  excludeRampUpTime?: boolean;

  @ApiProperty({
    description: 'Average all series together',
    example: false,
    default: false,
    required: false
  })
  @IsOptional()
  @IsBoolean()
  averageAll?: boolean;

  @ApiProperty({
    description: 'Series matching pattern (regex)',
    example: '.*response_time.*',
    required: false
  })
  @IsOptional()
  @IsString()
  matchPattern?: string;

  @ApiProperty({
    description: 'Validate with default value if no data is available',
    example: false,
    default: false,
    required: false
  })
  @IsOptional()
  @IsBoolean()
  validateWithDefaultIfNoData?: boolean;

  @ApiProperty({
    description: 'Default value to use when no data is available',
    example: 0,
    required: false
  })
  @IsOptional()
  @IsNumber()
  validateWithDefaultIfNoDataValue?: number;

  @ApiProperty({
    description: 'Tags for categorization',
    type: [String],
    example: ['performance', 'critical'],
    required: false
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiProperty({
    description: 'Additional metadata',
    example: { customField: 'value' },
    required: false
  })
  @IsOptional()
  metadata?: Record<string, unknown>;

  @ApiProperty({
    description: 'Whether this benchmark is read-only',
    example: false,
    default: false,
    required: false
  })
  @IsOptional()
  @IsBoolean()
  readOnly?: boolean;
}

/**
 * DTO for updating an existing profile benchmark
 */
export class UpdateProfileBenchmarkDto {
  @ApiProperty({
    description: 'Profile dashboard ID to attach benchmark to',
    example: '550e8400-e29b-41d4-a716-446655440000',
    required: false
  })
  @IsOptional()
  @IsUUID()
  profileDashboardId?: string;

  @ApiProperty({
    description: 'Workload pattern regex',
    example: '.*',
    required: false
  })
  @IsOptional()
  @IsString()
  workloadPattern?: string;

  @ApiProperty({
    description: 'Source type',
    enum: ['grafana', 'dynatrace'],
    example: 'grafana',
    required: false
  })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiProperty({
    description: 'Grafana instance name',
    example: 'Default',
    required: false
  })
  @IsOptional()
  @IsString()
  grafanaInstance?: string;

  @ApiProperty({
    description: 'Dashboard UID',
    example: 'abc123def',
    required: false
  })
  @IsOptional()
  @IsString()
  dashboardUid?: string;

  @ApiProperty({
    description: 'Panel ID',
    example: 1,
    required: false
  })
  @IsOptional()
  @IsNumber()
  panelId?: number;

  @ApiProperty({
    description: 'Panel title',
    example: 'Heap Memory Usage',
    required: false
  })
  @IsOptional()
  @IsString()
  panelTitle?: string;

  @ApiProperty({
    description: 'Panel type',
    example: 'graph',
    required: false
  })
  @IsOptional()
  @IsString()
  panelType?: string;

  @ApiProperty({
    description: 'Panel description',
    example: 'Displays heap memory usage over time',
    required: false
  })
  @IsOptional()
  @IsString()
  panelDescription?: string;

  @ApiProperty({
    description: 'Evaluation type',
    enum: ['avg', 'max', 'min', 'last', 'fit', 'q50', 'q90', 'q95', 'q99'],
    example: 'avg',
    required: false
  })
  @IsOptional()
  @IsString()
  evaluateType?: string;

  @ApiProperty({
    description: 'Metric unit',
    example: 'ms',
    required: false
  })
  @IsOptional()
  @IsString()
  metricUnit?: string;

  @ApiProperty({
    description: 'Requirement operator for Service Level Objective',
    enum: ['gt', 'lt', 'gte', 'lte', 'eq', 'ne'],
    example: 'lt',
    required: false
  })
  @IsOptional()
  @IsString()
  requirementOperator?: string;

  @ApiProperty({
    description: 'Requirement value for Service Level Objective',
    example: 500,
    required: false
  })
  @IsOptional()
  @IsNumber()
  requirementValue?: number;

  @ApiProperty({
    description: 'Exclude ramp-up time from evaluation',
    example: true,
    required: false
  })
  @IsOptional()
  @IsBoolean()
  excludeRampUpTime?: boolean;

  @ApiProperty({
    description: 'Average all series together',
    example: false,
    required: false
  })
  @IsOptional()
  @IsBoolean()
  averageAll?: boolean;

  @ApiProperty({
    description: 'Series matching pattern (regex)',
    example: '.*response_time.*',
    required: false
  })
  @IsOptional()
  @IsString()
  matchPattern?: string;

  @ApiProperty({
    description: 'Validate with default value if no data is available',
    example: false,
    required: false
  })
  @IsOptional()
  @IsBoolean()
  validateWithDefaultIfNoData?: boolean;

  @ApiProperty({
    description: 'Default value to use when no data is available',
    example: 0,
    required: false
  })
  @IsOptional()
  @IsNumber()
  validateWithDefaultIfNoDataValue?: number;

  @ApiProperty({
    description: 'Tags for categorization',
    type: [String],
    example: ['performance', 'critical'],
    required: false
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiProperty({
    description: 'Additional metadata',
    example: { customField: 'value' },
    required: false
  })
  @IsOptional()
  metadata?: Record<string, unknown>;

  @ApiProperty({
    description: 'Whether this benchmark is read-only',
    example: false,
    required: false
  })
  @IsOptional()
  @IsBoolean()
  readOnly?: boolean;
}

/**
 * Response DTO for profile benchmark
 */
export class ProfileBenchmarkResponse {
  @ApiProperty({
    description: 'Benchmark ID',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  id!: string;

  @ApiProperty({
    description: 'Profile ID',
    example: '550e8400-e29b-41d4-a716-446655440001'
  })
  profileId!: string;

  @ApiProperty({
    description: 'Profile dashboard ID',
    example: '550e8400-e29b-41d4-a716-446655440002'
  })
  profileDashboardId!: string;

  @ApiProperty({
    description: 'Workload pattern regex',
    example: '.*'
  })
  workloadPattern!: string;

  @ApiProperty({
    description: 'Source type',
    example: 'grafana'
  })
  source!: string;

  @ApiProperty({
    description: 'Grafana instance name',
    example: 'Default',
    required: false
  })
  grafanaInstance?: string;

  @ApiProperty({
    description: 'Dashboard UID',
    example: 'abc123def',
    required: false
  })
  dashboardUid?: string;

  @ApiProperty({
    description: 'Panel ID',
    example: 1,
    required: false
  })
  panelId?: number;

  @ApiProperty({
    description: 'Panel title',
    example: 'Heap Memory Usage',
    required: false
  })
  panelTitle?: string;

  @ApiProperty({
    description: 'Panel type',
    example: 'graph',
    required: false
  })
  panelType?: string;

  @ApiProperty({
    description: 'Panel description',
    example: 'Displays heap memory usage over time',
    required: false
  })
  panelDescription?: string;

  @ApiProperty({
    description: 'Evaluation type',
    example: 'avg',
    required: false
  })
  evaluateType?: string;

  @ApiProperty({
    description: 'Metric unit',
    example: 'ms',
    required: false
  })
  metricUnit?: string;

  @ApiProperty({
    description: 'Requirement operator',
    example: 'lt',
    required: false
  })
  requirementOperator?: string;

  @ApiProperty({
    description: 'Requirement value',
    example: 500,
    required: false
  })
  requirementValue?: number;

  @ApiProperty({
    description: 'Exclude ramp-up time',
    example: true
  })
  excludeRampUpTime!: boolean;

  @ApiProperty({
    description: 'Average all series',
    example: false
  })
  averageAll!: boolean;

  @ApiProperty({
    description: 'Series matching pattern',
    example: '.*response_time.*',
    required: false
  })
  matchPattern?: string;

  @ApiProperty({
    description: 'Validate with default if no data',
    example: false
  })
  validateWithDefaultIfNoData!: boolean;

  @ApiProperty({
    description: 'Default validation value',
    example: 0,
    required: false
  })
  validateWithDefaultIfNoDataValue?: number;

  @ApiProperty({
    description: 'Tags',
    type: [String],
    example: ['performance', 'critical']
  })
  tags!: string[];

  @ApiProperty({
    description: 'Additional metadata',
    example: { customField: 'value' }
  })
  metadata!: Record<string, unknown>;

  @ApiProperty({
    description: 'Read-only status',
    example: false,
    required: false
  })
  readOnly?: boolean;

  @ApiProperty({
    description: 'Creation timestamp',
    example: '2025-11-08T12:00:00.000Z'
  })
  createdAt!: string;

  @ApiProperty({
    description: 'Last update timestamp',
    example: '2025-11-08T12:00:00.000Z'
  })
  updatedAt!: string;
}
