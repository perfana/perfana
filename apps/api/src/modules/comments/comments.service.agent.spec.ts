/**
 * Value: protects=the agent rules on create that no other unit covers — author_kind and the
 * signature come from the caller, never the body; an agent comment is stamped announced; a
 * repeated clientRef returns the first comment without a second insert; the per-run limits answer
 * 429 naming the limit; a person's clientRef is ignored; an anchor cannot be mixed with the raw
 * fields; fails_when=any of those moves to the request or is dropped; seam=mocked EntityManager
 * (no request EM, so tx() falls back to dataSource.transaction); no_claim=SQL against Postgres
 * (src/test/rls/agent-comments.spec.ts), the anchor resolvers (comment-anchor.resolver.spec.ts).
 */
import { BadRequestException, ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import { CommentsService, isClientRefConflict } from './comments.service';

const ORG = '11111111-1111-4111-8111-111111111111';
const RUN = '22222222-2222-4222-8222-222222222222';
const agent = { userId: 'api-key:k1', displayName: 'Claude analysis agent', orgIds: [ORG], authorKind: 'agent' as const };
const person = { userId: 'sub-1', displayName: 'Ada', orgIds: [ORG] };

function setup(opts: { existing?: Record<string, unknown> | null; count?: number } = {}) {
  const saved: Record<string, unknown>[] = [];
  const repo = {
    create: (v: Record<string, unknown>) => v,
    save: jest.fn(async (v: Record<string, unknown>) => {
      const row = { ...v, id: '33333333-3333-4333-8333-333333333333', deletedAt: null, editedAt: null, createdAt: new Date('2026-11-20T10:00:00Z') };
      saved.push(row);
      return row;
    }),
    findOne: jest.fn(async () => opts.existing ?? null),
  };
  const em = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('FROM test_runs tr')) return [{ id: RUN, organization_id: ORG, team_id: null, sut_team_id: null }];
      if (sql.includes('count(*)::int AS n')) return [{ n: opts.count ?? 0 }];
      return [];
    }),
    getRepository: () => repo,
  };
  const dataSource = { transaction: (fn: (e: typeof em) => unknown) => fn(em), manager: em };
  const gateway = { emitCommentEvent: jest.fn() };
  const service = new CommentsService(dataSource as never, {} as never, gateway as never, {} as never);
  return { service, repo, em, saved, gateway };
}

