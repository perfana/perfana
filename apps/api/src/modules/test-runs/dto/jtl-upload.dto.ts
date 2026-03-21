import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, Length, Matches } from 'class-validator';

export class JtlUploadDto {
  @ApiProperty({
    description: 'System under test name',
    example: 'PaymentService',
  })
  @IsString()
  @Length(1, 255)
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'systemUnderTest must contain only alphanumeric characters, dots, hyphens, and underscores',
  })
  systemUnderTest!: string;

  @ApiProperty({
    description: 'Test environment name',
    example: 'production',
  })
  @IsString()
  @Length(1, 255)
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'testEnvironment must contain only alphanumeric characters, dots, hyphens, and underscores',
  })
  testEnvironment!: string;

  @ApiProperty({
    description: 'Workload name',
    example: 'loadTest',
  })
  @IsString()
  @Length(1, 255)
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'workload must contain only alphanumeric characters, dots, hyphens, and underscores',
  })
  workload!: string;

  @ApiPropertyOptional({
    description: 'Ramp-up time in seconds (excluded from performance analysis)',
    example: '30',
  })
  @IsOptional()
  @IsString()
  rampUp?: string;

  @ApiPropertyOptional({
    description: 'Optional JSON string: Array<{key: string, value: string}>',
    example: '[{"key":"version","value":"1.0.0"}]',
  })
  @IsOptional()
  @IsString()
  configs?: string;
}

export interface JtlUploadResult {
  testRunId: string;
  scenarioCount: number;
  message: string;
}
