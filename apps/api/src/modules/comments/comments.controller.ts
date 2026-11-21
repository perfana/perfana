import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { COMMENT_CARD_KEYS } from '@perfana/shared/constants/comment-cards';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';
import { AuthorizationService } from '../../common/services/authorization.service';
import { withOrgFilter } from '../../common/utils/with-org-filter';
import { CommentCaller, CommentsService } from './comments.service';
import { CreateCommentDto, MarkSeenDto, UpdateCommentDto } from './dto/comment.dto';
import type { CommentResponse, CommentThreadResponse } from './dto/comment.dto';
import { CreateStoryDto, ReplaceStoryStepsDto, UpdateStoryDto } from './dto/story.dto';
import type { StoryResponse, StorySummaryResponse } from './dto/story.dto';
import { StoriesService } from './stories.service';

@ApiTags('Test Run Comments')
@ApiBearerAuth()
@Controller()
export class CommentsController {
  constructor(
    private readonly comments: CommentsService,
    private readonly authzService: AuthorizationService,
    private readonly stories: StoriesService,
  ) {}

  private async caller(ctx: UserContext, write = false): Promise<CommentCaller> {
    // Comments and stories are human-authored: an API key has no person behind it (design R3).
    if (write && ctx.userId.startsWith('api-key:')) {
      throw new ForbiddenException('API keys can read comments and stories but not write them');
    }
    return {
      userId: ctx.userId,
      displayName: ctx.displayName,
      orgIds: await withOrgFilter(ctx.userId, ctx.roles, this.authzService),
    };
  }

  @Get('test-runs/:id/comments')
  @ApiOperation({ summary: 'List comment threads on a test run', description: '`:id` is the run uuid or its test_run_id. Threads are roots with their replies, oldest first. With `card`, `lastSeenAt` is the caller\'s previous look at that card. `canModerate`: the caller may delete other people\'s comments here (organization admin or global admin).' })
  @ApiQuery({ name: 'card', required: false, enum: COMMENT_CARD_KEYS })
  @ApiResponse({ status: 404, description: 'Run not found or outside your organizations' })
  async list(@Param('id') id: string, @UserCtx() ctx: UserContext, @Query('card') card?: string): Promise<{ threads: CommentThreadResponse[]; lastSeenAt: string | null; canModerate: boolean }> {
    return this.comments.listThreads(id, card, await this.caller(ctx));
  }

  @Get('test-runs/:id/comments/counts')
  @ApiOperation({
    summary: 'Comment counts per card for the caller',
    description: '`{ <card>: { total, unread } }`: `total` counts every comment that is not deleted, `unread` those by others since the caller last opened that card\'s comments (last 30 days). Cards without comments are absent.',
  })
  async counts(@Param('id') id: string, @UserCtx() ctx: UserContext): Promise<Record<string, { total: number; unread: number }>> {
    return this.comments.counts(id, await this.caller(ctx));
  }

  @Get('test-runs/:id/comments/items')
  @ApiOperation({ summary: "Thread and unread counts per anchored item on one card, for the caller" })
  @ApiQuery({ name: 'card', required: true, enum: COMMENT_CARD_KEYS })
  async items(@Param('id') id: string, @Query('card') card: string, @UserCtx() ctx: UserContext): Promise<Record<string, { threads: number; unread: number }>> {
    if (!(COMMENT_CARD_KEYS as readonly string[]).includes(card)) throw new BadRequestException('Unknown card');
    return this.comments.itemCounts(id, card, await this.caller(ctx));
  }

  @Post('test-runs/:id/comments')
  @ApiOperation({ summary: 'Post a comment or a reply', description: 'A root may carry one `tag` (symptom, hypothesis, evidence, ruled-out, root-cause, action); a reply may not.' })
  @ApiResponse({ status: 400, description: 'Invalid card or tag, a tag on a reply, or the parent is not a live root on the same run and card' })
  @ApiResponse({ status: 403, description: 'API keys cannot write comments' })
  async create(@Param('id') id: string, @Body() dto: CreateCommentDto, @UserCtx() ctx: UserContext): Promise<CommentResponse> {
    return this.comments.create(id, dto, await this.caller(ctx, true));
  }

  @Put('test-runs/:id/comments/seen')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Mark a card's comments as seen by the caller" })
  async seen(@Param('id') id: string, @Body() dto: MarkSeenDto, @UserCtx() ctx: UserContext): Promise<void> {
    return this.comments.markSeen(id, dto.card, await this.caller(ctx, true));
  }

  @Patch('comments/:id')
  @ApiOperation({
    summary: "Edit a comment's text and/or tag (author only)",
    description: 'Send `body`, `tag` or both; an absent field is left alone and `tag: null` clears the tag. Only a text change sets `editedAt`.',
  })
  @ApiResponse({ status: 400, description: 'Neither body nor tag sent, an invalid tag, or a tag on a reply' })
  @ApiResponse({ status: 403, description: 'Not the author, or an API key' })
  @ApiResponse({ status: 404, description: 'Not found, deleted, or outside your organizations' })
  async update(@Param('id') id: string, @Body() dto: UpdateCommentDto, @UserCtx() ctx: UserContext): Promise<CommentResponse> {
    return this.comments.update(id, dto, await this.caller(ctx, true));
  }

