import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, IsInt, Min, Max, IsDateString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { AuditAction } from '@perfana/shared/entities';

/**
 * Query DTO for `GET /api/audit-logs` (admin endpoint).
 * Phase 5a: filterable audit-log search.
 */
export class AuditFilterDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  resourceType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  resourceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ enum: ['CREATE', 'UPDATE', 'DELETE'] })
  @IsOptional()
  @IsIn(['CREATE', 'UPDATE', 'DELETE'])
  action?: AuditAction;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional({
    description:
      'Filter to audit rows for a single SystemUnderTest and its descendants ' +
      '(workloads, benchmarks, dashboards, expected-config-changes, etc.). ' +
      'Backed by the denormalized `system_under_test_id` column populated at write time.',
  })
  @IsOptional()
  @IsUUID()
  systemUnderTestId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ default: 100, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
