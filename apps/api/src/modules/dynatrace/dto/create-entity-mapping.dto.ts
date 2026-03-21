import { IsString, IsUUID, IsOptional, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateEntityMappingDto {
  @ApiProperty({
    description: 'UUID of the Dynatrace configuration instance',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  dynatraceConfigId!: string;

  @ApiProperty({
    description: 'UUID of the system under test',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  @IsUUID()
  systemUnderTestId!: string;

  @ApiProperty({
    description: 'Test environment name (required for sut_testenv and sut_testenv_workload levels)',
    example: 'production',
    required: false,
  })
  @IsOptional()
  @IsString()
  testEnvironment?: string;

  @ApiProperty({
    description: 'Workload name (required for sut_testenv_workload level)',
    example: 'load-test',
    required: false,
  })
  @IsOptional()
  @IsString()
  workload?: string;

  @ApiProperty({
    description: 'Dynatrace entity ID',
    example: 'HOST-1234567890ABCDEF',
  })
  @IsString()
  entityId!: string;

  @ApiProperty({
    description: 'Display name of the Dynatrace entity',
    example: 'prod-server-01',
  })
  @IsString()
  entityDisplayName!: string;

  @ApiProperty({
    description: 'Type of the Dynatrace entity',
    example: 'HOST',
  })
  @IsString()
  entityType!: string;

  @ApiProperty({
    description: 'Configuration level',
    enum: ['sut', 'sut_testenv', 'sut_testenv_workload'],
    example: 'sut',
  })
  @IsIn(['sut', 'sut_testenv', 'sut_testenv_workload'])
  level!: 'sut' | 'sut_testenv' | 'sut_testenv_workload';
}
