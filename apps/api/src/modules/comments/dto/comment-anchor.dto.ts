import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { COMMENT_CARD_KEYS, type CommentCardKey } from '@perfana/shared/constants/comment-cards';
import { MARKER_MAX_SERIES } from './comment.dto';

/**
 * Anchors: an agent names the thing it is commenting on and the API builds the card's item key,
 * label and recorded view (design: test-run-analysis-stories.md, "Anchors: the agent names the
 * thing, the server builds the key"). Validated by the service per `type`, like a chart context,
 * because one nested union type here would have the global whitelist strip the other types' fields.
 */
export const COMMENT_ANCHOR_TYPES = ['card', 'transaction', 'config', 'dashboard', 'slo', 'marker'] as const;
export type CommentAnchorType = (typeof COMMENT_ANCHOR_TYPES)[number];

/** The card each anchor type belongs to; `card` names its own. */
export const ANCHOR_CARD: Readonly<Record<Exclude<CommentAnchorType, 'card'>, CommentCardKey>> = Object.freeze({
  transaction: 'performance',
  config: 'config',
  dashboard: 'dashboards',
  slo: 'slo',
  marker: 'graphs',
});

export class CardAnchorDto {
  @IsIn(['card']) type!: 'card';
  @ApiProperty({ enum: COMMENT_CARD_KEYS })
  @IsIn(COMMENT_CARD_KEYS as string[])
  card!: CommentCardKey;
}

export class TransactionAnchorDto {
  @IsIn(['transaction']) type!: 'transaction';
  @ApiProperty({ description: 'Transaction name as Performance analysis lists it' })
  @IsString() @Length(1, 1000) name!: string;
  @ApiPropertyOptional({ description: 'Scenario, when the transaction runs in more than one' })
  @IsOptional() @IsString() @Length(1, 1000) scenario?: string;
}

export class ConfigAnchorDto {
  @IsIn(['config']) type!: 'config';
  @ApiProperty({ description: 'Configuration key' })
  @IsString() @Length(1, 1000) key!: string;
  @ApiPropertyOptional({ description: 'The run (test_run_id) the value is compared with' })
  @IsOptional() @IsString() @Length(1, 255) comparedToTestRunId?: string;
}

export class DashboardAnchorDto {
  @IsIn(['dashboard']) type!: 'dashboard';
  @IsUUID() applicationDashboardId!: string;
}

export class SloAnchorDto {
  @IsIn(['slo']) type!: 'slo';
  @IsUUID() checkResultId!: string;
}

export class MarkerSeriesDto {
  @IsString() @Length(1, 255) dashboardLabel!: string;
  @IsInt() @Min(0) panelId!: number;
  @IsString() @Length(1, 255) metricName!: string;
  @ApiPropertyOptional({ description: 'Disambiguates a dashboard label shared by two application dashboards' })
  @IsOptional() @IsUUID() applicationDashboardId?: string;
}

export class MarkerAnchorDto {
  @IsIn(['marker']) type!: 'marker';
  @ApiProperty({ description: 'Where the marker sits, as an ISO timestamp inside the run' })
  @IsISO8601() time!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MARKER_MAX_SERIES)
  @ValidateNested({ each: true })
  @Type(() => MarkerSeriesDto)
  series!: MarkerSeriesDto[];

  @ApiPropertyOptional({ description: 'Zoom window [from, to]; defaults to the whole run, and is clamped to it', type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsISO8601({}, { each: true })
  range?: [string, string];
}

export const ANCHOR_DTO_BY_TYPE = {
  card: CardAnchorDto,
  transaction: TransactionAnchorDto,
  config: ConfigAnchorDto,
  dashboard: DashboardAnchorDto,
  slo: SloAnchorDto,
  marker: MarkerAnchorDto,
} as const;

export type CommentAnchor =
  | CardAnchorDto
  | TransactionAnchorDto
  | ConfigAnchorDto
  | DashboardAnchorDto
  | SloAnchorDto
  | MarkerAnchorDto;
