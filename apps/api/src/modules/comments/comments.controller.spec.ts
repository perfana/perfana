import { ForbiddenException, HttpStatus } from '@nestjs/common';
import { CommentsController } from './comments.controller';
import type { UserContext } from '../../common/decorators/user-context.decorator';

describe('CommentsController', () => {
  const created = { id: 'c1' };
  const service = {
    listThreads: jest.fn().mockResolvedValue([]),
    counts: jest.fn().mockResolvedValue({}),
    createOrReplay: jest.fn().mockResolvedValue({ comment: created, created: true }),
    replyTo: jest.fn().mockResolvedValue({ comment: created, created: true }),
    markSeen: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const authz = { isGlobalAdmin: () => false, getAccessibleOrganizations: jest.fn().mockResolvedValue(['org-a']) };
  const stories = {
    list: jest.fn().mockResolvedValue([]),
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    replaceSteps: jest.fn(),
    remove: jest.fn(),
  };
  const controller = new CommentsController(service as never, authz as never, stories as never);
  const key = { userId: 'api-key:123', roles: [], apiKeyDescription: 'CI key' } as unknown as UserContext;
  const agentKey = { userId: 'api-key:456', roles: ['comments:write'], apiKeyDescription: 'Claude analysis agent' } as unknown as UserContext;
  const person = { userId: 'sub-1', roles: [], displayName: 'Ada' } as unknown as UserContext;
  // A person who somehow carries the scope as a Keycloak role gains nothing: it only reads on keys.
  const personWithScope = { userId: 'sub-2', roles: ['comments:write'], displayName: 'Bo' } as unknown as UserContext;
  const res = () => ({ status: jest.fn() });

  beforeEach(() => jest.clearAllMocks());

  // Design R3, as narrowed by the stories design: a key without comments:write may only read.
  it.each([
    ['create', () => controller.create('run', { card: 'graphs', body: 'x' }, key, res() as never)],
    ['reply', () => controller.reply('c', { body: 'x' }, key, res() as never)],
    ['seen', () => controller.seen('run', { card: 'graphs' }, key)],
    ['update', () => controller.update('c', { body: 'x' }, key)],
    ['update (tag only)', () => controller.update('c', { tag: 'symptom' }, key)],
    ['remove', () => controller.remove('c', key)],
  ])('refuses %s from an API key without comments:write with 403', async (_name, call) => {
    await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.createOrReplay).not.toHaveBeenCalled();
    expect(service.replyTo).not.toHaveBeenCalled();
    expect(service.markSeen).not.toHaveBeenCalled();
    expect(service.update).not.toHaveBeenCalled();
    expect(service.remove).not.toHaveBeenCalled();
  });

  it('names the missing role in the 403', async () => {
    await expect(controller.create('run', { card: 'graphs', body: 'x' }, key, res() as never)).rejects.toThrow(/comments:write/);
  });

  // With the role a key writes as an agent, but still never deletes or marks seen.
  it.each([
    ['seen', () => controller.seen('run', { card: 'graphs' }, agentKey)],
    ['remove', () => controller.remove('c', agentKey)],
  ])('refuses %s from a comments:write key with 403', async (_name, call) => {
    await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.markSeen).not.toHaveBeenCalled();
    expect(service.remove).not.toHaveBeenCalled();
  });

  it('lets a comments:write key create and edit, as an agent signed with its description', async () => {
    const r = res();
    await controller.create('run', { card: 'graphs', body: 'x' }, agentKey, r as never);
    const agent = { userId: 'api-key:456', displayName: 'Claude analysis agent', orgIds: ['org-a'], authorKind: 'agent' };
    expect(service.createOrReplay).toHaveBeenCalledWith('run', { card: 'graphs', body: 'x' }, agent);
    expect(r.status).not.toHaveBeenCalled();
    await controller.reply('c', { body: 'answer', clientRef: 'r' }, agentKey, res() as never);
    expect(service.replyTo).toHaveBeenCalledWith('c', { body: 'answer', clientRef: 'r' }, agent);
    await controller.update('c', { tag: 'evidence' }, agentKey);
    expect(service.update).toHaveBeenCalledWith('c', { tag: 'evidence' }, agent);
  });

  it('answers 200 instead of 201 when a clientRef replays an existing comment', async () => {
    service.createOrReplay.mockResolvedValueOnce({ comment: created, created: false });
    const r = res();
    await expect(controller.create('run', { card: 'graphs', body: 'x', clientRef: 'a' }, agentKey, r as never)).resolves.toBe(created);
    expect(r.status).toHaveBeenCalledWith(HttpStatus.OK);
  });

  it('lets an API key read', async () => {
    await controller.list('run', key);
    await controller.counts('run', key);
    expect(service.listThreads).toHaveBeenCalledWith('run', undefined, {
      userId: 'api-key:123',
      displayName: 'CI key',
      orgIds: ['org-a'],
      authorKind: 'agent',
    });
  });

  it('hands a person through with their display name and org scope, as a user', async () => {
    await controller.create('run', { card: 'graphs', body: 'x' }, person, res() as never);
    expect(service.createOrReplay).toHaveBeenCalledWith('run', { card: 'graphs', body: 'x' }, { userId: 'sub-1', displayName: 'Ada', orgIds: ['org-a'] });
    await controller.create('run', { card: 'graphs', body: 'x' }, personWithScope, res() as never);
    expect(service.createOrReplay).toHaveBeenLastCalledWith('run', { card: 'graphs', body: 'x' }, { userId: 'sub-2', displayName: 'Bo', orgIds: ['org-a'] });
  });

  it('hands a PATCH through whole, so a tag-only edit reaches the service', async () => {
    await controller.update('c', { tag: null }, person);
    expect(service.update).toHaveBeenCalledWith('c', { tag: null }, { userId: 'sub-1', displayName: 'Ada', orgIds: ['org-a'] });
  });

  // A key without comments:write may read stories and write none of them.
  it.each([
    ['createStory', () => controller.createStory('run', { title: 't' }, key)],
    ['updateStory', () => controller.updateStory('s', { title: 't' }, key)],
    ['replaceStorySteps', () => controller.replaceStorySteps('s', { steps: [] }, key)],
    ['removeStory', () => controller.removeStory('s', key)],
  ])('refuses %s from an API key without comments:write with 403', async (_name, call) => {
    await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
    expect(stories.create).not.toHaveBeenCalled();
    expect(stories.update).not.toHaveBeenCalled();
    expect(stories.replaceSteps).not.toHaveBeenCalled();
    expect(stories.remove).not.toHaveBeenCalled();
  });

  it('names the missing role when a key without it creates a story', async () => {
    await expect(controller.createStory('run', { title: 't' }, key)).rejects.toThrow(/comments:write/);
  });

  // PR6b: with the role a key proposes stories as an agent; it still never deletes one.
  it('lets a comments:write key create, edit and reorder stories as an agent', async () => {
    const agent = { userId: 'api-key:456', displayName: 'Claude analysis agent', orgIds: ['org-a'], authorKind: 'agent' };
    await controller.createStory('run', { title: 't' }, agentKey);
    expect(stories.create).toHaveBeenCalledWith('run', { title: 't' }, agent);
    await controller.updateStory('s', { summary: 'why' }, agentKey);
    expect(stories.update).toHaveBeenCalledWith('s', { summary: 'why' }, agent);
    await controller.replaceStorySteps('s', { steps: [{ commentId: 'c1' }] }, agentKey);
    expect(stories.replaceSteps).toHaveBeenCalledWith('s', [{ commentId: 'c1' }], agent);
  });

  it('refuses a story delete from a comments:write key with 403', async () => {
    await expect(controller.removeStory('s', agentKey)).rejects.toBeInstanceOf(ForbiddenException);
    expect(stories.remove).not.toHaveBeenCalled();
  });

  it('lets an API key read stories', async () => {
    await controller.listStories('run', key);
    await controller.getStory('s', key);
    expect(stories.list).toHaveBeenCalledWith('run', { userId: 'api-key:123', displayName: 'CI key', authorKind: 'agent', orgIds: ['org-a'] });
  });

  it('hands the step list of a PUT through as the ordered array', async () => {
    const steps = [{ commentId: 'c2' }, { commentId: 'c1', note: 'then' }];
    await controller.replaceStorySteps('s', { steps }, person);
    expect(stories.replaceSteps).toHaveBeenCalledWith('s', steps, { userId: 'sub-1', displayName: 'Ada', orgIds: ['org-a'] });
  });
});
