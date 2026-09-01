import { IsOptional, IsString, IsBoolean, IsUrl, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateDynatraceConfigDto {
  @ApiPropertyOptional({
    description: 'Browser-facing Dynatrace URL for deep links. Send an empty string to clear it.',
    example: 'https://dynatrace.example.com',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== '')
  @IsUrl({ require_tld: false }, { message: 'Client URL must be a valid URL' })
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