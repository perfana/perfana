import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray, IsDateString, IsUUID, MaxLength } from 'class-validator';

export class CreateEventDto {
  @ApiProperty({ description: 'Event title' })
  @IsString()
  @MaxLength(255)
  title!: string;

  @ApiPropertyOptional({ description: 'Event description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'System under test name or UUID' })
  @IsString()
  systemUnderTest!: string;

  @ApiProperty({ description: 'Test environment name' })
  @IsString()
  @MaxLength(255)
  testEnvironment!: string;

  @ApiPropertyOptional({ description: 'Event timestamp (ISO 8601). Defaults to now if omitted.' })
  @IsOptional()
  @IsDateString()
  timestamp?: string;

  @ApiPropertyOptional({ description: 'Event source', enum: ['manual', 'grafana', 'alertmanager'] })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({ description: 'Tags for the event', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: 'Alert metadata (source-specific data)' })
  @IsOptional()
  alertMetadata?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Organization ID to assign this event to' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class UpdateEventDto {
  @ApiPropertyOptional({ description: 'Event title' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({ description: 'Event description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Event timestamp (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  timestamp?: string;

  @ApiPropertyOptional({ description: 'Tags for the event', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class EventQueryDto {
  @ApiPropertyOptional({ description: 'Filter by system under test ID' })
  @IsOptional()
  @IsUUID()
  systemUnderTestId?: string;

  @ApiPropertyOptional({ description: 'Filter by test environment' })
  @IsOptional()
  @IsString()
  testEnvironment?: string;

  @ApiPropertyOptional({ description: 'Filter events from this date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Filter events to this date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
