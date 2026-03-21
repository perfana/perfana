import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, IsArray, IsString, IsOptional, ValidateIf, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Single Pyroscope application + profiler combination
 */
export class PyroscopeConfigurationDto {
  @ApiPropertyOptional({
    description: 'Application/service name',
    example: 'payment-service',
  })
  @IsString()
  application!: string;

  @ApiPropertyOptional({
    description: 'Profiler type value',
    example: 'process_cpu:cpu:nanoseconds:cpu:nanoseconds',
  })
  @IsString()
  profiler!: string;
}

/**
 * DTO for updating Pyroscope configuration on a System Under Test
 *
 * This DTO allows updating the Pyroscope profiling integration settings.
 * All fields are optional, but if pyroscope_instance_id is provided,
 * at least one configuration combination should be provided.
 */
export class UpdatePyroscopeConfigDto {
  @ApiPropertyOptional({
    description: 'Pyroscope instance ID (UUID) or null to disable profiling integration',
    example: '550e8400-e29b-41d4-a716-446655440000',
    type: String,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((o) => o.pyroscope_instance_id !== null)
  @IsUUID('4', { message: 'pyroscope_instance_id must be a valid UUID' })
  pyroscope_instance_id?: string | null;

  @ApiPropertyOptional({
    description: 'Array of application + profiler combinations',
    example: [
      { application: 'payment-service', profiler: 'process_cpu:cpu:nanoseconds:cpu:nanoseconds' },
      { application: 'payment-service', profiler: 'memory:alloc_in_new_tlab_bytes:bytes:space:bytes' },
    ],
    type: [PyroscopeConfigurationDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PyroscopeConfigurationDto)
  pyroscope_configurations?: PyroscopeConfigurationDto[];
}
