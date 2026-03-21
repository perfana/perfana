import { ApiProperty } from '@nestjs/swagger';
import { TracingUI } from '@perfana/shared/entities';

class TracingInstanceInfo {
  @ApiProperty({
    description: 'Tracing instance ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id!: string;

  @ApiProperty({
    description: 'Tracing instance label',
    example: 'Production Tempo',
  })
  label!: string;

  @ApiProperty({
    description: 'Base URL for the tracing instance',
    example: 'https://tempo.example.com',
  })
  tracingUrl!: string;

  @ApiProperty({
    description: 'Backend API URL for Tempo (used for server-side API calls). Only applicable for Tempo UI type.',
    example: 'http://tempo-api.internal:3200',
    required: false,
  })
  tracingApiUrl?: string;

  @ApiProperty({
    description: 'Type of tracing UI',
    enum: TracingUI,
    example: TracingUI.TEMPO,
  })
  tracingUi!: TracingUI;

  @ApiProperty({
    description: 'Whether the tracing UI can be embedded in an iframe',
    example: false,
  })
  tracingIframeAllowed!: boolean;
}

export class TracingServiceResponseDto {
  @ApiProperty({
    description: 'Unique identifier',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id!: string;

  @ApiProperty({
    description: 'System under test ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  systemUnderTestId!: string;

  @ApiProperty({
    description: 'Test environment - null means applies to all environments',
    example: 'production',
    nullable: true,
  })
  testEnvironment!: string | null;

  @ApiProperty({
    description: 'Workload - null means applies to all workloads',
    example: 'load-test',
    nullable: true,
  })
  workload!: string | null;

  @ApiProperty({
    description: 'Tracing instance ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  tracingInstanceId!: string;

  @ApiProperty({
    description: 'Tracing instance information',
    type: TracingInstanceInfo,
  })
  tracingInstance!: TracingInstanceInfo;

  @ApiProperty({
    description: 'Array of service names to trace',
    example: ['user-service', 'order-service', 'payment-service'],
    type: [String],
  })
  serviceNames!: string[];

  @ApiProperty({
    description: 'Timestamp when created',
    example: '2024-01-15T10:30:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'Timestamp when last updated',
    example: '2024-01-15T10:30:00.000Z',
  })
  updatedAt!: Date;
}
