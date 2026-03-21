import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsArray, MaxLength } from 'class-validator';

export class CreateProfileDto {
  @ApiProperty({ description: 'Unique profile name', example: 'my-app-profile' })
  @IsString()
  @MaxLength(255)
  name!: string;

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