describe('CommentsService agent comments', () => {
  it('marks an agent comment as agent, signs it with the key, and stamps it announced', async () => {
    const { service, saved } = setup();
    // author fields in the body are not DTO fields; even if they arrive they are never read.
    const dto = { card: 'graphs', body: 'p95 doubles', authorKind: 'user', authorName: 'Ada', authorId: 'sub-9' } as never;
    const { comment, created } = await service.createOrReplay('run-1', dto, agent);
    expect(created).toBe(true);
    expect(saved[0]).toMatchObject({ authorKind: 'agent', authorId: 'api-key:k1', authorName: 'Claude analysis agent' });
    expect(saved[0]!.notifiedAt).toBeInstanceOf(Date);
    expect(comment.authorKind).toBe('agent');
  });

  it('leaves a person\'s comment unannounced and ignores a clientRef from them', async () => {
    const { service, saved, em } = setup();
    await service.createOrReplay('run-1', { card: 'graphs', body: 'x', clientRef: 'r1' } as never, person);
    expect(saved[0]).toMatchObject({ authorKind: 'user', clientRef: null, notifiedAt: null });
    expect(em.query.mock.calls.some(([sql]) => String(sql).includes('test_run_comments:agent:'))).toBe(false);
  });

  it('returns the first comment for a repeated clientRef, without inserting or emitting', async () => {
    const first = {
      id: '44444444-4444-4444-8444-444444444444', testRunId: RUN, cardKey: 'graphs', parentId: null, body: 'first',
      authorId: 'api-key:k1', authorName: 'Claude analysis agent', authorKind: 'agent', tag: null,
      createdAt: new Date('2026-11-20T09:00:00Z'), deletedAt: null, editedAt: null,
    };
    const { service, repo, gateway } = setup({ existing: first });
    const { comment, created } = await service.createOrReplay('run-1', { card: 'graphs', body: 'retry', clientRef: 'r1' } as never, agent);
    expect(created).toBe(false);
    expect(comment.id).toBe(first.id);
    expect(comment.body).toBe('first');
    expect(repo.save).not.toHaveBeenCalled();
    expect(gateway.emitCommentEvent).not.toHaveBeenCalled();
  });

  it('wraps a clientRef insert in a savepoint', async () => {
    const { service, em } = setup();
    await service.createOrReplay('run-1', { card: 'graphs', body: 'x', clientRef: 'r2' } as never, agent);
    const sqls = em.query.mock.calls.map(([sql]) => String(sql));
    expect(sqls).toContain('SAVEPOINT comment_client_ref');
    expect(sqls).toContain('RELEASE SAVEPOINT comment_client_ref');
  });

  it.each([
    ['root', {}, 100, 'root comments'],
    ['reply', { parentId: '55555555-5555-4555-8555-555555555555' }, 200, 'replies'],
  ])('refuses the agent\'s next %s past the limit with a 429 naming it', async (_kind, extra, limit, word) => {
    const { service, repo } = setup({ count: limit });
    const err = await service.createOrReplay('run-1', { card: 'graphs', body: 'x', ...extra } as never, agent).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect((err as HttpException).message).toContain(`${limit} ${word}`);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('allows the 100th root (99 already written)', async () => {
    const { service, repo } = setup({ count: 99 });
    await service.createOrReplay('run-1', { card: 'graphs', body: 'x' } as never, agent);
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['itemKey', { itemKey: 'k', itemLabel: 'K' }],
    ['markerTime', { markerTime: '2026-11-20T10:00:00Z' }],
    ['chartContext', { chartContext: {} }],
    ['parentId', { parentId: '55555555-5555-4555-8555-555555555555' }],
  ])('refuses an anchor sent with %s', async (_f, extra) => {
    const { service, repo } = setup();
    await expect(
      service.createOrReplay('run-1', { body: 'x', anchor: { type: 'card', card: 'slo' }, ...extra } as never, agent),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('takes the card from a card anchor, and refuses a card that disagrees with the anchor', async () => {
    const { service, saved } = setup();
    await service.createOrReplay('run-1', { body: 'x', anchor: { type: 'card', card: 'slo' } } as never, agent);
    expect(saved[0]).toMatchObject({ cardKey: 'slo', itemKey: null });
    await expect(
      service.createOrReplay('run-1', { card: 'graphs', body: 'x', anchor: { type: 'transaction', name: 't' } } as never, agent),
    ).rejects.toThrow(/belongs to the performance card/);
  });

  /*
   * Value: protects=a clientRef insert that loses the unique-index race is answered with the row
   * that won (200, nothing emitted), and with a 409 when that row is not yet visible, never a 500
   * or a second comment; fails_when=the null-row branch after the transaction is dropped, emits, or
   * throws the raw 23505; why_new=agent-comments.spec.ts settles a real race only on the success arm
   * and cannot force the invisible-winner arm; seam=none; no_claim=Postgres index and lock behaviour
   * (mocked EntityManager; unit only).
   */
  it('answers a lost clientRef race with the winning comment, and a 409 while the winner is invisible', async () => {
    const winner = {
      id: '66666666-6666-4666-8666-666666666666', testRunId: RUN, cardKey: 'graphs', parentId: null, body: 'won',
      authorId: 'api-key:k1', authorName: 'Claude analysis agent', authorKind: 'agent', tag: null,
      createdAt: new Date('2026-11-20T09:00:00Z'), deletedAt: null, editedAt: null,
    };
    const conflict = Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'uq_test_run_comments_client_ref' });

    const won = setup();
    won.repo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(winner as never);
    won.repo.save.mockRejectedValueOnce(conflict);
    const replay = await won.service.createOrReplay('run-1', { card: 'graphs', body: 'race', clientRef: 'r3' } as never, agent);
    expect(replay).toMatchObject({ created: false, comment: { id: winner.id, body: 'won' } });
    expect(won.gateway.emitCommentEvent).not.toHaveBeenCalled();
    expect(won.em.query.mock.calls.map(([sql]) => String(sql))).toContain('ROLLBACK TO SAVEPOINT comment_client_ref');

    const invisible = setup();
    invisible.repo.findOne.mockResolvedValue(null);
    invisible.repo.save.mockRejectedValueOnce(conflict);
    const err = await invisible.service
      .createOrReplay('run-1', { card: 'graphs', body: 'race', clientRef: 'r3' } as never, agent)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(invisible.gateway.emitCommentEvent).not.toHaveBeenCalled();
  });

  /*
   * Value: protects=an insert failure that is not the idempotency conflict still fails the request
   * after rolling back to the savepoint; fails_when=the catch swallows every error as a replay;
   * why_new=no test drives a non-conflict save failure on the clientRef path; seam=none;
   * no_claim=which Postgres errors occur in practice (mocked EntityManager; unit only).
   */
  it('rethrows a non-conflict failure on a clientRef insert after rolling back to the savepoint', async () => {
    const { service, repo, em, gateway } = setup();
    repo.save.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: '23503' }));
    await expect(service.createOrReplay('run-1', { card: 'graphs', body: 'x', clientRef: 'r4' } as never, agent)).rejects.toThrow('boom');
    expect(em.query.mock.calls.map(([sql]) => String(sql))).toContain('ROLLBACK TO SAVEPOINT comment_client_ref');
    expect(gateway.emitCommentEvent).not.toHaveBeenCalled();
  });

  it('recognises only the idempotency index as a clientRef conflict', () => {
    expect(isClientRefConflict({ code: '23505', constraint: 'uq_test_run_comments_client_ref' })).toBe(true);
    expect(isClientRefConflict({ driverError: { code: '23505', constraint: 'uq_test_run_comments_client_ref' } })).toBe(true);
    expect(isClientRefConflict({ code: '23505', constraint: 'other' })).toBe(false);
  });
});
