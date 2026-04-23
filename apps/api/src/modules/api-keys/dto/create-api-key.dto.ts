import { IsNotEmpty, IsString, Matches, IsArray, IsOptional, ArrayMinSize, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateApiKeyDto {
  @ApiProperty({
    description: 'Description/name for the API key',
    example: 'CI/CD Pipeline Key',
  })
  @IsNotEmpty()
  @IsString()
  description!: string;

  @ApiProperty({
    description: 'Time to live for the API key (e.g., "30d", "1w", "6M", "1y")',
    example: '30d',
  })
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d+[dwMy]$/, {
    message: 'TTL must be in format: number + unit (d for days, w for weeks, M for months, y for years)',
  })
  ttl!: string;

  @ApiProperty({
    description: 'Array of role identifiers assigned to this API key. Controls access permissions. Common roles: perfana-admin (full access), perfana-user (standard access), read-only (view-only access). Defaults to empty array (minimal permissions) if not specified.',
    example: ['perfana-user'],
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(0)
  roles?: string[];

  @ApiProperty({
    description: 'Organization ID to associate with this API key. If not provided, uses the first organization the user belongs to.',
    example: '550e8400-e29b-41d4-a716-446655440000',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class ApiKeyDto {
  @ApiProperty({
    description: 'Unique identifier for the API key',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id!: string;

  @ApiProperty({
    description: 'Description/name for the API key',
    example: 'CI/CD Pipeline Key',
  })
  description!: string;

  @ApiProperty({
    description: 'Roles assigned to this API key',
    example: ['perfana-user'],
    type: [String],
  })
  roles!: string[];

  @ApiProperty({
    description: 'Timestamp when the API key expires',
    example: '2025-02-15T10:30:00.000Z',
  })
  validUntil!: Date;

  @ApiProperty({
    description: 'Timestamp when the API key was created',
    example: '2024-01-15T10:30:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'Timestamp when the API key was last updated',
    example: '2024-01-15T10:30:00.000Z',
  })
  updatedAt!: Date;

  @ApiProperty({
    description: 'Timestamp when the API key was last used',
    example: '2024-01-20T14:45:00.000Z',
    required: false,
  })
  lastUsed?: Date;
}

export class CreateApiKeyResponseDto {
  @ApiProperty({
    description: 'Created API key details',
    type: ApiKeyDto,
  })
  apiKey!: ApiKeyDto;

  @ApiProperty({
    description: 'Bearer token - ONLY returned during creation, store securely',
    example: 'Q0kvQ0QgUGlwZWxpbmUgS2V5IzU1MGU4NDAwLWUyOWItNDFkNC1hNzE2LTQ0NjY1NTQ0MDAwMA==',
  })
  token!: string;
}