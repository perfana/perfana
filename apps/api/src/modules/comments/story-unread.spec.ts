import { isStoryUnread } from './stories.service';

/** PR7: when an investigation (a story) counts as unread for the caller. */
describe('isStoryUnread', () => {
  const now = Date.parse('2026-11-21T12:00:00Z');
  const hoursAgo = (h: number) => new Date(now - h * 3_600_000);
  const story = (over: Partial<Parameters<typeof isStoryUnread>[0]> = {}) => ({
    authorId: 'anna',
    authorKind: 'user' as const,
    status: 'published' as const,
    activityAt: hoursAgo(1),
    createdAt: hoursAgo(5),
    ...over,
  });
  const mark = { userId: 'mark' };

  it('is unread for someone else who never opened a published story', () => {
    expect(isStoryUnread(story(), null, mark, now)).toBe(true);
  });

  it('is never unread for its author', () => {
    expect(isStoryUnread(story(), null, { userId: 'anna' }, now)).toBe(false);
  });

  it('is never unread for an API key', () => {
    expect(isStoryUnread(story(), null, { userId: 'api-key:1' }, now)).toBe(false);
  });

  it("is read once opened, and unread again after the next publish or steps change (activity_at moves)", () => {
    expect(isStoryUnread(story(), hoursAgo(0.5), mark, now)).toBe(false);
    expect(isStoryUnread(story({ activityAt: hoursAgo(0.1) }), hoursAgo(0.5), mark, now)).toBe(true);
    // The same instant (the reader's own write, one transaction) reads as read.
    expect(isStoryUnread(story({ activityAt: hoursAgo(0.5) }), hoursAgo(0.5), mark, now)).toBe(false);
  });

  it("counts an AI agent's draft, which everyone can see, and never a user's draft", () => {
    expect(isStoryUnread(story({ status: 'draft', authorKind: 'agent', authorId: 'api-key:9' }), null, mark, now)).toBe(true);
    expect(isStoryUnread(story({ status: 'draft' }), null, mark, now)).toBe(false);
  });

  it('stops counting after the 30-day window', () => {
    expect(isStoryUnread(story({ activityAt: hoursAgo(24 * 29) }), null, mark, now)).toBe(true);
    expect(isStoryUnread(story({ activityAt: hoursAgo(24 * 31) }), null, mark, now)).toBe(false);
  });
});
