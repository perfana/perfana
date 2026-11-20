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

// Value: protects=a marker that breaks the shape rules is refused before a number is taken or a row
// written (oversized chartContext, an item anchor on a marker); fails_when=the CHART_CONTEXT_MAX_BYTES
// check is dropped or moved after the INSERT, or the itemKey arm leaves the marker guard;
// why_new=the RLS spec covers off-card, reply and half-field markers only; seam=none (same mocked EM
// as above); no_claim=class-validator's DTO rules (comment.dto.spec.ts), the advisory lock under load.
describe('CommentsService marker validation', () => {
  const ORG = '11111111-1111-4111-8111-111111111111';
  const RUN = '22222222-2222-4222-8222-222222222222';
  const series = [{ dashboardId: 'd1', dashboardLabel: 'JVM', panelId: 3, panelTitle: 'Heap', metricName: 'used', source: 'grafana' }];

  const setup = () => {
    const repo = { create: (v: Record<string, unknown>) => v, save: jest.fn() };
    const em = {
      query: jest.fn().mockResolvedValue([{ id: RUN, organization_id: ORG, team_id: null }]),
      getRepository: () => repo,
    };
    const dataSource = { transaction: (fn: (e: typeof em) => unknown) => fn(em), manager: em };
    const service = new CommentsService(dataSource as never, {} as never, { emitCommentEvent: jest.fn() } as never, {} as never);
    return { service, repo, em };
  };
  const caller = { userId: 'sub-1', displayName: 'Ada', orgIds: [ORG] };

  it('refuses a chartContext over the byte cap without numbering or saving it', async () => {
    const { service, repo, em } = setup();
    const huge = { series, title: 'x'.repeat(70 * 1024) };
    await expect(
      service.create('run-1', { card: 'graphs', body: 'b', markerTime: '2026-11-20T10:00:00Z', chartContext: huge } as never, caller),
    ).rejects.toThrow('chartContext is too large');
    expect(repo.save).not.toHaveBeenCalled();
    expect(em.query.mock.calls.some(([sql]) => String(sql).includes('marker_seq') || String(sql).includes('advisory'))).toBe(false);
  });

  it('refuses a marker that also carries a row anchor', async () => {
    const { service, repo } = setup();
    await expect(
      service.create(
        'run-1',
        { card: 'graphs', body: 'b', itemKey: 'k', itemLabel: 'K', markerTime: '2026-11-20T10:00:00Z', chartContext: { series } } as never,
        caller,
      ),
    ).rejects.toThrow('A marker is a root comment on the Graphs card');
    expect(repo.save).not.toHaveBeenCalled();
  });

  // Value: protects=a timestamp @IsISO8601 accepts but Date cannot read is a 400, not a failed INSERT
  // (500, aborted request transaction); a backwards xRange is refused; fails_when=the Date.parse or
  // order check is removed; why_new=the DTO spec only covers what class-validator rejects; seam=none;
  // no_claim=Postgres timestamp parsing (repo mocked).
  it.each([
    ['a week date', { markerTime: '2026-W01', xRange: undefined }, 'readable timestamp'],
    ['a backwards range', { markerTime: '2026-11-20T10:00:00Z', xRange: ['2026-11-20T11:00:00Z', '2026-11-20T10:00:00Z'] }, 'run forwards'],
  ])('refuses %s', async (_label, { markerTime, xRange }, message) => {
    const { service, repo } = setup();
    await expect(
      service.create('run-1', { card: 'graphs', body: 'b', markerTime, chartContext: { series, xRange } } as never, caller),
    ).rejects.toThrow(message);
    expect(repo.save).not.toHaveBeenCalled();
  });
});
