import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNumber, IsArray, IsOptional, IsUUID, MaxLength, Min, Max, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

// Application dashboard variable configuration
export class ApplicationDashboardVariableDto {
  @ApiProperty({ description: 'Variable name' })
  @IsString()
  name!: string;

  @ApiProperty({ description: 'Variable values', type: [String] })
  @IsArray()
  @IsString({ each: true })
  values!: string[];
}

// Replaced templating variable structure
export class ReplacedTemplatingVariableDto {
  @ApiProperty({ description: 'Variable name' })
  @IsString()
  name!: string;

  @ApiProperty({ description: 'Replacement values', type: [String] })
  @IsArray()
  @IsString({ each: true })
  value!: string[];
}

export class CreateApplicationDashboardDto {
  @ApiProperty({ description: 'ID of the system under test this dashboard is for' })
  @IsUUID()
  systemUnderTestId!: string;

  @ApiProperty({ description: 'Test environment name' })
  @IsString()
  @MaxLength(255)
  testEnvironment!: string;

  @ApiPropertyOptional({ description: 'ID of the Grafana instance (NULL for non-Grafana sources)' })
  @IsOptional()
  @IsUUID()
  grafanaInstanceId?: string;

  @ApiPropertyOptional({ description: 'ID of the Grafana dashboard (NULL for non-Grafana sources)' })
  @IsOptional()
  @IsUUID()
  grafanaDashboardId?: string;

  @ApiProperty({ description: 'Dashboard name from Grafana' })
  @IsString()
  @MaxLength(255)
  dashboardName!: string;

  @ApiPropertyOptional({ description: 'Grafana internal dashboard ID' })
  @IsOptional()
  @IsNumber()
  dashboardId?: number;

  @ApiPropertyOptional({ description: 'Grafana dashboard UID' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  dashboardUid?: string;

  @ApiProperty({ description: 'Human-readable label for this dashboard configuration' })
  @IsString()
  @MaxLength(255)
  dashboardLabel!: string;

  @ApiPropertyOptional({ description: 'Tags for categorizing this dashboard', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: 'UID of the template dashboard this is based on' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  templateDashboardUid?: string;

  @ApiPropertyOptional({ description: 'Dashboard variable configurations', type: [ApplicationDashboardVariableDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApplicationDashboardVariableDto)
  variables?: ApplicationDashboardVariableDto[];

  @ApiPropertyOptional({ description: 'Replaced templating variables', type: [ReplacedTemplatingVariableDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReplacedTemplatingVariableDto)
  replacedTemplatingVariables?: ReplacedTemplatingVariableDto[];

  @ApiPropertyOptional({ description: 'Timeout in seconds for taking dashboard snapshots', default: 4 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(300)
  snapshotTimeout?: number;
}

export class UpdateApplicationDashboardDto {
  @ApiPropertyOptional({ description: 'ID of the system under test this dashboard is for' })
  @IsOptional()
  @IsUUID()
  systemUnderTestId?: string;

  @ApiPropertyOptional({ description: 'Test environment name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  testEnvironment?: string;

  @ApiPropertyOptional({ description: 'ID of the Grafana instance' })
  @IsOptional()
  @IsUUID()
  grafanaInstanceId?: string;

  @ApiPropertyOptional({ description: 'ID of the Grafana dashboard' })
  @IsOptional()
  @IsUUID()
  grafanaDashboardId?: string;

  @ApiPropertyOptional({ description: 'Dashboard name from Grafana' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  dashboardName?: string;

  @ApiPropertyOptional({ description: 'Grafana internal dashboard ID' })
  @IsOptional()
  @IsNumber()
  dashboardId?: number;

  @ApiPropertyOptional({ description: 'Grafana dashboard UID' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  dashboardUid?: string;

  @ApiPropertyOptional({ description: 'Human-readable label for this dashboard configuration' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  dashboardLabel?: string;

  @ApiPropertyOptional({ description: 'Tags for categorizing this dashboard', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: 'UID of the template dashboard this is based on' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  templateDashboardUid?: string;

  @ApiPropertyOptional({ description: 'Dashboard variable configurations', type: [ApplicationDashboardVariableDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApplicationDashboardVariableDto)
  variables?: ApplicationDashboardVariableDto[];

  @ApiPropertyOptional({ description: 'Replaced templating variables', type: [ReplacedTemplatingVariableDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReplacedTemplatingVariableDto)
  replacedTemplatingVariables?: ReplacedTemplatingVariableDto[];

  @ApiPropertyOptional({ description: 'Timeout in seconds for taking dashboard snapshots' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(300)
  snapshotTimeout?: number;
}

export class ApplicationDashboardQuery {
  @ApiPropertyOptional({ description: 'Filter by system under test ID' })
  @IsOptional()
  @IsUUID()
  systemUnderTestId?: string;

  @ApiPropertyOptional({ description: 'Filter by test environment' })
  @IsOptional()
  @IsString()
  testEnvironment?: string;

  @ApiPropertyOptional({ description: 'Filter by Grafana instance ID' })
  @IsOptional()
  @IsUUID()
  grafanaInstanceId?: string;

  @ApiPropertyOptional({ description: 'Filter by dashboard label' })
  @IsOptional()
  @IsString()
  dashboardLabel?: string;

  @ApiPropertyOptional({ description: 'Filter by dashboard UID' })
  @IsOptional()
  @IsString()
  dashboardUid?: string;

  @ApiPropertyOptional({ description: 'Filter by tags', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

