import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsArray, IsOptional, IsUUID, MaxLength, IsIn } from 'class-validator';

const VALID_SOURCE_TYPES = ['grafana', 'dynatrace', 'prometheus', 'influxdb', 'performance_test'] as const;

export class CreateMetricsSourceDto {
  @ApiProperty({ description: 'ID of the system under test' })
  @IsUUID()
  systemUnderTestId!: string;

  @ApiProperty({ description: 'Test environment name' })
  @IsString()
  @MaxLength(255)
  testEnvironment!: string;

  @ApiProperty({ description: 'Source type', enum: VALID_SOURCE_TYPES })
  @IsString()
  @IsIn(VALID_SOURCE_TYPES)
  sourceType!: string;

  @ApiPropertyOptional({ description: 'ID of the source configuration (e.g., GrafanaInstance.id, DynatraceConfig.id)' })
  @IsOptional()
  @IsUUID()
  sourceConfigId?: string;

  @ApiPropertyOptional({ description: 'External reference (e.g., Grafana dashboard UID)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  externalRef?: string;

  @ApiProperty({ description: 'Display name for this metrics source' })
  @IsString()
  @MaxLength(255)
  displayName!: string;

  @ApiPropertyOptional({ description: 'Display label (human-readable variant)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayLabel?: string;

  @ApiPropertyOptional({ description: 'Workload name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  workload?: string;

  @ApiPropertyOptional({ description: 'Tags for categorization', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: 'Additional metadata' })
  @IsOptional()
  metadata?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Organization ID' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional({ description: 'Team ID' })
  @IsOptional()
  @IsUUID()
  teamId?: string;
}
