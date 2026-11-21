// Value: protects=comment tags in the web (design: test-run-analysis-stories.md, "Tags"): the chip
// shows each tag's label and nothing for an untagged or unknown key, the picker offers the six tags
// in order plus "No tag", a new root is posted with its tag, a reply composer has no picker, a
// deleted root keeps its chip, and the author's edit mode retags without resending an unchanged tag;
// fails_when=the drawer stops passing the tag to postComment/editComment, the picker reaches a reply,
// or the chip is dropped from deleted roots; why_new=comments.test.tsx predates tags; seam=the
// '@/lib/test-run-comments' module is mocked as in comments.test.tsx; no_claim=colour contrast
// (jsdom renders no theme colours worth asserting) and the server rules (API specs).
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { COMMENT_TAGS, COMMENT_TAG_LABELS } from '@perfana/shared/constants/comment-cards';
import { CommentsProvider } from '../CommentsContext';
import CardComments from '../CardComments';
import { CommentTagChip } from '../CommentTagChip';
import { CommentTagPicker } from '../CommentTagPicker';
import * as api from '@/lib/test-run-comments';

jest.mock('@/lib/socket', () => ({
  socketManager: {
    isConnected: () => true,
    emit: jest.fn(),
    on: jest.fn(() => () => undefined),
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
  postComment: jest.fn(),
  editComment: jest.fn(),
}));

const mocked = api as jest.Mocked<typeof api>;
const comment = (over: Partial<api.RunComment>): api.RunComment => ({
  id: 'c', testRunId: 'run', cardKey: 'graphs', parentId: null, itemKey: null, itemLabel: null, body: 'b', deleted: false,
  authorId: 'other', authorName: 'Anna', markerSeq: null, markerTime: null, chartContext: null, tag: null,
  createdAt: '2026-11-19T09:00:00Z', editedAt: null, ...over,
});

const openDrawer = async () => {
  render(
    <CommentsProvider runId="run" reveal={jest.fn()}>
      <CardComments card="graphsExpanded" expanded><div>graphs card</div></CardComments>
    </CommentsProvider>,
  );
  fireEvent.click(await screen.findByTestId('card-comments-graphs'));
  return screen.findByRole('complementary', { name: 'Comments on Graphs' });
};

const pickTag = async (scope: HTMLElement, label: string) => {
  fireEvent.mouseDown(within(scope).getByRole('combobox', { name: 'Comment tag' }));
  fireEvent.click(await screen.findByRole('option', { name: label }));
};

beforeEach(() => {
  jest.clearAllMocks();
  mocked.markCommentsSeen.mockResolvedValue(undefined);
  mocked.fetchCommentCounts.mockResolvedValue({});
});

describe('CommentTagChip', () => {
  it.each(COMMENT_TAGS)('shows the label of %s', (tag) => {
    render(<CommentTagChip tag={tag} />);
    expect(screen.getByText(COMMENT_TAG_LABELS[tag])).toHaveAttribute('data-comment-tag', tag);
  });

  it('renders nothing for an untagged comment or a key this build does not know', () => {
    const { container } = render(<><CommentTagChip tag={null} /><CommentTagChip tag="blame" /></>);
    expect(container).toBeEmptyDOMElement();
  });

  it('is a pressed toggle when clickable', () => {
    const onClick = jest.fn();
    render(<CommentTagChip tag="root-cause" onClick={onClick} selected />);
    const button = screen.getByRole('button', { name: 'Root cause' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledWith('root-cause');
  });
});

describe('CommentTagPicker', () => {
  it('offers No tag and the six tags in story order, and reports the pick', async () => {
    const onChange = jest.fn();
    render(<CommentTagPicker value={null} onChange={onChange} />);
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Comment tag' }));
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['No tag', ...COMMENT_TAGS.map((t) => COMMENT_TAG_LABELS[t])]);
    fireEvent.click(screen.getByRole('option', { name: 'Hypothesis' }));
    expect(onChange).toHaveBeenCalledWith('hypothesis');
  });

  it('clears to null with No tag', async () => {
    const onChange = jest.fn();
    render(<CommentTagPicker value="evidence" onChange={onChange} />);
    expect(screen.getByRole('combobox', { name: 'Comment tag' })).toHaveTextContent('Evidence');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Comment tag' }));
    fireEvent.click(await screen.findByRole('option', { name: 'No tag' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe('tags in the comments drawer', () => {
  it('posts a new root with the picked tag', async () => {
    mocked.fetchCommentThreads.mockResolvedValue({ threads: [], lastSeenAt: null });
    mocked.postComment.mockResolvedValue(comment({ id: 'n', authorId: 'me', body: 'p95 jumps', tag: 'symptom' }));
    const drawer = await openDrawer();
    await within(drawer).findByText('No comments on Graphs yet.');
    await pickTag(drawer, 'Symptom');
    fireEvent.change(within(drawer).getByLabelText('New comment on this card…'), { target: { value: 'p95 jumps' } });
    await act(async () => fireEvent.click(within(drawer).getByRole('button', { name: 'Comment' })));
    expect(mocked.postComment).toHaveBeenCalledWith('run', 'graphs', 'p95 jumps', undefined, undefined, undefined, 'symptom');
    // The composer starts the next comment untagged.
    await waitFor(() => expect(within(drawer).getByRole('combobox', { name: 'Comment tag' })).toHaveTextContent('Add tag'));
  });

  it("shows a root's chip, also once deleted, and offers no picker to a reply", async () => {
    mocked.fetchCommentThreads.mockResolvedValue({
      lastSeenAt: '2999-01-01T00:00:00Z',
      threads: [
        { ...comment({ id: 'live', body: 'heap.max halved', tag: 'root-cause', createdAt: '2026-11-19T10:00:00Z' }), replies: [] },
        { ...comment({ id: 'gone', body: null, deleted: true, tag: 'ruled-out' }), replies: [comment({ id: 'r', parentId: 'gone', body: 'kept' })] },
      ],
    });
    const drawer = await openDrawer();
    await within(drawer).findByText('heap.max halved');
    expect(within(drawer).getByText('Root cause')).toBeInTheDocument();
    expect(within(drawer).getByText('Ruled out')).toBeInTheDocument();
    const row = [...drawer.querySelectorAll('button[aria-expanded]')].find((b) => b.textContent?.includes('Root cause'))!;
    if (row.getAttribute('aria-expanded') === 'false') fireEvent.click(row);
    await within(drawer).findByLabelText('Reply…');
    // Only the new-root composer carries a picker; the open thread's reply box has none.
    expect(within(drawer).getAllByRole('combobox', { name: 'Comment tag' })).toHaveLength(1);
  });

  it("lets the author retag a root from its edit mode, sending the tag only when it changed", async () => {
    const mine = comment({ id: 'mine', authorId: 'me', body: 'GC pauses?', tag: 'hypothesis' });
    mocked.fetchCommentThreads.mockResolvedValue({ lastSeenAt: null, threads: [{ ...mine, replies: [] }] });
    mocked.editComment.mockResolvedValue({ ...mine, tag: 'ruled-out' });
    const drawer = await openDrawer();
    fireEvent.click((await within(drawer).findAllByText('GC pauses?'))[0]!);
    fireEvent.click(await within(drawer).findByRole('button', { name: 'Edit' }));
    const edit = within(drawer).getByLabelText('Edit comment').closest('.MuiBox-root')!.parentElement as HTMLElement;
    expect(within(edit).getByRole('combobox', { name: 'Comment tag' })).toHaveTextContent('Hypothesis');
    await pickTag(edit, 'Ruled out');
    await act(async () => fireEvent.click(within(drawer).getByRole('button', { name: 'Save' })));
    expect(mocked.editComment).toHaveBeenCalledWith('mine', 'GC pauses?', 'ruled-out');
    await waitFor(() => expect(within(drawer).getAllByText('Ruled out').length).toBeGreaterThan(0));

    // A text-only edit leaves the tag out of the request.
    mocked.editComment.mockClear();
    mocked.editComment.mockResolvedValue({ ...mine, tag: 'ruled-out', body: 'not GC' });
    fireEvent.click(await within(drawer).findByRole('button', { name: 'Edit' }));
    fireEvent.change(within(drawer).getByLabelText('Edit comment'), { target: { value: 'not GC' } });
    await act(async () => fireEvent.click(within(drawer).getByRole('button', { name: 'Save' })));
    expect(mocked.editComment).toHaveBeenCalledWith('mine', 'not GC', undefined);
  });
});
