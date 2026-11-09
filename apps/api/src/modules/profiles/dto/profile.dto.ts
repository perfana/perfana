import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsArray, IsUUID, MaxLength } from 'class-validator';

export class CreateProfileDto {
  @ApiProperty({ description: 'Unique profile name', example: 'my-app-profile' })
  @IsString()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({
    description:
      'Organization to create the profile in. The caller must be an org-admin there (a global admin may name any ' +
      'existing organization). Omitted: the first organization, by id, in which the caller is an org-admin. The ' +
      "profile's organization decides which runs its ADAPT templates reach, so name it whenever the caller has more than one.",
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional({ description: 'Profile description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Tags for categorization', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: 'Whether the profile is read-only', default: false })
  @IsOptional()
  @IsBoolean()
  readOnly?: boolean;
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ description: 'Profile name', example: 'my-app-profile' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ description: 'Profile description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Tags for categorization', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: 'Whether the profile is read-only' })
  @IsOptional()
  @IsBoolean()
  readOnly?: boolean;
}
