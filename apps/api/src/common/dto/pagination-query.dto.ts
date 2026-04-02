import { IsOptional, IsInt, Min, Max, IsString, IsIn, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for pagination query parameters
 * Provides consistent pagination interface across all endpoints
 */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @ApiProperty({
    required: false,
    default: 1,
    minimum: 1,
    description: 'Page number (1-indexed)',
    example: 1,
  })
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @ApiProperty({
    required: false,
    default: 50,
    minimum: 1,
    maximum: 100,
    description: 'Number of items per page (max 100)',
    example: 50,
  })
  pageSize?: number = 50;

  @IsOptional()
  @IsString()
  @ApiProperty({
    required: false,
    default: 'createdAt',
    description: 'Field to sort by',
    example: 'createdAt',
    enum: ['createdAt', 'testRunId', 'workload', 'testEnvironment', 'startTime', 'endTime'],
  })
  sortBy?: string = 'createdAt';

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  @ApiProperty({
    required: false,
    default: 'DESC',
    enum: ['ASC', 'DESC'],
    description: 'Sort order',
    example: 'DESC',
  })
  sortOrder?: 'ASC' | 'DESC' = 'DESC';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @ApiProperty({
    required: false,
    description: 'Filter by system under test name (exact match)',
    example: 'PaymentService',
  })
  system?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @ApiProperty({
    required: false,
    description: 'Filter by test environment (exact match)',
    example: 'production',
  })
  environment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @ApiProperty({
    required: false,
    description: 'Filter by workload (exact match)',
    example: 'loadTest',
  })
  workload?: string;
}
