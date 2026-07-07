import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsUrl, IsBoolean, IsOptional, IsEnum, MaxLength } from 'class-validator';
import { TracingUI } from '@perfana/shared/entities';

export class CreateTracingInstanceDto {
  @ApiProperty({ description: 'Unique label for the tracing instance', example: 'Production Tempo' })
  @IsString()
  @MaxLength(255)
  label!: string;

  @ApiProperty({ description: 'Tracing instance URL', example: 'https://tempo.example.com' })
  @IsUrl({ require_tld: false })
  tracingUrl!: string;

  @ApiPropertyOptional({
    description: 'Backend API URL for Tempo (used for server-side API calls). Only applicable for Tempo UI type.',
    example: 'http://tempo-api.internal:3200'
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  tracingApiUrl?: string;

  @ApiProperty({
    description: 'Type of tracing UI',
    enum: TracingUI,
    example: TracingUI.TEMPO
  })
  @IsEnum(TracingUI)
  tracingUi!: TracingUI;

  @ApiPropertyOptional({
    description: 'Whether the tracing UI can be embedded in an iframe',
    default: false,
    example: false
  })
  @IsOptional()
  @IsBoolean()
  tracingIframeAllowed?: boolean;

  @ApiPropertyOptional({ description: 'Route outbound requests through the organization proxy' })
  @IsOptional()
  @IsBoolean()
  useProxy?: boolean;

  @ApiPropertyOptional({ description: 'Organization ID to assign this instance to' })
  @IsOptional()
  @IsString()
  organizationId?: string;
}

export class UpdateTracingInstanceDto {
  @ApiPropertyOptional({ description: 'Unique label for the tracing instance' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  label?: string;

  @ApiPropertyOptional({ description: 'Tracing instance URL' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  tracingUrl?: string;

  @ApiPropertyOptional({
    description: 'Backend API URL for Tempo (used for server-side API calls). Only applicable for Tempo UI type.',
    example: 'http://tempo-api.internal:3200'
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  tracingApiUrl?: string;

  @ApiPropertyOptional({
    description: 'Type of tracing UI',
    enum: TracingUI
  })
  @IsOptional()
  @IsEnum(TracingUI)
  tracingUi?: TracingUI;

  @ApiPropertyOptional({ description: 'Whether the tracing UI can be embedded in an iframe' })
  @IsOptional()
  @IsBoolean()
  tracingIframeAllowed?: boolean;

  @ApiPropertyOptional({ description: 'Route outbound requests through the organization proxy' })
  @IsOptional()
  @IsBoolean()
  useProxy?: boolean;
}

export class TracingInstanceResponseDto {
  @ApiProperty({ description: 'Unique identifier', example: '550e8400-e29b-41d4-a716-446655440000' })
  id!: string;

  @ApiProperty({ description: 'Unique label for the tracing instance', example: 'Production Tempo' })
  label!: string;

  @ApiProperty({ description: 'Tracing instance URL', example: 'https://tempo.example.com' })
  tracing_url!: string;

  @ApiPropertyOptional({
    description: 'Backend API URL for Tempo (used for server-side API calls). Only applicable for Tempo UI type.',
    example: 'http://tempo-api.internal:3200'
  })
  tracing_api_url?: string;

  @ApiProperty({ description: 'Type of tracing UI', enum: ['tempo', 'jaeger', 'elastic'] })
  tracing_ui!: TracingUI;

  @ApiProperty({ description: 'Whether the tracing UI can be embedded in an iframe' })
  tracing_iframe_allowed!: boolean;

  @ApiProperty({ description: 'Creation timestamp' })
  created_at!: string;

  @ApiProperty({ description: 'Last update timestamp' })
  updated_at!: string;
}

export class TracingInstanceQuery {
  @ApiPropertyOptional({ description: 'Filter by instance label' })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({
    description: 'Filter by tracing UI type',
    enum: TracingUI
  })
  @IsOptional()
  @IsEnum(TracingUI)
  tracingUi?: TracingUI;
}

export class TestConnectionDto {
  @ApiProperty({ description: 'Tracing instance URL to test', example: 'https://tempo.example.com' })
  @IsUrl({ require_tld: false })
  tracingUrl!: string;

  @ApiProperty({
    description: 'Type of tracing UI',
    enum: TracingUI
  })
  @IsEnum(TracingUI)
  tracingUi!: TracingUI;
}
