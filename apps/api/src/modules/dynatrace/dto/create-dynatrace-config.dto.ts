import { IsUrl, IsNotEmpty, IsString, IsIn, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateDynatraceConfigDto {
  @ApiProperty({
    description: 'Dynatrace server URL',
    example: 'https://your-tenant.dynatrace.com',
  })
  @IsUrl({ require_tld: false }, { message: 'Host must be a valid URL' })
  @IsNotEmpty()
  host!: string;

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
}