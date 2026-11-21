/**
 * Analysis stories (migration 1830, packages/shared/src/database/migrations/1830000000000-AnalysisStories.ts;
 * StoriesService, and CommentsService's delete-rule extension) against a real Postgres.
 *
 * Mocks cannot see what matters here: the FKs between steps, stories and comments (a run delete
 * must remove all three in one statement), the CHECKs, the atomicity of a step replacement, the
 * draft predicate in the SELECT policy, and the tenant boundary on by-id routes. Runs as the owner
 * role against the local dev DB, like its sibling suites, except the policy cases, which switch to
 * `perfana_app` inside a rolled-back transaction. Everything it writes is deleted in afterAll.
 */
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AppDataSource } from '../../data-source';
import * as Entities from '../../entities';
import { CommentsService, CommentCaller } from '../../modules/comments/comments.service';
import { StoriesService } from '../../modules/comments/stories.service';

const entityClasses = Object.values(Entities).filter(
  (v): v is new () => unknown => typeof v === 'function',
);

describe('StoriesService against a real database', () => {
  const ds = new DataSource({
    ...(AppDataSource.options as Record<string, unknown>),
    entities: entityClasses,
    migrations: [],
  } as never);

  const suffix = randomUUID().slice(0, 8);
  const orgA = randomUUID();
  const orgB = randomUUID();
  const teamA = randomUUID();
  const sutA = randomUUID();
  let runUuid = '';
  let otherRunUuid = '';
  const runHuman = `stories-spec-run-${suffix}`;

  const storyEvents: { owner: { testRunId: string; organizationId?: string | null }; storyId: string }[] = [];
  const gateway = {
    emitCommentEvent: jest.fn(),
    emitStoryChanged: (owner: { testRunId: string; organizationId?: string | null }, storyId: string) => storyEvents.push({ owner, storyId }),
  };
  const isOrgAdmin = jest.fn().mockResolvedValue(false);
  const canViewTeamResources = jest.fn(async (userId: string) => ({ allowed: userId !== 'stories-spec-tom' }));
  const authz = { isOrganizationAdmin: isOrgAdmin, canViewTeamResources };
  let comments: CommentsService;
  let stories: StoriesService;

  const anna: CommentCaller = { userId: 'stories-spec-anna', displayName: 'Anna', orgIds: [orgA] };
  const mark: CommentCaller = { userId: 'stories-spec-mark', displayName: 'Mark', orgIds: [orgA] };
  const tom: CommentCaller = { userId: 'stories-spec-tom', displayName: 'Tom', orgIds: [orgA] };
  const outsider: CommentCaller = { userId: 'stories-spec-eve', displayName: 'Eve', orgIds: [orgB] };
  const admin: CommentCaller = { userId: 'stories-spec-root', displayName: 'Root', orgIds: null };

  const root = (body: string, tag?: string) =>
    comments.create(runUuid, { card: 'performance', body, ...(tag ? { tag } : {}) } as never, anna);

  beforeAll(async () => {
    await ds.initialize();
    comments = new CommentsService(ds, authz as never, gateway as never, { logDelete: jest.fn() } as never);
    stories = new StoriesService(ds, comments, authz as never, gateway as never, { logDelete: jest.fn() } as never);
    for (const org of [orgA, orgB]) {
      await ds.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [org, `stories-spec-${org.slice(0, 8)}`]);
    }
    await ds.query(
      `INSERT INTO teams (id, organization_id, name, restrict_to_team_members) VALUES ($1, $2, $3, true)`,
      [teamA, orgA, `stories-spec-team-${suffix}`],
    );
    await ds.query(
      `INSERT INTO systems_under_test (id, organization_id, team_id, name, description) VALUES ($1, $2, $3, $4, 'stories spec')`,
      [sutA, orgA, teamA, `stories-spec-sut-${suffix}`],
    );
    const insertRun = async (key: string) =>
      (await ds.query(
        `INSERT INTO test_runs (test_run_id, system_under_test_id, test_environment, workload, organization_id, start_time, end_time)
         VALUES ($1, $2, 'acc', 'load', $3, now(), now()) RETURNING id`,
        [key, sutA, orgA],
      ))[0].id as string;
    runUuid = await insertRun(runHuman);
    otherRunUuid = await insertRun(`${runHuman}-other`);
  });

  afterAll(async () => {
    const runs = [runUuid, otherRunUuid];
    await ds.query(`DELETE FROM ds_metric_collection_status WHERE test_run_id IN (SELECT test_run_id FROM test_runs WHERE id = ANY($1))`, [runs]);
    await ds.query(`DELETE FROM test_runs WHERE id = ANY($1)`, [runs]); // cascades comments, stories, steps
    await ds.query(`DELETE FROM systems_under_test WHERE id = $1`, [sutA]);
    await ds.query(`DELETE FROM teams WHERE id = $1`, [teamA]);
    await ds.query(`DELETE FROM organizations WHERE id = ANY($1)`, [[orgA, orgB]]);
    await ds.destroy();
  });

  beforeEach(() => isOrgAdmin.mockResolvedValue(false));

  it('creates a draft by human run id with its first step, stamped "user", visible only to its author', async () => {
    const c = await root('p95 jumps at 14:32', 'symptom');
    const s = await stories.create(runHuman, { title: '  Checkout latency  ', steps: [{ commentId: c.id }] }, anna);
    expect(s).toMatchObject({ title: 'Checkout latency', status: 'draft', authorName: 'Anna', authorKind: 'user', stepCount: 1, canEdit: true, publishedAt: null });
    expect(s.steps[0]).toMatchObject({ position: 1, note: null, comment: { id: c.id, tag: 'symptom', replyCount: 0 } });
    const [row] = await ds.query(`SELECT organization_id, team_id, author_kind FROM test_run_stories WHERE id = $1`, [s.id]);
    expect(row).toMatchObject({ organization_id: orgA, team_id: teamA, author_kind: 'user' });

    expect((await stories.list(runUuid, anna)).map((x) => x.id)).toContain(s.id);
    expect((await stories.list(runUuid, mark)).map((x) => x.id)).not.toContain(s.id);
  });

  // Design: "someone else's draft is 404 on GET/PATCH/PUT/DELETE", for an org admin and a global admin too.
  it("answers 404 for someone else's draft on every route, admins included", async () => {
    const c = await root('draft step');
    const s = await stories.create(runUuid, { title: 'Private', steps: [{ commentId: c.id }] }, anna);
    for (const who of [mark, admin]) {
      isOrgAdmin.mockResolvedValue(true);
      await expect(stories.get(s.id, who)).rejects.toBeInstanceOf(NotFoundException);
      await expect(stories.update(s.id, { title: 'x' }, who)).rejects.toBeInstanceOf(NotFoundException);
      await expect(stories.replaceSteps(s.id, [], who)).rejects.toBeInstanceOf(NotFoundException);
      await expect(stories.remove(s.id, who)).rejects.toBeInstanceOf(NotFoundException);
    }
  });

  it('publishes only with steps, stamps publishedAt once and keeps it across unpublish and republish', async () => {
    const empty = await stories.create(runUuid, { title: 'Empty' }, anna);
    await expect(stories.update(empty.id, { status: 'published' }, anna)).rejects.toBeInstanceOf(BadRequestException);

    const c = await root('heap halved', 'root-cause');
    await stories.replaceSteps(empty.id, [{ commentId: c.id }], anna);
    const published = await stories.update(empty.id, { status: 'published' }, anna);
    expect(published.status).toBe('published');
    const first = published.publishedAt;
    expect(first).not.toBeNull();
    const unpublished = await stories.update(empty.id, { status: 'draft' }, anna);
    expect(unpublished).toMatchObject({ status: 'draft', publishedAt: first });
    await new Promise((r) => setTimeout(r, 10));
    expect((await stories.update(empty.id, { status: 'published' }, anna)).publishedAt).toBe(first);
    // A published story cannot be emptied in place.
    await expect(stories.replaceSteps(empty.id, [], anna)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lets the same org read a published story, the author alone edit it, and keeps other orgs and the team rule at 404', async () => {
    const c = await root('GC every 2 s', 'evidence');
    const s = await stories.create(runUuid, { title: 'Shared', steps: [{ commentId: c.id, note: 'then the GC' }] }, anna);
    await stories.update(s.id, { status: 'published' }, anna);

    expect(await stories.get(s.id, mark)).toMatchObject({ id: s.id, canEdit: false, canDelete: false, steps: [{ note: 'then the GC' }] });
    expect((await stories.list(runUuid, mark)).map((x) => x.id)).toContain(s.id);
    await expect(stories.update(s.id, { title: 'hijack' }, mark)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(stories.replaceSteps(s.id, [{ commentId: c.id }], mark)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(stories.remove(s.id, mark)).rejects.toBeInstanceOf(ForbiddenException);

    for (const who of [outsider, tom]) {
      await expect(stories.list(runUuid, who)).rejects.toBeInstanceOf(NotFoundException);
      await expect(stories.get(s.id, who)).rejects.toBeInstanceOf(NotFoundException);
      await expect(stories.create(runUuid, { title: 'x' }, who)).rejects.toBeInstanceOf(NotFoundException);
      await expect(stories.remove(s.id, who)).rejects.toBeInstanceOf(NotFoundException);
    }
  });

  it('lets an org admin of the story\'s org, and a global admin, delete a published story', async () => {
    const c = await root('to moderate');
    const s1 = await stories.create(runUuid, { title: 'Mod 1', steps: [{ commentId: c.id }] }, anna);
    await stories.update(s1.id, { status: 'published' }, anna);
    isOrgAdmin.mockResolvedValue(true);
    expect((await stories.get(s1.id, mark)).canDelete).toBe(true);
    await stories.remove(s1.id, mark);
    expect(isOrgAdmin).toHaveBeenLastCalledWith(mark.userId, orgA);

    const s2 = await stories.create(runUuid, { title: 'Mod 2', steps: [{ commentId: c.id }] }, anna);
    await stories.update(s2.id, { status: 'published' }, anna);
    await stories.remove(s2.id, admin);
    expect(await ds.query(`SELECT 1 FROM test_run_stories WHERE id = ANY($1)`, [[s1.id, s2.id]])).toHaveLength(0);
    // Deleting a story never touches comments.
    expect(await ds.query(`SELECT 1 FROM test_run_comments WHERE id = $1 AND deleted_at IS NULL`, [c.id])).toHaveLength(1);
  });

  it('refuses a step that is a reply, on another run, deleted, repeated, or the 51st', async () => {
    const c = await root('anchor');
    const reply = await comments.create(runUuid, { card: 'performance', body: 'reply', parentId: c.id }, mark);
    const foreign = await comments.create(otherRunUuid, { card: 'performance', body: 'elsewhere' }, anna);
    const gone = await root('gone');
    await comments.create(runUuid, { card: 'performance', body: 'keeps it soft', parentId: gone.id }, mark);
    await comments.remove(gone.id, anna);

    for (const steps of [[{ commentId: reply.id }], [{ commentId: foreign.id }], [{ commentId: gone.id }], [{ commentId: c.id }, { commentId: c.id }]]) {
      await expect(stories.create(runUuid, { title: 'bad', steps }, anna)).rejects.toBeInstanceOf(BadRequestException);
    }
    const many = Array.from({ length: 51 }, () => ({ commentId: randomUUID() }));
    await expect(stories.create(runUuid, { title: 'too long', steps: many }, anna)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('replaces steps atomically: a failing insert leaves the old list', async () => {
    const a = await root('step a');
    const b = await root('step b');
    const s = await stories.create(runUuid, { title: 'Atomic', steps: [{ commentId: a.id }, { commentId: b.id }] }, anna);
    const reordered = await stories.replaceSteps(s.id, [{ commentId: b.id, note: 'first' }, { commentId: a.id }], anna);
    expect(reordered.steps.map((x) => [x.position, x.comment.id, x.note])).toEqual([[1, b.id, 'first'], [2, a.id, null]]);

    // A note past the CHECK (the DTO would refuse it first; the service is called directly here).
    await expect(stories.replaceSteps(s.id, [{ commentId: a.id, note: 'x'.repeat(2001) }], anna)).rejects.toThrow(/ck_test_run_story_steps_note/);
    expect((await stories.get(s.id, anna)).steps.map((x) => x.comment.id)).toEqual([b.id, a.id]);
  });

  // Delete rule (design): a root that is a step in any story is soft-deleted, even with no replies and no marker.
  it('soft-deletes a plain root that is a step, keeps its tag and the step note, and lets it stay on a reorder', async () => {
    const c = await root('heap.max is 512 MB', 'root-cause');
    const other = await root('other');
    const s = await stories.create(runUuid, { title: 'Soft', steps: [{ commentId: c.id, note: 'so I looked at the heap' }, { commentId: other.id }] }, anna);
    await comments.remove(c.id, anna);
    const [stored] = await ds.query(`SELECT body, deleted_at, tag FROM test_run_comments WHERE id = $1`, [c.id]);
    expect(stored).toMatchObject({ body: '', tag: 'root-cause' });
    expect(stored.deleted_at).not.toBeNull();

    const read = await stories.get(s.id, anna);
    expect(read.steps[0]).toMatchObject({ note: 'so I looked at the heap', comment: { id: c.id, deleted: true, body: null, tag: 'root-cause', chartContext: null } });
    // Already in the story: it may stay when the list is reordered.
    const reordered = await stories.replaceSteps(s.id, [{ commentId: other.id }, { commentId: c.id }], anna);
    expect(reordered.steps.map((x) => x.comment.id)).toEqual([other.id, c.id]);

    // A root in no story is still hard-deleted, as in v1.
    const plain = await root('plain');
    await comments.remove(plain.id, anna);
    expect(await ds.query(`SELECT 1 FROM test_run_comments WHERE id = $1`, [plain.id])).toHaveLength(0);
  });

  it("names the stories a root is a step of, among those the caller can see, in the thread list", async () => {
    const c = await root('named');
    const pub = await stories.create(runUuid, { title: 'Public walk', steps: [{ commentId: c.id }] }, anna);
    await stories.update(pub.id, { status: 'published' }, anna);
    await stories.create(runUuid, { title: 'Anna draft', steps: [{ commentId: c.id }] }, anna);

    const forAnna = (await comments.listThreads(runUuid, 'performance', anna)).threads.find((t) => t.id === c.id)!;
    expect(forAnna.stories!.map((x) => x.title)).toEqual(['Public walk', 'Anna draft']);
    const forMark = (await comments.listThreads(runUuid, 'performance', mark)).threads.find((t) => t.id === c.id)!;
    expect(forMark.stories!.map((x) => x.title)).toEqual(['Public walk']);
  });

  it('emits a body-free story:changed with the run organization on every write', async () => {
    const c = await root('emit');
    storyEvents.length = 0;
    const s = await stories.create(runUuid, { title: 'Emit secret title', steps: [{ commentId: c.id }] }, anna);
    await stories.update(s.id, { summary: 'secret summary' }, anna);
    await stories.replaceSteps(s.id, [{ commentId: c.id, note: 'secret note' }], anna);
    await stories.remove(s.id, anna);
    expect(storyEvents).toHaveLength(4);
    for (const e of storyEvents) expect(e).toEqual({ owner: { testRunId: runUuid, organizationId: orgA }, storyId: s.id });
    expect(JSON.stringify(storyEvents)).not.toMatch(/secret/);
  });

  it('removes comments, stories and steps together when the run is deleted', async () => {
    const run = (await ds.query(
      `INSERT INTO test_runs (test_run_id, system_under_test_id, test_environment, workload, organization_id, start_time, end_time)
       VALUES ($1, $2, 'acc', 'load', $3, now(), now()) RETURNING id`,
      [`${runHuman}-gone`, sutA, orgA],
    ))[0].id as string;
    const c = await comments.create(run, { card: 'graphs', body: 'doomed' }, anna);
    const s = await stories.create(run, { title: 'Doomed', steps: [{ commentId: c.id }] }, anna);
    await ds.query(`DELETE FROM test_runs WHERE id = $1`, [run]);
    expect(await ds.query(`SELECT 1 FROM test_run_stories WHERE id = $1`, [s.id])).toHaveLength(0);
    expect(await ds.query(`SELECT 1 FROM test_run_story_steps WHERE story_id = $1`, [s.id])).toHaveLength(0);
    expect(await ds.query(`SELECT 1 FROM test_run_comments WHERE id = $1`, [c.id])).toHaveLength(0);
  });

  it('enforces the title, status and author_kind CHECKs in the schema itself', async () => {
    const ins = (title: string, status = 'draft', kind = 'user') =>
      ds.query(
        `INSERT INTO test_run_stories (test_run_id, title, status, author_id, author_name, author_kind, organization_id)
         VALUES ($1, $2, $3, 'x', 'x', $4, $5)`,
        [runUuid, title, status, kind, orgA],
      );
    await expect(ins('')).rejects.toThrow(/ck_test_run_stories_title/);
    await expect(ins('t', 'archived')).rejects.toThrow(/ck_test_run_stories_status/);
    await expect(ins('t', 'draft', 'robot')).rejects.toThrow(/ck_test_run_stories_author_kind/);
  });

  // PR6b: an API key with comments:write proposes a story; a person reviews and publishes it.
  describe('agent stories', () => {
    const agent: CommentCaller = { userId: `api-key:stories-spec-${suffix}`, displayName: 'Claude analysis agent', orgIds: [orgA], authorKind: 'agent' };
    const outsiderAgent: CommentCaller = { userId: `api-key:stories-spec-b-${suffix}`, displayName: 'Other agent', orgIds: [orgB], authorKind: 'agent' };

    it('lets another org member read, edit, publish an agent draft, records the publisher, and keeps the key out afterwards', async () => {
      const c = await root('p95 doubles at 14:32', 'symptom');
      const s = await stories.create(runHuman, { title: 'Agent walk', steps: [{ commentId: c.id }] }, agent);
      expect(s).toMatchObject({ authorKind: 'agent', authorId: agent.userId, authorName: 'Claude analysis agent', status: 'draft', canEdit: true, canDelete: false });
      expect((await ds.query(`SELECT author_kind FROM test_run_stories WHERE id = $1`, [s.id]))[0].author_kind).toBe('agent');

      // Visible to every org member who can see the run, named in the thread list too.
      expect((await stories.list(runUuid, mark)).find((x) => x.id === s.id)).toMatchObject({ canEdit: true, canDelete: true });
      const thread = (await comments.listThreads(runUuid, 'performance', mark)).threads.find((t) => t.id === c.id)!;
      expect(thread.stories!.map((x) => x.title)).toContain('Agent walk');
      for (const who of [outsider, tom]) await expect(stories.get(s.id, who)).rejects.toBeInstanceOf(NotFoundException);

      // The key may refine its own draft, referencing any author's comments, but never publish it.
      const marks = await comments.create(runUuid, { card: 'performance', body: 'Mark saw GC' } as never, mark);
      await stories.replaceSteps(s.id, [{ commentId: c.id }, { commentId: marks.id, note: 'then GC' }], agent);
      await expect(stories.update(s.id, { status: 'published' }, agent)).rejects.toBeInstanceOf(ForbiddenException);

      // Mark reviews: edits, reorders and publishes.
      await stories.replaceSteps(s.id, [{ commentId: marks.id }, { commentId: c.id }], mark);
      const published = await stories.update(s.id, { status: 'published', summary: 'GC pauses' }, mark);
      expect(published).toMatchObject({ status: 'published', publishedById: mark.userId, publishedByName: 'Mark', authorName: 'Claude analysis agent' });
      const [row] = await ds.query(`SELECT published_by_id, published_by_name, published_at FROM test_run_stories WHERE id = $1`, [s.id]);
      expect(row).toMatchObject({ published_by_id: mark.userId, published_by_name: 'Mark' });
      expect(row.published_at).not.toBeNull();

      // Published: the key can no longer touch it; another user cannot either; Mark still can.
      await expect(stories.update(s.id, { title: 'x' }, agent)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(stories.replaceSteps(s.id, [{ commentId: c.id }], agent)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(stories.update(s.id, { title: 'x' }, anna)).rejects.toBeInstanceOf(ForbiddenException);
      expect((await stories.get(s.id, mark)).canEdit).toBe(true);
    });

    it("lets any user delete an agent's draft, and keeps a key's story on another org's run at 404", async () => {
      const s = await stories.create(runUuid, { title: 'Bad proposal' }, agent);
      await stories.remove(s.id, anna);
      expect(await ds.query(`SELECT 1 FROM test_run_stories WHERE id = $1`, [s.id])).toHaveLength(0);
      await expect(stories.create(runUuid, { title: 'x' }, outsiderAgent)).rejects.toBeInstanceOf(NotFoundException);
    });

    it("answers a key's 11th story on one run with 429", async () => {
      const run = (await ds.query(
        `INSERT INTO test_runs (test_run_id, system_under_test_id, test_environment, workload, organization_id, start_time, end_time)
         VALUES ($1, $2, 'acc', 'load', $3, now(), now()) RETURNING id`,
        [`${runHuman}-limit`, sutA, orgA],
      ))[0].id as string;
      try {
        for (let i = 0; i < 10; i++) await stories.create(run, { title: `p${i}` }, agent);
        await expect(stories.create(run, { title: 'p10' }, agent)).rejects.toMatchObject({ status: 429 });
        // Another key, and a person, are not counted against this key.
        await expect(stories.create(run, { title: 'mine' }, anna)).resolves.toBeDefined();
      } finally {
        await ds.query(`DELETE FROM test_runs WHERE id = $1`, [run]);
      }
    });
  });

  // RLS: the policies themselves, as perfana_app with the request GUCs the interceptor sets.
  describe('row-level security', () => {
    const asUser = async <T>(userId: string, orgs: string[], fn: (em: EntityManager) => Promise<T>): Promise<T> => {
      const qr = ds.createQueryRunner();
      await qr.connect();
      await qr.startTransaction();
      try {
        await qr.query(`SET LOCAL ROLE perfana_app`);
        await qr.query(`SELECT set_config('app.current_user_id', $1, true)`, [userId]);
        await qr.query(`SELECT set_config('app.current_user_organizations', $1, true)`, [JSON.stringify(orgs)]);
        await qr.query(`SELECT set_config('app.current_user_teams', $1, true)`, [JSON.stringify(orgs.includes(orgA) ? [teamA] : [])]);
        await qr.query(`SELECT set_config('app.current_user_roles', $1, true)`, [JSON.stringify(['user'])]);
        return await fn(qr.manager);
      } finally {
        await qr.rollbackTransaction();
        await qr.release();
      }
    };

    it("hides another user's draft and every story of another organization; steps follow the organization", async () => {
      const c = await root('rls');
      const draft = await stories.create(runUuid, { title: 'RLS draft', steps: [{ commentId: c.id }] }, anna);
      const pub = await stories.create(runUuid, { title: 'RLS published', steps: [{ commentId: c.id }] }, anna);
      await stories.update(pub.id, { status: 'published' }, anna);
      const ids = [draft.id, pub.id];
      const visible = (userId: string, orgs: string[]) =>
        asUser(userId, orgs, async (em) => (await em.query(`SELECT id FROM test_run_stories WHERE id = ANY($1) ORDER BY title`, [ids])).map((r: { id: string }) => r.id));

      expect(await visible(anna.userId, [orgA])).toEqual([draft.id, pub.id]);
      expect(await visible(mark.userId, [orgA])).toEqual([pub.id]);
      expect(await visible(outsider.userId, [orgB])).toEqual([]);
      // The delete rule must see every story a comment is in, drafts included.
      expect(await asUser(mark.userId, [orgA], async (em) => (await em.query(`SELECT 1 FROM test_run_story_steps WHERE comment_id = $1`, [c.id])).length)).toBe(2);
      expect(await asUser(outsider.userId, [orgB], async (em) => (await em.query(`SELECT 1 FROM test_run_story_steps WHERE comment_id = $1`, [c.id])).length)).toBe(0);
    });

    // Migration 1833: an agent's draft is visible to everyone who can see the run, still not cross-org.
    it("shows an agent's draft to another member of the organization and hides it from another organization", async () => {
      const agentKey = `api-key:stories-spec-rls-${suffix}`;
      const s = await stories.create(runUuid, { title: 'RLS agent draft' }, { userId: agentKey, displayName: 'Agent', orgIds: [orgA], authorKind: 'agent' });
      const userDraft = await stories.create(runUuid, { title: 'RLS user draft' }, anna);
      const visible = (userId: string, orgs: string[]) =>
        asUser(userId, orgs, async (em) =>
          (await em.query(`SELECT title FROM test_run_stories WHERE id = ANY($1) ORDER BY title`, [[s.id, userDraft.id]])).map((r: { title: string }) => r.title),
        );
      expect(await visible(mark.userId, [orgA])).toEqual(['RLS agent draft']);
      expect(await visible(anna.userId, [orgA])).toEqual(['RLS agent draft', 'RLS user draft']);
      expect(await visible(agentKey, [orgA])).toEqual(['RLS agent draft']);
      expect(await visible(outsider.userId, [orgB])).toEqual([]);
    });
  });
});
