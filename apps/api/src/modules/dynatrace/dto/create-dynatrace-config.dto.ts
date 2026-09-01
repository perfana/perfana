import { IsUrl, IsNotEmpty, IsString, IsIn, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDynatraceConfigDto {
  @ApiProperty({
    description: 'Dynatrace server URL',
    example: 'https://your-tenant.dynatrace.com',
  })
  @IsUrl({ require_tld: false }, { message: 'Host must be a valid URL' })
  @IsNotEmpty()
  host!: string;

  @ApiPropertyOptional({
    description: 'Browser-facing Dynatrace URL for deep links, when it differs from the server URL',
    example: 'https://dynatrace.example.com',
  })
  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'Client URL must be a valid URL' })
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