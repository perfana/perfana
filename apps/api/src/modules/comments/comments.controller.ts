import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { COMMENT_CARD_KEYS } from '@perfana/shared/constants/comment-cards';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';
import { AuthorizationService } from '../../common/services/authorization.service';
import { withOrgFilter } from '../../common/utils/with-org-filter';
import { CommentCaller, CommentsService } from './comments.service';
import { CreateCommentDto, MarkSeenDto, UpdateCommentDto } from './dto/comment.dto';
import type { CommentResponse, CommentThreadResponse } from './dto/comment.dto';

@ApiTags('Test Run Comments')
@ApiBearerAuth()
@Controller()
export class CommentsController {
  constructor(
    private readonly comments: CommentsService,
    private readonly authzService: AuthorizationService,
  ) {}

  private async caller(ctx: UserContext, write = false): Promise<CommentCaller> {
    // Comments are human-authored: an API key has no person behind it (design R3).
    if (write && ctx.userId.startsWith('api-key:')) {
      throw new ForbiddenException('API keys can read comments but not write them');
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
  @ApiOperation({ summary: 'Post a comment or a reply' })
  @ApiResponse({ status: 400, description: 'Invalid card, or the parent is not a live root on the same run and card' })
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
  @ApiOperation({ summary: "Edit a comment's text (author only)" })
  @ApiResponse({ status: 404, description: 'Not found, deleted, or outside your organizations' })
  async update(@Param('id') id: string, @Body() dto: UpdateCommentDto, @UserCtx() ctx: UserContext): Promise<CommentResponse> {
    return this.comments.update(id, dto.body, await this.caller(ctx, true));
  }

  @Delete('comments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a comment (author, org admin of its organization, or global admin)' })
  async remove(@Param('id') id: string, @UserCtx() ctx: UserContext): Promise<void> {
    return this.comments.remove(id, await this.caller(ctx, true));
  }
}
