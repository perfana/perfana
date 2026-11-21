/**
 * Agent comments (migration 1831, packages/shared/src/database/migrations/1831000000000-AgentComments.ts;
 * CommentsService.createOrReplay, comment-anchor.resolver.ts) against a real Postgres.
 *
 * What a mock cannot see: the author_kind CHECK and default, the partial unique index that makes
 * a clientRef idempotent under a race, the limit count, the unread_agent split in the counts SQL,
 * and the anchor resolvers' SQL against the real schema (column names, casts, the ds_metrics time
 * bound). Runs as the owner role against the local dev DB, like its sibling suites; everything it
 * writes is deleted in afterAll.
 */
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { AppDataSource } from '../../data-source';
import * as Entities from '../../entities';
import { CommentsService, CommentCaller } from '../../modules/comments/comments.service';
import { commentCountsByCard } from '../../modules/comments/comment-unread.sql';

const entityClasses = Object.values(Entities).filter(
  (v): v is new () => unknown => typeof v === 'function',
);

describe('Agent comments against a real database', () => {
  const ds = new DataSource({
    ...(AppDataSource.options as Record<string, unknown>),
    entities: entityClasses,
    migrations: [],
  } as never);

  const suffix = randomUUID().slice(0, 8);
  const orgA = randomUUID();
  const orgB = randomUUID();
  const sutA = randomUUID();
  const dashA = randomUUID();
  const runHuman = `agent-comments-spec-run-${suffix}`;
  const prevHuman = `agent-comments-spec-prev-${suffix}`;
  let runUuid = '';
  let prevUuid = '';

  let service: CommentsService;
  const agent: CommentCaller = { userId: `api-key:${randomUUID()}`, displayName: 'Claude analysis agent', orgIds: [orgA], authorKind: 'agent' };
  const otherOrgAgent: CommentCaller = { userId: `api-key:${randomUUID()}`, displayName: 'Other agent', orgIds: [orgB], authorKind: 'agent' };
  const anna: CommentCaller = { userId: 'agent-comments-spec-anna', displayName: 'Anna', orgIds: [orgA] };

  beforeAll(async () => {
    await ds.initialize();
    service = new CommentsService(
      ds,
      { isOrganizationAdmin: jest.fn().mockResolvedValue(false), canViewTeamResources: jest.fn().mockResolvedValue({ allowed: true }) } as never,
      { emitCommentEvent: jest.fn() } as never,
      { logDelete: jest.fn() } as never,
    );
    for (const org of [orgA, orgB]) {
      await ds.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [org, `agent-comments-spec-${org.slice(0, 8)}`]);
    }
    await ds.query(`INSERT INTO systems_under_test (id, organization_id, name, description) VALUES ($1, $2, $3, 'agent comments spec')`, [
      sutA,
      orgA,
      `agent-comments-spec-sut-${suffix}`,
    ]);
    const insertRun = async (human: string, start: string, end: string) =>
      (
        await ds.query(
          `INSERT INTO test_runs (test_run_id, system_under_test_id, test_environment, workload, organization_id, start_time, end_time)
           VALUES ($1, $2, 'acc', 'load', $3, $4, $5) RETURNING id`,
          [human, sutA, orgA, start, end],
        )
      )[0].id as string;
    prevUuid = await insertRun(prevHuman, '2026-11-19T10:00:00Z', '2026-11-19T11:00:00Z');
    runUuid = await insertRun(runHuman, '2026-11-20T10:00:00Z', '2026-11-20T11:00:00Z');
    await ds.query(
      `INSERT INTO application_dashboards (id, system_under_test_id, test_environment, dashboard_name, dashboard_label, organization_id)
       VALUES ($1, $2, 'acc', 'jvm', $3, $4)`,
      [dashA, sutA, `JVM ${suffix}`, orgA],
    );
    await ds.query(`INSERT INTO test_run_configs (test_run_id, key, value) VALUES ($1, 'heap.max', '512m'), ($2, 'heap.max', '2g')`, [runUuid, prevUuid]);
    await ds.query(
      `INSERT INTO ds_metrics (test_run_id, application_dashboard_id, dashboard_uid, panel_id, time, metric_name, panel_title, dashboard_label, value, unit)
       VALUES ($1, $2, 'jvm-uid', 3, '2026-11-20T10:30:00Z', 'used', 'Heap', $3, 1, 'bytes')`,
      [runHuman, dashA, `JVM ${suffix}`],
    );
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM ds_metrics WHERE test_run_id = $1`, [runHuman]);
    await ds.query(`DELETE FROM ds_metric_collection_status WHERE test_run_id = ANY($1)`, [[runHuman, prevHuman]]);
    await ds.query(`DELETE FROM test_run_configs WHERE test_run_id = ANY($1)`, [[runUuid, prevUuid]]);
    await ds.query(`DELETE FROM test_runs WHERE id = ANY($1)`, [[runUuid, prevUuid]]); // cascades comments
    await ds.query(`DELETE FROM application_dashboards WHERE id = $1`, [dashA]);
    await ds.query(`DELETE FROM systems_under_test WHERE id = $1`, [sutA]);
    await ds.query(`DELETE FROM organizations WHERE id = ANY($1)`, [[orgA, orgB]]);
    await ds.destroy();
  });

  it('defaults author_kind to user and refuses anything outside the CHECK', async () => {
    const c = await service.create(runUuid, { card: 'graphs', body: 'by a person' }, anna);
    const [row] = await ds.query(`SELECT author_kind, notified_at FROM test_run_comments WHERE id = $1`, [c.id]);
    expect(row).toMatchObject({ author_kind: 'user', notified_at: null });
    await expect(ds.query(`UPDATE test_run_comments SET author_kind = 'robot' WHERE id = $1`, [c.id])).rejects.toThrow(/ck_test_run_comments_author_kind/);
  });

  it('writes an agent comment as agent, signed with the key and already announced', async () => {
    const c = await service.create(runUuid, { card: 'graphs', body: 'p95 jumps' }, agent);
    expect(c).toMatchObject({ authorKind: 'agent', authorName: 'Claude analysis agent', authorId: agent.userId });
    const [row] = await ds.query(`SELECT author_kind, notified_at FROM test_run_comments WHERE id = $1`, [c.id]);
    expect(row.author_kind).toBe('agent');
    expect(row.notified_at).not.toBeNull();
  });

  it('answers a key of another organization with 404', async () => {
    await expect(service.create(runUuid, { card: 'graphs', body: 'x' }, otherOrgAgent)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the first comment for a repeated clientRef, and the index refuses a raw duplicate', async () => {
    const first = await service.createOrReplay(runUuid, { card: 'slo', body: 'first', clientRef: `ref-${suffix}` }, agent);
    const again = await service.createOrReplay(runUuid, { card: 'slo', body: 'retry', clientRef: `ref-${suffix}` }, agent);
    expect(first.created).toBe(true);
    expect(again).toMatchObject({ created: false, comment: { id: first.comment.id, body: 'first' } });
    await expect(
      ds.query(
        `INSERT INTO test_run_comments (test_run_id, card_key, body, author_id, author_name, organization_id, author_kind, client_ref)
         VALUES ($1, 'slo', 'dup', $2, 'x', $3, 'agent', $4)`,
        [runUuid, agent.userId, orgA, `ref-${suffix}`],
      ),
    ).rejects.toThrow(/uq_test_run_comments_client_ref/);
    // The same ref from a different author is a different comment.
    const other: CommentCaller = { ...agent, userId: `api-key:${randomUUID()}` };
    expect((await service.createOrReplay(runUuid, { card: 'slo', body: 'other', clientRef: `ref-${suffix}` }, other)).created).toBe(true);
  });

  it('settles two concurrent creates with one clientRef into one comment', async () => {
    const ref = `race-${suffix}`;
    const results = await Promise.all([
      service.createOrReplay(runUuid, { card: 'slo', body: 'a', clientRef: ref }, agent),
      service.createOrReplay(runUuid, { card: 'slo', body: 'b', clientRef: ref }, agent),
    ]);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(results[0]!.comment.id).toBe(results[1]!.comment.id);
    const [{ n }] = await ds.query(`SELECT count(*)::int AS n FROM test_run_comments WHERE client_ref = $1`, [ref]);
    expect(n).toBe(1);
  });

  it('refuses the 101st root comment per key per run with a 429', async () => {
    const capped: CommentCaller = { ...agent, userId: `api-key:${randomUUID()}` };
    const [{ n }] = await ds.query(`SELECT count(*)::int AS n FROM test_run_comments WHERE author_id = $1`, [capped.userId]);
    await ds.query(
      `INSERT INTO test_run_comments (test_run_id, card_key, body, author_id, author_name, organization_id, author_kind)
       SELECT $1, 'graphs', 'filler', $2, 'x', $3, 'agent' FROM generate_series(1, $4)`,
      [runUuid, capped.userId, orgA, 100 - n],
    );
    const err = await service.create(runUuid, { card: 'graphs', body: 'one too many' }, capped).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    expect((err as HttpException).message).toContain('100 root comments');
  });

  it('counts unread from agents separately', async () => {
    // Read as a third person: Anna's own comment is unread for them, the agent's too.
    const counts = await commentCountsByCard(ds, runUuid, 'agent-comments-spec-bob');
    expect(counts.graphs!.unreadAgent).toBeGreaterThanOrEqual(1);
    expect(counts.graphs!.unread).toBeGreaterThan(counts.graphs!.unreadAgent);
  });

  it('resolves a config anchor against the run and the compared run', async () => {
    const c = await service.create(runUuid, { body: 'heap shrank', tag: 'evidence', anchor: { type: 'config', key: 'heap.max', comparedToTestRunId: prevHuman } } as never, agent);
    expect(c).toMatchObject({ cardKey: 'config', itemKey: 'config:heap.max', itemLabel: 'heap.max', tag: 'evidence' });
    expect(c.chartContext).toEqual({ kind: 'config', comparedToTestRunId: prevHuman, status: 'changed', currentValue: '512m', previousValue: '2g' });
  });

  it('resolves a dashboard anchor, and refuses a dashboard of another system', async () => {
    const c = await service.create(runUuid, { body: 'GC pauses', anchor: { type: 'dashboard', applicationDashboardId: dashA } } as never, agent);
    expect(c).toMatchObject({ cardKey: 'dashboards', itemKey: `dashboard:${dashA}`, itemLabel: `JVM ${suffix}` });
    await expect(
      service.create(runUuid, { body: 'x', anchor: { type: 'dashboard', applicationDashboardId: randomUUID() } } as never, agent),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('resolves a marker anchor into a numbered marker with a replayable view', async () => {
    const c = await service.create(
      runUuid,
      { body: 'heap climbs', tag: 'symptom', anchor: { type: 'marker', time: '2026-11-20T10:30:00Z', series: [{ dashboardLabel: `JVM ${suffix}`, panelId: 3, metricName: 'used' }] } } as never,
      agent,
    );
    expect(c).toMatchObject({ cardKey: 'graphs', markerTime: '2026-11-20T10:30:00.000Z' });
    expect(c.markerSeq).toBeGreaterThanOrEqual(1);
    expect(c.chartContext).toMatchObject({
      kind: 'graphs',
      series: [{ dashboardId: dashA, panelId: 3, metricName: 'used', panelTitle: 'Heap', yAxisFormat: 'bytes', source: 'grafana' }],
      xRange: ['2026-11-20T10:00:00.000Z', '2026-11-20T11:00:00.000Z'],
    });
  });

  it('refuses a transaction anchor naming a transaction the run never ran', async () => {
    await expect(
      service.create(runUuid, { body: 'x', anchor: { type: 'transaction', name: 'never-ran' } } as never, agent),
    ).rejects.toThrow(/Transaction "never-ran" not found/);
  });
});
