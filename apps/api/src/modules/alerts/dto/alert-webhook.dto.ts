import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsArray, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

// Grafana legacy alert payload
export class GrafanaEvalMatch {
  @ApiProperty()
  @IsNumber()
  value!: number;

  @ApiProperty()
  @IsString()
  metric!: string;

  @ApiPropertyOptional()
  @IsOptional()
  tags?: Record<string, string>;
}

export class GrafanaAlertDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  dashboardId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  orgId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  panelId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  ruleId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ruleName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ruleUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  message?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ type: [GrafanaEvalMatch] })
  @IsOptional()
  @IsArray()
  evalMatches?: GrafanaEvalMatch[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  tags?: Record<string, string>;
}

// Alertmanager / Grafana unified alerting payload
export class AlertmanagerAlert {
  @ApiProperty()
  @IsString()
  status!: string; // 'firing' | 'resolved'

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  labels?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  annotations?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  startsAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  endsAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  generatorURL?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fingerprint?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  panelURL?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dashboardURL?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  silenceURL?: string;
}

export class AlertmanagerPayloadDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  receiver?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  orgId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  truncatedAlerts?: number;

  @ApiProperty({ type: [AlertmanagerAlert] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AlertmanagerAlert)
  alerts!: AlertmanagerAlert[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  groupLabels?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  commonLabels?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  commonAnnotations?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  externalURL?: string;
}
