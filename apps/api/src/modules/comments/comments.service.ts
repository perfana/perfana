import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { TestRunComment, TestRunCommentRead } from '@perfana/shared/entities';
import { getRequestEm } from '../../common/db/request-em';
import { AuthorizationService } from '../../common/services/authorization.service';
import { TestRunsGateway } from '../test-runs/gateways/test-runs.gateway';
import { AuditService } from '../audit/audit.service';
import type { OwnedResource } from '@perfana/shared';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CHART_CONTEXT_DTO_BY_CARD,
  CHART_CONTEXT_MAX_BYTES,
  type CommentResponse,
  type CommentThreadResponse,
  type CreateCommentDto,
} from './dto/comment.dto';
import { commentCountsByCard, type CommentCounts } from './comment-unread.sql';
import { COMMENT_UNREAD_WINDOW_DAYS } from '@perfana/shared/constants/comment-cards';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RunOwner {
  id: string;
  organizationId: string;
  teamId: string | null;
}

/** The caller, as every route needs it. `orgIds` null = global admin. */
export interface CommentCaller {
  userId: string;
  displayName?: string;
  orgIds: string[] | null;
}

/**
 * Test-run comments and Graphs markers (design: docs/designs/test-run-comments.md, PR1 + PR2).
 *
 * Tenant boundary: every route takes the caller's accessible organizations (`null` = global
 * admin) and answers 404, never 403, for a run or comment outside them (root CLAUDE.md #48).
 * There is no RLS backstop on a default deploy, so the checks here are the boundary.
 */
