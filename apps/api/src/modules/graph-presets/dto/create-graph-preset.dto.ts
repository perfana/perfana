import { IsString, IsBoolean, IsOptional, IsArray, IsEnum, ValidateNested, IsNumber, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum DataSource {
  GRAFANA = 'grafana',
  DYNATRACE = 'dynatrace',
  PERFORMANCE_METRICS = 'performance-metrics'
}

export class SeriesConfigDto {
  @ApiProperty({
    description: 'Dashboard ID',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  @IsString()
  dashboardId!: string;

  @ApiProperty({
    description: 'Dashboard label for display',
    example: 'Load Testing Dashboard'
  })
  @IsString()
  dashboardLabel!: string;

  @ApiProperty({
    description: 'Panel ID within the dashboard',
    example: 5
  })
  @IsNumber()
  panelId!: number;

  @ApiProperty({
    description: 'Panel title for display',
    example: 'Response Time'
  })
  @IsString()
  panelTitle!: string;

  @ApiProperty({
    description: 'Metric name/identifier',
    example: 'http_request_duration_seconds_p95'
  })
  @IsString()
  metricName!: string;

  @ApiProperty({
    description: 'Data source for this series',
    enum: DataSource,
    example: DataSource.GRAFANA
  })
  @IsEnum(DataSource)
  source!: DataSource;

  @ApiPropertyOptional({
    description: 'Y-axis format specification',
    example: 'ms'
  })
  @IsString()
  @IsOptional()
  yAxisFormat?: string;
}

export class CreateGraphPresetDto {
  @ApiProperty({
    description: 'Name of the graph preset',
    example: 'My Custom Graph'
  })
  @IsString()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({
    description: 'Optional description of the preset',
    example: 'Shows response time and throughput metrics from multiple dashboards'
  })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    description: 'Test run ID to associate with this preset',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  @IsString()
  @IsOptional()
  testRunId?: string;

  @ApiProperty({
    description: 'Array of series configurations',
    type: [SeriesConfigDto],
    example: [
      {
        dashboardId: '550e8400-e29b-41d4-a716-446655440000',
        dashboardLabel: 'Load Testing',
        panelId: 5,
        panelTitle: 'Response Time',
        metricName: 'http_request_duration_seconds_p95',
        source: 'grafana',
        yAxisFormat: 'ms'
      }
    ]
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SeriesConfigDto)
  seriesConfig!: SeriesConfigDto[];

  @ApiPropertyOptional({
    description: 'Chart customization options (for future use)',
    example: { showLegend: true, lineWidth: 2 }
  })
  @IsOptional()
  chartOptions?: Record<string, any>;

  @ApiProperty({
    description: 'Whether this preset should be available to all users',
    example: false,
    default: false
  })
  @IsBoolean()
  @IsOptional()
  isGlobal?: boolean;
}
