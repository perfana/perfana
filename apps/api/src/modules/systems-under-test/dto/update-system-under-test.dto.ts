import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, IsString, IsOptional } from 'class-validator';

/**
 * DTO for updating general System Under Test properties
 *
 * This DTO allows updating core system properties like name, description,
 * team assignment, and tracing service.
 */
export class UpdateSystemUnderTestDto {
  @ApiPropertyOptional({
    description: 'System name',
    example: 'Payment API',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: 'System description',
    example: 'Core payment processing system',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Team ID (UUID) or null to unassign from team',
    example: '550e8400-e29b-41d4-a716-446655440000',
    type: String,
    nullable: true,
  })
  @IsOptional()
  @IsUUID('4', { message: 'team_id must be a valid UUID or null' })
  team_id?: string | null;

  @ApiPropertyOptional({
    description: 'Tracing service identifier',
    example: 'tempo-prod',
  })
  @IsOptional()
  @IsString()
  tracing_service?: string;
}