@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly authzService: AuthorizationService,
    private readonly gateway: TestRunsGateway,
    private readonly auditService: AuditService,
  ) {}

  /** Inside the request's RLS transaction when there is one, otherwise a fresh transaction. */
  private tx<T>(fn: (em: EntityManager) => Promise<T>): Promise<T> {
    const em = getRequestEm();
    return em ? fn(em) : this.dataSource.transaction(fn);
  }

  private em(): EntityManager {
    return getRequestEm() ?? this.dataSource.manager;
  }

  /** Resolve a run by uuid or human `test_run_id`; 404 outside the caller's organizations. */
  /**
   * The run, if the caller may read it, by the same rule as a test-run read (`denialReason` in
   * TestRunsCrudQueryService): a member of the run's SYSTEM's organization, and of its team when
   * that team restricts its resources. Every refusal is the same 404, so nobody learns a run
   * exists. No RLS backstops this on a default deploy (root CLAUDE.md #48).
   */
  async resolveRun(idOrTestRunId: string, caller: Pick<CommentCaller, 'userId' | 'orgIds'>, em = this.em()): Promise<RunOwner> {
    const rows: { id: string; organization_id: string | null; sut_team_id: string | null; team_id: string | null }[] = await em.query(
      `SELECT tr.id, sut.organization_id, sut.team_id AS sut_team_id,
              COALESCE(tr.team_id, sut.team_id) AS team_id
         FROM test_runs tr
         JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
        WHERE ${UUID_RE.test(idOrTestRunId) ? 'tr.id = $1::uuid' : 'tr.test_run_id = $1'}
        LIMIT 1`,
      [idOrTestRunId],
    );
    const run = rows[0];
    const notFound = new NotFoundException('Test run not found');
    if (!run?.organization_id) throw notFound;
    if (caller.orgIds !== null) {
      if (!caller.orgIds.includes(run.organization_id)) throw notFound;
      if (run.sut_team_id && !(await this.authzService.canViewTeamResources(caller.userId, run.sut_team_id)).allowed) {
        throw notFound;
      }
    }
    return { id: run.id, organizationId: run.organization_id, teamId: run.team_id };
  }

  /**
   * `forUpdate` (inside a transaction) row-locks the comment, so an edit and a delete of the same
   * comment serialize, and a delete counts replies only after a concurrent reply (which holds FOR
   * SHARE on its parent) has committed: no reply is lost to the cascade, no deleted row is resaved.
   */
  private async loadComment(id: string, caller: CommentCaller, em = this.em(), forUpdate = false): Promise<TestRunComment> {
    if (!UUID_RE.test(id)) throw new NotFoundException('Comment not found');
    const comment = await em
      .getRepository(TestRunComment)
      .findOne({ where: { id }, ...(forUpdate ? { lock: { mode: 'pessimistic_write' as const } } : {}) });
    if (!comment) throw new NotFoundException('Comment not found');
    // A comment is readable exactly when its run is: same organization and team rule, same 404.
    await this.resolveRun(comment.testRunId, caller, em).catch((e: unknown) => {
      throw e instanceof NotFoundException ? new NotFoundException('Comment not found') : e;
    });
    return comment;
  }

  /**
   * Threads for a run (optionally one card), plus the caller's previous look at that card so the
   * drawer can keep "new" marks while open (design DR4). Read before the drawer marks it seen.
   */
  async listThreads(
    runIdOrTestRunId: string,
    card: string | undefined,
    caller: CommentCaller,
  ): Promise<{ threads: CommentThreadResponse[]; lastSeenAt: string | null }> {
    const run = await this.resolveRun(runIdOrTestRunId, caller);
    const where: Record<string, unknown> = { testRunId: run.id };
    if (card) where.cardKey = card;
    const em = this.em();
    const rows = await em.getRepository(TestRunComment).find({ where, order: { createdAt: 'ASC' } });
    const threads = new Map<string, CommentThreadResponse>();
    for (const row of rows) if (!row.parentId) threads.set(row.id, { ...toResponse(row), replies: [] });
    for (const row of rows) {
      const root = row.parentId ? threads.get(row.parentId) : undefined;
      if (root) root.replies.push({ ...toResponse(row), itemKey: root.itemKey, itemLabel: root.itemLabel });
    }
    const read = card
      ? await em.getRepository(TestRunCommentRead).findOne({ where: { userId: caller.userId, testRunId: run.id, cardKey: card } })
      : null;
    return { threads: [...threads.values()], lastSeenAt: read ? new Date(read.lastSeenAt).toISOString() : null };
  }

  // audit-skip: user discussion, not configuration; the row records its author and time itself
  async create(runIdOrTestRunId: string, dto: CreateCommentDto, caller: CommentCaller): Promise<CommentResponse> {
    const saved = await this.tx(async (em) => {
      const run = await this.resolveRun(runIdOrTestRunId, caller, em);
      if (dto.parentId && dto.itemKey) {
        throw new BadRequestException('A reply takes its anchor from the root; send itemKey only on a root comment');
      }
      if (Boolean(dto.itemKey) !== Boolean(dto.itemLabel)) {
        throw new BadRequestException('itemKey and itemLabel go together');
      }
      const isMarker = Boolean(dto.markerTime);
      if (isMarker) {
        if (!dto.chartContext) throw new BadRequestException('A marker needs a chartContext');
        if (dto.card !== 'graphs' || dto.parentId || dto.itemKey) {
          throw new BadRequestException('A marker is a root comment on the Graphs card');
        }
        // @IsISO8601 accepts forms Date cannot read (week dates such as 2026-W01): refuse them
        // here rather than let the INSERT fail with a 500 inside the request transaction.
        if (Number.isNaN(Date.parse(dto.markerTime!))) throw new BadRequestException('markerTime must be a readable timestamp');
      }
      const chartContext = dto.chartContext ? validateChartContext(dto.card, dto.parentId, dto.chartContext) : null;
      if (dto.parentId) {
        // Lock the parent so a concurrent hard delete cannot orphan the reply.
        const parents: { test_run_id: string; card_key: string; parent_id: string | null; deleted_at: Date | null }[] =
          await em.query(
            `SELECT test_run_id, card_key, parent_id, deleted_at FROM test_run_comments WHERE id = $1 FOR SHARE`,
            [dto.parentId],
          );
        const parent = parents[0];
        if (!parent || parent.test_run_id !== run.id || parent.card_key !== dto.card || parent.parent_id) {
          throw new BadRequestException('A reply must answer a root comment on the same run and card');
        }
        if (parent.deleted_at) throw new BadRequestException('Cannot reply to a deleted comment');
      }
      let markerSeq: number | null = null;
      if (isMarker) {
        // Serialize numbering per run instead of retrying on the unique index: a failed INSERT
        // would abort the request's RLS transaction. Never reused: marker roots are only ever
        // soft-deleted, so MAX never goes down (design: marker_seq assignment).
        await em.query(`SELECT pg_advisory_xact_lock(hashtextextended('test_run_comments:marker:' || $1, 0))`, [run.id]);
        const [next]: { seq: number }[] = await em.query(
          `SELECT COALESCE(MAX(marker_seq), 0) + 1 AS seq FROM test_run_comments WHERE test_run_id = $1`,
          [run.id],
        );
        markerSeq = Number(next!.seq);
      }
      const repo = em.getRepository(TestRunComment);
      return repo.save(
        repo.create({
          testRunId: run.id,
          cardKey: dto.card,
          parentId: dto.parentId ?? null,
          itemKey: dto.itemKey ?? null,
          itemLabel: dto.itemLabel ?? null,
          markerSeq,
          markerTime: isMarker ? new Date(dto.markerTime!) : null,
          chartContext,
          body: dto.body,
          authorId: caller.userId,
          authorName: (caller.displayName || caller.userId).slice(0, 255),
          organizationId: run.organizationId,
          teamId: run.teamId,
        }),
      );
    });
    const response = toResponse(saved);
    this.emit('comment:created', saved, response);
    return response;
  }

  // audit-skip: author-only text edit of their own comment; the row carries edited_at
  async update(id: string, body: string, caller: CommentCaller): Promise<CommentResponse> {
    const saved = await this.tx(async (em) => {
      const comment = await this.loadComment(id, caller, em, true);
      if (comment.deletedAt) throw new NotFoundException('Comment not found');
      if (comment.authorId !== caller.userId) throw new ForbiddenException('Only the author can edit a comment');
      comment.body = body;
      comment.editedAt = new Date();
      return em.getRepository(TestRunComment).save(comment);
    });
    const response = toResponse(saved);
    this.emit('comment:updated', saved, response);
    return response;
  }

  /**
   * Delete rule: a marker root or a root with replies is soft-deleted (body wiped, number and
   * thread kept); a plain root and any reply are hard-deleted.
   */
  async remove(id: string, caller: CommentCaller): Promise<void> {
    const outcome = await this.tx(async (em) => {
      const comment = await this.loadComment(id, caller, em, true);
      if (comment.deletedAt) throw new NotFoundException('Comment not found');
      const allowed =
        comment.authorId === caller.userId ||
        caller.orgIds === null ||
        (await this.authzService.isOrganizationAdmin(caller.userId, comment.organizationId));
      if (!allowed) throw new ForbiddenException('Only the author or an organization admin can delete a comment');

      const repo = em.getRepository(TestRunComment);
      this.auditService.logDelete(comment as unknown as OwnedResource, { organizationIdOverride: comment.organizationId });
      const hasReplies = !comment.parentId && (await repo.count({ where: { parentId: comment.id } })) > 0;
      if (comment.markerSeq !== null || hasReplies) {
        comment.deletedAt = new Date();
        comment.body = '';
        // The recorded view is the author's content too; the greyed pin needs only marker_seq/time.
        comment.chartContext = null;
        return { comment: await repo.save(comment), soft: true };
      }
      await repo.delete({ id: comment.id });
      return { comment, soft: false };
    });
    this.emit('comment:deleted', outcome.comment, {
      ...toResponse({ ...outcome.comment, deletedAt: outcome.comment.deletedAt ?? new Date() }),
      hardDeleted: !outcome.soft,
    });
  }

  // audit-skip: per-user read mark, not a resource change
  async markSeen(runIdOrTestRunId: string, card: string, caller: CommentCaller): Promise<void> {
    const run = await this.resolveRun(runIdOrTestRunId, caller);
    await this.em()
      .createQueryBuilder()
      .insert()
      .into(TestRunCommentRead)
      .values({ userId: caller.userId, testRunId: run.id, cardKey: card, lastSeenAt: () => 'now()', organizationId: run.organizationId })
      .orUpdate(['last_seen_at'], ['user_id', 'test_run_id', 'card_key'])
      .execute();
  }

  /**
   * Per-item thread counts for one card, so each row can show its own indicator without the
   * drawer open. `unread` follows the card's unread rule (others, not deleted, in the window,
   * newer than the caller's last look at the card).
   */
  async itemCounts(runIdOrTestRunId: string, card: string, caller: CommentCaller): Promise<Record<string, { threads: number; unread: number }>> {
    const run = await this.resolveRun(runIdOrTestRunId, caller);
    const rows: { item_key: string; threads: number; unread: number }[] = await this.em().query(
      `SELECT root.item_key,
              count(DISTINCT root.id)::int AS threads,
              count(c.id) FILTER (
                WHERE c.deleted_at IS NULL AND c.author_id <> $3
                  AND c.created_at > now() - make_interval(days => ${COMMENT_UNREAD_WINDOW_DAYS})
                  AND c.created_at > COALESCE(r.last_seen_at, '-infinity'::timestamptz)
              )::int AS unread
         FROM test_run_comments root
         JOIN test_run_comments c ON c.id = root.id OR c.parent_id = root.id
         LEFT JOIN test_run_comment_reads r
           ON r.user_id = $3 AND r.test_run_id = root.test_run_id AND r.card_key = root.card_key
        WHERE root.test_run_id = $1 AND root.card_key = $2 AND root.parent_id IS NULL AND root.item_key IS NOT NULL
        GROUP BY root.item_key`,
      [run.id, card, caller.userId],
    );
    return Object.fromEntries(rows.map((r) => [r.item_key, { threads: r.threads, unread: r.unread }]));
  }

  /** Total and unread comments per card, for the card badges and the run header. */
  async counts(runIdOrTestRunId: string, caller: CommentCaller): Promise<Record<string, CommentCounts>> {
    const run = await this.resolveRun(runIdOrTestRunId, caller);
    return commentCountsByCard(this.em(), run.id, caller.userId);
  }

  private emit(type: 'comment:created' | 'comment:updated' | 'comment:deleted', row: TestRunComment, payload: object): void {
    try {
      this.gateway.emitCommentEvent(type, row, payload);
    } catch (err) {
      // A realtime failure must never fail the write the user just made.
      const msg = err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Unknown error';
      this.logger.warn(`Failed to emit ${type} for comment ${row.id}: ${msg}`);
    }
  }
}

