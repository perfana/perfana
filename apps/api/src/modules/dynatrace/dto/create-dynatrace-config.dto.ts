import { IsUrl, IsNotEmpty, IsString, IsIn, IsOptional, IsBoolean, ValidateIf, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDynatraceConfigDto {
  @ApiProperty({
    description: 'Dynatrace server URL',
    example: 'https://your-tenant.dynatrace.com',
  })
  @IsUrl({ require_tld: false }, { message: 'Host must be a valid URL' })
  @IsNotEmpty()
  @MaxLength(500)
  host!: string;

  @ApiPropertyOptional({
    description: 'Browser-facing Dynatrace URL for deep links, when it differs from the server URL',
    example: 'https://dynatrace.example.com',
  })
  @IsOptional()
  // Same '' tolerance as the update DTO, so a client can POST back a config it
  // GET'd without special-casing a cleared field. The service collapses it.
  @ValidateIf((_, value) => value !== '')
  // Scheme pinned explicitly: with require_protocol off, validator.js never consults
  // the protocol list, so 'evil.com' and 'ftp://evil.com' would both pass. The value
  // is only ever handed to window.open, so http(s) is the whole contract.
  // require_tld stays false for internal hostnames — nothing fetches this server-side.
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true, require_tld: false },
    { message: 'Client URL must be a valid http(s) URL' },
  )
  @MaxLength(500)
  clientUrl?: string;

  @ApiProperty({
    description: 'Dynatrace API token',
    example: 'dt0c01.XXXXXXXXXXXX.YYYYYYYYYYYY',
  })
  @IsString()
  @IsNotEmpty()
  apiToken!: string;

  @ApiProperty({
    description: 'Dynatrace deployment type',
    enum: ['saas', 'managed'],
    default: 'saas',
    example: 'saas',
  })
  @IsIn(['saas', 'managed'])
  @IsOptional()
  dynatraceType?: 'saas' | 'managed';

  @ApiProperty({
    description: 'Label to identify this Dynatrace instance',
    example: 'Production Dynatrace',
  })
  @IsString()
  @IsNotEmpty()
  label!: string;

  @ApiProperty({
    description: 'Optional Dynatrace Platform API token for advanced features',
    example: 'dt0s02.XXXXXXXXXXXX.YYYYYYYYYYYY',
    required: false,
  })
  @IsString()
  @IsOptional()
  platformApiToken?: string;

  @ApiProperty({
    description: 'Organization ID to assign this configuration to',
    required: false,
  })
  @IsString()
  @IsOptional()
  organizationId?: string;

  @ApiPropertyOptional({ description: 'Route outbound requests through the organization proxy' })
  @IsOptional()
  @IsBoolean()
  useProxy?: boolean;
}