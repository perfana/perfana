import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { TestRunComment, TestRunStory, TestRunStoryStep } from '@perfana/shared/entities';
import type { OwnedResource } from '@perfana/shared';
import { STORY_MAX_STEPS } from '@perfana/shared/constants/comment-cards';
import { getRequestEm } from '../../common/db/request-em';
import { AuthorizationService } from '../../common/services/authorization.service';
import { TestRunsGateway } from '../test-runs/gateways/test-runs.gateway';
import { AuditService } from '../audit/audit.service';
import { CommentsService, toResponse, type CommentCaller } from './comments.service';
import type {
  CreateStoryDto,
  StoryResponse,
  StoryStepInputDto,
  StoryStepResponse,
  StorySummaryResponse,
  UpdateStoryDto,
} from './dto/story.dto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Analysis stories (design: docs/designs/test-run-analysis-stories.md, "Stories", PR4).
 *
 * Tenant boundary as for comments: a story is readable exactly when its run is (the same 404), and
 * a draft is readable by its author only — to everyone else, admins included, it is the same 404,
 * so nobody learns a draft exists. Edit, reorder, publish and unpublish are the author's; delete is
 * the author's, an org admin's of the story's organization, or a global admin's.
 */
@Injectable()
export class StoriesService {
  private readonly logger = new Logger(StoriesService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly comments: CommentsService,
    private readonly authzService: AuthorizationService,
    private readonly gateway: TestRunsGateway,
    private readonly auditService: AuditService,
  ) {}

  private tx<T>(fn: (em: EntityManager) => Promise<T>): Promise<T> {
    const em = getRequestEm();
    return em ? fn(em) : this.dataSource.transaction(fn);
  }

  private em(): EntityManager {
    return getRequestEm() ?? this.dataSource.manager;
  }

  /** The caller may delete other people's stories on this run's organization. API keys never may. */
  private async canModerate(caller: CommentCaller, organizationId: string): Promise<boolean> {
    if (caller.userId.startsWith('api-key:')) return false;
    return caller.orgIds === null || (await this.authzService.isOrganizationAdmin(caller.userId, organizationId));
  }

  /**
   * The story, if the caller may read it: its run is readable (same rule and same 404 as a comment)
   * and it is published or the caller's own draft. `forUpdate` row-locks it inside a transaction.
   */
  private async loadStory(id: string, caller: CommentCaller, em: EntityManager, forUpdate = false): Promise<TestRunStory> {
    const notFound = new NotFoundException('Story not found');
    if (!UUID_RE.test(id)) throw notFound;
    const story = await em
      .getRepository(TestRunStory)
      .findOne({ where: { id }, ...(forUpdate ? { lock: { mode: 'pessimistic_write' as const } } : {}) });
    if (!story) throw notFound;
    await this.comments.resolveRun(story.testRunId, caller, em).catch((e: unknown) => {
      throw e instanceof NotFoundException ? notFound : e;
    });
    if (story.status !== 'published' && story.authorId !== caller.userId) throw notFound;
    return story;
  }

  /** Published stories of a run plus the caller's own drafts, oldest first, without steps. */
  async list(runIdOrTestRunId: string, caller: CommentCaller): Promise<StorySummaryResponse[]> {
    const run = await this.comments.resolveRun(runIdOrTestRunId, caller);
    const em = this.em();
    const stories = await em
      .getRepository(TestRunStory)
      .createQueryBuilder('s')
      .where('s.testRunId = :run', { run: run.id })
      .andWhere(`(s.status = 'published' OR s.authorId = :me)`, { me: caller.userId })
      .orderBy('s.createdAt', 'ASC')
      .getMany();
    if (stories.length === 0) return [];
    const counts: { story_id: string; n: number }[] = await em.query(
      `SELECT story_id, count(*)::int AS n FROM test_run_story_steps WHERE story_id = ANY($1::uuid[]) GROUP BY story_id`,
      [stories.map((s) => s.id)],
    );
    const byStory = new Map(counts.map((c) => [c.story_id, c.n]));
    const moderate = await this.canModerate(caller, run.organizationId);
    return stories.map((s) => toStorySummary(s, byStory.get(s.id) ?? 0, caller, moderate));
  }

  /** One story with its steps, each joined to its comment as it reads now. */
  async get(id: string, caller: CommentCaller): Promise<StoryResponse> {
    const em = this.em();
    const story = await this.loadStory(id, caller, em);
    return this.withSteps(story, caller, em);
  }

