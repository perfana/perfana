import { IsOptional, IsString, IsUrl } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertProxyDto {
  @ApiProperty({ description: 'Proxy server URL', example: 'http://proxy.example.com:8080' })
  @IsUrl({ require_tld: false })
  proxyUrl!: string;

  @ApiPropertyOptional({ description: 'Proxy username' })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional({ description: 'Proxy password (never returned in responses)' })
  @IsOptional()
  @IsString()
  password?: string;
}

export class ProxyResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'Proxy server URL' })
  proxyUrl!: string;

  @ApiPropertyOptional({ description: 'Proxy username' })
  username?: string;

  @ApiProperty({ description: 'Whether a password is configured (password itself is never returned)' })
  hasPassword!: boolean;

  @ApiProperty()
  organizationId!: string;

  @ApiPropertyOptional()
  createdBy?: string;

  @ApiPropertyOptional()
  updatedBy?: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
