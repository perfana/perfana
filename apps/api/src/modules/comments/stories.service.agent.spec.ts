/**
 * Value: protects=the agent-story rules (PR6b) that no other unit covers — author_kind and the
 * signature come from the caller; a key's 11th story on a run answers 429 naming the limit; a key
 * edits only its own draft and never after a person published it, and never sends status; any user
 * sees, edits, publishes and deletes an agent's draft, and publishing records who did it; a
 * published agent story belongs to its publisher; a user's draft stays author-only;
 * fails_when=any of those rules moves or is dropped; seam=mocked EntityManager and repositories
 * (no request EM, so tx() falls back to dataSource.transaction); no_claim=SQL against Postgres and
 * the RLS SELECT rule (src/test/rls/test-run-stories.spec.ts), the controller's role gate
 * (comments.controller.spec.ts).
 */
import { ForbiddenException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { TestRunComment, TestRunStory, TestRunStoryStep } from '@perfana/shared/entities';
import { editDenial, StoriesService } from './stories.service';

const ORG = '11111111-1111-4111-8111-111111111111';
const RUN = '22222222-2222-4222-8222-222222222222';
const STORY = '33333333-3333-4333-8333-333333333333';
const agent = { userId: 'api-key:k1', displayName: 'Claude analysis agent', orgIds: [ORG], authorKind: 'agent' as const };
const otherAgent = { ...agent, userId: 'api-key:k2' };
const ada = { userId: 'sub-1', displayName: 'Ada', orgIds: [ORG] };
const bo = { userId: 'sub-2', displayName: 'Bo', orgIds: [ORG] };

type Row = Record<string, unknown>;

const storyRow = (over: Row = {}): Row => ({
  id: STORY,
  testRunId: RUN,
  title: 'Why p95 doubled',
  summary: null,
  status: 'draft',
  authorId: 'api-key:k1',
  authorName: 'Claude analysis agent',
  authorKind: 'agent',
  publishedAt: null,
  publishedById: null,
  publishedByName: null,
  organizationId: ORG,
  teamId: null,
  createdAt: new Date('2026-11-20T10:00:00Z'),
  updatedAt: new Date('2026-11-20T10:00:00Z'),
  ...over,
});

function setup(opts: { story?: Row | null; count?: number; stepCount?: number; admin?: boolean } = {}) {
  const saved: Row[] = [];
  const stories = {
    create: (v: Row) => v,
    save: jest.fn(async (v: Row) => {
      const row = { id: STORY, createdAt: new Date(), updatedAt: new Date(), ...v };
      saved.push(row);
      return row;
    }),
    findOne: jest.fn(async () => (opts.story === undefined ? storyRow() : opts.story)),
    delete: jest.fn(async () => undefined),
    createQueryBuilder: jest.fn(),
  };
  const steps = {
    find: jest.fn(async () => []),
    count: jest.fn(async () => opts.stepCount ?? 1),
    delete: jest.fn(async () => undefined),
    insert: jest.fn(async () => undefined),
    create: (v: Row) => v,
  };
  const comments = { find: jest.fn(async () => []) };
  const em = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('count(*)::int AS n FROM test_run_stories')) return [{ n: opts.count ?? 0 }];
      return [];
    }),
    getRepository: (e: unknown) => (e === TestRunStory ? stories : e === TestRunStoryStep ? steps : e === TestRunComment ? comments : null),
  };
  const dataSource = { transaction: (fn: (e: typeof em) => unknown) => fn(em), manager: em };
  const commentsService = { resolveRun: jest.fn(async () => ({ id: RUN, organizationId: ORG, teamId: null })) };
  const authz = { isOrganizationAdmin: jest.fn(async () => opts.admin ?? false) };
  const gateway = { emitStoryChanged: jest.fn() };
  const audit = { logDelete: jest.fn() };
  const service = new StoriesService(dataSource as never, commentsService as never, authz as never, gateway as never, audit as never);
  return { service, stories, em, saved };
}

