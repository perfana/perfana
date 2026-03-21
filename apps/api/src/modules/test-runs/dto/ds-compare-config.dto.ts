import { IsString, IsObject, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsUuidOrSynthetic } from '../validators/uuid-or-synthetic.validator';

export class CreateDsCompareConfigDto {
  @ApiProperty({
    description: 'System under test ID',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  @IsUUID()
  systemUnderTestId!: string;

  @ApiProperty({
    description: 'Test environment',
    example: 'production'
  })
  @IsString()
  testEnvironment!: string;

  @ApiProperty({
    description: 'Workload type',
    example: 'loadTest'
  })
  @IsString()
  workload!: string;

  @ApiProperty({
    description: 'Application dashboard ID (accepts standard UUIDs or synthetic dashboard ID for Performance Test metrics)',
    example: '550e8400-e29b-41d4-a716-446655440001'
  })
  @IsUuidOrSynthetic()
  applicationDashboardId!: string;

  @ApiProperty({
    description: 'Panel ID',
    example: '1'
  })
  @IsString()
  panelId!: string;

  @ApiProperty({
    description: 'Metric name (null for panel-wide configuration)',
    example: 'response_time_p90',
    required: false
  })
  @IsString()
  @IsOptional()
  metricName?: string;

  @ApiProperty({
    description: 'Configuration data stored as JSON',
    example: {
      metricClassification: {
        classification: 'RED_duration',
        higherIsBetter: false
      },
      thresholds: {
        aggregation: 'mean',
        percentageThreshold: 10,
        iqrThreshold: 1.5,
        absoluteThreshold: 100
      },
      defaultValueIfControlGroupMissing: 0
    }
  })
  @IsObject()
  configData!: Record<string, any>;
}

export class UpdateDsCompareConfigDto {
  @ApiProperty({
    description: 'Configuration data stored as JSON',
    example: {
      metricClassification: {
        classification: 'RED_duration',
        higherIsBetter: false
      },
      thresholds: {
        aggregation: 'mean',
        percentageThreshold: 10,
        iqrThreshold: 1.5,
        absoluteThreshold: 100
      },
      defaultValueIfControlGroupMissing: 0
    }
  })
  @IsObject()
  configData!: Record<string, any>;
}

export class DsCompareConfigDto {
  @ApiProperty({
    description: 'Unique identifier for the data science compare configuration',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  id!: string;

  @ApiProperty({
    description: 'System under test ID',
    example: '550e8400-e29b-41d4-a716-446655440001'
  })
  systemUnderTestId!: string;

  @ApiProperty({
    description: 'Test environment',
    example: 'production'
  })
  testEnvironment!: string;

  @ApiProperty({
    description: 'Workload type',
    example: 'loadTest'
  })
  workload!: string;

  @ApiProperty({
    description: 'Application dashboard ID',
    example: '550e8400-e29b-41d4-a716-446655440002'
  })
  applicationDashboardId!: string;

  @ApiProperty({
    description: 'Panel ID from the dashboard',
    example: '1'
  })
  panelId!: string;

  @ApiProperty({
    description: 'Metric name (null for panel-wide configuration)',
    example: 'response_time_p90',
    required: false
  })
  metricName?: string;

  @ApiProperty({
    description: 'Configuration data stored as JSON, including metric classification, thresholds, and other settings',
    example: {
      metricClassification: {
        classification: 'RED_duration',
        higherIsBetter: false
      },
      thresholds: {
        aggregation: 'mean',
        percentageThreshold: 10,
        iqrThreshold: 1.5,
        absoluteThreshold: 100
      },
      defaultValueIfControlGroupMissing: 0
    }
  })
  configData!: Record<string, any>;

  @ApiProperty({
    description: 'Timestamp when this configuration was created',
    example: '2024-01-15T10:30:00.000Z'
  })
  createdAt!: string;

  @ApiProperty({
    description: 'Timestamp when this configuration was last updated',
    example: '2024-01-15T10:30:00.000Z'
  })
  updatedAt!: string;

  @ApiProperty({
    description: 'Configuration source level (metric-specific, panel-level, etc.)',
    example: 'panel-level',
    required: false
  })
  configSource?: string;
}