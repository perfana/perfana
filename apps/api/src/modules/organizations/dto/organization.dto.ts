import { IsNotEmpty, IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateOrganizationDto {
  @ApiProperty({ description: 'Organization name', example: 'Acme Corp' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ description: 'Organization description' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class UpdateOrganizationDto {
  @ApiPropertyOptional({ description: 'Organization name', example: 'Acme Corp' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ description: 'Organization description' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
