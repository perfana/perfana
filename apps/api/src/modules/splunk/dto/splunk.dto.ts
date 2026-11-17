import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUrl, IsUUID, Matches, Max, MaxLength, Min,
} from 'class-validator';

export class CreateSplunkConfigDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(255)
  label!: string;

  @ApiProperty({ description: 'Management URL, port 8089 (not Splunk Web on 8000)', example: 'https://splunk.example.com:8089' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false }) @MaxLength(500)
  host!: string;

  @ApiPropertyOptional({ description: 'Splunk Web URL for deep links; falls back to host' })
  @IsOptional() @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false }) @MaxLength(500)
  clientUrl?: string | null;

  @ApiPropertyOptional({ description: 'Splunk authentication token; wins over username/password' })
  @IsOptional() @IsString()
  apiToken?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255)
  username?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsString()
  password?: string | null;

  @ApiPropertyOptional({ default: 'search' }) @IsOptional() @IsString() @Matches(/^[\w.-]+$/) @MaxLength(100)
  splunkApp?: string;

  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean()
  verifyTls?: boolean;

  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean()
  useProxy?: boolean;

  @ApiPropertyOptional({ default: 2 }) @IsOptional() @IsInt() @Min(1) @Max(20)
  maxConcurrentSearches?: number;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  organizationId?: string;
}

export class UpdateSplunkConfigDto extends PartialType(OmitType(CreateSplunkConfigDto, ['organizationId'] as const)) {}

export class TestSplunkConnectionDto {
  @ApiProperty() @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  host!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() apiToken?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() username?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() password?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() useProxy?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsUUID() organizationId?: string;
}

const LEVELS = ['sut', 'environment', 'workload'] as const;

export class CreateSplunkEntityMappingDto {
  @ApiProperty() @IsUUID() splunkConfigId!: string;
  @ApiProperty() @IsUUID() systemUnderTestId!: string;

  @ApiProperty({ enum: LEVELS }) @IsIn(LEVELS)
  level!: (typeof LEVELS)[number];

  @ApiPropertyOptional({ description: 'Required for level environment and workload' })
  @IsOptional() @IsString() @MaxLength(255)
  testEnvironment?: string | null;

  @ApiPropertyOptional({ description: 'Required for level workload' })
  @IsOptional() @IsString() @MaxLength(255)
  workload?: string | null;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(255)
  indexName!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255)
  sourcetype?: string | null;

  @ApiPropertyOptional({ description: 'Exact host or Splunk wildcard, e.g. app-*' })
  @IsOptional() @IsString() @MaxLength(500)
  hostPattern?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(50, { each: true })
  labels?: string[];
}

export class CopySplunkEntityMappingsDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true })
  mappingIds!: string[];

  @ApiProperty() @IsString() @IsNotEmpty() targetEnvironment!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() targetWorkload?: string;
}

export class CreateSplunkQueryDto {
  @ApiProperty() @IsUUID() splunkConfigId!: string;
  @ApiProperty() @IsUUID() systemUnderTestId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(255) testEnvironment!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(255) workload!: string;

  @ApiPropertyOptional({ default: 'Splunk logs' }) @IsOptional() @IsString() @MaxLength(255)
  dashboardLabel?: string;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(500) panelTitle!: string;

  @ApiPropertyOptional({ description: 'Assigned automatically when omitted' }) @IsOptional() @IsInt() @Min(1)
  panelId?: number;

  @ApiProperty({ description: 'Filter only, e.g. "$entities log_level=ERROR". Perfana adds the time window and timechart.' })
  @IsString() @IsNotEmpty() @MaxLength(4000)
  spl!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^[A-Za-z_][\w.]*$/) @MaxLength(255)
  splitBy?: string | null;

  @ApiPropertyOptional({ default: 'count', example: 'p95(duration_ms)' }) @IsOptional() @IsString() @MaxLength(100)
  aggregation?: string;

  @ApiPropertyOptional({ default: 'short' }) @IsOptional() @IsString() @MaxLength(50)
  metricUnit?: string;

  @ApiPropertyOptional({ default: 20 }) @IsOptional() @IsInt() @Min(1) @Max(100)
  maxSeries?: number;

  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean()
  enabled?: boolean;
}

export class UpdateSplunkQueryDto extends PartialType(
  OmitType(CreateSplunkQueryDto, ['splunkConfigId', 'systemUnderTestId', 'testEnvironment', 'workload'] as const),
) {}

export class PreviewSplunkQueryDto {
  @ApiProperty() @IsUUID() splunkConfigId!: string;
  @ApiProperty() @IsUUID() systemUnderTestId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() testEnvironment!: string;
  @ApiProperty() @IsString() @IsNotEmpty() workload!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(4000) spl!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^[A-Za-z_][\w.]*$/) splitBy?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() aggregation?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100) maxSeries?: number;
  @ApiPropertyOptional({ description: 'Minutes back from now, default 60' }) @IsOptional() @IsInt() @Min(5) @Max(1440)
  minutes?: number;
}

export class StarterSplunkQueriesDto {
  @ApiProperty() @IsUUID() splunkConfigId!: string;
  @ApiProperty() @IsUUID() systemUnderTestId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(255) testEnvironment!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(255) workload!: string;

  @ApiPropertyOptional({ description: 'Field holding the log level in these logs', default: 'log_level' })
  @IsOptional() @IsString() @Matches(/^[A-Za-z_][\w.]*$/) @MaxLength(255)
  levelField?: string;
}
