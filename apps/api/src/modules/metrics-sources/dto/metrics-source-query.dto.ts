import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsArray, IsOptional, IsUUID, IsIn } from 'class-validator';

const VALID_SOURCE_TYPES = ['grafana', 'dynatrace', 'prometheus', 'influxdb', 'performance_test'] as const;

export class MetricsSourceQueryDto {
  @ApiPropertyOptional({ description: 'Filter by system under test ID' })
  @IsOptional()
  @IsUUID()
  systemId?: string;

  @ApiPropertyOptional({ description: 'Filter by system under test ID (alias)' })
  @IsOptional()
  @IsUUID()
  systemUnderTestId?: string;

  @ApiPropertyOptional({ description: 'Filter by test environment' })
  @IsOptional()
  @IsString()
  environment?: string;

  @ApiPropertyOptional({ description: 'Filter by test environment (alias)' })
  @IsOptional()
  @IsString()
  testEnvironment?: string;

  @ApiPropertyOptional({ description: 'Filter by source type', enum: VALID_SOURCE_TYPES })
  @IsOptional()
  @IsString()
  @IsIn(VALID_SOURCE_TYPES)
  sourceType?: string;

  @ApiPropertyOptional({ description: 'Filter by tags (comma-separated)', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: 'Filter by display name (partial match)' })
  @IsOptional()
  @IsString()
  displayName?: string;
}
