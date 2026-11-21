import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SeriesConfigDto } from '../../graph-presets/dto/create-graph-preset.dto';
import { CompareSeriesConfig } from '../../compare-presets/dto/create-compare-preset.dto';
import {
  COMMENT_BODY_MAX_LENGTH,
  COMMENT_CARD_KEYS,
  CONFIG_VIEW_VALUE_MAX_LENGTH,
  type CommentCardKey,
} from '@perfana/shared/constants/comment-cards';

/** Most series a marker records; mirrors the web's LINK_WILDCARD_MAX_SERIES. */
export const MARKER_MAX_SERIES = 50;
/** Byte cap on a stored chart context (design R3-15); checked on the serialised JSON. */
export const CHART_CONTEXT_MAX_BYTES = 64 * 1024;

/**
 * The Graphs view a marker was placed on, replayed by "Restore view" and the deep link.
 * `series` uses the graph-preset series shape, so replay is the preset load path.
 */
export class ChartContextDto {
  @ApiProperty({ type: [SeriesConfigDto], maxItems: MARKER_MAX_SERIES })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MARKER_MAX_SERIES)
  @ValidateNested({ each: true })
  @Type(() => SeriesConfigDto)
  series!: SeriesConfigDto[];

  @ApiPropertyOptional({ description: 'Zoom window [from, to] as ISO timestamps; absent = the whole run', type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsISO8601({}, { each: true })
  xRange?: [string, string];

  @ApiPropertyOptional({ enum: ['overlay', 'split'] })
  @IsOptional()
  @IsIn(['overlay', 'split'])
  axisMode?: 'overlay' | 'split';

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  title?: string;
}

/** A Trends series, as the Trends card's presets store it. */
export class TrendsSeriesDto {
  @IsString() @Length(1, 255) dashboardId!: string;
  @IsOptional() @IsString() @Length(0, 255) dashboardLabel?: string;
  @IsNumber() panelId!: number;
  @IsOptional() @IsString() @Length(0, 255) panelTitle?: string;
  @IsString() @Length(1, 1024) metricName!: string;
  @IsString() @Length(1, 64) source!: string;
  @IsOptional() @IsString() @Length(0, 64) yAxisFormat?: string;
  @IsOptional() @IsString() @Length(0, 64) metricsSourceId?: string;
  @IsOptional() @IsBoolean() isAggregated?: boolean;
  @IsOptional() @IsInt() colorSlot?: number;
  @IsOptional() @IsBoolean() hidden?: boolean;
}

/** The Trends view a comment was written on: series, run window and aggregation. */
export class TrendsChartContextDto {
  @ApiProperty({ type: [TrendsSeriesDto], maxItems: MARKER_MAX_SERIES })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MARKER_MAX_SERIES)
  @ValidateNested({ each: true })
  @Type(() => TrendsSeriesDto)
  series!: TrendsSeriesDto[];

  @ApiProperty({ description: "The time range option's label, e.g. 'Last week' or 'Custom'", maxLength: 64 })
  @IsString()
  @Length(1, 64)
  timeRange!: string;

  @ApiPropertyOptional({ description: 'The custom window [from, to] when timeRange is Custom', type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsISO8601({}, { each: true })
  customRange?: [string, string];

  @ApiProperty({ description: 'Aggregation evaluated per run, e.g. avg or p95', maxLength: 32 })
  @IsString()
  @Length(1, 32)
  evaluateType!: string;
}

/** The Compare view a comment was written on: series and baseline. */
export class CompareChartContextDto {
  @ApiProperty({ type: [CompareSeriesConfig], maxItems: MARKER_MAX_SERIES })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MARKER_MAX_SERIES)
  @ValidateNested({ each: true })
  @Type(() => CompareSeriesConfig)
  series!: CompareSeriesConfig[];

  @ApiPropertyOptional({ description: "The baseline run id, or 'control-group'; absent = none picked", maxLength: 255 })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  baselineTestRunId?: string;
}

/**
 * What a Configuration item comment was written against: the run the card compared with and
 * the item's status and values in that comparison, so the comment stays readable after the
 * comparison moves on. Values are null when the key is absent from that side.
 */
export class ConfigChartContextDto {
  @ApiPropertyOptional({ description: 'The run the card compared with; absent = none picked', maxLength: 255 })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  comparedToTestRunId?: string;

  @ApiProperty({ enum: ['changed', 'expected', 'new', 'removed', 'same'] })
  @IsIn(['changed', 'expected', 'new', 'removed', 'same'])
  status!: 'changed' | 'expected' | 'new' | 'removed' | 'same';

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: CONFIG_VIEW_VALUE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @Length(0, CONFIG_VIEW_VALUE_MAX_LENGTH)
  currentValue?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: CONFIG_VIEW_VALUE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @Length(0, CONFIG_VIEW_VALUE_MAX_LENGTH)
  previousValue?: string | null;
}

/** Which view shape a card's comments record. Other cards record none. */
export const CHART_CONTEXT_DTO_BY_CARD = {
  graphs: ChartContextDto,
  trends: TrendsChartContextDto,
  compare: CompareChartContextDto,
  config: ConfigChartContextDto,
} as const;

export class CreateCommentDto {
  @ApiProperty({ enum: COMMENT_CARD_KEYS, description: 'The card the comment belongs to' })
  @IsIn(COMMENT_CARD_KEYS as string[])
  card!: CommentCardKey;

  @ApiProperty({ minLength: 1, maxLength: COMMENT_BODY_MAX_LENGTH })
  @IsString()
  @Length(1, COMMENT_BODY_MAX_LENGTH)
  body!: string;

  @ApiPropertyOptional({ description: 'Root comment this replies to. Threads are one level deep.' })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({
    description: 'Anchor a root comment to one item of the card (a row key the card builds). Not allowed on a reply.',
    maxLength: 1024,
  })
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  itemKey?: string;

  @ApiPropertyOptional({ description: 'What the anchored item is called, shown with the thread. Required with itemKey.', maxLength: 255 })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  itemLabel?: string;

  @ApiPropertyOptional({ description: 'Makes this root a numbered graph marker (Graphs card only). Required with chartContext.' })
  @IsOptional()
  @IsISO8601()
  markerTime?: string;

  @ApiPropertyOptional({
    description:
      "The card's view when the comment was written (Graphs, Trends and Compare roots, and Configuration item roots; required with markerTime). " +
      'Its shape depends on the card: ChartContextDto, TrendsChartContextDto, CompareChartContextDto or ConfigChartContextDto. ' +
      'Validated by the service against that class, because one nested type here would have the whitelist strip the other cards\' fields.',
  })
  @IsOptional()
  @IsObject()
  chartContext?: Record<string, unknown>;
}

/** Only the body is editable (design R5); any other key is stripped by the global ValidationPipe. */
export class UpdateCommentDto {
  @ApiProperty({ minLength: 1, maxLength: COMMENT_BODY_MAX_LENGTH })
  @IsString()
  @Length(1, COMMENT_BODY_MAX_LENGTH)
  body!: string;
}

export class MarkSeenDto {
  @ApiProperty({ enum: COMMENT_CARD_KEYS })
  @IsIn(COMMENT_CARD_KEYS as string[])
  card!: CommentCardKey;
}

export interface CommentResponse {
  id: string;
  testRunId: string;
  cardKey: string;
  parentId: string | null;
  /** The card item a root is anchored to; replies carry their root's. */
  itemKey: string | null;
  itemLabel: string | null;
  /** null when the comment was deleted. */
  body: string | null;
  deleted: boolean;
  authorId: string;
  authorName: string;
  markerSeq: number | null;
  markerTime: string | null;
  chartContext: Record<string, unknown> | null;
  createdAt: string;
  editedAt: string | null;
}

export interface CommentThreadResponse extends CommentResponse {
  replies: CommentResponse[];
}
