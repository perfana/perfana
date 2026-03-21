import { IsString, IsOptional, IsBoolean, IsArray, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * DTO for dashboard variable
 */
export class DashboardVariableDto {
  @ApiProperty({
    description: 'Variable name',
    example: 'system_under_test'
  })
  @IsString()
  name!: string;

  @ApiProperty({
    description: 'Variable values',
    example: ['MyApp', 'MyService'],
    type: [String]
  })
  @IsArray()
  @IsString({ each: true })
  values!: string[];
}

/**
 * DTO for creating a new profile dashboard association
 */
export class CreateProfileDashboardDto {
  @ApiProperty({
    description: 'Dashboard UID from Grafana',
    example: 'abc123def'
  })
  @IsString()
  dashboardUid!: string;

  @ApiProperty({
    description: 'Grafana instance label',
    example: 'Default'
  })
  @IsString()
  grafanaLabel!: string;

  @ApiProperty({
    description: 'Variable name to create separate dashboards for',
    example: 'application',
    required: false
  })
  @IsOptional()
  @IsString()
  createSeparateDashboardForVariable?: string;

  @ApiProperty({
    description: 'Variables with hardcoded values',
    type: [DashboardVariableDto],
    required: false
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DashboardVariableDto)
  setHardcodedValueForVariables?: DashboardVariableDto[];

  @ApiProperty({
    description: 'Regex patterns for variables',
    example: { 'environment': 'prod.*', 'region': 'us-.*' },
    required: false
  })
  @IsOptional()
  matchRegexForVariables?: Record<string, string>;

  @ApiProperty({
    description: 'Whether this dashboard configuration is read-only',
    example: false,
    required: false
  })
  @IsOptional()
  @IsBoolean()
  readOnly?: boolean;
}

/**
 * DTO for updating an existing profile dashboard association
 */
export class UpdateProfileDashboardDto {
  @ApiProperty({
    description: 'Dashboard UID from Grafana',
    example: 'abc123def',
    required: false
  })
  @IsOptional()
  @IsString()
  dashboardUid?: string;

  @ApiProperty({
    description: 'Grafana instance label',
    example: 'Default',
    required: false
  })
  @IsOptional()
  @IsString()
  grafanaLabel?: string;

  @ApiProperty({
    description: 'Variable name to create separate dashboards for',
    example: 'application',
    required: false
  })
  @IsOptional()
  @IsString()
  createSeparateDashboardForVariable?: string;

  @ApiProperty({
    description: 'Variables with hardcoded values',
    type: [DashboardVariableDto],
    required: false
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DashboardVariableDto)
  setHardcodedValueForVariables?: DashboardVariableDto[];

  @ApiProperty({
    description: 'Regex patterns for variables',
    example: { 'environment': 'prod.*', 'region': 'us-.*' },
    required: false
  })
  @IsOptional()
  matchRegexForVariables?: Record<string, string>;

  @ApiProperty({
    description: 'Whether this dashboard configuration is read-only',
    example: false,
    required: false
  })
  @IsOptional()
  @IsBoolean()
  readOnly?: boolean;
}
