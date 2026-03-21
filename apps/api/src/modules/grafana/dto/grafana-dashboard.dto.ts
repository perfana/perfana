import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNumber, IsArray, IsOptional, IsObject, MaxLength, IsUUID } from 'class-validator';

// Dashboard panel target structure
export class DashboardTargetDto {
  @ApiPropertyOptional({ description: 'Query string for the target' })
  @IsOptional()
  @IsString()
  query?: string;

  @ApiPropertyOptional({ description: 'Retention policy' })
  @IsOptional()
  @IsString()
  rp?: string;

  @ApiPropertyOptional({ description: 'Measurement name' })
  @IsOptional()
  @IsString()
  measurement?: string;

  @ApiPropertyOptional({ description: 'Field name' })
  @IsOptional()
  @IsString()
  field?: string;

  @ApiPropertyOptional({ description: 'WHERE filter' })
  @IsOptional()
  @IsString()
  whereFilter?: string;

  @ApiPropertyOptional({ description: 'GROUP BY clauses', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  groupBy?: string[];

  @ApiPropertyOptional({ description: 'Legend format string' })
  @IsOptional()
  @IsString()
  legendFormat?: string;
}

// Dashboard panel structure
export class DashboardPanelDto {
  @ApiProperty({ description: 'Panel ID within the dashboard' })
  @IsNumber()
  id!: number;

  @ApiProperty({ description: 'Panel title' })
  @IsString()
  title!: string;

  @ApiProperty({ description: 'Panel type (graph, singlestat, table, etc.)' })
  @IsString()
  type!: string;

  @ApiPropertyOptional({ description: 'Datasource ID' })
  @IsOptional()
  @IsNumber()
  datasourceId?: number;

  @ApiPropertyOptional({ description: 'Datasource type' })
  @IsOptional()
  @IsString()
  datasourceType?: string;

  @ApiPropertyOptional({ description: 'Datasource database name' })
  @IsOptional()
  @IsString()
  datasourceDatabase?: string;

  @ApiPropertyOptional({ description: 'Minimum time interval' })
  @IsOptional()
  @IsString()
  minTimeInterval?: string;

  @ApiPropertyOptional({ description: 'Y-axes format' })
  @IsOptional()
  @IsString()
  yAxesFormat?: string;

  @ApiPropertyOptional({ description: 'Panel description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Repeat variable name' })
  @IsOptional()
  @IsString()
  repeat?: string;

  @ApiPropertyOptional({ description: 'Panel targets/queries', type: [DashboardTargetDto] })
  @IsOptional()
  @IsArray()
  targets?: DashboardTargetDto[];
}

// Templating variable structure
export class TemplatingVariableDto {
  @ApiProperty({ description: 'Variable name' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ description: 'Variable query' })
  @IsOptional()
  query?: string | { query?: string; [key: string]: any };

  @ApiPropertyOptional({ description: 'Variable type' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: 'Datasource configuration' })
  @IsOptional()
  @IsObject()
  datasource?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Regex filter' })
  @IsOptional()
  @IsString()
  regex?: string;

  @ApiPropertyOptional({ description: 'Variable options' })
  @IsOptional()
  @IsArray()
  options?: Array<{ text?: string; value: string; [key: string]: any }>;
}

// Dashboard variable structure  
export class DashboardVariableDto {
  @ApiProperty({ description: 'Variable name' })
  @IsString()
  name!: string;

  // Allow additional properties for flexibility
  [key: string]: any;
}

export class CreateGrafanaDashboardDto {
  @ApiProperty({ description: 'ID of the Grafana instance this dashboard belongs to' })
  @IsUUID()
  grafanaInstanceId!: string;

  @ApiProperty({ description: 'Grafana internal dashboard ID' })
  @IsNumber()
  grafanaId!: number;

  @ApiPropertyOptional({ description: 'Primary datasource type' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  datasourceType?: string;

  @ApiProperty({ description: 'Grafana dashboard UID' })
  @IsString()
  @MaxLength(100)
  uid!: string;

  @ApiPropertyOptional({ description: 'Dashboard slug' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  slug?: string;

  @ApiProperty({ description: 'Dashboard name' })
  @IsString()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ description: 'Dashboard URI path' })
  @IsOptional()
  @IsString()
  uri?: string;

  @ApiPropertyOptional({ description: 'Dashboard templating variables', type: [TemplatingVariableDto] })
  @IsOptional()
  @IsArray()
  templatingVariables?: TemplatingVariableDto[];

  @ApiProperty({ description: 'Dashboard panels configuration', type: [DashboardPanelDto] })
  @IsArray()
  panels!: DashboardPanelDto[];

  @ApiPropertyOptional({ description: 'Dashboard variables', type: [DashboardVariableDto] })
  @IsOptional()
  @IsArray()
  variables?: DashboardVariableDto[];

  @ApiPropertyOptional({ description: 'Dashboard tags', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: 'Systems under test that use this dashboard', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  usedBySut?: string[];
}

export class UpdateGrafanaDashboardDto {
  @ApiPropertyOptional({ description: 'ID of the Grafana instance this dashboard belongs to' })
  @IsOptional()
  @IsUUID()
  grafanaInstanceId?: string;

  @ApiPropertyOptional({ description: 'Grafana internal dashboard ID' })
  @IsOptional()
  @IsNumber()
  grafanaId?: number;

  @ApiPropertyOptional({ description: 'Primary datasource type' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  datasourceType?: string;

  @ApiPropertyOptional({ description: 'Grafana dashboard UID' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  uid?: string;

  @ApiPropertyOptional({ description: 'Dashboard slug' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  slug?: string;

  @ApiPropertyOptional({ description: 'Dashboard name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ description: 'Dashboard URI path' })
  @IsOptional()
  @IsString()
  uri?: string;

  @ApiPropertyOptional({ description: 'Dashboard templating variables', type: [TemplatingVariableDto] })
  @IsOptional()
  @IsArray()
  templatingVariables?: TemplatingVariableDto[];

  @ApiPropertyOptional({ description: 'Dashboard panels configuration', type: [DashboardPanelDto] })
  @IsOptional()
  @IsArray()
  panels?: DashboardPanelDto[];

  @ApiPropertyOptional({ description: 'Dashboard variables', type: [DashboardVariableDto] })
  @IsOptional()
  @IsArray()
  variables?: DashboardVariableDto[];

  @ApiPropertyOptional({ description: 'Dashboard tags', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: 'Systems under test that use this dashboard', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  usedBySut?: string[];
}

export class GrafanaDashboardQuery {
  @ApiPropertyOptional({ description: 'Filter by Grafana instance ID' })
  @IsOptional()
  @IsUUID()
  grafanaInstanceId?: string;

  @ApiPropertyOptional({ description: 'Filter by dashboard name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Filter by dashboard UID' })
  @IsOptional()
  @IsString()
  uid?: string;

  @ApiPropertyOptional({ description: 'Filter by tags', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: 'Filter by system under test name' })
  @IsOptional()
  @IsString()
  usedBySut?: string;
}