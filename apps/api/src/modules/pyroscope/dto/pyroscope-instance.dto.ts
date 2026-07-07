import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsUrl, IsBoolean, IsOptional, MaxLength } from 'class-validator';

export class CreatePyroscopeInstanceDto {
  @ApiProperty({ description: 'Unique label for the Pyroscope instance' })
  @IsString()
  @MaxLength(255)
  label!: string;

  @ApiProperty({ description: 'Pyroscope server URL' })
  @IsUrl({ require_tld: false })
  pyroscopeUrl!: string;

  @ApiPropertyOptional({ description: 'Backend API URL for programmatic access' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  backendUrl?: string;

  @ApiPropertyOptional({ description: 'Whether this is a standalone Pyroscope instance', default: false })
  @IsOptional()
  @IsBoolean()
  pyroscopeStandAlone?: boolean;

  @ApiPropertyOptional({ description: 'Route outbound requests through the organization proxy' })
  @IsOptional()
  @IsBoolean()
  useProxy?: boolean;

  @ApiPropertyOptional({ description: 'Organization ID to assign this instance to' })
  @IsOptional()
  @IsString()
  organizationId?: string;
}

export class UpdatePyroscopeInstanceDto {
  @ApiPropertyOptional({ description: 'Unique label for the Pyroscope instance' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  label?: string;

  @ApiPropertyOptional({ description: 'Pyroscope server URL' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  pyroscopeUrl?: string;

  @ApiPropertyOptional({ description: 'Backend API URL for programmatic access' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  backendUrl?: string;

  @ApiPropertyOptional({ description: 'Whether this is a standalone Pyroscope instance' })
  @IsOptional()
  @IsBoolean()
  pyroscopeStandAlone?: boolean;

  @ApiPropertyOptional({ description: 'Route outbound requests through the organization proxy' })
  @IsOptional()
  @IsBoolean()
  useProxy?: boolean;
}

export class PyroscopeInstanceQuery {
  @ApiPropertyOptional({ description: 'Filter by instance label' })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({ description: 'Filter by standalone flag' })
  @IsOptional()
  @IsBoolean()
  pyroscopeStandAlone?: boolean;
}
