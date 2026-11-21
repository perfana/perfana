// Value: protects=the page context hears story:changed for its own run only (ids, no body), a story
// Exit's applyView is a silent request that reveals nothing and clears an empty chart, and the
// drawer's delete confirmation names the stories a root is a step of; fails_when=the listener takes
// another run's event, applyView switches tabs or shows an Undo, or the confirmation drops the
// story names; why_new=new context members and drawer prop; seam=socket and API modules mocked;
// no_claim=the reader (stories.test.tsx), the cards' replay (their hook tests).
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CommentsProvider, emptyViewFor, useComments } from '../CommentsContext';
import CardComments from '../CardComments';
import * as api from '@/lib/test-run-comments';

const handlers: Record<string, (e: unknown) => void> = {};
jest.mock('@/lib/socket', () => ({
  socketManager: {
    isConnected: () => true,
    emit: jest.fn(),
    on: jest.fn((event: string, fn: (e: unknown) => void) => {
      handlers[event] = fn;
      return () => undefined;
    }),
    onConnectionStateChange: jest.fn(() => () => undefined),
  },
}));
jest.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
jest.mock('@/lib/test-run-comments', () => ({
  ...jest.requireActual('@/lib/test-run-comments'),
  fetchCommentCounts: jest.fn(),
  fetchCommentItemCounts: jest.fn().mockResolvedValue({}),
  fetchCommentThreads: jest.fn(),
  markCommentsSeen: jest.fn(),
}));
const mocked = api as jest.Mocked<typeof api>;

let latest: ReturnType<typeof useComments> = null;
function Probe() {
  latest = useComments();
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
  mocked.fetchCommentCounts.mockResolvedValue({ slo: { total: 1, unread: 0 } });
  mocked.markCommentsSeen.mockResolvedValue(undefined);
});

it('records story:changed for its own run only', async () => {
  render(<CommentsProvider runId="run" reveal={jest.fn()}><Probe /></CommentsProvider>);
  await waitFor(() => expect(handlers['story:changed']).toBeDefined());
  act(() => handlers['story:changed']!({ testRunId: 'other-run', storyId: 's9' }));
  expect(latest?.storyEvent).toBeNull();
  act(() => handlers['story:changed']!({ testRunId: 'run', storyId: 's1' }));
  expect(latest?.storyEvent).toEqual({ storyId: 's1', seq: expect.any(Number) });
});

it('applyView is a silent request that reveals nothing, and a null view clears a chart card', async () => {
  const reveal = jest.fn();
  render(<CommentsProvider runId="run" reveal={reveal}><Probe /></CommentsProvider>);
  const view = { kind: 'compare' as const, series: [], baselineTestRunId: 'R-1' };
  act(() => latest!.applyView('compare', view));
  expect(latest?.viewRequest).toMatchObject({ card: 'compare', silent: true, comment: { cardKey: 'compare', chartContext: view, itemKey: null } });
  act(() => latest!.applyView('graphs', null));
  expect(latest?.viewRequest).toMatchObject({ card: 'graphs', silent: true, comment: { chartContext: emptyViewFor('graphs') } });
  act(() => latest!.applyView('slo', null)); // a card with no view: nothing to put back
  expect(latest?.viewRequest?.card).toBe('graphs');
  expect(reveal).not.toHaveBeenCalled();
});

it("restoreView passes silent through and still reveals the card", async () => {
  const reveal = jest.fn();
  render(<CommentsProvider runId="run" reveal={reveal}><Probe /></CommentsProvider>);
  const c = { id: 'c1', cardKey: 'graphs', chartContext: { kind: 'graphs', series: [] } } as unknown as api.RunComment;
  act(() => latest!.restoreView(c, { silent: true }));
  expect(reveal).toHaveBeenCalledWith('graphsExpanded');
  expect(latest?.viewRequest).toMatchObject({ card: 'graphs', silent: true });
});

it('names the stories a root is a step of in the delete confirmation', async () => {
  mocked.fetchCommentThreads.mockResolvedValue({
    lastSeenAt: null,
    threads: [{
      id: 'r1', testRunId: 'run', cardKey: 'slo', parentId: null, itemKey: null, itemLabel: null, body: 'heap halved', deleted: false,
      authorId: 'me', authorName: 'Me', markerSeq: null, markerTime: null, chartContext: null, tag: 'root-cause',
      createdAt: '2026-11-20T10:00:00Z', editedAt: null, replies: [],
      stories: [{ id: 's1', title: 'Checkout latency', position: 3 }],
    }],
  });
  render(
    <CommentsProvider runId="run" reveal={jest.fn()}>
      <Probe />
      <CardComments card="sloExpanded" expanded><div>slo card</div></CardComments>
    </CommentsProvider>,
  );
  act(() => latest!.openDrawer('slo'));
  fireEvent.click(await screen.findByText('heap halved'));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
  expect(screen.getByTestId('comment-delete-confirm')).toHaveTextContent('It is step 3 of “Checkout latency”');
});
