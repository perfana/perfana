import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for validating test run query parameters
 * Used across multiple endpoints that filter by system/environment/workload
 */
export class TestRunQueryDto {
  @ApiPropertyOptional({
    description: 'System under test identifier',
    example: 'PaymentService'
  })
  @IsOptional()
  @IsString()
  @Length(1, 255, { message: 'System must be between 1 and 255 characters' })
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'System must contain only alphanumeric characters, dots, hyphens, and underscores'
  })
  system?: string;

  @ApiPropertyOptional({
    description: 'Test environment',
    example: 'production'
  })
  @IsOptional()
  @IsString()
  @Length(1, 255, { message: 'Environment must be between 1 and 255 characters' })
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'Environment must contain only alphanumeric characters, dots, hyphens, and underscores'
  })
  environment?: string;

  @ApiPropertyOptional({
    description: 'Workload identifier',
    example: 'loadTest'
  })
  @IsOptional()
  @IsString()
  @Length(1, 255, { message: 'Workload must be between 1 and 255 characters' })
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'Workload must contain only alphanumeric characters, dots, hyphens, and underscores'
  })
  workload?: string;
}

/**
 * DTO for endpoints requiring mandatory system/environment/workload
 */
export class RequiredTestRunQueryDto {
  @ApiPropertyOptional({
    description: 'System under test identifier',
    example: 'PaymentService',
    required: true
  })
  @IsString()
  @Length(1, 255, { message: 'System must be between 1 and 255 characters' })
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'System must contain only alphanumeric characters, dots, hyphens, and underscores'
  })
  system!: string;

  @ApiPropertyOptional({
    description: 'Test environment',
    example: 'production',
    required: true
  })
  @IsString()
  @Length(1, 255, { message: 'Environment must be between 1 and 255 characters' })
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'Environment must contain only alphanumeric characters, dots, hyphens, and underscores'
  })
  environment!: string;

  @ApiPropertyOptional({
    description: 'Workload identifier',
    example: 'loadTest',
    required: true
  })
  @IsString()
  @Length(1, 255, { message: 'Workload must be between 1 and 255 characters' })
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'Workload must contain only alphanumeric characters, dots, hyphens, and underscores'
  })
  workload!: string;
}
