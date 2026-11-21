import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CommentsProvider, useComments } from '../../CommentsContext';
import RunCommentsButton from '../RunCommentsButton';
import * as api from '@/lib/test-run-comments';
import * as storiesApi from '@/lib/test-run-stories';

const handlers: Record<string, (c: api.RunComment) => void> = {};
jest.mock('@/lib/socket', () => ({
  socketManager: {
    isConnected: () => true,
    emit: jest.fn(),
    on: jest.fn((event: string, fn: (c: unknown) => void) => {
      handlers[event] = fn;
      return () => undefined;
    }),
    onConnectionStateChange: jest.fn(() => () => undefined),
  },
}));
jest.mock('@/lib/test-run-stories', () => ({
  ...jest.requireActual('@/lib/test-run-stories'),
  fetchStories: jest.fn(),
}));
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  usePathname: () => '/test-runs/run',
}));
jest.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
jest.mock('@/lib/test-run-comments', () => ({
  ...jest.requireActual('@/lib/test-run-comments'),
  fetchCommentCounts: jest.fn(),
  fetchCommentThreads: jest.fn(),
  markCommentsSeen: jest.fn(),
}));

const mocked = api as jest.Mocked<typeof api>;
const mockedStories = storiesApi as jest.Mocked<typeof storiesApi>;
const comment = (over: Partial<api.RunComment>): api.RunComment => ({
  id: 'c', testRunId: 'run', cardKey: 'graphs', parentId: null, itemKey: null, itemLabel: null, body: 'b', deleted: false,
  authorId: 'other', authorName: 'Anna', markerSeq: null, markerTime: null, chartContext: null, createdAt: '2026-11-19T09:00:00Z',
  editedAt: null, ...over,
});
const thread = (over: Partial<api.RunComment>, replies: api.RunComment[] = []): api.RunCommentThread => ({ ...comment(over), replies });

const THREADS: api.RunCommentThread[] = [
  thread({ id: 'old', cardKey: 'slo', itemKey: 'k', itemLabel: 'Login p95', body: 'oldest one', authorName: 'Bert', createdAt: '2026-11-19T08:00:00Z', tag: 'symptom' }),
  thread({ id: 'mid', cardKey: 'graphs', markerSeq: 3, markerTime: '2026-11-19T08:30:00Z', body: 'marker body', createdAt: '2026-11-19T09:00:00Z', tag: 'root-cause' },
    [comment({ id: 'r1', parentId: 'mid' }), comment({ id: 'r2', parentId: 'mid' })]),
  thread({ id: 'new', cardKey: 'details', body: 'newest one', createdAt: '2026-11-19T10:00:00Z' }),
  thread({ id: 'gone', cardKey: 'config', body: null, deleted: true, createdAt: '2026-11-19T07:00:00Z' }, [comment({ id: 'r3', parentId: 'gone' })]),
];

/** Exposes what the context did, since the drawer is not rendered here. */
function Probe() {
  const ctx = useComments();
  return <div data-testid="probe" data-open={ctx?.openCard ?? ''} data-focus={ctx?.focusCommentId ?? ''} data-replay={String(ctx?.focusReplay)} />;
}

const renderButton = ({ reveal = jest.fn() } = {}) =>
  render(
    <CommentsProvider runId="run" reveal={reveal}>
      <Probe />
      <RunCommentsButton />
    </CommentsProvider>,
  );
/** Render the header icon and open its dialog. */
const renderCard = async ({ reveal = jest.fn() } = {}) => {
  const r = renderButton({ reveal });
  fireEvent.click(await screen.findByTestId('run-comments-button'));
  await screen.findByRole('dialog', { name: 'Comments' });
  return r;
};

const rows = () => screen.getAllByTestId('run-comments-row');
const rowIds = () => rows().map((r) => r.getAttribute('data-comment-id'));

beforeEach(() => {
  jest.clearAllMocks();
  mocked.markCommentsSeen.mockResolvedValue(undefined);
  mocked.fetchCommentCounts.mockResolvedValue({ slo: { total: 1, unread: 0 }, graphs: { total: 3, unread: 1 }, details: { total: 1, unread: 0 }, config: { total: 1, unread: 0 } });
  mocked.fetchCommentThreads.mockResolvedValue({ threads: THREADS.map((t) => ({ ...t })), lastSeenAt: null });
  mockedStories.fetchStories.mockResolvedValue([]);
});

