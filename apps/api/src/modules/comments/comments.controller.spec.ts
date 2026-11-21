import { ForbiddenException } from '@nestjs/common';
import { CommentsController } from './comments.controller';
import type { UserContext } from '../../common/decorators/user-context.decorator';

describe('CommentsController', () => {
  const service = {
    listThreads: jest.fn().mockResolvedValue([]),
    counts: jest.fn().mockResolvedValue({}),
    create: jest.fn(),
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
  const key = { userId: 'api-key:123', roles: [] } as unknown as UserContext;
  const person = { userId: 'sub-1', roles: [], displayName: 'Ada' } as unknown as UserContext;

  beforeEach(() => jest.clearAllMocks());

  // Design R3: comments are human-authored; an API key may read them but never write.
  it.each([
    ['create', () => controller.create('run', { card: 'graphs', body: 'x' }, key)],
    ['seen', () => controller.seen('run', { card: 'graphs' }, key)],
    ['update', () => controller.update('c', { body: 'x' }, key)],
    ['update (tag only)', () => controller.update('c', { tag: 'symptom' }, key)],
    ['remove', () => controller.remove('c', key)],
  ])('refuses %s from an API key with 403', async (_name, call) => {
    await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.create).not.toHaveBeenCalled();
    expect(service.markSeen).not.toHaveBeenCalled();
    expect(service.update).not.toHaveBeenCalled();
    expect(service.remove).not.toHaveBeenCalled();
  });

  it('lets an API key read', async () => {
    await controller.list('run', key);
    await controller.counts('run', key);
    expect(service.listThreads).toHaveBeenCalledWith('run', undefined, { userId: 'api-key:123', displayName: undefined, orgIds: ['org-a'] });
  });

  it('hands a person through with their display name and org scope', async () => {
    await controller.create('run', { card: 'graphs', body: 'x' }, person);
    expect(service.create).toHaveBeenCalledWith('run', { card: 'graphs', body: 'x' }, { userId: 'sub-1', displayName: 'Ada', orgIds: ['org-a'] });
  });

  it('hands a PATCH through whole, so a tag-only edit reaches the service', async () => {
    await controller.update('c', { tag: null }, person);
    expect(service.update).toHaveBeenCalledWith('c', { tag: null }, { userId: 'sub-1', displayName: 'Ada', orgIds: ['org-a'] });
  });

  // Stories inherit the R3 rule: an API key may read them, never write (PR6 adds an opt-in role).
  it.each([
    ['createStory', () => controller.createStory('run', { title: 't' }, key)],
    ['updateStory', () => controller.updateStory('s', { status: 'published' }, key)],
    ['replaceStorySteps', () => controller.replaceStorySteps('s', { steps: [] }, key)],
    ['removeStory', () => controller.removeStory('s', key)],
  ])('refuses %s from an API key with 403', async (_name, call) => {
    await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
    expect(stories.create).not.toHaveBeenCalled();
    expect(stories.update).not.toHaveBeenCalled();
    expect(stories.replaceSteps).not.toHaveBeenCalled();
    expect(stories.remove).not.toHaveBeenCalled();
  });

  it('lets an API key read stories', async () => {
    await controller.listStories('run', key);
    await controller.getStory('s', key);
    expect(stories.list).toHaveBeenCalledWith('run', { userId: 'api-key:123', displayName: undefined, orgIds: ['org-a'] });
  });

  it('hands the step list of a PUT through as the ordered array', async () => {
    const steps = [{ commentId: 'c2' }, { commentId: 'c1', note: 'then' }];
    await controller.replaceStorySteps('s', { steps }, person);
    expect(stories.replaceSteps).toHaveBeenCalledWith('s', steps, { userId: 'sub-1', displayName: 'Ada', orgIds: ['org-a'] });
  });
});
