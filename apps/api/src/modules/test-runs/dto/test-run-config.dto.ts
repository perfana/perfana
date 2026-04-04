import {
  IsString,
  IsArray,
  IsObject,
  ArrayMinSize,
  ArrayMaxSize,
  ValidateNested,
  IsOptional,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  Validate,
  Length,
  Matches,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsValidTestRunId, IsSafeRegex, HasValidJsonDepth } from '../../../common/validators';

@ValidatorConstraint({ name: 'workloadOrTestType', async: false })
class WorkloadOrTestTypeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, validationArguments?: ValidationArguments) {
    const obj = validationArguments?.object as Record<string, unknown> | undefined;
    // Check if workload is provided or if testType is provided (even if workload is empty)
    return !!(value || obj?.testType);
  }

  defaultMessage() {
    return 'Either workload or testType must be provided';
  }
}

export class TestRunConfigItemDto {
  @ApiProperty({
    description: 'Configuration key',
    example: 'jvm.heap.size'
  })
  @IsString()
  key!: string;

  @ApiProperty({
    description: 'Configuration value',
    example: '2048m'
  })
  @IsString()
  @Length(0, 5000, { message: 'Configuration value must not exceed 5000 characters' })
  value!: string;
}

export class AddTestRunConfigDto {
  @ApiProperty({
    description: 'Application name (system under test)',
    example: 'my-app'
  })
  @IsString()
  @Length(1, 255, { message: 'Application name must be between 1 and 255 characters' })
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'Application name must contain only alphanumeric characters, dots, hyphens, and underscores'
  })
  application!: string;

  @ApiProperty({
    description: 'Test environment',
    example: 'production'
  })
  @IsString()
  @Length(1, 255, { message: 'Test environment must be between 1 and 255 characters' })
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'Test environment must contain only alphanumeric characters, dots, hyphens, and underscores'
  })
  testEnvironment!: string;

  @ApiProperty({
    description: 'Workload',
    example: 'load-test'
  })
  @IsOptional()
  @IsString()
  @Length(1, 255, { message: 'Workload must be between 1 and 255 characters' })
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'Workload must contain only alphanumeric characters, dots, hyphens, and underscores'
  })
  @Validate(WorkloadOrTestTypeConstraint)
  workload?: string;

  @ApiPropertyOptional({
    description: 'Legacy test type field (deprecated, use workload instead)',
    example: 'load-test'
  })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  @Transform(({ value, obj }) => {
    if (value && !obj.workload) {
      obj.workload = value;
    }
    return undefined;
  })
  testType?: string;

  @ApiProperty({
    description: 'Test run ID',
    example: 'load-test-2024-01-15-14-30'
  })
  @IsString()
  @IsValidTestRunId()
  testRunId!: string;

  @ApiProperty({
    description: 'Tags associated with the test run (max 50)',
    type: [String],
    example: ['performance', 'production']
  })
  @IsArray()
  @ArrayMaxSize(50, { message: 'Maximum 50 tags allowed' })
  @IsString({ each: true })
  @Length(1, 100, { each: true, message: 'Each tag must be between 1 and 100 characters' })
  tags!: string[];

  @ApiProperty({
    description: 'Configuration key',
    example: 'jvm.heap.size'
  })
  @IsString()
  key!: string;

  @ApiProperty({
    description: 'Configuration value',
    example: '2048m'
  })
  @IsString()
  @Length(0, 5000, { message: 'Configuration value must not exceed 5000 characters' })
  value!: string;
}

