import { IsString, IsEnum, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DeleteAnomalyDto {
  @ApiProperty({
    description: 'Dashboard label',
    example: 'MyApp-LoadTest'
  })
  @IsString()
  @IsNotEmpty()
  dashboardLabel!: string;

  @ApiProperty({
    description: 'Panel title',
    example: 'Response Times'
  })
  @IsString()
  @IsNotEmpty()
  panelTitle!: string;

  @ApiProperty({
    description: 'Metric name (required when scope is "metric")',
    example: 'response_time_p90',
    required: false
  })
  @IsString()
  @IsOptional()
  metricName?: string;

  @ApiProperty({
    description: 'Panel ID',
    example: '42'
  })
  @IsString()
  @IsNotEmpty()
  panelId!: string;

  @ApiProperty({
    description: 'Application dashboard ID',
    example: '550e8400-e29b-41d4-a716-446655440001'
  })
  @IsString()
  @IsNotEmpty()
  applicationDashboardId!: string;

  @ApiProperty({
    description: 'What to delete: specific metric or all metrics in panel',
    enum: ['metric', 'panel'],
    example: 'metric'
  })
  @IsEnum(['metric', 'panel'])
  scope!: 'metric' | 'panel';

  @ApiProperty({
    description: 'Delete range: current test run only or all test runs',
    enum: ['current-test-run', 'all-test-runs'],
    example: 'current-test-run'
  })
  @IsEnum(['current-test-run', 'all-test-runs'])
  range!: 'current-test-run' | 'all-test-runs';
}