  // audit-skip: user discussion, not configuration; the row records its author and time itself
  async create(runIdOrTestRunId: string, dto: CreateStoryDto, caller: CommentCaller): Promise<StoryResponse> {
    const title = normaliseTitle(dto.title);
    const result = await this.tx(async (em) => {
      const run = await this.comments.resolveRun(runIdOrTestRunId, caller, em);
      const steps = dto.steps ?? [];
      await this.validateSteps(em, run.id, steps, new Set());
      const repo = em.getRepository(TestRunStory);
      const story = await repo.save(
        repo.create({
          testRunId: run.id,
          title,
          summary: dto.summary ?? null,
          status: 'draft',
          authorId: caller.userId,
          authorName: (caller.displayName || caller.userId).slice(0, 255),
          // Never from the request: agent authoring is a later design step (PR6).
          authorKind: 'user',
          publishedAt: null,
          organizationId: run.organizationId,
          teamId: run.teamId,
        }),
      );
      await this.insertSteps(em, story, steps);
      return this.withSteps(story, caller, em);
    });
    this.emit(result.testRunId, result.id, result.organizationIdForEmit);
    return stripEmitOwner(result);
  }

  /**
   * Author-only edit of title, summary and status. Publishing a story with no steps is refused;
   * `publishedAt` is set on the first publish and kept on unpublish.
   */
  // audit-skip: author-only edit of their own story; the row carries updated_at
  async update(id: string, dto: UpdateStoryDto, caller: CommentCaller): Promise<StoryResponse> {
    if (dto.title === undefined && dto.summary === undefined && dto.status === undefined) {
      throw new BadRequestException('Send title, summary, status or a combination');
    }
    const result = await this.tx(async (em) => {
      const story = await this.loadStory(id, caller, em, true);
      if (story.authorId !== caller.userId) throw new ForbiddenException('Only the author can edit a story');
      if (dto.title !== undefined) story.title = normaliseTitle(dto.title);
      if (dto.summary !== undefined) story.summary = dto.summary;
      if (dto.status !== undefined && dto.status !== story.status) {
        if (dto.status === 'published') {
          const steps = await em.getRepository(TestRunStoryStep).count({ where: { storyId: story.id } });
          if (steps === 0) throw new BadRequestException('A story needs at least one step before it can be published');
          story.publishedAt ??= new Date();
        }
        story.status = dto.status;
      }
      const saved = await em.getRepository(TestRunStory).save(story);
      return this.withSteps(saved, caller, em);
    });
    this.emit(result.testRunId, result.id, result.organizationIdForEmit);
    return stripEmitOwner(result);
  }

  /**
   * Replace every step in one transaction (delete + insert): reorder, add and remove are all this
   * call. A comment already in the story may stay after it was deleted; a new one must be live.
   */
  // audit-skip: author-only edit of their own story
  async replaceSteps(id: string, steps: StoryStepInputDto[], caller: CommentCaller): Promise<StoryResponse> {
    const result = await this.tx(async (em) => {
      const story = await this.loadStory(id, caller, em, true);
      if (story.authorId !== caller.userId) throw new ForbiddenException('Only the author can change a story\'s steps');
      if (story.status === 'published' && steps.length === 0) {
        throw new BadRequestException('A published story needs at least one step; unpublish it first');
      }
      const repo = em.getRepository(TestRunStoryStep);
      const existing = await repo.find({ where: { storyId: story.id } });
      await this.validateSteps(em, story.testRunId, steps, new Set(existing.map((s) => s.commentId)));
      await repo.delete({ storyId: story.id });
      await this.insertSteps(em, story, steps);
      // Touch the story so `updatedAt` says the walk changed.
      const saved = await em.getRepository(TestRunStory).save({ ...story, updatedAt: new Date() });
      return this.withSteps(saved, caller, em);
    });
    this.emit(result.testRunId, result.id, result.organizationIdForEmit);
    return stripEmitOwner(result);
  }

  /** Hard-deletes the story; its steps cascade. Never touches comments. */
  async remove(id: string, caller: CommentCaller): Promise<void> {
    const story = await this.tx(async (em) => {
      const s = await this.loadStory(id, caller, em, true);
      const allowed = s.authorId === caller.userId || (await this.canModerate(caller, s.organizationId));
      if (!allowed) throw new ForbiddenException('Only the author or an organization admin can delete a story');
      this.auditService.logDelete(s as unknown as OwnedResource, { organizationIdOverride: s.organizationId });
      await em.getRepository(TestRunStory).delete({ id: s.id });
      return s;
    });
    this.emit(story.testRunId, story.id, story.organizationId);
  }

