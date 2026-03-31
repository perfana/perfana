import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNumber, IsBoolean, IsOptional, IsEnum, IsUrl } from 'class-validator';

export enum PyroscopeViewMode {
  SINGLE = 'single',
  COMPARISON = 'comparison',
  DIFF = 'diff'
}

export enum PyroscopeTheme {
  LIGHT = 'light',
  DARK = 'dark'
}

export class ProfilerTypeDto {
  @ApiProperty({ description: 'Profiler value/identifier', example: 'process_cpu:cpu:nanoseconds:cpu:nanoseconds' })
  value!: string;

  @ApiProperty({ description: 'Human-readable profiler label', example: 'process_cpu/cpu' })
  label!: string;
}

export class GenerateSingleViewUrlDto {
  @ApiProperty({ description: 'Pyroscope instance URL', example: 'https://pyroscope.example.com' })
  @IsUrl({ require_tld: false })
  pyroscopeUrl!: string;

  @ApiProperty({ description: 'Whether this is a standalone Pyroscope instance', example: false })
  @IsBoolean()
  isStandalone!: boolean;

  @ApiProperty({ description: 'Application name/service name', example: 'payment-service' })
  @IsString()
  application!: string;

  @ApiProperty({ description: 'Profiler type value', example: 'process_cpu:cpu:nanoseconds:cpu:nanoseconds' })
  @IsString()
  profilerValue!: string;

  @ApiProperty({ description: 'Start timestamp in milliseconds', example: 1609459200000 })
  @IsNumber()
  startTime!: number;

  @ApiProperty({ description: 'End timestamp in milliseconds', example: 1609462800000 })
  @IsNumber()
  endTime!: number;

  @ApiPropertyOptional({ description: 'UI theme', enum: PyroscopeTheme, example: 'dark' })
  @IsOptional()
  @IsEnum(PyroscopeTheme)
  theme?: PyroscopeTheme;
}

export class GenerateCompareUrlDto {
  @ApiProperty({ description: 'Pyroscope instance URL', example: 'https://pyroscope.example.com' })
  @IsUrl({ require_tld: false })
  pyroscopeUrl!: string;

  @ApiProperty({ description: 'Whether this is a standalone Pyroscope instance', example: false })
  @IsBoolean()
  isStandalone!: boolean;

  @ApiProperty({ description: 'Application name/service name', example: 'payment-service' })
  @IsString()
  application!: string;

  @ApiProperty({ description: 'Profiler type value', example: 'process_cpu:cpu:nanoseconds:cpu:nanoseconds' })
  @IsString()
  profilerValue!: string;

  @ApiProperty({ description: 'Profiler label for query construction', example: 'process_cpu/cpu' })
  @IsString()
  profilerLabel!: string;

  @ApiProperty({ description: 'Left (baseline) start timestamp in milliseconds', example: 1609459200000 })
  @IsNumber()
  leftStartTime!: number;

  @ApiProperty({ description: 'Left (baseline) end timestamp in milliseconds', example: 1609462800000 })
  @IsNumber()
  leftEndTime!: number;

  @ApiProperty({ description: 'Right (current) start timestamp in milliseconds', example: 1609466400000 })
  @IsNumber()
  rightStartTime!: number;

  @ApiProperty({ description: 'Right (current) end timestamp in milliseconds', example: 1609470000000 })
  @IsNumber()
  rightEndTime!: number;

  @ApiPropertyOptional({ description: 'View mode for comparison', enum: PyroscopeViewMode, example: 'comparison' })
  @IsOptional()
  @IsEnum(PyroscopeViewMode)
  viewMode?: PyroscopeViewMode;

  @ApiPropertyOptional({ description: 'UI theme', enum: PyroscopeTheme, example: 'dark' })
  @IsOptional()
  @IsEnum(PyroscopeTheme)
  theme?: PyroscopeTheme;
}

export class PyroscopeUrlResponseDto {
  @ApiProperty({ description: 'Generated Pyroscope URL', example: 'https://pyroscope.example.com/?from=...' })
  url!: string;

  @ApiProperty({ description: 'Whether the URL is for standalone mode', example: false })
  isStandalone!: boolean;

  @ApiProperty({ description: 'Application name used', example: 'payment-service' })
  application!: string;

  @ApiProperty({ description: 'Profiler value used', example: 'process_cpu:cpu:nanoseconds:cpu:nanoseconds' })
  profilerValue!: string;
}
