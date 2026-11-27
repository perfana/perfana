import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { LOKI_LEVEL_PARSERS, LOKI_MATCHER_OPS, type LokiLevelParser, type LokiMatcherOp } from '@perfana/shared/services/loki/client';

const LABEL_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export class CreateLokiConfigDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(255)
  label!: string;

  @ApiProperty({ description: 'The Grafana instance Perfana queries Loki through (its credentials are used)' })
  @IsUUID()
  grafanaInstanceId!: string;

  @ApiProperty({ description: 'Uid of the Loki datasource on that Grafana instance' })
  @IsString() @IsNotEmpty() @MaxLength(255) @Matches(/^[\w.-]+$/)
  datasourceUid!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255)
  datasourceName?: string | null;

  @ApiPropertyOptional({ description: 'Label holding a line\'s log level', default: 'detected_level' })
  @IsOptional() @IsString() @Matches(LABEL_NAME) @MaxLength(100)
  levelLabel?: string;

  @ApiPropertyOptional({
    enum: LOKI_LEVEL_PARSERS, default: 'none',
    description: 'How the level label is obtained: none (a stream label or structured metadata), or the json / logfmt parser that extracts it from the line',
  })
  @IsOptional() @IsIn(LOKI_LEVEL_PARSERS as unknown as string[])
  levelParser?: LokiLevelParser;

  @ApiPropertyOptional({ description: 'Label that names an application, for the per-application view', default: 'service_name' })
  @IsOptional() @IsString() @Matches(LABEL_NAME) @MaxLength(100)
  serviceLabel?: string;

  @ApiPropertyOptional({ default: 2 }) @IsOptional() @IsInt() @Min(1) @Max(20)
  maxConcurrentQueries?: number;
}

export class UpdateLokiConfigDto extends PartialType(OmitType(CreateLokiConfigDto, ['grafanaInstanceId'] as const)) {}

export class TestLokiConnectionDto {
  @ApiProperty() @IsUUID() grafanaInstanceId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(255) @Matches(/^[\w.-]+$/) datasourceUid!: string;

  @ApiPropertyOptional({ description: 'The level label to check (default detected_level)' })
  @IsOptional() @IsString() @Matches(LABEL_NAME) @MaxLength(100)
  levelLabel?: string;

  @ApiPropertyOptional({ enum: LOKI_LEVEL_PARSERS })
  @IsOptional() @IsIn(LOKI_LEVEL_PARSERS as unknown as string[])
  levelParser?: LokiLevelParser;

  @ApiPropertyOptional({ description: 'The service label, used to pick streams for the level check (default service_name)' })
  @IsOptional() @IsString() @Matches(LABEL_NAME) @MaxLength(100)
  serviceLabel?: string;
}

export class LokiMatcherDto {
  @ApiProperty({ example: 'service_name' }) @IsString() @Matches(LABEL_NAME) @MaxLength(255)
  label!: string;

  @ApiProperty({ enum: LOKI_MATCHER_OPS }) @IsIn(LOKI_MATCHER_OPS as unknown as string[])
  op!: LokiMatcherOp;

  @ApiProperty({ example: 'checkout' }) @IsString() @MaxLength(500)
  value!: string;
}

const LEVELS = ['sut', 'environment', 'workload'] as const;

export class CreateLokiStreamMappingDto {
  @ApiProperty() @IsUUID() lokiConfigId!: string;
  @ApiProperty() @IsUUID() systemUnderTestId!: string;

  @ApiProperty({ enum: LEVELS }) @IsIn(LEVELS)
  level!: (typeof LEVELS)[number];

  @ApiPropertyOptional({ description: 'Required for level environment and workload' })
  @IsOptional() @IsString() @MaxLength(255)
  testEnvironment?: string | null;

  @ApiPropertyOptional({ description: 'Required for level workload' })
  @IsOptional() @IsString() @MaxLength(255)
  workload?: string | null;

  @ApiProperty({ type: [LokiMatcherDto], description: 'Label matchers, AND-ed into one stream selector' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => LokiMatcherDto)
  matchers!: LokiMatcherDto[];

  @ApiPropertyOptional({ type: [String], description: 'Perfana tags a panel can target with $entities[tag]' })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(50, { each: true })
  labels?: string[];
}

export class CopyLokiStreamMappingsDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true })
  mappingIds!: string[];

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(255) targetEnvironment!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(255) targetWorkload?: string;
}

export class CreateLokiQueryDto {
  @ApiProperty() @IsUUID() lokiConfigId!: string;
  @ApiProperty() @IsUUID() systemUnderTestId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(255) testEnvironment!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(255) workload!: string;

  @ApiPropertyOptional({ default: 'Loki logs' }) @IsOptional() @IsString() @MaxLength(255)
  dashboardLabel?: string;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(500) panelTitle!: string;

  @ApiPropertyOptional({ description: 'Assigned automatically when omitted' }) @IsOptional() @IsInt() @Min(1)
  panelId?: number;

  @ApiProperty({ description: '$entities plus pipeline stages, e.g. `$entities |= "Exception"`. Perfana adds the aggregation and range.' })
  @IsString() @IsNotEmpty() @MaxLength(4000)
  logql!: string;

  @ApiPropertyOptional({ description: 'Label to split series on' }) @IsOptional() @IsString() @Matches(LABEL_NAME) @MaxLength(255)
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

export class UpdateLokiQueryDto extends PartialType(
  // dashboardLabel is fixed at create: it is hashed into the artificial dashboard's id.
  OmitType(CreateLokiQueryDto, ['lokiConfigId', 'systemUnderTestId', 'testEnvironment', 'workload', 'dashboardLabel'] as const),
) {}

export class PreviewLokiQueryDto {
  @ApiProperty() @IsUUID() lokiConfigId!: string;
  @ApiProperty() @IsUUID() systemUnderTestId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() testEnvironment!: string;
  @ApiProperty() @IsString() @IsNotEmpty() workload!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(4000) logql!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(LABEL_NAME) splitBy?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() aggregation?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100) maxSeries?: number;
  @ApiPropertyOptional({ description: 'Minutes back from now, default 60' }) @IsOptional() @IsInt() @Min(5) @Max(1440)
  minutes?: number;
}

export class StarterLokiQueriesDto {
  @ApiProperty() @IsUUID() lokiConfigId!: string;
  @ApiProperty() @IsUUID() systemUnderTestId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(255) testEnvironment!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(255) workload!: string;

  @ApiPropertyOptional({ description: 'Label that names a service in these streams; defaults to the connection\'s service label' })
  @IsOptional() @IsString() @Matches(LABEL_NAME) @MaxLength(255)
  serviceLabel?: string;
}
