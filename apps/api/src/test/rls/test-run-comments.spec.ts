/**
 * Test-run comments (migration 1827, packages/shared/src/database/migrations/1827000000000-TestRunComments.ts;
 * CommentsService) against a real Postgres.
 *
 * Mocks cannot see what matters here: the body CHECK that encodes the delete rule, the
 * parent FK and its row lock, the unread SQL's window and missing-read-row behaviour, and the
 * tenant boundary on by-id routes. Runs as the owner role against the local dev DB, like its
 * sibling suites; everything it writes is deleted in afterAll.
 */
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { AppDataSource } from '../../data-source';
import * as Entities from '../../entities';
import { CommentsService, CommentCaller } from '../../modules/comments/comments.service';
import { commentCountsByCard, commentCountsByRun } from '../../modules/comments/comment-unread.sql';

const entityClasses = Object.values(Entities).filter(
  (v): v is new () => unknown => typeof v === 'function',
);

describe('CommentsService against a real database', () => {
  const ds = new DataSource({
    ...(AppDataSource.options as Record<string, unknown>),
    entities: entityClasses,
    migrations: [],
  } as never);

  const suffix = randomUUID().slice(0, 8);
  const orgA = randomUUID();
  const orgB = randomUUID();
  const sutA = randomUUID();
  const runHuman = `comments-spec-run-${suffix}`;
  let runUuid = '';

  const emitted: { type: string; owner: { organizationId?: string | null }; payload: Record<string, unknown> }[] = [];
  const gateway = {
    emitCommentEvent: (type: string, owner: { organizationId?: string | null }, payload: Record<string, unknown>) =>
      emitted.push({ type, owner, payload }),
  };
  const isOrgAdmin = jest.fn().mockResolvedValue(false);
  // The system belongs to a team that admits every org-A member here except Tom.
  const canViewTeamResources = jest.fn(async (userId: string) => ({ allowed: userId !== 'comments-spec-tom' }));
  let service: CommentsService;

  const anna: CommentCaller = { userId: 'comments-spec-anna', displayName: 'Anna', orgIds: [orgA] };
  const mark: CommentCaller = { userId: 'comments-spec-mark', displayName: 'Mark', orgIds: [orgA] };
  const outsider: CommentCaller = { userId: 'comments-spec-eve', displayName: 'Eve', orgIds: [orgB] };
  const tom: CommentCaller = { userId: 'comments-spec-tom', displayName: 'Tom', orgIds: [orgA] };
  const teamA = randomUUID();

  beforeAll(async () => {
    await ds.initialize();
    service = new CommentsService(ds, { isOrganizationAdmin: isOrgAdmin, canViewTeamResources } as never, gateway as never, { logDelete: jest.fn() } as never);
    for (const org of [orgA, orgB]) {
      await ds.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [org, `comments-spec-${org.slice(0, 8)}`]);
    }
    await ds.query(
      `INSERT INTO teams (id, organization_id, name, restrict_to_team_members) VALUES ($1, $2, $3, true)`,
      [teamA, orgA, `comments-spec-team-${suffix}`],
    );
    await ds.query(
      `INSERT INTO systems_under_test (id, organization_id, team_id, name, description) VALUES ($1, $2, $3, $4, 'comments spec')`,
      [sutA, orgA, teamA, `comments-spec-sut-${suffix}`],
    );
    const rows = await ds.query(
      `INSERT INTO test_runs (test_run_id, system_under_test_id, test_environment, workload, organization_id, start_time, end_time)
       VALUES ($1, $2, 'acc', 'load', $3, now(), now()) RETURNING id`,
      [runHuman, sutA, orgA],
    );
    runUuid = rows[0].id;
  });

  afterAll(async () => {
    // A worker on the same database can register collection for this throwaway run mid-test; its
    // rows hold a NO ACTION foreign key and would block the run's delete.
    await ds.query(`DELETE FROM ds_metric_collection_status WHERE test_run_id IN (SELECT test_run_id FROM test_runs WHERE id = $1)`, [runUuid]);
    await ds.query(`DELETE FROM test_runs WHERE id = $1`, [runUuid]); // cascades comments and reads
    await ds.query(`DELETE FROM systems_under_test WHERE id = $1`, [sutA]);
    await ds.query(`DELETE FROM teams WHERE id = $1`, [teamA]);
    await ds.query(`DELETE FROM organizations WHERE id = ANY($1)`, [[orgA, orgB]]);
    await ds.destroy();
  });

  it('creates a root by human run id, stamps the author name and the run org, and emits with that org', async () => {
    const c = await service.create(runHuman, { card: 'graphs', body: 'p95 jumps here' }, anna);
    expect(c).toMatchObject({ testRunId: runUuid, cardKey: 'graphs', authorName: 'Anna', deleted: false, parentId: null });
    expect(emitted.at(-1)).toMatchObject({ type: 'comment:created', owner: { organizationId: orgA } });
  });

  it('answers 404 to another organization on every route, by run and by comment id', async () => {
    const c = await service.create(runUuid, { card: 'slo', body: 'secret' }, anna);
    await expect(service.listThreads(runUuid, undefined, outsider)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.create(runUuid, { card: 'slo', body: 'x' }, outsider)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.counts(runUuid, outsider)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.markSeen(runUuid, 'slo', outsider)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update(c.id, { body: 'x' }, { ...outsider, userId: anna.userId })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(c.id, outsider)).rejects.toBeInstanceOf(NotFoundException);
  });

  // Value: protects=comments following the team restriction a run read enforces (denialReason);
  // fails_when=resolveRun checks the organization alone again; why_new=the org case above cannot see a
  // team rule; seam=none; no_claim=canViewTeamResources' own membership rules (stubbed)
  it('answers 404 to an org member the run\'s team does not admit, by run and by comment id', async () => {
    const c = await service.create(runUuid, { card: 'graphs', body: 'team only' }, anna);
    await expect(service.listThreads(runUuid, undefined, tom)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.create(runHuman, { card: 'slo', body: 'x' }, tom)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.counts(runUuid, tom)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.itemCounts(runUuid, 'graphs', tom)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.markSeen(runUuid, 'slo', tom)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update(c.id, { body: 'x' }, { ...tom, userId: 'comments-spec-tom' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(c.id, tom)).rejects.toBeInstanceOf(NotFoundException);
    expect(canViewTeamResources).toHaveBeenCalledWith('comments-spec-tom', teamA);
  });

  it('threads replies under their root and refuses a reply to a reply or across cards', async () => {
    const root = await service.create(runUuid, { card: 'compare', body: 'is login slower?' }, mark);
    const reply = await service.create(runUuid, { card: 'compare', body: 'yes', parentId: root.id }, anna);
    await expect(service.create(runUuid, { card: 'compare', body: 'no', parentId: reply.id }, mark))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(runUuid, { card: 'graphs', body: 'no', parentId: root.id }, mark))
      .rejects.toBeInstanceOf(BadRequestException);

    const { threads, lastSeenAt } = await service.listThreads(runUuid, 'compare', anna);
    expect(lastSeenAt).toBeNull();
    expect(threads).toHaveLength(1);
    expect(threads[0].replies.map((r) => r.body)).toEqual(['yes']);
  });

  it('lets only the author edit, and marks the edit', async () => {
    const c = await service.create(runUuid, { card: 'trends', body: 'typo' }, anna);
    await expect(service.update(c.id, { body: 'hijack' }, mark)).rejects.toBeInstanceOf(ForbiddenException);
    const edited = await service.update(c.id, { body: 'fixed' }, anna);
    expect(edited).toMatchObject({ body: 'fixed' });
    expect(edited.editedAt).not.toBeNull();
  });

  // Tags design (migration 1829): the service rules and the CHECKs, against the real schema.
  it('tags a root, lets only its author retag or clear it, and never marks a retag as an edit', async () => {
    const c = await service.create(runUuid, { card: 'graphs', body: 'p95 jumps at 14:32', tag: 'symptom' }, anna);
    expect(c.tag).toBe('symptom');
    await expect(service.update(c.id, { tag: 'root-cause' }, mark)).rejects.toBeInstanceOf(ForbiddenException);
    const retagged = await service.update(c.id, { tag: 'root-cause' }, anna);
    expect(retagged).toMatchObject({ tag: 'root-cause', body: 'p95 jumps at 14:32', editedAt: null });
    const cleared = await service.update(c.id, { tag: null }, anna);
    expect(cleared).toMatchObject({ tag: null, editedAt: null });
    // The same body sent beside a tag (what the drawer's edit mode does) is not an edit either.
    expect(await service.update(c.id, { body: 'p95 jumps at 14:32', tag: 'evidence' }, anna)).toMatchObject({ tag: 'evidence', editedAt: null });
  });

  it('refuses a tag on a reply, on create and on edit; the CHECK refuses one written past the service', async () => {
    const root = await service.create(runUuid, { card: 'graphs', body: 'GC?', tag: 'hypothesis' }, anna);
    await expect(service.create(runUuid, { card: 'graphs', body: 'no', parentId: root.id, tag: 'ruled-out' }, mark))
      .rejects.toBeInstanceOf(BadRequestException);
    const reply = await service.create(runUuid, { card: 'graphs', body: 'no', parentId: root.id }, mark);
    expect(reply.tag).toBeNull();
    await expect(service.update(reply.id, { tag: 'ruled-out' }, mark)).rejects.toBeInstanceOf(BadRequestException);
    await expect(ds.query(`UPDATE test_run_comments SET tag = 'evidence' WHERE id = $1`, [reply.id]))
      .rejects.toThrow(/ck_test_run_comments_tag_root/);
    await expect(ds.query(`UPDATE test_run_comments SET tag = 'rootcause' WHERE id = $1`, [root.id]))
      .rejects.toThrow(/ck_test_run_comments_tag/);
  });

  it('keeps the tag of a soft-deleted root, in the list and in the stored row', async () => {
    const root = await service.create(runUuid, { card: 'graphs', body: 'heap.max halved', tag: 'root-cause' }, anna);
    await service.create(runUuid, { card: 'graphs', body: 'agreed', parentId: root.id }, mark);
    await service.remove(root.id, anna);
    const { threads } = await service.listThreads(runUuid, 'graphs', mark);
    expect(threads.find((t) => t.id === root.id)).toMatchObject({ deleted: true, body: null, tag: 'root-cause' });
    expect((await ds.query(`SELECT tag FROM test_run_comments WHERE id = $1`, [root.id]))[0].tag).toBe('root-cause');
  });

  it('soft-deletes a root with replies (body wiped, thread kept) and hard-deletes a lone reply', async () => {
    const root = await service.create(runUuid, { card: 'events', body: 'deploy at 10:00' }, anna);
    const reply = await service.create(runUuid, { card: 'events', body: 'ack', parentId: root.id }, mark);

    await service.remove(root.id, anna);
    const { threads: [thread] } = await service.listThreads(runUuid, 'events', mark);
    expect(thread).toMatchObject({ id: root.id, deleted: true, body: null });
    expect(thread.replies).toHaveLength(1);
    const stored = await ds.query(`SELECT body FROM test_run_comments WHERE id = $1`, [root.id]);
    expect(stored[0].body).toBe('');

    await expect(service.create(runUuid, { card: 'events', body: 'late', parentId: root.id }, mark))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update(root.id, { body: 'revive' }, anna)).rejects.toBeInstanceOf(NotFoundException);

    await service.remove(reply.id, mark);
    expect((await ds.query(`SELECT 1 FROM test_run_comments WHERE id = $1`, [reply.id])).length).toBe(0);
  });

  it('lets an org admin of that org delete someone else\'s comment, and nobody else', async () => {
    const c = await service.create(runUuid, { card: 'report', body: 'off topic' }, anna);
    await expect(service.remove(c.id, mark)).rejects.toBeInstanceOf(ForbiddenException);
    isOrgAdmin.mockResolvedValueOnce(true);
    await service.remove(c.id, mark);
    expect(isOrgAdmin).toHaveBeenLastCalledWith(mark.userId, orgA);
  });

  it('counts unread per card: others only, cleared by seen, missing read row = unread, 30-day window', async () => {
    const card = 'awr';
    await service.create(runUuid, { card, body: 'mine' }, anna);
    await service.create(runUuid, { card, body: 'theirs' }, mark);
    // An old comment by someone else: outside the window, never unread.
    await ds.query(
      `INSERT INTO test_run_comments (test_run_id, card_key, body, author_id, author_name, organization_id, created_at)
       VALUES ($1, $2, 'ancient', $3, 'Mark', $4, now() - interval '31 days')`,
      [runUuid, card, mark.userId, orgA],
    );

    // total: mine + theirs + the ancient one (all live); unread: only theirs within the window.
    expect((await commentCountsByCard(ds, runUuid, anna.userId))[card]).toEqual({ total: 3, unread: 1, unreadAgent: 0 });
    expect((await commentCountsByRun(ds, [runUuid], anna.userId)).get(runUuid)?.unread).toBeGreaterThanOrEqual(1);

    await service.markSeen(runUuid, card, anna);
    expect((await service.listThreads(runUuid, card, anna)).lastSeenAt).not.toBeNull();
    // Seen: nothing unread, but the comments are still there to show on the collapsed card.
    expect((await commentCountsByCard(ds, runUuid, anna.userId))[card]).toEqual({ total: 3, unread: 0, unreadAgent: 0 });

    await service.markSeen(runUuid, card, anna); // upsert, not a duplicate-key error
  });

  it('anchors a root to a card item, passes the anchor to replies, and counts threads and unread per item', async () => {
    const card = 'anomaly';
    const item = 'dash-1|42|Heap Usage';
    const root = await service.create(runUuid, { card, body: 'heap climbs', itemKey: item, itemLabel: 'Heap Usage' }, mark);
    expect(root).toMatchObject({ itemKey: item, itemLabel: 'Heap Usage' });
    await expect(service.create(runUuid, { card, body: 'x', parentId: root.id, itemKey: item, itemLabel: 'Heap Usage' }, anna))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(runUuid, { card, body: 'x', itemKey: item }, anna)).rejects.toBeInstanceOf(BadRequestException);
    await service.create(runUuid, { card, body: 'GC?', parentId: root.id }, mark);
    await service.create(runUuid, { card, body: 'card-level' }, mark);

    const { threads } = await service.listThreads(runUuid, card, anna);
    const anchored = threads.find((t) => t.id === root.id)!;
    expect(anchored.replies[0]).toMatchObject({ itemKey: item, itemLabel: 'Heap Usage' });

    expect(await service.itemCounts(runUuid, card, anna)).toEqual({ [item]: { threads: 1, unread: 2 } });
    expect(await service.itemCounts(runUuid, card, mark)).toEqual({ [item]: { threads: 1, unread: 0 } });
    await service.markSeen(runUuid, card, anna);
    expect(await service.itemCounts(runUuid, card, anna)).toEqual({ [item]: { threads: 1, unread: 0 } });
    await expect(service.itemCounts(runUuid, card, outsider)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('enforces the body and marker CHECKs in the schema itself', async () => {
    await expect(
      ds.query(
        `INSERT INTO test_run_comments (test_run_id, card_key, body, author_id, author_name, organization_id)
         VALUES ($1, 'graphs', '', 'x', 'x', $2)`,
        [runUuid, orgA],
      ),
    ).rejects.toThrow(/ck_test_run_comments_body/);
    await expect(
      ds.query(
        `INSERT INTO test_run_comments (test_run_id, card_key, body, author_id, author_name, organization_id, marker_seq)
         VALUES ($1, 'graphs', 'b', 'x', 'x', $2, 1)`,
        [runUuid, orgA],
      ),
    ).rejects.toThrow(/ck_test_run_comments_marker/);
  });

  // Value: protects=marker numbering is distinct under concurrency and never reused after a delete;
  // fails_when=the advisory lock goes, MAX() is read outside the transaction, or a marker is hard-deleted;
  // why_new=only a real database can race two inserts; seam=none; no_claim=the web pin rendering
  describe('graph markers', () => {
    const ctx = {
      series: [{ dashboardId: 'd1', dashboardLabel: 'JVM', panelId: 3, panelTitle: 'Heap', metricName: 'used', source: 'grafana' }],
      xRange: ['2026-11-20T10:00:00.000Z', '2026-11-20T11:00:00.000Z'] as [string, string],
    };
    const marker = (body: string) =>
      ({ card: 'graphs', body, markerTime: '2026-11-20T10:37:10.000Z', chartContext: ctx }) as never;

    it('numbers concurrent markers distinctly and keeps a deleted marker\'s number', async () => {
      const placed = await Promise.all([1, 2, 3, 4].map((i) => service.create(runUuid, marker(`spike ${i}`), i % 2 ? anna : mark)));
      const seqs = placed.map((c) => c.markerSeq!).sort((a, b) => a - b);
      expect(new Set(seqs).size).toBe(4);
      expect(seqs[3]! - seqs[0]!).toBe(3);
      expect(placed[0]).toMatchObject({ markerTime: '2026-11-20T10:37:10.000Z', chartContext: { xRange: ctx.xRange } });

      const top = placed.find((c) => c.markerSeq === seqs[3])!;
      await service.remove(top.id, top.authorId === anna.userId ? anna : mark);
      const after = await service.create(runUuid, marker('again'), anna);
      expect(after.markerSeq).toBe(seqs[3]! + 1);
      const { threads } = await service.listThreads(runUuid, 'graphs', anna);
      expect(threads.find((t) => t.id === top.id)).toMatchObject({ deleted: true, markerSeq: seqs[3], chartContext: null });
      // The stored view goes with the body, not only the response: retracting means gone from the row.
      const [row] = await ds.query(`SELECT chart_context FROM test_run_comments WHERE id = $1`, [top.id]);
      expect(row.chart_context).toBeNull();
    });

    it('refuses a marker off the Graphs card, on a reply, or with half its fields', async () => {
      await expect(service.create(runUuid, { ...(marker('x') as object), card: 'slo' } as never, anna)).rejects.toBeInstanceOf(BadRequestException);
      const root = await service.create(runUuid, { card: 'graphs', body: 'root' }, anna);
      await expect(service.create(runUuid, { ...(marker('x') as object), parentId: root.id } as never, anna)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.create(runUuid, { card: 'graphs', body: 'x', markerTime: '2026-11-20T10:00:00Z' } as never, anna)).rejects.toBeInstanceOf(BadRequestException);
    });

    // A plain comment records its card's view too, without taking a marker number.
    it('stores a Trends comment’s view with its kind and no marker number', async () => {
      const view = { series: ctx.series, timeRange: 'Last week', evaluateType: 'p95' };
      const c = await service.create(runUuid, { card: 'trends', body: 'p95 creeping up', chartContext: view } as never, anna);
      expect(c).toMatchObject({ markerSeq: null, markerTime: null, chartContext: { kind: 'trends', timeRange: 'Last week', evaluateType: 'p95' } });
    });
  });
});