/**
 * Check a comment's recorded view against its card's shape and return what to store: the
 * validated, whitelisted fields plus `kind` (the card), stamped here rather than trusted from
 * the body. Only Graphs, Trends and Compare roots record a view.
 */
export function validateChartContext(card: string, parentId: string | undefined, raw: Record<string, unknown>): Record<string, unknown> {
  const cls = (CHART_CONTEXT_DTO_BY_CARD as Record<string, new () => object>)[card];
  if (!cls || parentId) throw new BadRequestException('Only a root comment on Graphs, Trends or Compare records a view');
  if (Buffer.byteLength(JSON.stringify(raw)) > CHART_CONTEXT_MAX_BYTES) throw new BadRequestException('chartContext is too large');
  const view = plainToInstance(cls, raw);
  const errors = validateSync(view, { whitelist: true });
  if (errors.length > 0) {
    const first = errors[0]!;
    throw new BadRequestException(`chartContext.${first.property}: ${Object.values(first.constraints ?? {})[0] ?? 'is invalid'}`);
  }
  // @IsISO8601 accepts forms Date cannot read (week dates such as 2026-W01): refuse them here
  // rather than let a replay fetch nothing. A window must also run forwards.
  for (const key of ['xRange', 'customRange'] as const) {
    const range = (view as Record<string, unknown>)[key] as [string, string] | undefined;
    if (!range) continue;
    const [from, to] = range.map((t) => Date.parse(t));
    if (Number.isNaN(from) || Number.isNaN(to)) throw new BadRequestException(`chartContext.${key} must be readable timestamps`);
    if (from! >= to!) throw new BadRequestException(`chartContext.${key} must run forwards`);
  }
  return { ...JSON.parse(JSON.stringify(view)), kind: card };
}

export function toResponse(row: TestRunComment): CommentResponse {
  const deleted = row.deletedAt !== null && row.deletedAt !== undefined;
  return {
    id: row.id,
    testRunId: row.testRunId,
    cardKey: row.cardKey,
    parentId: row.parentId ?? null,
    itemKey: row.itemKey ?? null,
    itemLabel: row.itemLabel ?? null,
    body: deleted ? null : row.body,
    deleted,
    authorId: row.authorId,
    authorName: row.authorName,
    markerSeq: row.markerSeq ?? null,
    markerTime: row.markerTime ? new Date(row.markerTime).toISOString() : null,
    chartContext: deleted ? null : (row.chartContext ?? null),
    createdAt: new Date(row.createdAt).toISOString(),
    editedAt: row.editedAt ? new Date(row.editedAt).toISOString() : null,
  };
}
