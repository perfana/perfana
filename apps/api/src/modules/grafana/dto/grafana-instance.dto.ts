import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsUrl, IsBoolean, IsOptional, MaxLength } from 'class-validator';

export class CreateGrafanaInstanceDto {
  @ApiProperty({ description: 'Unique label for the Grafana instance' })
  @IsString()
  @MaxLength(255)
  label!: string;

  @ApiProperty({ description: 'URL used by browser clients to access Grafana' })
  @IsUrl({ require_tld: false })
  clientUrl!: string;

  @ApiPropertyOptional({ description: 'URL used by server-side components to access Grafana' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  serverUrl?: string;

  @ApiProperty({ description: 'Grafana Organization ID' })
  @IsString()
  @MaxLength(50)
  orgId!: string;

  @ApiPropertyOptional({ description: 'Grafana API Key (will be encrypted)' })
  @IsOptional()
  @IsString()
  apiKey?: string;

  @ApiPropertyOptional({ description: 'Grafana username for basic auth' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  username?: string;

  @ApiPropertyOptional({ description: 'Grafana password for basic auth (will be encrypted)' })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional({ description: 'Use this instance for storing snapshots', default: false })
  @IsOptional()
  @IsBoolean()
  snapshotInstance?: boolean;

  @ApiPropertyOptional({ description: 'Route outbound requests through the organization proxy' })
  @IsOptional()
  @IsBoolean()
  useProxy?: boolean;

  @ApiPropertyOptional({ description: 'Organization ID to assign this instance to' })
  @IsOptional()
  @IsString()
  organizationId?: string;
}

export class UpdateGrafanaInstanceDto {
  @ApiPropertyOptional({ description: 'Unique label for the Grafana instance' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  label?: string;

  @ApiPropertyOptional({ description: 'URL used by browser clients to access Grafana' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  clientUrl?: string;

  @ApiPropertyOptional({ description: 'URL used by server-side components to access Grafana' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  serverUrl?: string;

  @ApiPropertyOptional({ description: 'Grafana Organization ID' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  orgId?: string;

  @ApiPropertyOptional({ description: 'Grafana API Key (will be encrypted)' })
  @IsOptional()
  @IsString()
  apiKey?: string;

  @ApiPropertyOptional({ description: 'Grafana username for basic auth' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  username?: string;

  @ApiPropertyOptional({ description: 'Grafana password for basic auth (will be encrypted)' })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional({ description: 'Use this instance for storing snapshots' })
  @IsOptional()
  @IsBoolean()
  snapshotInstance?: boolean;

  @ApiPropertyOptional({ description: 'Route outbound requests through the organization proxy' })
  @IsOptional()
  @IsBoolean()
  useProxy?: boolean;
}

export class GrafanaInstanceQuery {
  @ApiPropertyOptional({ description: 'Filter by instance label' })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({ description: 'Filter by snapshot instance flag' })
  @IsOptional()
  @IsBoolean()
  snapshotInstance?: boolean;
}