it('is hidden while the run has no comments and no stories, and fetches no threads', async () => {
  mocked.fetchCommentCounts.mockResolvedValue({});
  renderButton();
  await waitFor(() => expect(mockedStories.fetchStories).toHaveBeenCalledWith('run'));
  await waitFor(() => expect(mocked.fetchCommentCounts).toHaveBeenCalled());
  expect(screen.queryByTestId('run-comments-button')).not.toBeInTheDocument();
  expect(mocked.fetchCommentThreads).not.toHaveBeenCalled();
});

it('is shown for a run with stories only, so they stay reachable', async () => {
  mocked.fetchCommentCounts.mockResolvedValue({});
  mockedStories.fetchStories.mockResolvedValue([{ id: 's1' } as never]);
  renderButton();
  expect(await screen.findByTestId('run-comments-button')).toHaveAccessibleName('Comments: 1 investigation');
});

it("is shown when the run's only content is an AI agent's draft story (the API lists it to everyone)", async () => {
  mocked.fetchCommentCounts.mockResolvedValue({});
  mockedStories.fetchStories.mockResolvedValue([{ id: 's1', status: 'draft', authorKind: 'agent', authorId: 'api-key:k1' } as never]);
  renderButton();
  expect(await screen.findByTestId('run-comments-button')).toHaveAccessibleName('Comments: 1 investigation');
});

it('badges the total, says how many are unread, and fetches threads only once opened', async () => {
  renderButton();
  const button = await screen.findByTestId('run-comments-button');
  await waitFor(() => expect(button).toHaveAccessibleName('Comments: 6, 1 unread'));
  expect(screen.getByTestId('run-comments-badge')).toHaveTextContent('6');
  expect(mocked.fetchCommentThreads).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(await screen.findByRole('dialog', { name: 'Comments' })).toBeInTheDocument();
  await screen.findAllByTestId('run-comments-row');
  expect(mocked.fetchCommentThreads).toHaveBeenCalledWith('run');
  expect(mocked.markCommentsSeen).not.toHaveBeenCalled();
});

it('reads "Comments: 4" with nothing unread', async () => {
  mocked.fetchCommentCounts.mockResolvedValue({ slo: { total: 4, unread: 0 } });
  renderButton();
  const button = await screen.findByTestId('run-comments-button');
  await waitFor(() => expect(button).toHaveAccessibleName('Comments: 4'));
});

it('Next unread closes the dialog and opens the first card in page order with unread comments', async () => {
  const reveal = jest.fn();
  await renderCard({ reveal });
  const next = screen.getByTestId('run-comments-next-unread');
  expect(next).toHaveTextContent('Next unread (1)');
  fireEvent.click(next);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Comments' })).not.toBeInTheDocument());
  expect(reveal).toHaveBeenCalledWith('graphsExpanded');
  expect(screen.getByTestId('probe')).toHaveAttribute('data-open', 'graphs');
});

it('offers no Next unread when nothing is unread', async () => {
  mocked.fetchCommentCounts.mockResolvedValue({ slo: { total: 1, unread: 0 } });
  await renderCard();
  expect(screen.queryByTestId('run-comments-next-unread')).not.toBeInTheDocument();
});

it('lists every root run-wide, newest first, with its labels, and marks nothing seen', async () => {
  await renderCard();
  await screen.findAllByTestId('run-comments-row');
  expect(mocked.fetchCommentThreads).toHaveBeenCalledWith('run');
  expect(rowIds()).toEqual(['new', 'mid', 'old', 'gone']);
  const [details, marker, slo, gone] = rows();
  expect(details).toHaveTextContent('Test run details');
  expect(details).toHaveTextContent('newest one');
  expect(marker).toHaveTextContent('Graphs');
  expect(marker).toHaveTextContent('Marker 3');
  expect(marker).toHaveTextContent('Root cause');
  expect(marker).toHaveTextContent('2 replies');
  expect(slo).toHaveTextContent('Service level objectives');
  expect(slo).toHaveTextContent('Login p95');
  expect(slo).toHaveTextContent('Bert');
  expect(slo).toHaveTextContent('Symptom');
  expect(gone).toHaveTextContent('Comment deleted');
  expect(gone).toHaveTextContent('1 reply');
  expect(screen.getByRole('status')).toHaveTextContent('4 of 4 comments');
  expect(mocked.markCommentsSeen).not.toHaveBeenCalled();
});

