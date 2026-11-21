import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsString, IsUUID, Length, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import {
  STORY_MAX_STEPS,
  STORY_STATUSES,
  STORY_STEP_NOTE_MAX_LENGTH,
  STORY_SUMMARY_MAX_LENGTH,
  STORY_TITLE_MAX_LENGTH,
  type StoryAuthorKind,
  type StoryStatus,
} from '@perfana/shared/constants/comment-cards';
import type { CommentResponse } from './comment.dto';

/** One step as a client sends it: a root comment on the story's run, and optional connecting words. */
export class StoryStepInputDto {
  @ApiProperty({ description: 'A root comment on the same run' })
  @IsUUID()
  commentId!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: STORY_STEP_NOTE_MAX_LENGTH, description: "The story author's words for this step" })
  @ValidateIf((o: StoryStepInputDto) => o.note !== undefined && o.note !== null)
  @IsString()
  @MaxLength(STORY_STEP_NOTE_MAX_LENGTH)
  note?: string | null;
}

export class CreateStoryDto {
  @ApiProperty({ minLength: 1, maxLength: STORY_TITLE_MAX_LENGTH })
  @IsString()
  @Length(1, STORY_TITLE_MAX_LENGTH)
  title!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: STORY_SUMMARY_MAX_LENGTH, description: 'The conclusion, shown as the last screen' })
  @ValidateIf((o: CreateStoryDto) => o.summary !== undefined && o.summary !== null)
  @IsString()
  @MaxLength(STORY_SUMMARY_MAX_LENGTH)
  summary?: string | null;

  @ApiPropertyOptional({ type: [StoryStepInputDto], maxItems: STORY_MAX_STEPS, description: 'Initial steps, in order' })
  @ValidateIf((o: CreateStoryDto) => o.steps !== undefined)
  @IsArray()
  @ArrayMaxSize(STORY_MAX_STEPS)
  @ValidateNested({ each: true })
  @Type(() => StoryStepInputDto)
  steps?: StoryStepInputDto[];
}

/** An absent key leaves the stored value alone; `summary: null` clears the conclusion. */
export class UpdateStoryDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: STORY_TITLE_MAX_LENGTH })
  @ValidateIf((o: UpdateStoryDto) => o.title !== undefined)
  @IsString()
  @Length(1, STORY_TITLE_MAX_LENGTH)
  title?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: STORY_SUMMARY_MAX_LENGTH })
  @ValidateIf((o: UpdateStoryDto) => o.summary !== undefined && o.summary !== null)
  @IsString()
  @MaxLength(STORY_SUMMARY_MAX_LENGTH)
  summary?: string | null;

  @ApiPropertyOptional({ enum: STORY_STATUSES, description: "'published' publishes (refused with no steps); 'draft' unpublishes" })
  @ValidateIf((o: UpdateStoryDto) => o.status !== undefined)
  @IsIn(STORY_STATUSES as readonly string[] as string[])
  status?: StoryStatus;
}

export class ReplaceStoryStepsDto {
  @ApiProperty({ type: [StoryStepInputDto], maxItems: STORY_MAX_STEPS, description: 'The full ordered list; replaces every step' })
  @IsArray()
  @ArrayMaxSize(STORY_MAX_STEPS)
  @ValidateNested({ each: true })
  @Type(() => StoryStepInputDto)
  steps!: StoryStepInputDto[];
}

export interface StorySummaryResponse {
  id: string;
  testRunId: string;
  title: string;
  summary: string | null;
  status: StoryStatus;
  authorId: string;
  authorName: string;
  authorKind: StoryAuthorKind;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  stepCount: number;
  /** The caller wrote it, so may edit, reorder, publish and unpublish it. */
  canEdit: boolean;
  /** The caller may delete it: its author, an org admin of its organization, or a global admin. */
  canDelete: boolean;
}

/** A step with its comment as it reads now: the redacted shape when the comment was deleted. */
export interface StoryStepResponse {
  position: number;
  note: string | null;
  comment: CommentResponse & { replyCount: number };
}

export interface StoryResponse extends StorySummaryResponse {
  steps: StoryStepResponse[];
}
