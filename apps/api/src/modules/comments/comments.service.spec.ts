/**
 * Value: protects=a comment write succeeds and is returned even when the realtime emit throws;
 * fails_when=CommentsService.emit's try/catch is removed or create() calls the gateway directly, so a
 * socket failure turns a committed comment into a 500 the author retries into a duplicate;
 * why_new=the live-DB spec (src/test/rls/test-run-comments.spec.ts) uses a gateway that never throws,
 * and the controller spec mocks the whole service; seam=none (constructor injection, no request EM in
 * a unit test so tx() falls back to dataSource.transaction); no_claim=SQL, tenant scoping, threading
 * rules (covered against Postgres by the RLS spec).
 */
import { CommentsService } from './comments.service';

describe('CommentsService realtime failure', () => {
  const ORG = '11111111-1111-4111-8111-111111111111';
  const RUN = '22222222-2222-4222-8222-222222222222';

  const repo = {
    create: (v: Record<string, unknown>) => v,
    save: jest.fn(async (v: Record<string, unknown>) => ({
      ...v,
      id: '33333333-3333-4333-8333-333333333333',
      markerSeq: null,
      markerTime: null,
      chartContext: null,
      deletedAt: null,
      editedAt: null,
      createdAt: new Date('2026-11-20T10:00:00Z'),
    })),
  };
  const em = {
    query: jest.fn().mockResolvedValue([{ id: RUN, organization_id: ORG, team_id: null }]),
    getRepository: () => repo,
  };
  const dataSource = { transaction: (fn: (e: typeof em) => unknown) => fn(em), manager: em };
  const gateway = { emitCommentEvent: jest.fn(() => { throw new Error('socket server gone'); }) };

  it('returns the saved comment when emitting it fails', async () => {
    const service = new CommentsService(dataSource as never, {} as never, gateway as never, {} as never);

    const result = await service.create(
      'orders-run-0001',
      { card: 'graphs', body: 'latency doubles at 10:42' },
      { userId: 'sub-1', displayName: 'Ada', orgIds: [ORG] },
    );

    expect(gateway.emitCommentEvent).toHaveBeenCalledTimes(1);
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ testRunId: RUN, cardKey: 'graphs', body: 'latency doubles at 10:42', authorName: 'Ada', deleted: false });
  });
});
