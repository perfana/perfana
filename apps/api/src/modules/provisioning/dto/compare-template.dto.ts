import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TEMPLATE_AGGREGATIONS } from '../compare-template-codec';

const INT4_MIN = -2147483648;
const INT4_MAX = 2147483647;

/**
 * One compare-config template, in the shape of an item of `template_ds_compare_configs.yaml`
 * (`MetricClassificationYaml` in `compare-template-codec.ts`). The API takes and returns exactly
 * what the file holds, so a template created here exports to the item that provisions it back.
 *
 * These decorators check types and column widths only, and run inside the service, not in the global
 * pipe (see `CompareTemplatesService.parse`). `parseTemplateItem` is the authority on what a template
 * may say (ranges, aggregations, regex safety, "panelId or panelTitle"), the same function provisioning
 * runs on the file, so the API cannot accept something the file would refuse. The one rule kept here is
 * `minSampleCount` as a whole number of at least 1: the file floors and clamps it, the API refuses
 * instead, so what is stored is what was sent.
 *
 * Presence is meaningful: an override that is absent leaves a row's own value alone, one that is
 * present forces it. Omit a field to leave it out. `null` means something only for `higherIsBetter`
 * ("no direction") and `absThreshold` (no absolute threshold); everywhere else it is refused, as in
 * the file.
 *
 * The scope (organization or install-wide) is not part of the definition: it is chosen by the
 * collection a template is created in, and never changes.
 */
export class CompareTemplateDefinitionDto {
  @ApiPropertyOptional({ description: 'Omit to apply to every dashboard carrying the panel. A regular expression when regex is true.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  dashboardUid?: string;

  @ApiPropertyOptional({ description: 'true: dashboardUid, and panelTitle when there is no panelId, are regular expressions. Exported only when true.' })
  @IsOptional()
  @IsBoolean()
  regex?: boolean;

  @ApiPropertyOptional({ description: 'Descriptive only; not part of the template identity.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  dashboardLabel?: string;

  @ApiPropertyOptional({ description: 'Omit to select panels by panelTitle instead.' })
  @IsOptional()
  @IsInt()
  @Min(INT4_MIN)
  @Max(INT4_MAX)
  panelId?: number;

  @ApiPropertyOptional({ description: 'Descriptive beside panelId; the matching key when panelId is omitted.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  panelTitle?: string;

  @ApiPropertyOptional({ description: 'Omit for a panel-level template. A metric-level template only reaches rows of that metric.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  metricName?: string;

  @ApiProperty({ example: 'RED_duration' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  metricClassification!: string;

  @ApiPropertyOptional({ nullable: true, type: Boolean, description: 'null forces "no direction", which no regression can fail a run on. Omit to keep the row\'s own direction.' })
  @IsOptional()
  @IsBoolean()
  higherIsBetter?: boolean | null;

  @ApiPropertyOptional({ nullable: true, type: Number, minimum: 0, description: 'null forces "no absolute threshold".' })
  @IsOptional()
  @IsNumber()
  absThreshold?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ignore?: boolean;

  @ApiPropertyOptional({ minimum: 0, description: 'Stored, but ADAPT does not read it yet.' })
  @IsOptional()
  @IsNumber()
  ignoreMeanDiffSmallerThan?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 1, description: 'A fraction, as stored: 0.15 is 15 %.' })
  @IsOptional()
  @IsNumber()
  percentageThreshold?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  iqrThreshold?: number;

  @ApiPropertyOptional({ enum: TEMPLATE_AGGREGATIONS })
  @IsOptional()
  @IsString()
  aggregation?: (typeof TEMPLATE_AGGREGATIONS)[number];

  @ApiPropertyOptional({ minimum: 1, description: 'A whole number of at least 1. The file floors and clamps; the API refuses instead, so what is stored is what was sent.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  minSampleCount?: number;

  @ApiPropertyOptional({ description: 'Stored, but ADAPT does not read it yet.' })
  @IsOptional()
  @IsNumber()
  defaultValueIfControlGroupMissing?: number;
}

export type CompareTemplateScopeKind = 'organization' | 'install';

export class CompareTemplateResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['organization', 'install'] }) scope!: CompareTemplateScopeKind;
  @ApiProperty({ nullable: true, type: String, description: 'null for an install-wide template' })
  organizationId!: string | null;
  @ApiProperty({ description: 'Provisioned from template_ds_compare_configs.yaml: edit the file, not the template.' })
  readOnly!: boolean;
  @ApiProperty({ type: CompareTemplateDefinitionDto })
  definition!: CompareTemplateDefinitionDto;
  @ApiPropertyOptional() createdBy?: string;
  @ApiPropertyOptional() updatedBy?: string;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class CompareTemplateListDto {
  @ApiProperty({ enum: ['organization', 'install'] }) scope!: CompareTemplateScopeKind;
  @ApiProperty({ nullable: true, type: String }) organizationId!: string | null;
  @ApiProperty({ description: 'Whether the caller may create, edit and delete templates in this scope.' })
  canWrite!: boolean;
  @ApiProperty({ type: [CompareTemplateResponseDto], description: 'In the order the export writes them.' })
  templates!: CompareTemplateResponseDto[];
}
