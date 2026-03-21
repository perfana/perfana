import { IsNotEmpty, IsOptional, IsString, IsUUID, IsArray, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTracingServiceDto {
  @ApiProperty({
    description: 'System under test ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsNotEmpty()
  @IsUUID()
  systemUnderTestId!: string;

  @ApiProperty({
    description: 'Test environment - null means applies to all environments',
    example: 'production',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  testEnvironment?: string | null;

  @ApiProperty({
    description: 'Workload - null means applies to all workloads',
    example: 'load-test',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  workload?: string | null;

  @ApiProperty({
    description: 'Tracing instance ID to use',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsNotEmpty()
  @IsUUID()
  tracingInstanceId!: string;

  @ApiProperty({
    description: 'Array of service names to trace',
    example: ['user-service', 'order-service', 'payment-service'],
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  serviceNames!: string[];
}

export class UpdateTracingServiceDto {
  @ApiProperty({
    description: 'Test environment - null means applies to all environments',
    example: 'production',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  testEnvironment?: string | null;

  @ApiProperty({
    description: 'Workload - null means applies to all workloads',
    example: 'load-test',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  workload?: string | null;

  @ApiProperty({
    description: 'Tracing instance ID to use',
    example: '550e8400-e29b-41d4-a716-446655440000',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  tracingInstanceId?: string;

  @ApiProperty({
    description: 'Array of service names to trace',
    example: ['user-service', 'order-service'],
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serviceNames?: string[];
}
