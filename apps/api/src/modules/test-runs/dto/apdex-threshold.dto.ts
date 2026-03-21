import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min, Max } from 'class-validator';

/**
 * DTO for setting Apdex threshold (workload-level or transaction-level)
 */
export class SetApdexThresholdDto {
  @ApiProperty({
    description: 'Apdex threshold in milliseconds (T)',
    example: 500,
    minimum: 1,
    maximum: 60000,
  })
  @IsInt()
  @Min(1)
  @Max(60000)
  apdex_threshold: number;
}

/**
 * Response DTO for workload-level Apdex threshold
 */
export class WorkloadApdexThresholdDto {
  @ApiProperty({
    description: 'Unique identifier',
    example: '550e8400-e29b-41d4-a716-446655440000',
    required: false,
  })
  id?: string;

  @ApiProperty({
    description: 'System under test ID',
    example: 'MyAfterburner',
  })
  system_under_test_id: string;

  @ApiProperty({
    description: 'Test environment',
    example: 'acc',
  })
  test_environment: string;

  @ApiProperty({
    description: 'Workload name',
    example: 'loadTest',
  })
  workload: string;

  @ApiProperty({
    description: 'Apdex threshold in milliseconds',
    example: 500,
  })
  apdex_threshold: number;

  @ApiProperty({
    description: 'Creation timestamp',
    example: '2025-11-28T10:00:00Z',
    required: false,
  })
  created_at?: string;

  @ApiProperty({
    description: 'Last update timestamp',
    example: '2025-11-28T10:00:00Z',
    required: false,
  })
  updated_at?: string;
}

/**
 * Response DTO for workload transaction-level Apdex threshold
 */
export class WorkloadTransactionApdexThresholdDto {
  @ApiProperty({
    description: 'Unique identifier',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: 'System under test ID',
    example: 'MyAfterburner',
  })
  system_under_test_id: string;

  @ApiProperty({
    description: 'Test environment',
    example: 'acc',
  })
  test_environment: string;

  @ApiProperty({
    description: 'Workload name',
    example: 'loadTest',
  })
  workload: string;

  @ApiProperty({
    description: 'Transaction name',
    example: 'database_call',
  })
  transaction_name: string;

  @ApiProperty({
    description: 'Apdex threshold in milliseconds',
    example: 2000,
  })
  apdex_threshold: number;

  @ApiProperty({
    description: 'Creation timestamp',
    example: '2025-11-28T10:00:00Z',
  })
  created_at: string;

  @ApiProperty({
    description: 'Last update timestamp',
    example: '2025-11-28T10:00:00Z',
  })
  updated_at: string;
}
