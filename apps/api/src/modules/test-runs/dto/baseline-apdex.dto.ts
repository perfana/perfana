import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsEnum, Min, Max, IsInt, IsOptional } from 'class-validator';

/**
 * Scope for baseline Apdex calculation
 */
export enum BaselineApdexScope {
  WORKLOAD = 'workload',
  TRANSACTION = 'transaction',
}

/**
 * DTO for previewing baseline Apdex calculation
 */
export class BaselineApdexPreviewDto {
  @ApiProperty({
    description: 'Target Apdex score to achieve (0.0 - 1.0)',
    example: 0.85,
    minimum: 0,
    maximum: 1,
  })
  @IsNumber()
  @Min(0)
  @Max(1)
  target_apdex: number;

  @ApiProperty({
    description: 'Scope of threshold application',
    enum: BaselineApdexScope,
    example: BaselineApdexScope.WORKLOAD,
  })
  @IsEnum(BaselineApdexScope)
  scope: BaselineApdexScope;

  @ApiPropertyOptional({
    description:
      'Minimum samples a transaction needs before a threshold is calculated. ' +
      'Below the default of 10 the result is a ballpark: Apdex moves in steps of ' +
      '0.5/n, so one slow outlier shifts the threshold a lot.',
    example: 10,
    minimum: 1,
    maximum: 1000,
    default: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  min_samples?: number;
}

/**
 * DTO for applying baseline Apdex thresholds
 */
export class BaselineApdexApplyDto {
  @ApiProperty({
    description: 'Target Apdex score to achieve (0.0 - 1.0)',
    example: 0.85,
    minimum: 0,
    maximum: 1,
  })
  @IsNumber()
  @Min(0)
  @Max(1)
  target_apdex: number;

  @ApiProperty({
    description: 'Scope of threshold application',
    enum: BaselineApdexScope,
    example: BaselineApdexScope.WORKLOAD,
  })
  @IsEnum(BaselineApdexScope)
  scope: BaselineApdexScope;

  @ApiPropertyOptional({
    description:
      'Minimum samples a transaction needs before a threshold is calculated. ' +
      'Below the default of 10 the result is a ballpark: Apdex moves in steps of ' +
      '0.5/n, so one slow outlier shifts the threshold a lot.',
    example: 10,
    minimum: 1,
    maximum: 1000,
    default: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  min_samples?: number;
}

/**
 * Individual preview item for a transaction
 */
export class BaselinePreviewItemDto {
  @ApiProperty({
    description: 'Transaction name',
    example: 'database_call',
  })
  transaction_name: string;

  @ApiProperty({
    description: 'Scenario name',
    example: 'checkout_flow',
  })
  scenario_name: string;

  @ApiProperty({
    description: 'Current Apdex threshold in milliseconds',
    example: 500,
    nullable: true,
  })
  current_threshold: number | null;

  @ApiProperty({
    description: 'Calculated optimal threshold in milliseconds',
    example: 750,
    nullable: true,
  })
  calculated_threshold: number | null;

  @ApiProperty({
    description: 'Current Apdex score with current threshold',
    example: 0.856,
    nullable: true,
  })
  current_apdex: number | null;

  @ApiProperty({
    description: 'Projected Apdex score with calculated threshold',
    example: 0.85,
    nullable: true,
  })
  projected_apdex: number | null;

  @ApiProperty({
    description: 'Number of transaction samples',
    example: 1523,
  })
  sample_count: number;

  @ApiProperty({
    description: 'Whether target is achievable',
    example: true,
  })
  achievable: boolean;

  @ApiProperty({
    description: 'Message explaining result',
    example: 'Target achievable with threshold 750ms',
    nullable: true,
  })
  message?: string | null;
}

/**
 * Workload-level summary for preview
 */
export class BaselineWorkloadSummaryDto {
  @ApiProperty({
    description: 'Current workload-level threshold',
    example: 500,
    nullable: true,
  })
  current_workload_threshold: number | null;

  @ApiProperty({
    description: 'Calculated workload-level threshold (weighted average)',
    example: 720,
    nullable: true,
  })
  calculated_workload_threshold: number | null;

  @ApiProperty({
    description: 'Current overall workload Apdex',
    example: 0.856,
    nullable: true,
  })
  current_workload_apdex: number | null;

  @ApiProperty({
    description: 'Projected overall workload Apdex',
    example: 0.85,
    nullable: true,
  })
  projected_workload_apdex: number | null;

  @ApiProperty({
    description: 'Total number of transactions',
    example: 12,
  })
  total_transactions: number;

  @ApiProperty({
    description: 'Number of transactions where target is achievable',
    example: 10,
  })
  achievable_count: number;
}

/**
 * Response for baseline Apdex preview
 */
export class BaselinePreviewResponseDto {
  @ApiProperty({
    description: 'Scope of calculation',
    enum: BaselineApdexScope,
    example: BaselineApdexScope.TRANSACTION,
  })
  scope: BaselineApdexScope;

  @ApiProperty({
    description: 'Target Apdex score',
    example: 0.85,
  })
  target_apdex: number;

  @ApiProperty({
    description: 'Per-transaction preview items',
    type: [BaselinePreviewItemDto],
  })
  items: BaselinePreviewItemDto[];

  @ApiProperty({
    description: 'Workload-level summary (only for workload scope)',
    type: BaselineWorkloadSummaryDto,
    nullable: true,
  })
  workload_summary?: BaselineWorkloadSummaryDto | null;
}

/**
 * Response for baseline Apdex apply operation
 */
export class BaselineApplyResponseDto {
  @ApiProperty({
    description: 'Success message',
    example: 'Baseline Apdex thresholds applied successfully',
  })
  message: string;

  @ApiProperty({
    description: 'Number of transaction thresholds updated',
    example: 10,
  })
  transactions_updated: number;

  @ApiProperty({
    description: 'Whether workload threshold was updated',
    example: true,
  })
  workload_threshold_updated: boolean;

  @ApiProperty({
    description: 'Applied scope',
    enum: BaselineApdexScope,
  })
  scope: BaselineApdexScope;
}
