import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import {
  COMMENT_BODY_MAX_LENGTH,
  COMMENT_CARD_KEYS,
  type CommentCardKey,
} from '@perfana/shared/constants/comment-cards';

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
