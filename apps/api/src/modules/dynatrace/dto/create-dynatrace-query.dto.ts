import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsArray, IsNumber, IsUUID, IsBoolean } from 'class-validator';

export class CreateDynatraceQueryDto {
  @ApiProperty()
  @IsUUID()
  dynatraceConfigId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  systemUnderTestId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  testEnvironment!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  workload!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  dashboardLabel!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  applicationDashboardId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  panelTitle!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  panelId?: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  query!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  matchMetricPattern?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  omitGroupByVariableFromMetricName?: string[];

  @ApiProperty({ required: false, type: Object })
  @IsOptional()
  templateVariables?: Record<string, string>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  metricUnit?: string;

  @ApiProperty({ required: false, description: 'Explicit metric name for storage (e.g., "CPU Usage")' })
  @IsOptional()
  @IsString()
  metricName?: string;

  @ApiProperty({ required: false, default: true, description: 'False parks the query: no collection path executes it and nothing is stored in ds_metrics' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}