import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, IsUrl, IsUUID, Matches, MaxLength } from 'class-validator';

const DEPLOYMENTS = ['cloud', 'datacenter'] as const;
const URL_RULE = { protocols: ['http', 'https'], require_protocol: true, require_tld: false };

export class CreateConfluenceConfigDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(255)
  label!: string;

  @ApiProperty({ description: 'Cloud: https://<site>.atlassian.net. Data Center: the base URL including any context path.', example: 'https://acme.atlassian.net' })
  @IsUrl(URL_RULE) @MaxLength(500)
  baseUrl!: string;

  @ApiProperty({ enum: DEPLOYMENTS }) @IsIn(DEPLOYMENTS)
  deployment!: (typeof DEPLOYMENTS)[number];

  @ApiPropertyOptional({ description: 'Atlassian account email (Cloud only)' })
  @IsOptional() @IsString() @MaxLength(255)
  username?: string | null;

  @ApiProperty({ description: 'Cloud API token, or Data Center personal access token (Confluence 7.9+)' })
  @IsString() @IsNotEmpty() @MaxLength(2000)
  apiToken!: string;

  @ApiProperty({ example: 'PERF' }) @IsString() @Matches(/^~?[A-Za-z0-9_-]+$/, { message: 'spaceKey must be a Confluence space key, e.g. PERF' }) @MaxLength(255)
  spaceKey!: string;

  @ApiPropertyOptional({ description: 'Numeric id of the page reports are created under; empty = space root' })
  @IsOptional() @Matches(/^\d*$/, { message: 'parentPageId must be the numeric page id' }) @MaxLength(64)
  parentPageId?: string | null;

  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean()
  useProxy?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  organizationId?: string;
}

export class UpdateConfluenceConfigDto extends PartialType(OmitType(CreateConfluenceConfigDto, ['organizationId'] as const)) {}

export class TestConfluenceConnectionDto extends OmitType(CreateConfluenceConfigDto, ['label', 'parentPageId'] as const) {}

export class PublishReportToConfluenceDto {
  @ApiProperty() @IsUUID()
  configId!: string;

  @ApiPropertyOptional({ description: 'Page title; defaults to the report name and test run id' })
  @IsOptional() @IsString() @MaxLength(255)
  title?: string;
}
