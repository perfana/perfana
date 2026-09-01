import { IsOptional, IsString, IsBoolean, IsUrl, ValidateIf, MaxLength, IsNotEmpty } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateDynatraceConfigDto {
  @ApiPropertyOptional({
    description: 'Browser-facing Dynatrace URL for deep links. Send an empty string to clear it.',
    example: 'https://dynatrace.example.com',
  })
  @IsOptional()
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

  @ApiPropertyOptional({
    description: 'The request attribute ID for tracking Perfana test run IDs',
    example: 'test-run-id-attribute-key',
  })
  @IsOptional()
  @IsString()
  perfanaTestRunIdAttribute?: string;

  @ApiPropertyOptional({
    description: 'The request attribute ID for tracking Perfana request names',
    example: 'request-name-attribute-key',
  })
  @IsOptional()
  @IsString()
  perfanaRequestNameAttribute?: string;

  @ApiPropertyOptional({
    description: 'Label to identify this Dynatrace instance',
    example: 'Production Dynatrace',
  })
  @IsOptional()
  @IsString()
  // The web client now sends label on every update, so an empty one would blank
  // the config's display name in the integrations list, the deep-link picker and
  // the entity-mapping labels. '' satisfies the NOT NULL column on its own.
  @IsNotEmpty()
  @MaxLength(255)
  label?: string;

  @ApiPropertyOptional({
    description: 'Dynatrace API token — omit to keep the existing one',
    example: 'dt0c01.XXXXXXXXXXXX.YYYYYYYYYYYY',
  })
  @IsOptional()
  @IsString()
  apiToken?: string;

  @ApiPropertyOptional({
    description: 'Optional Dynatrace Platform API token for advanced features',
    example: 'dt0s02.XXXXXXXXXXXX.YYYYYYYYYYYY',
  })
  @IsOptional()
  @IsString()
  platformApiToken?: string;

  @ApiPropertyOptional({ description: 'Route outbound requests through the organization proxy' })
  @IsOptional()
  @IsBoolean()
  useProxy?: boolean;
}