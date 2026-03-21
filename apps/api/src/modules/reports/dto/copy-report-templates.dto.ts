import { IsString, IsOptional, IsArray, IsIn, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CopyReportTemplatesDto {
  @ApiProperty({ description: 'Source system ID' })
  @IsString()
  sourceSystemId!: string;

  @ApiProperty({ description: 'Source test environment' })
  @IsString()
  sourceTestEnvironment!: string;

  @ApiProperty({ description: 'Source workload' })
  @IsString()
  sourceWorkload!: string;

  @ApiProperty({ description: 'Target system ID' })
  @IsString()
  targetSystemId!: string;

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