describe('StoriesService agent stories', () => {
  it('marks a key-created story as an agent draft signed with the key, whatever the body says', async () => {
    const { service, saved } = setup();
    const dto = { title: 'Why p95 doubled', authorKind: 'user', authorName: 'Ada', status: 'published' } as never;
    const res = await service.create('run-1', dto, agent);
    expect(saved[0]).toMatchObject({ authorKind: 'agent', authorId: 'api-key:k1', authorName: 'Claude analysis agent', status: 'draft' });
    expect(res.authorKind).toBe('agent');
    expect(res.canEdit).toBe(true);
    expect(res.canDelete).toBe(false);
  });

  it("answers the key's 11th story on a run with 429 naming the limit, under the per-key advisory lock", async () => {
    const { service, em, stories } = setup({ count: 10 });
    const err = await service.create('run-1', { title: 't' }, agent).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect((err as HttpException).message).toMatch(/limit of 10 stories/);
    const sqls = em.query.mock.calls.map(([sql]) => String(sql));
    expect(sqls[0]).toContain("test_run_stories:agent:");
    expect(stories.save).not.toHaveBeenCalled();
  });

  it('applies no limit and no lock to a person', async () => {
    const { service, em, saved } = setup({ count: 99 });
    await service.create('run-1', { title: 't' }, ada);
    expect(saved[0]).toMatchObject({ authorKind: 'user', authorId: 'sub-1' });
    expect(em.query.mock.calls.some(([sql]) => String(sql).includes('test_run_stories:agent:'))).toBe(false);
  });

  it('lets a key edit the title, summary and steps of its own draft', async () => {
    const { service } = setup();
    await expect(service.update(STORY, { summary: 'GC pauses' }, agent)).resolves.toMatchObject({ summary: 'GC pauses' });
    await expect(service.replaceSteps(STORY, [], agent)).resolves.toBeDefined();
  });

  it('refuses status from a key, before reading anything', async () => {
    const { service, stories } = setup();
    await expect(service.update(STORY, { status: 'published' }, agent)).rejects.toBeInstanceOf(ForbiddenException);
    expect(stories.findOne).not.toHaveBeenCalled();
  });

  it("refuses a key editing another key's draft or its own published story", async () => {
    await expect(setup().service.update(STORY, { title: 'x' }, otherAgent)).rejects.toBeInstanceOf(ForbiddenException);
    const published = storyRow({ status: 'published', publishedById: 'sub-1', publishedByName: 'Ada' });
    await expect(setup({ story: published }).service.update(STORY, { title: 'x' }, agent)).rejects.toThrow(/can no longer change it/);
    await expect(setup({ story: published }).service.replaceSteps(STORY, [], agent)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("lets any user read, edit and publish an agent's draft, and records who published it", async () => {
    const { service, saved } = setup();
    await expect(service.get(STORY, bo)).resolves.toMatchObject({ canEdit: true, canDelete: true });
    const res = await service.update(STORY, { status: 'published', title: 'Reviewed' }, bo);
    expect(saved.at(-1)).toMatchObject({ status: 'published', publishedById: 'sub-2', publishedByName: 'Bo', title: 'Reviewed' });
    expect(res).toMatchObject({ status: 'published', publishedById: 'sub-2', publishedByName: 'Bo', authorName: 'Claude analysis agent' });
    expect(saved.at(-1)!.publishedAt).toBeInstanceOf(Date);
  });

  it("records the publisher on every publish, and keeps publishedAt from the first", async () => {
    const first = new Date('2026-11-01T00:00:00Z');
    const { service, saved } = setup({ story: storyRow({ publishedAt: first, publishedById: 'sub-1', publishedByName: 'Ada' }) });
    await service.update(STORY, { status: 'published' }, bo);
    expect(saved.at(-1)).toMatchObject({ publishedAt: first, publishedById: 'sub-2', publishedByName: 'Bo' });
  });

  it("lets any user delete an agent's draft", async () => {
    const { service, stories } = setup();
    await service.remove(STORY, bo);
    expect(stories.delete).toHaveBeenCalledWith({ id: STORY });
  });

  it('hands a published agent story to its publisher: others can no longer edit or delete it', async () => {
    const published = storyRow({ status: 'published', publishedAt: new Date(), publishedById: 'sub-1', publishedByName: 'Ada' });
    await expect(setup({ story: published }).service.update(STORY, { title: 'x' }, bo)).rejects.toThrow(/person who published/);
    await expect(setup({ story: published }).service.remove(STORY, bo)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(setup({ story: published }).service.update(STORY, { status: 'draft' }, ada)).resolves.toMatchObject({ status: 'draft' });
    // An org admin may still delete it, as for any story.
    await expect(setup({ story: published, admin: true }).service.remove(STORY, bo)).resolves.toBeUndefined();
  });

  it("keeps a user's draft author-only: 404 to another user and to a key", async () => {
    const userDraft = storyRow({ authorId: 'sub-1', authorName: 'Ada', authorKind: 'user' });
    await expect(setup({ story: userDraft }).service.get(STORY, bo)).rejects.toBeInstanceOf(NotFoundException);
    await expect(setup({ story: userDraft }).service.get(STORY, agent)).rejects.toBeInstanceOf(NotFoundException);
    await expect(setup({ story: userDraft }).service.get(STORY, ada)).resolves.toMatchObject({ canEdit: true });
  });

  it('never lets a key edit a user story, published or not', () => {
    const published = storyRow({ authorId: 'sub-1', authorKind: 'user', status: 'published' }) as unknown as TestRunStory;
    expect(editDenial(published, agent)).toMatch(/only stories it created/);
    expect(editDenial(published, ada)).toBeNull();
    expect(editDenial(published, bo)).toMatch(/Only the author/);
  });
});
