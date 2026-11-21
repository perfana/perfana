import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { API_KEY_COMMENTS_WRITE_ROLE, COMMENT_CARD_KEYS } from '@perfana/shared/constants/comment-cards';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';
import { AuthorizationService } from '../../common/services/authorization.service';
import { withOrgFilter } from '../../common/utils/with-org-filter';
import { CommentCaller, CommentsService } from './comments.service';
import { CreateCommentDto, MarkSeenDto, ReplyCommentDto, UpdateCommentDto } from './dto/comment.dto';
import type { CommentResponse, CommentThreadResponse } from './dto/comment.dto';

@ApiTags('Test Run Comments')
@ApiBearerAuth()
@Controller()
export class CommentsController {
  constructor(
    private readonly comments: CommentsService,
    private readonly authzService: AuthorizationService,
  ) {}

  /**
   * `write`: `true` refuses every API key (delete, seen and anything not opened to agents);
   * `'agent'` admits a key that carries the opt-in `comments:write` role (design:
   * test-run-analysis-stories.md, "Reversing v1 R3, for opted-in keys only"). Such a key writes
   * as an agent, signed with its description; the role grants nothing outside these routes.
   */
  private async caller(ctx: UserContext, write: boolean | 'agent' = false): Promise<CommentCaller> {
    const isKey = ctx.userId.startsWith('api-key:');
    if (isKey && write === true) {
      throw new ForbiddenException('API keys cannot delete comments, mark them seen or do this');
    }
    if (isKey && write === 'agent' && !ctx.roles.includes(API_KEY_COMMENTS_WRITE_ROLE)) {
      throw new ForbiddenException(
        `This API key can read comments but not write them: create a key with the ${API_KEY_COMMENTS_WRITE_ROLE} role`,
      );
    }
    return {
      userId: ctx.userId,
      displayName: isKey ? ctx.apiKeyDescription : ctx.displayName,
      orgIds: await withOrgFilter(ctx.userId, ctx.roles, this.authzService),
      ...(isKey ? { authorKind: 'agent' as const } : {}),
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
    description: '`{ <card>: { total, unread, unreadAgent } }`: `total` counts every comment that is not deleted, `unread` those by others since the caller last opened that card\'s comments (last 30 days), `unreadAgent` how many of those an AI agent wrote. Cards without comments are absent.',
  })
  async counts(@Param('id') id: string, @UserCtx() ctx: UserContext): Promise<Record<string, { total: number; unread: number; unreadAgent: number }>> {
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
  @ApiOperation({
    summary: 'Post a comment or a reply',
    description:
      'A root may carry one `tag` (symptom, hypothesis, evidence, ruled-out, root-cause, action); a reply may not. ' +
      'A root may name what it is about with `anchor` instead of `itemKey`/`markerTime`/`chartContext`. ' +
      `An API key needs the ${API_KEY_COMMENTS_WRITE_ROLE} role; its comments are marked as written by an AI agent, ` +
      'are never announced to notification channels, and are capped at 100 roots and 200 replies per key per run. ' +
      'A key repeating a `clientRef` gets the comment it already wrote, with 200 instead of 201.',
  })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 200, description: 'An API key repeated a clientRef: the comment it already wrote' })
  @ApiResponse({ status: 400, description: 'Invalid card or tag, a tag on a reply, the parent is not a live root on the same run and card, or the anchor names something not in the run' })
  @ApiResponse({ status: 403, description: `An API key without the ${API_KEY_COMMENTS_WRITE_ROLE} role` })
  @ApiResponse({ status: 429, description: "The API key reached its per-run limit of root comments or replies" })
  async create(
    @Param('id') id: string,
    @Body() dto: CreateCommentDto,
    @UserCtx() ctx: UserContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CommentResponse> {
    const { comment, created } = await this.comments.createOrReplay(id, dto, await this.caller(ctx, 'agent'));
    if (!created) res.status(HttpStatus.OK);
    return comment;
  }

  @Post('comments/:id/replies')
  @ApiOperation({
    summary: 'Reply to a root comment by its id',
    description:
      'The same as posting with `parentId`, for a client that holds only the comment id (the MCP server): the run and ' +
      'card come from the root. Takes `body` and, for an API key, an optional `clientRef`.',
  })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 200, description: 'An API key repeated a clientRef: the reply it already wrote' })
  @ApiResponse({ status: 400, description: 'The comment is a reply or deleted' })
  @ApiResponse({ status: 403, description: `An API key without the ${API_KEY_COMMENTS_WRITE_ROLE} role` })
  @ApiResponse({ status: 404, description: 'Not found, or outside your organizations' })
  @ApiResponse({ status: 429, description: 'The API key reached its per-run limit of replies' })
  async reply(
    @Param('id') id: string,
    @Body() dto: ReplyCommentDto,
    @UserCtx() ctx: UserContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CommentResponse> {
    const { comment, created } = await this.comments.replyTo(id, dto, await this.caller(ctx, 'agent'));
    if (!created) res.status(HttpStatus.OK);
    return comment;
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
  @ApiResponse({ status: 403, description: `Not the author, or an API key without the ${API_KEY_COMMENTS_WRITE_ROLE} role` })
  @ApiResponse({ status: 404, description: 'Not found, deleted, or outside your organizations' })
  async update(@Param('id') id: string, @Body() dto: UpdateCommentDto, @UserCtx() ctx: UserContext): Promise<CommentResponse> {
    return this.comments.update(id, dto, await this.caller(ctx, 'agent'));
  }

  @Delete('comments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a comment (author, org admin of its organization, or global admin)' })
  async remove(@Param('id') id: string, @UserCtx() ctx: UserContext): Promise<void> {
    return this.comments.remove(id, await this.caller(ctx, true));
  }
}
