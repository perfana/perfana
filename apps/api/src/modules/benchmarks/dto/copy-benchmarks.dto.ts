import { IsString, IsUUID, IsOptional, IsArray, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CopyBenchmarksDto {
  @ApiProperty({ description: 'Source system under test ID' })
  @IsUUID()
  sourceSystemUnderTestId!: string;

  @ApiProperty({ description: 'Source test environment' })
  @IsString()
  sourceTestEnvironment!: string;

  @ApiProperty({ description: 'Source workload' })
  @IsString()
  sourceWorkload!: string;

  @ApiProperty({ description: 'Target system under test ID' })
  @IsUUID()
  targetSystemUnderTestId!: string;

  @ApiProperty({ description: 'Target test environment' })
  @IsString()
  targetTestEnvironment!: string;

  @ApiProperty({ description: 'Target workload' })
  @IsString()
  targetWorkload!: string;

  @ApiProperty({ description: 'Conflict strategy', enum: ['skip', 'overwrite'] })
  @IsIn(['skip', 'overwrite'])
  conflictStrategy!: 'skip' | 'overwrite';

  @ApiPropertyOptional({ description: 'Specific IDs to copy (omit to copy all)', type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  ids?: string[];
}
