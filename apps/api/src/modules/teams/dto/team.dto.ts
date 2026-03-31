import { IsNotEmpty, IsString, IsOptional, IsBoolean, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTeamDto {
  @ApiProperty({ description: 'Organization ID this team belongs to' })
  @IsNotEmpty()
  @IsUUID()
  organization_id!: string;

  @ApiProperty({ description: 'Team name', example: 'Backend Team' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ description: 'Team description' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class UpdateTeamDto {
  @ApiPropertyOptional({ description: 'Team name', example: 'Backend Team' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ description: 'Team description' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ description: 'Organization ID' })
  @IsOptional()
  @IsUUID()
  organization_id?: string;

  @ApiPropertyOptional({ description: 'Restrict resource visibility to team members only' })
  @IsOptional()
  @IsBoolean()
  restrict_to_team_members?: boolean;
}
