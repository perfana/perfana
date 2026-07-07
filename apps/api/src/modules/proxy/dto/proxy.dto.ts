import { IsOptional, IsString, IsUrl } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertProxyDto {
  /**
   * NOTE: proxyUrl is intentionally NOT run through the SSRF / private-IP validator.
   * A corporate proxy is legitimately an internal host (e.g. 10.x.x.x or
   * proxy.corp:3128).  The field is only writable by org-admins, and the proxy
   * routes that organisation's own outbound traffic — so private-IP blocking
   * would break valid configurations without improving security posture.
   */
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
  teamId?: string;

  @ApiPropertyOptional()
  createdBy?: string;

  @ApiPropertyOptional()
  updatedBy?: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
