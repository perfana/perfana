import { IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateExpectedConfigChangeDto {
  @ApiProperty({
    description: 'System under test name',
    example: 'MyAfterburner'
  })
  @IsString()
  system!: string;

  @ApiProperty({
    description: 'Test environment',
    example: 'acc'
  })
  @IsString()
  environment!: string;

  @ApiProperty({
    description: 'Workload type',
    example: 'loadTest'
  })
  @IsString()
  workload!: string;

  @ApiProperty({
    description: 'Configuration key that is expected to change',
    example: 'application.build.timestamp'
  })
  @IsString()
  configKey!: string;

  @ApiProperty({
    description: 'Optional reason for why this change is expected',
    example: 'Build timestamp changes with every deployment'
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ExpectedConfigChangeDto {
  @ApiProperty({
    description: 'Unique identifier for the expected config change',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  id!: string;

  @ApiProperty({
    description: 'System under test ID',
    example: '550e8400-e29b-41d4-a716-446655440001'
  })
  system_under_test_id!: string;

  @ApiProperty({
    description: 'Test environment',
    example: 'acc'
  })
  test_environment!: string;

  @ApiProperty({
    description: 'Workload type',
    example: 'loadTest'
  })
  workload!: string;

  @ApiProperty({
    description: 'Configuration key that is expected to change',
    example: 'application.build.timestamp'
  })
  config_key!: string;

  @ApiProperty({
    description: 'Reason for why this change is expected',
    example: 'Build timestamp changes with every deployment',
    required: false
  })
  reason?: string;

  @ApiProperty({
    description: 'User ID who created this expected change',
    example: 'user@example.com',
    required: false
  })
  created_by?: string;

  @ApiProperty({
    description: 'Timestamp when this expected change was created',
    example: '2024-01-15T10:30:00.000Z'
  })
  created_at!: string;

  @ApiProperty({
    description: 'Timestamp when this expected change was last updated',
    example: '2024-01-15T10:30:00.000Z'
  })
  updated_at!: string;
}