import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateDynatraceConfigDto {
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
    description: 'Optional Dynatrace Platform API token for advanced features',
    example: 'dt0s02.XXXXXXXXXXXX.YYYYYYYYYYYY',
  })
  @IsOptional()
  @IsString()
  platformApiToken?: string;
}