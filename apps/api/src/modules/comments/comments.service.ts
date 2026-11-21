import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
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
  type UpdateCommentDto,
} from './dto/comment.dto';
import { commentCountsByCard, type CommentCounts } from './comment-unread.sql';
import {
  AGENT_COMMENT_LIMITS,
  COMMENT_ITEM_KEY_MAX_LENGTH,
  COMMENT_UNREAD_WINDOW_DAYS,
  type CommentAuthorKind,
} from '@perfana/shared/constants/comment-cards';
import { anchorCard, loadAnchorRun, parseAnchor, resolveAnchor } from './comment-anchor.resolver';

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
  /** `agent` for an API key with the comments:write role; absent means a person. */
  authorKind?: CommentAuthorKind;
}

/** A unique violation on the agent idempotency index. */
export function isClientRefConflict(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string; driverError?: { code?: string; constraint?: string } } | null;
  const code = e?.code ?? e?.driverError?.code;
  const constraint = e?.constraint ?? e?.driverError?.constraint;
  return code === '23505' && constraint === 'uq_test_run_comments_client_ref';
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
   * `canModerate`: the caller may delete other people's comments on this run (the same rule as
   * `remove`), so the drawer can offer Delete on them. API keys never may: they cannot write.
   */
  async listThreads(
    runIdOrTestRunId: string,
    card: string | undefined,
    caller: CommentCaller,
  ): Promise<{ threads: CommentThreadResponse[]; lastSeenAt: string | null; canModerate: boolean }> {
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
    const canModerate =
      !caller.userId.startsWith('api-key:') &&
      (caller.orgIds === null || (await this.authzService.isOrganizationAdmin(caller.userId, run.organizationId)));
    return { threads: [...threads.values()], lastSeenAt: read ? new Date(read.lastSeenAt).toISOString() : null, canModerate };
  }

  // audit-skip: user discussion, not configuration; the row records its author and time itself
  async create(runIdOrTestRunId: string, dto: CreateCommentDto, caller: CommentCaller): Promise<CommentResponse> {
    return (await this.createOrReplay(runIdOrTestRunId, dto, caller)).comment;
  }

  /**
   * Create a comment, or for an agent repeating a `clientRef` return the comment it already
   * wrote (`created: false`, answered 200 rather than 201, nothing emitted). An agent's comment
   * is stamped `author_kind = 'agent'` and `notified_at = now()`, so the channel sweep never
   * announces it, and is capped per key per run (AGENT_COMMENT_LIMITS).
   */
  async createOrReplay(
    runIdOrTestRunId: string,
    rawDto: CreateCommentDto,
    caller: CommentCaller,
  ): Promise<{ comment: CommentResponse; created: boolean }> {
    const isAgent = caller.authorKind === 'agent';
    // Users never send a clientRef; one is ignored rather than refused, so a field a person's
    // client cannot produce changes nothing for them.
    const clientRef = isAgent ? (rawDto.clientRef ?? null) : null;
    const outcome = await this.tx(async (em) => {
      const run = await this.resolveRun(runIdOrTestRunId, caller, em);
      const dto = await this.applyAnchor(em, run.id, rawDto);
      if (isAgent) {
        // One writer per (run, key) at a time: the replay check, the limit count and the insert
        // below cannot interleave with a retry of the same request.
        await em.query(`SELECT pg_advisory_xact_lock(hashtextextended('test_run_comments:agent:' || $1 || ':' || $2, 0))`, [
          run.id,
          caller.userId,
        ]);
        if (clientRef) {
          const existing = await em.getRepository(TestRunComment).findOne({ where: { testRunId: run.id, authorId: caller.userId, clientRef } });
          if (existing) return { row: existing, created: false };
        }
        const isReply = Boolean(dto.parentId);
        const counted: { n: number }[] = await em.query(
          `SELECT count(*)::int AS n FROM test_run_comments
            WHERE test_run_id = $1 AND author_id = $2 AND parent_id IS ${isReply ? 'NOT ' : ''}NULL`,
          [run.id, caller.userId],
        );
        const limit = isReply ? AGENT_COMMENT_LIMITS.replies : AGENT_COMMENT_LIMITS.roots;
        if (Number(counted[0]?.n ?? 0) >= limit) {
          throw new HttpException(
            `This API key has reached its limit of ${limit} ${isReply ? 'replies' : 'root comments'} on this test run`,
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
      }
      const row = await this.insertComment(em, run, dto, caller, clientRef);
      return { row, created: row !== null };
    });
    if (outcome.created === false && outcome.row === null) {
      // Lost a unique-index race on client_ref (insertComment rolled back to its savepoint).
      const run = await this.resolveRun(runIdOrTestRunId, caller);
      const existing = await this.em().getRepository(TestRunComment).findOne({ where: { testRunId: run.id, authorId: caller.userId, clientRef: clientRef! } });
      if (!existing) throw new ConflictException('A comment with this clientRef is being written; retry');
      return { comment: toResponse(existing), created: false };
    }
    const response = toResponse(outcome.row!);
    if (outcome.created) this.emit('comment:created', outcome.row!, response);
    return { comment: response, created: outcome.created };
  }

  /**
   * A reply addressed by its root's id: the run and card come from the root, which must be one
   * the caller can read (else 404). The usual reply rules then apply in createOrReplay.
   */
  async replyTo(
    rootId: string,
    dto: { body: string; clientRef?: string },
    caller: CommentCaller,
  ): Promise<{ comment: CommentResponse; created: boolean }> {
    const root = await this.loadComment(rootId, caller);
    if (root.parentId) throw new BadRequestException('Reply to the root comment; threads are one level deep');
    return this.createOrReplay(
      root.testRunId,
      { card: root.cardKey as CreateCommentDto['card'], parentId: root.id, body: dto.body, clientRef: dto.clientRef },
      caller,
    );
  }

  /**
   * Resolve `anchor` into the fields a web client would have sent, after checking it is used
   * alone. Without an anchor the DTO is returned as it came, with its card required.
   */
  private async applyAnchor(em: EntityManager, runUuid: string, dto: CreateCommentDto): Promise<CreateCommentDto> {
    if (!dto.anchor) {
      if (!dto.card) throw new BadRequestException('card is required without an anchor');
      return dto;
    }
    if (dto.parentId) throw new BadRequestException('A reply takes its anchor from the root; send anchor only on a root comment');
    if (dto.itemKey !== undefined || dto.itemLabel !== undefined || dto.markerTime !== undefined || dto.chartContext !== undefined) {
      throw new BadRequestException('anchor replaces itemKey, itemLabel, markerTime and chartContext; send one or the other');
    }
    const anchor = parseAnchor(dto.anchor);
    const card = anchorCard(anchor);
    if (dto.card && dto.card !== card) throw new BadRequestException(`anchor.type ${anchor.type} belongs to the ${card} card, not ${dto.card}`);
    const resolved =
      anchor.type === 'card'
        ? { card, itemKey: null, itemLabel: null, markerTime: null, chartContext: null }
        : await resolveAnchor(em, await loadAnchorRun(em, runUuid), anchor);
    if (resolved.itemKey && Array.from(resolved.itemKey).length > COMMENT_ITEM_KEY_MAX_LENGTH) {
      throw new BadRequestException('The anchored item\'s name is too long to anchor a comment');
    }
    return {
      ...dto,
      card: resolved.card,
      itemKey: resolved.itemKey ?? undefined,
      itemLabel: resolved.itemLabel ?? undefined,
      markerTime: resolved.markerTime ?? undefined,
      chartContext: resolved.chartContext ?? undefined,
    };
  }

  /**
   * Validate and insert one comment. Returns null only when an agent's insert lost the
   * `uq_test_run_comments_client_ref` race, rolled back to a savepoint so the request's
   * transaction survives (a failed INSERT would otherwise abort it, 25P02).
   */
  // audit-skip: user or agent discussion, not configuration; the row records its author, kind and time itself
  private async insertComment(
    em: EntityManager,
    run: RunOwner,
    dto: CreateCommentDto,
    caller: CommentCaller,
    clientRef: string | null,
  ): Promise<TestRunComment | null> {
      if (dto.parentId && dto.itemKey) {
        throw new BadRequestException('A reply takes its anchor from the root; send itemKey only on a root comment');
      }
      if (dto.parentId && dto.tag) {
        throw new BadRequestException('Only a root comment takes a tag; a reply discusses its root');
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
      if (dto.card === 'config' && dto.chartContext && !dto.parentId && !dto.itemKey) {
        // A Configuration view is one item's comparison; a card-level comment has none to record.
        throw new BadRequestException('A Configuration view belongs to a comment on a configuration item');
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
      const isAgent = caller.authorKind === 'agent';
      const row = repo.create({
        testRunId: run.id,
        cardKey: dto.card,
        parentId: dto.parentId ?? null,
        itemKey: dto.itemKey ?? null,
        itemLabel: dto.itemLabel ?? null,
        markerSeq,
        markerTime: isMarker ? new Date(dto.markerTime!) : null,
        chartContext,
        tag: dto.tag ?? null,
        body: dto.body,
        authorId: caller.userId,
        // Server-set from the principal, never from the request: an agent is named by its key.
        authorName: (caller.displayName || caller.userId).slice(0, 255),
        authorKind: isAgent ? 'agent' : 'user',
        clientRef,
        // No per-comment channel post for an agent (design: "Retries, limits and notifications").
        notifiedAt: isAgent ? new Date() : null,
        organizationId: run.organizationId,
        teamId: run.teamId,
      });
      if (!clientRef) return repo.save(row);
      // The advisory lock in createOrReplay makes this unreachable through this service; the
      // savepoint still keeps a unique violation from aborting the request's transaction.
      await em.query('SAVEPOINT comment_client_ref');
      try {
        const saved = await repo.save(row);
        await em.query('RELEASE SAVEPOINT comment_client_ref');
        return saved;
      } catch (err) {
        await em.query('ROLLBACK TO SAVEPOINT comment_client_ref');
        if (isClientRefConflict(err)) return null;
        throw err;
      }
  }

  /**
   * Author-only edit of the text and/or the tag (design R5; tags design). An absent field is left
   * alone and `tag: null` clears the tag. Only a text change sets `editedAt`: "(edited)" is about
   * the text, so retagging a comment does not mark it edited.
   */
  // audit-skip: author-only edit of their own comment; the row carries edited_at
  async update(id: string, dto: UpdateCommentDto, caller: CommentCaller): Promise<CommentResponse> {
    if (dto.body === undefined && dto.tag === undefined) throw new BadRequestException('Send body, tag or both');
    const saved = await this.tx(async (em) => {
      const comment = await this.loadComment(id, caller, em, true);
      if (comment.deletedAt) throw new NotFoundException('Comment not found');
      if (comment.authorId !== caller.userId) throw new ForbiddenException('Only the author can edit a comment');
      if (dto.tag && comment.parentId) {
        throw new BadRequestException('Only a root comment takes a tag; a reply discusses its root');
      }
      if (dto.body !== undefined && dto.body !== comment.body) {
        comment.body = dto.body;
        comment.editedAt = new Date();
      }
      if (dto.tag !== undefined) comment.tag = dto.tag;
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
 * the body. Only Graphs, Trends and Compare roots, and Configuration item roots, record a view.
 */
export function validateChartContext(card: string, parentId: string | undefined, raw: Record<string, unknown>): Record<string, unknown> {
  const cls = (CHART_CONTEXT_DTO_BY_CARD as Record<string, new () => object>)[card];
  if (!cls || parentId) throw new BadRequestException('Only a root comment on Graphs, Trends, Compare or a Configuration item records a view');
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
    authorKind: row.authorKind === 'agent' ? 'agent' : 'user',
    markerSeq: row.markerSeq ?? null,
    markerTime: row.markerTime ? new Date(row.markerTime).toISOString() : null,
    chartContext: deleted ? null : (row.chartContext ?? null),
    // Kept on a deleted comment: a story step still reads "Root cause · comment deleted".
    tag: row.tag ?? null,
    createdAt: new Date(row.createdAt).toISOString(),
    editedAt: row.editedAt ? new Date(row.editedAt).toISOString() : null,
  };
}