  @Delete('comments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a comment (author, org admin of its organization, or global admin)' })
  async remove(@Param('id') id: string, @UserCtx() ctx: UserContext): Promise<void> {
    return this.comments.remove(id, await this.caller(ctx, true));
  }

  // --- Analysis stories (design: docs/designs/test-run-analysis-stories.md, "Stories") ---

  @Get('test-runs/:id/stories')
  @ApiTags('Test Run Stories')
  @ApiOperation({
    summary: "List a test run's analysis stories",
    description: "`:id` is the run uuid or its test_run_id. Published stories plus the caller's own drafts, oldest first, without steps. `canEdit` / `canDelete` say what the caller may do with each.",
  })
  @ApiResponse({ status: 404, description: 'Run not found or outside your organizations' })
  async listStories(@Param('id') id: string, @UserCtx() ctx: UserContext): Promise<StorySummaryResponse[]> {
    return this.stories.list(id, await this.caller(ctx));
  }

  @Get('stories/:id')
  @ApiTags('Test Run Stories')
  @ApiOperation({
    summary: 'Read one story with its steps',
    description: 'Each step carries its comment as it reads now: the redacted shape (`deleted: true`, no body) when the comment was deleted, with its tag kept.',
  })
  @ApiResponse({ status: 404, description: "Not found, outside your organizations, or someone else's draft" })
  async getStory(@Param('id') id: string, @UserCtx() ctx: UserContext): Promise<StoryResponse> {
    return this.stories.get(id, await this.caller(ctx));
  }

  @Post('test-runs/:id/stories')
  @ApiTags('Test Run Stories')
  @ApiOperation({
    summary: 'Start a story (a draft)',
    description: 'Optionally with initial steps. Each step is a live root comment on the same run, at most once; at most 50 steps.',
  })
  @ApiResponse({ status: 400, description: 'Empty title, more than 50 steps, or a step that is a reply, on another run, deleted or repeated' })
  @ApiResponse({ status: 403, description: 'API keys cannot write stories' })
  @ApiResponse({ status: 404, description: 'Run not found or outside your organizations' })
  async createStory(@Param('id') id: string, @Body() dto: CreateStoryDto, @UserCtx() ctx: UserContext): Promise<StoryResponse> {
    return this.stories.create(id, dto, await this.caller(ctx, true));
  }

  @Patch('stories/:id')
  @ApiTags('Test Run Stories')
  @ApiOperation({
    summary: "Edit a story's title, summary or status (author only)",
    description: "An absent field is left alone; `summary: null` clears it. `status: 'published'` publishes (refused with no steps; `publishedAt` is set on the first publish and kept on unpublish), `status: 'draft'` unpublishes.",
  })
  @ApiResponse({ status: 400, description: 'Nothing sent, an empty title, or publishing a story with no steps' })
  @ApiResponse({ status: 403, description: 'Not the author, or an API key' })
  @ApiResponse({ status: 404, description: "Not found, outside your organizations, or someone else's draft" })
  async updateStory(@Param('id') id: string, @Body() dto: UpdateStoryDto, @UserCtx() ctx: UserContext): Promise<StoryResponse> {
    return this.stories.update(id, dto, await this.caller(ctx, true));
  }

  @Put('stories/:id/steps')
  @ApiTags('Test Run Stories')
  @ApiOperation({
    summary: "Replace a story's steps (author only)",
    description: '`{ steps: [{ commentId, note? }] }` is the full ordered list and replaces every step in one transaction: reorder, add and remove are all this call. A comment already in the story may stay after it was deleted; a newly added one must be live.',
  })
  @ApiResponse({ status: 400, description: 'More than 50 steps, a step that is a reply, on another run, newly added but deleted, or repeated, or emptying a published story' })
  @ApiResponse({ status: 403, description: 'Not the author, or an API key' })
  @ApiResponse({ status: 404, description: "Not found, outside your organizations, or someone else's draft" })
  async replaceStorySteps(@Param('id') id: string, @Body() dto: ReplaceStoryStepsDto, @UserCtx() ctx: UserContext): Promise<StoryResponse> {
    return this.stories.replaceSteps(id, dto.steps, await this.caller(ctx, true));
  }

  @Delete('stories/:id')
  @ApiTags('Test Run Stories')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a story (author, org admin of its organization, or global admin)', description: 'Its steps go with it; the comments are never touched.' })
  @ApiResponse({ status: 403, description: 'Not allowed, or an API key' })
  @ApiResponse({ status: 404, description: "Not found, outside your organizations, or someone else's draft" })
  async removeStory(@Param('id') id: string, @UserCtx() ctx: UserContext): Promise<void> {
    return this.stories.remove(id, await this.caller(ctx, true));
  }
}
