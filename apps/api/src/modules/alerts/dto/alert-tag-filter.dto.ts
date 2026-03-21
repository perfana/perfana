import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID, IsIn, MaxLength } from 'class-validator';

export class CreateAlertTagFilterDto {
  @ApiProperty({ description: 'Filter type', enum: ['omit', 'abort'] })
  @IsString()
  @IsIn(['omit', 'abort'])
  filterType!: string;

  @ApiProperty({ description: 'Alert source', enum: ['grafana', 'alertmanager'] })
  @IsString()
  @IsIn(['grafana', 'alertmanager'])
  alertSource!: string;

  @ApiProperty({ description: 'Tag key to match' })
  @IsString()
  @MaxLength(255)
  tagKey!: string;

  @ApiPropertyOptional({ description: 'Tag value to match (null = any value)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  tagValue?: string;

  @ApiPropertyOptional({ description: 'System under test ID (for abort filters)' })
  @IsOptional()
  @IsUUID()
  systemUnderTestId?: string;

  @ApiPropertyOptional({ description: 'Test environment (for abort filters)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  testEnvironment?: string;

  @ApiPropertyOptional({ description: 'Test type (for abort filters)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  testType?: string;

  @ApiPropertyOptional({ description: 'Organization ID' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class UpdateAlertTagFilterDto {
  @ApiPropertyOptional({ description: 'Filter type', enum: ['omit', 'abort'] })
  @IsOptional()
  @IsString()
  @IsIn(['omit', 'abort'])
  filterType?: string;

  @ApiPropertyOptional({ description: 'Alert source', enum: ['grafana', 'alertmanager'] })
  @IsOptional()
  @IsString()
  @IsIn(['grafana', 'alertmanager'])
  alertSource?: string;

  @ApiPropertyOptional({ description: 'Tag key to match' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  tagKey?: string;

  @ApiPropertyOptional({ description: 'Tag value to match' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  tagValue?: string;

  @ApiPropertyOptional({ description: 'System under test ID' })
  @IsOptional()
  @IsUUID()
  systemUnderTestId?: string;

  @ApiPropertyOptional({ description: 'Test environment' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  testEnvironment?: string;

  @ApiPropertyOptional({ description: 'Test type' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  testType?: string;
}
