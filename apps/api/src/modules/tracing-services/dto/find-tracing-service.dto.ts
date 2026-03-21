import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class FindTracingServiceDto {
  @ApiProperty({
    description: 'System under test ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsNotEmpty()
  @IsUUID()
  systemId!: string;

  @ApiProperty({
    description: 'Test environment for hierarchical resolution',
    example: 'production',
    required: false,
  })
  @IsOptional()
  @IsString()
  environment?: string;

  @ApiProperty({
    description: 'Workload for hierarchical resolution',
    example: 'load-test',
    required: false,
  })
  @IsOptional()
  @IsString()
  workload?: string;
}
