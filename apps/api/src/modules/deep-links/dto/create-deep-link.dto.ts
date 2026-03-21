import { IsString, IsUUID, IsOptional, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDeepLinkDto {
  @ApiProperty({ description: 'System under test ID' })
  @IsUUID()
  systemUnderTestId!: string;

  @ApiProperty({ description: 'Test environment name' })
  @IsString()
  testEnvironment!: string;

  @ApiProperty({ description: 'Workload name' })
  @IsString()
  workload!: string;

  @ApiProperty({ description: 'Display name for the deep link' })
  @IsString()
  name!: string;

  @ApiProperty({ description: 'URL with placeholder variables' })
  @IsString()
  url!: string;

  @ApiPropertyOptional({ description: 'Template deep link ID if created from template' })
  @IsOptional()
  @IsUUID()
  templateDeepLinkId?: string;

  @ApiPropertyOptional({ description: 'Tags for filtering and grouping deep links', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}