/**
 * Value: protects=a comment write succeeds and is returned even when the realtime emit throws;
 * fails_when=CommentsService.emit's try/catch is removed or create() calls the gateway directly, so a
 * socket failure turns a committed comment into a 500 the author retries into a duplicate;
 * why_new=the live-DB spec (src/test/rls/test-run-comments.spec.ts) uses a gateway that never throws,
 * and the controller spec mocks the whole service; seam=none (constructor injection, no request EM in
 * a unit test so tx() falls back to dataSource.transaction); no_claim=SQL, tenant scoping, threading
 * rules (covered against Postgres by the RLS spec).
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CommentsService, toResponse } from './comments.service';

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

describe('CommentsService canModerate', () => {
  const ORG = '11111111-1111-4111-8111-111111111111';
  const RUN = '22222222-2222-4222-8222-222222222222';
  const setup = (isOrgAdmin: boolean) => {
    const repo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn().mockResolvedValue(null) };
    const em = { query: jest.fn().mockResolvedValue([{ id: RUN, organization_id: ORG, team_id: null }]), getRepository: () => repo };
    const dataSource = { transaction: (fn: (e: typeof em) => unknown) => fn(em), manager: em };
    const authz = { isOrganizationAdmin: jest.fn().mockResolvedValue(isOrgAdmin) };
    return { service: new CommentsService(dataSource as never, authz as never, {} as never, {} as never), authz };
  };

  it.each([
    ['an org admin', 'sub-1', [ORG], true, true],
    ['a member', 'sub-1', [ORG], false, false],
    ['a global admin', 'sub-1', null, false, true],
    ['an API key, even in an org it administers', 'api-key:1', [ORG], true, false],
  ])('is %s → %s', async (_who, userId, orgIds, isOrgAdmin, expected) => {
    const { service } = setup(isOrgAdmin as boolean);
    const res = await service.listThreads(RUN, 'graphs', { userId: userId as string, orgIds: orgIds as string[] | null });
    expect(res.canModerate).toBe(expected);
  });
});

// Value: protects=a Configuration view is stored only on a root comment anchored to a config item,
// with `kind: 'config'` stamped by the server; a reply, a card-level comment and an oversized value
// are 400 before any row is written; fails_when=`config` leaves CHART_CONTEXT_DTO_BY_CARD, the value
// cap or the item guard is dropped, or kind is trusted from the body; why_new=PR1 of
// test-run-analysis-stories.md adds the config view; seam=none (same mocked EM as above);
// no_claim=the reply's parent lookup (covered against Postgres by the RLS spec).
describe('CommentsService Configuration view', () => {
  const ORG = '11111111-1111-4111-8111-111111111111';
  const RUN = '22222222-2222-4222-8222-222222222222';
  const PARENT = '44444444-4444-4444-8444-444444444444';
  const view = { comparedToTestRunId: 'App-00006', status: 'changed', currentValue: '512m', previousValue: '2g' };

  const setup = () => {
    const repo = {
      create: (v: Record<string, unknown>) => v,
      save: jest.fn(async (v: Record<string, unknown>) => ({
        ...v,
        id: '33333333-3333-4333-8333-333333333333',
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
    const service = new CommentsService(dataSource as never, {} as never, { emitCommentEvent: jest.fn() } as never, {} as never);
    return { service, repo };
  };
  const caller = { userId: 'sub-1', displayName: 'Ada', orgIds: [ORG] };

  it('stores the view on a config item root, stamped with kind config', async () => {
    const { service, repo } = setup();
    const res = await service.create(
      'run-1',
      { card: 'config', body: 'heap shrank', itemKey: 'config:heap.max', itemLabel: 'heap.max', chartContext: { ...view, kind: 'graphs' } } as never,
      caller,
    );
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(res.chartContext).toEqual({ ...view, kind: 'config' });
  });

  it('refuses a view on a reply', async () => {
    const { service, repo } = setup();
    await expect(
      service.create('run-1', { card: 'config', body: 'b', parentId: PARENT, chartContext: view } as never, caller),
    ).rejects.toThrow(/root comment/);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('refuses a view on a card-level config comment', async () => {
    const { service, repo } = setup();
    await expect(service.create('run-1', { card: 'config', body: 'b', chartContext: view } as never, caller)).rejects.toThrow(
      'configuration item',
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('refuses a value over 2,000 characters', async () => {
    const { service, repo } = setup();
    await expect(
      service.create(
        'run-1',
        { card: 'config', body: 'b', itemKey: 'config:k', itemLabel: 'k', chartContext: { ...view, currentValue: 'x'.repeat(2001) } } as never,
        caller,
      ),
    ).rejects.toThrow(/chartContext\.currentValue/);
    expect(repo.save).not.toHaveBeenCalled();
  });
});

// Value: protects=the tag rules of the tags design without a database: a reply never takes a tag,
// PATCH stays author-only for the tag too, a tag-only change leaves editedAt alone, an empty PATCH is
// a 400, and the deleted shape keeps the tag; fails_when=the reply guard, the author check or the
// editedAt guard is dropped from update(), or toResponse redacts the tag with the body;
// why_new=the RLS spec proves the same against Postgres but needs one; seam=none (mocked EM, as
// above); no_claim=the CHECK constraints (RLS spec and the 1829 migration spec).
describe('CommentsService tags', () => {
  const ORG = '11111111-1111-4111-8111-111111111111';
  const RUN = '22222222-2222-4222-8222-222222222222';
  const ID = '33333333-3333-4333-8333-333333333333';
  const anna = { userId: 'sub-anna', displayName: 'Anna', orgIds: [ORG] };
  const mark = { userId: 'sub-mark', displayName: 'Mark', orgIds: [ORG] };

  const setup = (stored: Record<string, unknown> = {}) => {
    const row = {
      id: ID, testRunId: RUN, cardKey: 'graphs', parentId: null, body: 'p95 jumps', authorId: anna.userId, authorName: 'Anna',
      itemKey: null, itemLabel: null, markerSeq: null, markerTime: null, chartContext: null, tag: null,
      organizationId: ORG, teamId: null, createdAt: new Date('2026-11-20T10:00:00Z'), editedAt: null, deletedAt: null,
      ...stored,
    };
    const repo = {
      create: (v: Record<string, unknown>) => v,
      save: jest.fn(async (v: Record<string, unknown>) => ({ ...row, ...v, id: v.id ?? ID, createdAt: row.createdAt })),
      findOne: jest.fn().mockResolvedValue(row),
    };
    const em = {
      query: jest.fn(async (sql: string) =>
        String(sql).includes('FOR SHARE')
          ? [{ test_run_id: RUN, card_key: 'graphs', parent_id: null, deleted_at: null }]
          : [{ id: RUN, organization_id: ORG, team_id: null }],
      ),
      getRepository: () => repo,
    };
    const dataSource = { transaction: (fn: (e: typeof em) => unknown) => fn(em), manager: em };
    const service = new CommentsService(dataSource as never, {} as never, { emitCommentEvent: jest.fn() } as never, {} as never);
    return { service, repo, row };
  };

  it('stores and returns a root tag on create', async () => {
    const { service, repo } = setup();
    const res = await service.create(RUN, { card: 'graphs', body: 'p95 jumps', tag: 'symptom' }, anna);
    expect(repo.save.mock.calls[0][0]).toMatchObject({ tag: 'symptom' });
    expect(res.tag).toBe('symptom');
  });

  it('stores null when no tag is sent', async () => {
    const { service, repo } = setup();
    expect((await service.create(RUN, { card: 'graphs', body: 'x' }, anna)).tag).toBeNull();
    expect(repo.save.mock.calls[0][0]).toMatchObject({ tag: null });
  });

  it('refuses a tag on a reply with 400 before saving', async () => {
    const { service, repo } = setup();
    await expect(service.create(RUN, { card: 'graphs', body: 'no', parentId: ID, tag: 'ruled-out' }, anna)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('refuses retagging a reply with 400', async () => {
    const { service, repo } = setup({ parentId: '44444444-4444-4444-8444-444444444444' });
    await expect(service.update(ID, { tag: 'evidence' }, anna)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('refuses a tag change by anyone but the author with 403', async () => {
    const { service, repo } = setup();
    await expect(service.update(ID, { tag: 'root-cause' }, mark)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('changes only the tag on a tag-only PATCH, leaving body and editedAt', async () => {
    const { service } = setup({ tag: 'hypothesis' });
    expect(await service.update(ID, { tag: 'root-cause' }, anna)).toMatchObject({ tag: 'root-cause', body: 'p95 jumps', editedAt: null });
  });

  it('does not mark an unchanged body sent beside a tag as edited', async () => {
    const { service } = setup();
    expect(await service.update(ID, { body: 'p95 jumps', tag: 'evidence' }, anna)).toMatchObject({ tag: 'evidence', editedAt: null });
  });

  it('clears the tag on tag: null', async () => {
    const { service } = setup({ tag: 'hypothesis' });
    expect((await service.update(ID, { tag: null }, anna)).tag).toBeNull();
  });

  it('marks a text change as edited and keeps the tag when none is sent', async () => {
    const { service } = setup({ tag: 'evidence' });
    const res = await service.update(ID, { body: 'p95 doubles' }, anna);
    expect(res).toMatchObject({ body: 'p95 doubles', tag: 'evidence' });
    expect(res.editedAt).not.toBeNull();
  });

  it('refuses an empty PATCH with 400', async () => {
    const { service, repo } = setup();
    await expect(service.update(ID, {}, anna)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.findOne).not.toHaveBeenCalled();
  });

  it('keeps the tag in the redacted shape of a deleted comment', () => {
    const { row } = setup({ tag: 'root-cause', deletedAt: new Date(), body: '' });
    expect(toResponse(row as never)).toMatchObject({ deleted: true, body: null, chartContext: null, tag: 'root-cause' });
  });
});
