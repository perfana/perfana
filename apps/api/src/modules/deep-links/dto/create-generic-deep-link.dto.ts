import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateGenericDeepLinkDto {
  @ApiProperty({ description: 'Profile name this template belongs to' })
  @IsString()
  profile!: string;

  @ApiProperty({ description: 'Template name' })
  @IsString()
  name!: string;

  @ApiProperty({ description: 'URL template with placeholder variables' })
  @IsString()
  url!: string;
}