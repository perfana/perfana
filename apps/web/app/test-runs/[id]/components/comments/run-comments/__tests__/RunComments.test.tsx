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
  expect(await screen.findByTestId('run-comments-button')).toHaveAccessibleName('Comments: 1 story');
});

it("is shown when the run's only content is an AI agent's draft story (the API lists it to everyone)", async () => {
  mocked.fetchCommentCounts.mockResolvedValue({});
  mockedStories.fetchStories.mockResolvedValue([{ id: 's1', status: 'draft', authorKind: 'agent', authorId: 'api-key:k1' } as never]);
  renderButton();
  expect(await screen.findByTestId('run-comments-button')).toHaveAccessibleName('Comments: 1 story');
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

it('Stories tab: Read closes the dialog and opens the story reader', async () => {
  mockedStories.fetchStories.mockResolvedValue([
    { id: 's1', testRunId: 'run', title: 'Checkout latency', summary: null, status: 'published', authorId: 'other', authorName: 'Anna', authorKind: 'user',
      publishedAt: '2026-11-19T10:00:00Z', createdAt: '2026-11-19T10:00:00Z', updatedAt: '2026-11-19T10:00:00Z', stepCount: 2, canEdit: false, canDelete: false },
  ]);
  await renderCard();
  fireEvent.click(screen.getByRole('tab', { name: 'Stories' }));
  const row = await screen.findByTestId('story-row');
  expect(row).toHaveTextContent('Checkout latency');
  expect(within(row).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  fireEvent.click(within(row).getByRole('button', { name: 'Read' }));
  expect(mockPush).toHaveBeenCalledWith('/test-runs/run?story=s1', { scroll: false });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Comments' })).not.toBeInTheDocument());
});
