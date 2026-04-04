import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsDateString, IsUUID, IsInt, Min } from 'class-validator';

export class SearchTracesDto {
  @ApiProperty({ description: 'Tracing instance UUID' })
  @IsUUID()
  tracingInstanceId: string;

  @ApiProperty({ description: 'Service name to filter traces' })
  @IsString()
  serviceName: string;

  @ApiProperty({ description: 'Test run ID for perfana-test-run-id tag' })
  @IsString()
  testRunId: string;

  @ApiProperty({ description: 'Scenario name (first part of perfana-request-name)' })
  @IsString()
  scenario: string;

  @ApiProperty({ description: 'Transaction name (second part of perfana-request-name)' })
  @IsString()
  transaction: string;

  @ApiPropertyOptional({ description: 'Sampler name (third part of perfana-request-name)' })
  @IsString()
  @IsOptional()
  sampler?: string;

  @ApiProperty({ description: 'Start time (ISO 8601)' })
  @IsDateString()
  startTime: string;

  @ApiProperty({ description: 'End time (ISO 8601)' })
  @IsDateString()
  endTime: string;

  @ApiPropertyOptional({ description: 'Maximum number of traces to return' })
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;
}

export class GetTraceDto {
  @ApiProperty({ description: 'Tracing instance UUID' })
  @IsUUID()
  tracingInstanceId: string;
}

export class TraceSearchResultDto {
  @ApiProperty({ description: 'Trace ID' })
  traceId: string;

  @ApiProperty({ description: 'Trace duration in milliseconds' })
  durationMs: number;

  @ApiProperty({ description: 'Start time in Unix nanoseconds' })
  startTimeUnixNano: string;

  @ApiProperty({ description: 'Number of spans in the trace' })
  spanCount: number;

  @ApiProperty({ description: 'Root service name' })
  rootServiceName: string;

  @ApiPropertyOptional({ description: 'Root span name' })
  rootTraceName?: string;
}

export class SearchTracesResponseDto {
  @ApiProperty({ description: 'List of matching traces', type: [TraceSearchResultDto] })
  traces: TraceSearchResultDto[];

  @ApiProperty({ description: 'Total number of traces found' })
  totalCount: number;
}

// OpenTelemetry trace structure types
export interface OTelSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  serviceName: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  durationNanos: number;
  status?: {
    code: number;
    message?: string;
  };
  attributes?: Record<string, string | number | boolean>;
  events?: Array<{
    timeUnixNano: string;
    name: string;
    attributes?: Record<string, string | number | boolean | null>;
  }>;
}

export interface OTelTrace {
  traceId: string;
  spans: OTelSpan[];
  rootSpan?: OTelSpan;
  durationMs: number;
  spanCount: number;
}

export class TraceDetailsResponseDto {
  @ApiProperty({ description: 'Trace ID' })
  traceId: string;

  @ApiProperty({ description: 'All spans in the trace' })
  spans: OTelSpan[];

  @ApiProperty({ description: 'Total duration in milliseconds' })
  durationMs: number;

  @ApiProperty({ description: 'Total span count' })
  spanCount: number;
}
