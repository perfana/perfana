import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID, IsArray, ValidateNested, ArrayMinSize, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateWorkloadDto {
  @ApiProperty({ description: 'Workload name', example: 'loadTest' })
  @IsString()
  @IsNotEmpty()
  name!: string;
}

export class CreateTestEnvironmentDto {
  @ApiProperty({ description: 'Environment name', example: 'acc' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({
    description: 'Workloads to pre-seed for this environment',
    type: [CreateWorkloadDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateWorkloadDto)
  workloads?: CreateWorkloadDto[];
}

export class CreateSystemUnderTestDto {
  @ApiProperty({ description: 'System under test name', example: 'Payment API' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ description: 'System description', example: 'Core payment processing system' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Organization ID (UUID)', example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID('4')
  @IsNotEmpty()
  organizationId!: string;

  @ApiPropertyOptional({
    description: 'Team ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @IsOptional()
  @IsUUID('4')
  teamId?: string;

  @ApiPropertyOptional({
    description: 'Test environments and workloads to pre-seed',
    type: [CreateTestEnvironmentDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CreateTestEnvironmentDto)
  environments?: CreateTestEnvironmentDto[];
}
