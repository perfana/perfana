import { IsString, IsOptional, MaxLength, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateScalingSessionDto {
  @ApiPropertyOptional({ description: 'Session name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ description: 'Session description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Baseline test run ID (test_run_id string)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  baselineTestRunId?: string;

  @ApiPropertyOptional({ description: 'Target load description' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  targetLoad?: string;

  @ApiPropertyOptional({ description: 'Session status', enum: ['active', 'completed', 'abandoned'] })
  @IsOptional()
  @IsString()
  @Matches(/^(active|completed|abandoned)$/, { message: 'status must be active, completed, or abandoned' })
  status?: string;
}