  /**
   * Every step must reference a ROOT comment on the SAME run, at most once, and a comment new to
   * the story must not be soft-deleted. The comments are locked FOR SHARE so a concurrent hard
   * delete of one waits for this transaction and then sees the step (and soft-deletes instead).
   */
  private async validateSteps(em: EntityManager, runId: string, steps: StoryStepInputDto[], alreadyIn: Set<string>): Promise<void> {
    if (steps.length > STORY_MAX_STEPS) throw new BadRequestException(`A story holds at most ${STORY_MAX_STEPS} steps`);
    const ids = steps.map((s) => s.commentId);
    if (ids.some((id) => !UUID_RE.test(id))) throw new BadRequestException('commentId must be a uuid');
    if (new Set(ids).size !== ids.length) throw new BadRequestException('A comment can appear only once in a story');
    if (ids.length === 0) return;
    const rows: { id: string; test_run_id: string; parent_id: string | null; deleted_at: Date | null }[] = await em.query(
      `SELECT id, test_run_id, parent_id, deleted_at FROM test_run_comments WHERE id = ANY($1::uuid[]) FOR SHARE`,
      [ids],
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of ids) {
      const c = byId.get(id);
      if (!c || c.test_run_id !== runId) throw new BadRequestException(`Comment ${id} is not a comment on this run`);
      if (c.parent_id) throw new BadRequestException(`Comment ${id} is a reply; a story step is a root comment`);
      if (c.deleted_at && !alreadyIn.has(id)) throw new BadRequestException(`Comment ${id} was deleted and cannot be added`);
    }
  }

  // audit-skip: part of the author's own story write (create/replaceSteps), not configuration
  private async insertSteps(em: EntityManager, story: TestRunStory, steps: StoryStepInputDto[]): Promise<void> {
    if (steps.length === 0) return;
    const repo = em.getRepository(TestRunStoryStep);
    await repo.insert(
      steps.map((s, i) =>
        repo.create({
          storyId: story.id,
          commentId: s.commentId,
          position: i + 1,
          note: s.note?.trim() ? s.note : null,
          organizationId: story.organizationId,
        }),
      ),
    );
  }

  private async withSteps(
    story: TestRunStory,
    caller: CommentCaller,
    em: EntityManager,
  ): Promise<StoryResponse & { organizationIdForEmit: string }> {
    const steps = await em.getRepository(TestRunStoryStep).find({ where: { storyId: story.id }, order: { position: 'ASC' } });
    const ids = steps.map((s) => s.commentId);
    const comments = ids.length ? await em.getRepository(TestRunComment).find({ where: { id: In(ids) } }) : [];
    const replies: { parent_id: string; n: number }[] = ids.length
      ? await em.query(
          `SELECT parent_id, count(*)::int AS n FROM test_run_comments WHERE parent_id = ANY($1::uuid[]) AND deleted_at IS NULL GROUP BY parent_id`,
          [ids],
        )
      : [];
    const byId = new Map(comments.map((c) => [c.id, c]));
    const replyCount = new Map(replies.map((r) => [r.parent_id, r.n]));
    const stepResponses: StoryStepResponse[] = [];
    for (const s of steps) {
      const c = byId.get(s.commentId);
      if (!c) continue; // FK makes this unreachable; never render a step pointing at nothing.
      stepResponses.push({ position: s.position, note: s.note ?? null, comment: { ...toResponse(c), replyCount: replyCount.get(c.id) ?? 0 } });
    }
    const moderate = story.authorId === caller.userId ? true : await this.canModerate(caller, story.organizationId);
    return {
      ...toStorySummary(story, stepResponses.length, caller, moderate),
      steps: stepResponses,
      organizationIdForEmit: story.organizationId,
    };
  }

  private emit(testRunId: string, storyId: string, organizationId: string): void {
    try {
      this.gateway.emitStoryChanged({ testRunId, organizationId }, storyId);
    } catch (err) {
      // A realtime failure must never fail the write the user just made.
      const msg = err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Unknown error';
      this.logger.warn(`Failed to emit story:changed for story ${storyId}: ${msg}`);
    }
  }
}

function normaliseTitle(raw: string): string {
  const title = raw.trim();
  if (title.length === 0) throw new BadRequestException('A story needs a title');
  return title;
}

function stripEmitOwner(r: StoryResponse & { organizationIdForEmit: string }): StoryResponse {
  const { organizationIdForEmit: _owner, ...rest } = r;
  return rest;
}

export function toStorySummary(s: TestRunStory, stepCount: number, caller: CommentCaller, moderate: boolean): StorySummaryResponse {
  const isAuthor = s.authorId === caller.userId && !caller.userId.startsWith('api-key:');
  return {
    id: s.id,
    testRunId: s.testRunId,
    title: s.title,
    summary: s.summary ?? null,
    status: s.status,
    authorId: s.authorId,
    authorName: s.authorName,
    authorKind: s.authorKind ?? 'user',
    publishedAt: s.publishedAt ? new Date(s.publishedAt).toISOString() : null,
    createdAt: new Date(s.createdAt).toISOString(),
    updatedAt: new Date(s.updatedAt).toISOString(),
    stepCount,
    canEdit: isAuthor,
    canDelete: isAuthor || moderate,
  };
}
