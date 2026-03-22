import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsArray, IsOptional, IsUUID, MaxLength, IsIn } from 'class-validator';

const VALID_SOURCE_TYPES = ['grafana', 'dynatrace', 'prometheus', 'influxdb', 'performance_test'] as const;

export class UpdateMetricsSourceDto {
  @ApiPropertyOptional({ description: 'ID of the system under test' })
  @IsOptional()
  @IsUUID()
  systemUnderTestId?: string;

  @ApiPropertyOptional({ description: 'Test environment name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  testEnvironment?: string;

  @ApiPropertyOptional({ description: 'Source type', enum: VALID_SOURCE_TYPES })
  @IsOptional()
  @IsString()
  @IsIn(VALID_SOURCE_TYPES)
  sourceType?: string;

  @ApiPropertyOptional({ description: 'ID of the source configuration' })
  @IsOptional()
  @IsUUID()
  sourceConfigId?: string;

  @ApiPropertyOptional({ description: 'External reference' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  externalRef?: string;

  @ApiPropertyOptional({ description: 'Display name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string;

  @ApiPropertyOptional({ description: 'Display label' })
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
