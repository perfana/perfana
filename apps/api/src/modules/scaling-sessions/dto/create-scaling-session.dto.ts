import { IsNotEmpty, IsString, IsUUID, IsOptional, MaxLength, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateScalingSessionDto {
  @ApiProperty({ description: 'Session name', example: 'PaymentService scaling to 1000 users' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ description: 'Session description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'System under test UUID' })
  @IsNotEmpty()
  @IsUUID()
  systemUnderTestId!: string;

  @ApiProperty({ description: 'Test environment', example: 'production' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  testEnvironment!: string;

  @ApiProperty({ description: 'Workload name', example: 'loadTest' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  workload!: string;

  @ApiPropertyOptional({ description: 'Baseline test run ID (test_run_id string)', example: 'PaymentService-prod-loadTest-100users' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  baselineTestRunId?: string;

  @ApiPropertyOptional({ description: 'Target load description', example: '1000 concurrent users' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  targetLoad?: string;

  @ApiPropertyOptional({ description: 'Linked benchmark (SLO) IDs that define scaling success', type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  linkedBenchmarkIds?: string[];
}