export class AddTestRunConfigsDto {
  @ApiProperty({
    description: 'Application name (system under test)',
    example: 'my-app'
  })
  @IsString()
  @Length(1, 255, { message: 'Application name must be between 1 and 255 characters' })
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'Application name must contain only alphanumeric characters, dots, hyphens, and underscores'
  })
  application!: string;

  @ApiProperty({
    description: 'Test environment',
    example: 'production'
  })
  @IsString()
  @Length(1, 255, { message: 'Test environment must be between 1 and 255 characters' })
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'Test environment must contain only alphanumeric characters, dots, hyphens, and underscores'
  })
  testEnvironment!: string;

  @ApiProperty({
    description: 'Workload',
    example: 'load-test'
  })
  @IsOptional()
  @IsString()
  @Length(1, 255, { message: 'Workload must be between 1 and 255 characters' })
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'Workload must contain only alphanumeric characters, dots, hyphens, and underscores'
  })
  @Validate(WorkloadOrTestTypeConstraint)
  workload?: string;

  @ApiPropertyOptional({
    description: 'Legacy test type field (deprecated, use workload instead)',
    example: 'load-test'
  })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  @Transform(({ value, obj }) => {
    if (value && !obj.workload) {
      obj.workload = value;
    }
    return undefined;
  })
  testType?: string;

  @ApiProperty({
    description: 'Test run ID',
    example: 'load-test-2024-01-15-14-30'
  })
  @IsString()
  @IsValidTestRunId()
  testRunId!: string;

  @ApiProperty({
    description: 'Tags associated with the test run (max 50)',
    type: [String],
    example: ['performance', 'production']
  })
  @IsArray()
  @ArrayMaxSize(50, { message: 'Maximum 50 tags allowed' })
  @IsString({ each: true })
  @Length(1, 100, { each: true, message: 'Each tag must be between 1 and 100 characters' })
  tags!: string[];

  @ApiProperty({
    description: 'Array of configuration items (max 200)',
    type: [TestRunConfigItemDto],
    example: [
      { key: 'jvm.heap.size', value: '2048m' },
      { key: 'database.pool.size', value: '50' }
    ]
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one configuration item is required' })
  @ArrayMaxSize(200, { message: 'Maximum 200 configuration items allowed' })
  @ValidateNested({ each: true })
  @Type(() => TestRunConfigItemDto)
  configItems!: TestRunConfigItemDto[];
}

export class AddTestRunConfigJsonDto {
  @ApiProperty({
    description: 'Application name (system under test)',
    example: 'my-app'
  })
  @IsString()
  @Length(1, 255, { message: 'Application name must be between 1 and 255 characters' })
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'Application name must contain only alphanumeric characters, dots, hyphens, and underscores'
  })
  application!: string;

  @ApiProperty({
    description: 'Test environment',
    example: 'production'
  })
  @IsString()
  @Length(1, 255, { message: 'Test environment must be between 1 and 255 characters' })
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'Test environment must contain only alphanumeric characters, dots, hyphens, and underscores'
  })
  testEnvironment!: string;

  @ApiProperty({
    description: 'Workload',
    example: 'load-test'
  })
  @IsString()
  @Length(1, 255, { message: 'Workload must be between 1 and 255 characters' })
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'Workload must contain only alphanumeric characters, dots, hyphens, and underscores'
  })
  workload!: string;

  @ApiPropertyOptional({
    description: 'Legacy test type field (deprecated, use workload instead)',
    example: 'load-test'
  })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  @Transform(({ value, obj }) => {
    if (value && !obj.workload) {
      obj.workload = value;
    }
    return undefined;
  })
  testType?: string;

  @ApiProperty({
    description: 'Test run ID',
    example: 'load-test-2024-01-15-14-30'
  })
  @IsString()
  @IsValidTestRunId()
  testRunId!: string;

  @ApiProperty({
    description: 'Tags associated with the test run (max 50)',
    type: [String],
    example: ['performance', 'production']
  })
  @IsArray()
  @ArrayMaxSize(50, { message: 'Maximum 50 tags allowed' })
  @IsString({ each: true })
  @Length(1, 100, { each: true, message: 'Each tag must be between 1 and 100 characters' })
  tags!: string[];

  @ApiProperty({
    description: 'Include patterns (regex) for filtering configuration keys (max 20, validated for ReDoS)',
    type: [String],
    example: ['jvm\\..*', 'database\\..*']
  })
  @IsArray()
  @ArrayMaxSize(20, { message: 'Maximum 20 include patterns allowed' })
  @IsString({ each: true })
  @Length(1, 500, { each: true, message: 'Each pattern must be between 1 and 500 characters' })
  @IsSafeRegex({ each: true })
  includes!: string[];

  @ApiProperty({
    description: 'Exclude patterns (regex) for filtering configuration keys (max 20, validated for ReDoS)',
    type: [String],
    example: ['.*\\.password', '.*\\.secret']
  })
  @IsArray()
  @ArrayMaxSize(20, { message: 'Maximum 20 exclude patterns allowed' })
  @IsString({ each: true })
  @Length(1, 500, { each: true, message: 'Each pattern must be between 1 and 500 characters' })
  @IsSafeRegex({ each: true })
  excludes!: string[];

  @ApiProperty({
    description: 'JSON object containing configuration data (max 10 levels deep)',
    example: {
      jvm: {
        heap: { size: '2048m', type: 'G1GC' },
        gc: { threads: 4 }
      },
      database: {
        pool: { size: 50, timeout: 30 }
      }
    }
  })
  @IsObject()
  @HasValidJsonDepth()
  json!: Record<string, unknown>;
}