it('filters by tag (multi), card, author and markers only, and says when nothing matches', async () => {
  await renderCard();
  await screen.findAllByTestId('run-comments-row');
  const tags = screen.getByRole('group', { name: 'Filter by tag' });

  fireEvent.click(within(tags).getByText('Symptom'));
  expect(rowIds()).toEqual(['old']);
  fireEvent.click(within(tags).getByText('Root cause'));
  expect(rowIds()).toEqual(['mid', 'old']);
  expect(screen.getByRole('status')).toHaveTextContent('2 of 4 comments');
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(rowIds()).toHaveLength(4);

  fireEvent.change(screen.getByLabelText('Card'), { target: { value: 'details' } });
  expect(rowIds()).toEqual(['new']);
  fireEvent.change(screen.getByLabelText('Card'), { target: { value: '' } });

  fireEvent.change(screen.getByLabelText('Author'), { target: { value: 'Bert' } });
  expect(rowIds()).toEqual(['old']);
  fireEvent.change(screen.getByLabelText('Author'), { target: { value: '' } });

  fireEvent.click(screen.getByLabelText('Markers only'));
  expect(rowIds()).toEqual(['mid']);

  fireEvent.change(screen.getByLabelText('Author'), { target: { value: 'Bert' } });
  expect(screen.queryAllByTestId('run-comments-row')).toHaveLength(0);
  expect(screen.getByText('No comments match these filters.')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('0 of 4 comments');
});

it('hides the tag filter when no comment has a tag (the API may not send `tag` at all)', async () => {
  mocked.fetchCommentThreads.mockResolvedValue({ threads: [thread({ id: 'a' }), thread({ id: 'b', tag: null })], lastSeenAt: null });
  await renderCard();
  await screen.findAllByTestId('run-comments-row');
  expect(screen.queryByRole('group', { name: 'Filter by tag' })).not.toBeInTheDocument();
});

it('Show in context reveals the card and opens its drawer on the thread with the view replayed', async () => {
  const reveal = jest.fn();
  await renderCard({ reveal });
  await screen.findAllByTestId('run-comments-row');
  fireEvent.click(screen.getByRole('button', { name: "Show in context: Bert's comment on Service level objectives · Login p95" }));
  expect(reveal).toHaveBeenCalledWith('sloExpanded');
  const probe = screen.getByTestId('probe');
  expect(probe).toHaveAttribute('data-open', 'slo');
  expect(probe).toHaveAttribute('data-focus', 'old');
  expect(probe).toHaveAttribute('data-replay', 'true');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Comments' })).not.toBeInTheDocument());
});

it('applies live creates, updates and deletes from the run room', async () => {
  await renderCard();
  await screen.findAllByTestId('run-comments-row');

  act(() => handlers['comment:created'](comment({ id: 'live', cardKey: 'trends', body: 'brand new', createdAt: '2026-11-19T11:00:00Z' })));
  expect(rowIds()[0]).toBe('live');
  expect(rows()[0]).toHaveTextContent('Trends');

  act(() => handlers['comment:created'](comment({ id: 'r9', parentId: 'live', body: 'a reply' })));
  expect(rows()[0]).toHaveTextContent('1 reply');
  expect(rowIds()).toHaveLength(5); // a reply is not a row

  act(() => handlers['comment:updated'](comment({ id: 'new', cardKey: 'details', body: 'edited text', createdAt: '2026-11-19T10:00:00Z' })));
  expect(screen.getByText('edited text')).toBeInTheDocument();

  act(() => handlers['comment:deleted'](comment({ id: 'mid', cardKey: 'graphs', markerSeq: 3, body: null, deleted: true, createdAt: '2026-11-19T09:00:00Z' })));
  expect(rows().find((r) => r.getAttribute('data-comment-id') === 'mid')).toHaveTextContent('Comment deleted');

  act(() => handlers['comment:deleted']({ ...comment({ id: 'live', cardKey: 'trends' }), hardDeleted: true } as api.RunComment));
  expect(rowIds()).not.toContain('live');
  expect(rowIds()).toHaveLength(4);
});

it('Investigations tab: Read closes the dialog and opens the reader', async () => {
  mockedStories.fetchStories.mockResolvedValue([
    { id: 's1', testRunId: 'run', title: 'Checkout latency', summary: null, status: 'published', authorId: 'other', authorName: 'Anna', authorKind: 'user',
      publishedAt: '2026-11-19T10:00:00Z', createdAt: '2026-11-19T10:00:00Z', updatedAt: '2026-11-19T10:00:00Z', stepCount: 2, canEdit: false, canDelete: false },
  ]);
  await renderCard();
  fireEvent.click(screen.getByRole('tab', { name: 'Investigations' }));
  const row = await screen.findByTestId('story-row');
  expect(row).toHaveTextContent('Checkout latency');
  expect(within(row).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  fireEvent.click(within(row).getByRole('button', { name: 'Read' }));
  expect(mockPush).toHaveBeenCalledWith('/test-runs/run?story=s1', { scroll: false });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Comments' })).not.toBeInTheDocument());
});

// --- PR7: investigations each comment is in, and unread state in the dialog ---

const storySummary = (over: Partial<storiesApi.RunStorySummary>): storiesApi.RunStorySummary => ({
  id: 's', testRunId: 'run', title: 'T', summary: null, status: 'published', authorId: 'other', authorName: 'Anna', authorKind: 'user',
  publishedAt: '2026-11-19T10:00:00Z', publishedById: 'other', publishedByName: 'Anna', createdAt: '2026-11-19T10:00:00Z',
  updatedAt: '2026-11-19T10:00:00Z', stepCount: 1, canEdit: false, canDelete: false, ...over,
});
const rowOf = (id: string) => rows().find((r) => r.getAttribute('data-comment-id') === id)!;

describe('investigation chips', () => {
  const withStories = (): api.RunCommentThread[] =>
    THREADS.map((t) =>
      t.id === 'mid'
        ? { ...t, stories: [
            { id: 's1', title: 'Checkout latency after the Tuesday deploy, part two', position: 3 },
            { id: 's2', title: 'GC', position: 1 },
            { id: 's3', title: 'Heap', position: 2 },
            { id: 's4', title: 'Hosts', position: 4 },
          ] }
        : t.id === 'old' ? { ...t, stories: [{ id: 's2', title: 'GC', position: 2 }] } : { ...t },
    );

  it('shows "In: <title>" per investigation, truncated, two at most and then +N', async () => {
    mocked.fetchCommentThreads.mockResolvedValue({ threads: withStories(), lastSeenAt: null });
    await renderCard();
    await screen.findAllByTestId('run-comments-row');
    const mid = within(rowOf('mid')).getByTestId('run-comments-row-stories');
    expect(mid).toHaveTextContent('In: Checkout latency after the Tues…');
    expect(mid).toHaveTextContent('In: GC');
    expect(mid).not.toHaveTextContent('Heap');
    expect(mid).toHaveTextContent('+2');
    expect(within(rowOf('old')).getByTestId('run-comments-row-stories')).toHaveTextContent('In: GC');
    expect(within(rowOf('new')).queryByTestId('run-comments-row-stories')).not.toBeInTheDocument();
  });

  it('a chip closes the dialog and opens that investigation in the reader', async () => {
    mocked.fetchCommentThreads.mockResolvedValue({ threads: withStories(), lastSeenAt: null });
    await renderCard();
    await screen.findAllByTestId('run-comments-row');
    fireEvent.click(within(rowOf('old')).getByRole('button', { name: 'Read the investigation GC (step 2)' }));
    expect(mockPush).toHaveBeenCalledWith('/test-runs/run?story=s2', { scroll: false });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Comments' })).not.toBeInTheDocument());
  });

  it('filters to comments not in an investigation yet', async () => {
    mocked.fetchCommentThreads.mockResolvedValue({ threads: withStories(), lastSeenAt: null });
    await renderCard();
    await screen.findAllByTestId('run-comments-row');
    fireEvent.click(screen.getByLabelText('Not in an investigation yet'));
    expect(rowIds()).toEqual(['new', 'gone']);
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(rowIds()).toHaveLength(4);
  });

  it('refetches on story:changed so a new investigation shows up on its comment', async () => {
    await renderCard();
    await screen.findAllByTestId('run-comments-row');
    expect(within(rowOf('new')).queryByTestId('run-comments-row-stories')).not.toBeInTheDocument();
    mocked.fetchCommentThreads.mockResolvedValue({
      threads: THREADS.map((t) => (t.id === 'new' ? { ...t, stories: [{ id: 's9', title: 'Fresh', position: 1 }] } : { ...t })),
      lastSeenAt: null,
    });
    act(() => (handlers['story:changed'] as unknown as (e: unknown) => void)({ testRunId: 'run', storyId: 's9' }));
    await waitFor(() => expect(within(rowOf('new')).getByTestId('run-comments-row-stories')).toHaveTextContent('In: Fresh'));
    expect(mocked.fetchCommentThreads).toHaveBeenCalledTimes(2);
    // The list stayed on screen while it refetched.
    expect(rowIds()).toHaveLength(4);
  });
});

describe('unread in the dialog', () => {
  const recent = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();

  it('dots a root that is unread, or has an unread reply, by the counts rule, and marks nothing seen', async () => {
    mocked.fetchCommentThreads.mockResolvedValue({
      threads: [
        thread({ id: 'fresh', cardKey: 'graphs', createdAt: recent(5) }),
        thread({ id: 'seen', cardKey: 'slo', createdAt: recent(30) }),
        thread({ id: 'mine', cardKey: 'details', authorId: 'me', createdAt: recent(5) }),
        thread({ id: 'reply', cardKey: 'slo', createdAt: recent(90) }, [comment({ id: 'rr', parentId: 'reply', cardKey: 'slo', createdAt: recent(2) })]),
        thread({ id: 'stale', cardKey: 'config', createdAt: new Date(Date.now() - 40 * 86_400_000).toISOString() }),
        thread({ id: 'deleted', cardKey: 'graphs', deleted: true, body: null, createdAt: recent(3) }),
      ],
      lastSeenAt: null,
      lastSeenByCard: { graphs: recent(10), slo: recent(10), details: null, config: null },
    });
    await renderCard();
    await screen.findAllByTestId('run-comments-row');
    const dotted = rows().filter((r) => within(r).queryByTestId('run-comments-unread-dot')).map((r) => r.getAttribute('data-comment-id'));
    expect(dotted.sort()).toEqual(['fresh', 'reply']);
    expect(mocked.markCommentsSeen).not.toHaveBeenCalled();
  });

  it('marks nothing when the API sends no lastSeenByCard (an older API)', async () => {
    mocked.fetchCommentThreads.mockResolvedValue({ threads: [thread({ id: 'fresh', createdAt: recent(5) })], lastSeenAt: null });
    await renderCard();
    await screen.findAllByTestId('run-comments-row');
    expect(screen.queryByTestId('run-comments-unread-dot')).not.toBeInTheDocument();
  });

  it('badges each tab with its unread count and dots each unread investigation', async () => {
    mockedStories.fetchStories.mockResolvedValue([
      storySummary({ id: 's1', title: 'Unread one', unread: true }),
      storySummary({ id: 's2', title: 'Read one', unread: false }),
    ]);
    await renderCard();
    expect(screen.getByRole('tab', { name: 'All comments, 1 unread' })).toBeInTheDocument();
    expect(screen.getByTestId('run-comments-tab-all-unread')).toHaveTextContent('1');
    const tab = await screen.findByRole('tab', { name: 'Investigations, 1 unread' });
    fireEvent.click(tab);
    const storyRows = await screen.findAllByTestId('story-row');
    expect(within(storyRows[0]!).getByTestId('story-unread-dot')).toBeInTheDocument();
    expect(within(storyRows[1]!).queryByTestId('story-unread-dot')).not.toBeInTheDocument();
  });

  it('shows plain tab names when nothing is unread', async () => {
    mocked.fetchCommentCounts.mockResolvedValue({ slo: { total: 1, unread: 0 } });
    mockedStories.fetchStories.mockResolvedValue([storySummary({ id: 's1', unread: false })]);
    await renderCard();
    expect(screen.getByRole('tab', { name: 'All comments' })).toBeInTheDocument();
    expect(await screen.findByRole('tab', { name: 'Investigations' })).toBeInTheDocument();
  });
});

describe('header icon with investigations', () => {
  it.each([
    ['comments unread only', { slo: { total: 2, unread: 1 } }, [storySummary({ unread: false })], 'Comments: 2, 1 unread', true],
    ['an investigation unread only', { slo: { total: 2, unread: 0 } }, [storySummary({ unread: true })], 'Comments: 2 · Investigations: 1 unread', true],
    ['both unread', { slo: { total: 12, unread: 3 } }, [storySummary({ id: 'a', unread: true }), storySummary({ id: 'b', unread: false })], 'Comments: 12, 3 unread · Investigations: 1 unread', true],
    ['nothing unread', { slo: { total: 2, unread: 0 } }, [storySummary({ unread: false })], 'Comments: 2', false],
    ['investigations only, one unread', {}, [storySummary({ unread: true })], 'Comments: 1 investigation · Investigations: 1 unread', true],
  ] as const)('%s', async (_n, counts, stories, label, red) => {
    mocked.fetchCommentCounts.mockResolvedValue(counts as never);
    mockedStories.fetchStories.mockResolvedValue([...stories]);
    renderButton();
    const button = await screen.findByTestId('run-comments-button');
    await waitFor(() => expect(button).toHaveAccessibleName(label));
    expect(button.className.includes('MuiIconButton-colorError')).toBe(red);
  });
});
