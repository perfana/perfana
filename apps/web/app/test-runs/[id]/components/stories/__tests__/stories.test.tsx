// Value: protects=the story reader walks steps by URL and by keys, reveals/focuses/replays and opens
// the step's thread in the card's drawer (without a second, toasting replay), replays silently and puts every touched card back on exit, and degrades
// on deleted or missing cards; the editor's Suggest order, reorder buttons and atomic save; Add to
// story's "New story…"; fails_when=a step leaves the drawer closed or replays through it, a replay is not silent, Exit restores
// nothing, keyboard nav fires inside a text field, a deleted step navigates, or Save splits the
// step list; why_new=new components; seam=the comments context and next/navigation are mocked at
// their modules; no_claim=the cards' own replay (their hook tests), the API (live-DB spec).
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RunComment } from '@/lib/test-run-comments';
import * as storiesApi from '@/lib/test-run-stories';
import type { RunStory } from '@/lib/test-run-stories';

const ctx: Record<string, jest.Mock | unknown> = {};
jest.mock('../../comments/CommentsContext', () => ({
  ...jest.requireActual('../../comments/CommentsContext'),
  useComments: () => ctx,
}));

let search = new URLSearchParams();
const router = { replace: jest.fn(), push: jest.fn() };
jest.mock('next/navigation', () => ({
  useSearchParams: () => search,
  useRouter: () => router,
  usePathname: () => '/test-runs/run-1',
}));

jest.mock('@/lib/test-run-stories', () => ({
  ...jest.requireActual('@/lib/test-run-stories'),
  fetchStory: jest.fn(),
  fetchStories: jest.fn(),
  createStory: jest.fn(),
  replaceStorySteps: jest.fn(),
  updateStory: jest.fn(),
  deleteStory: jest.fn(),
  markStorySeen: jest.fn(),
}));
const api = storiesApi as jest.Mocked<typeof storiesApi>;

// Imported after the mocks.
// eslint-disable-next-line import/first
import StoryReader, { readerScreen } from '../StoryReader';
// eslint-disable-next-line import/first
import { StoryEditor } from '../StoryEditor';
// eslint-disable-next-line import/first
import { AddToStoryMenu } from '../AddToStoryMenu';
// eslint-disable-next-line import/first
import { isTypingTarget } from '../story-format';
// eslint-disable-next-line import/first
import { StoriesPanel } from '../StoriesPanel';
// eslint-disable-next-line import/first
import { AI_DRAFT_LABEL, storyAttribution, storyStatusLabel } from '../StoryAuthorLine';

const comment = (over: Partial<RunComment>): RunComment & { replyCount: number } => ({
  id: 'c', testRunId: 'run-1', cardKey: 'performance', parentId: null, itemKey: null, itemLabel: null, body: 'text', deleted: false,
  authorId: 'u1', authorName: 'Anna', markerSeq: null, markerTime: null, chartContext: null, tag: null,
  createdAt: '2026-11-20T10:00:00Z', editedAt: null, replyCount: 0, ...over,
});

const graphsView = { kind: 'graphs' as const, series: [{ dashboardId: 'd', panelId: 1, metricName: 'm' }] as never };
const STORY: RunStory = {
  id: 's1', testRunId: 'run-1', title: 'Checkout latency', summary: 'Heap too small.', status: 'published', authorId: 'u1', authorName: 'Anna',
  authorKind: 'user', publishedAt: '2026-11-20T12:00:00Z', publishedById: 'u1', publishedByName: 'Anna', createdAt: '2026-11-20T11:00:00Z', updatedAt: '2026-11-20T12:00:00Z',
  stepCount: 4, canEdit: true, canDelete: true,
  steps: [
    { position: 1, note: null, comment: comment({ id: 'm1', cardKey: 'graphs', markerSeq: 2, markerTime: '2026-11-20T10:05:00Z', chartContext: graphsView, body: 'p95 jumps', tag: 'symptom' }) },
    { position: 2, note: 'then the config', comment: comment({ id: 'cfg', cardKey: 'config', itemKey: 'config:heap.max', itemLabel: 'heap.max', body: 'heap halved', tag: 'root-cause' }) },
    { position: 3, note: 'ruled out early', comment: comment({ id: 'gone', cardKey: 'dynatrace', body: null, deleted: true, tag: 'ruled-out' }) },
    { position: 4, note: null, comment: comment({ id: 'dt', cardKey: 'dynatrace', body: 'host CPU fine' }) },
  ],
};

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const setUrl = (q: string) => {
  search = new URLSearchParams(q);
};
const lastReplace = () => router.replace.mock.calls.at(-1)?.[0] as string;

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(ctx, {
    runId: 'run-1',
    storyEvent: null,
    lastEvent: null,
    reveal: jest.fn(),
    focusItem: jest.fn(),
    restoreView: jest.fn(),
    openDrawer: jest.fn(),
    closeDrawer: jest.fn(),
    applyView: jest.fn(),
    setActiveThreadId: jest.fn(),
    noteStoryRead: jest.fn(),
    noteStoryChanged: jest.fn(),
    storyReadSeq: 0,
    captureView: jest.fn(() => ({ kind: 'graphs', series: [{ dashboardId: 'mine', panelId: 9, metricName: 'before' }] })),
  });
  api.fetchStory.mockResolvedValue(clone(STORY));
  api.markStorySeen.mockResolvedValue(undefined);
  document.body.innerHTML = '';
});

describe('readerScreen', () => {
  it('reads no step as the intro, 1..N as steps and past N as the conclusion', () => {
    expect(readerScreen(null, 3)).toEqual({ kind: 'intro' });
    expect(readerScreen('abc', 3)).toEqual({ kind: 'intro' });
    expect(readerScreen('1', 3)).toEqual({ kind: 'step', index: 0 });
    expect(readerScreen('3', 3)).toEqual({ kind: 'step', index: 2 });
    expect(readerScreen('4', 3)).toEqual({ kind: 'end' });
  });
});

describe('StoryReader', () => {
  it('shows the intro with a table of contents, and Start goes to step 1', async () => {
    setUrl('story=s1&tab=x');
    render(<StoryReader />);
    const dialog = await screen.findByRole('dialog', { name: 'Checkout latency' });
    expect(within(dialog).getByText('Configuration › heap.max')).toBeInTheDocument();
    // Named "investigation" in the UI (PR7); stored and routed as a story.
    expect(dialog).toHaveTextContent('An investigation by Anna');
    expect(within(dialog).getByText('Comment deleted')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start' }));
    expect(lastReplace()).toBe('/test-runs/run-1?tab=x&story=s1&step=1');
    expect(ctx.reveal).not.toHaveBeenCalled();
  });

  it('a chart step snapshots the card, replays silently, and opens its thread in the drawer without a second replay', async () => {
    setUrl('story=s1&step=1');
    render(<StoryReader />);
    await screen.findByTestId('story-bar');
    expect(screen.getByText('Investigation · step 1 of 4')).toBeInTheDocument();
    expect(ctx.captureView).toHaveBeenCalledWith('graphs', null);
    expect(ctx.reveal).toHaveBeenCalledWith('graphsExpanded');
    expect(ctx.restoreView).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }), { silent: true });
    expect((ctx.captureView as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan((ctx.restoreView as jest.Mock).mock.invocationCallOrder[0]!);
    expect(ctx.setActiveThreadId).toHaveBeenCalledWith('m1');
    expect(ctx.openDrawer).toHaveBeenCalledWith('graphs', 'm1'); // no third argument: no replay through the drawer
    expect((ctx.restoreView as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan((ctx.openDrawer as jest.Mock).mock.invocationCallOrder[0]!);
  });

  it('an item step focuses the item, opens its thread, and Open thread reopens it after the drawer was closed', async () => {
    setUrl('story=s1&step=2');
    render(<StoryReader />);
    await screen.findByTestId('story-bar');
    expect(ctx.focusItem).toHaveBeenCalledWith('config', 'config:heap.max');
    expect(ctx.restoreView).not.toHaveBeenCalled();
    expect(screen.getByTestId('story-step-note')).toHaveTextContent('then the config');
    expect(ctx.openDrawer).toHaveBeenCalledTimes(1);
    expect(ctx.openDrawer).toHaveBeenCalledWith('config', 'cfg');
    fireEvent.click(screen.getByRole('button', { name: 'Open thread' }));
    expect(ctx.openDrawer).toHaveBeenCalledTimes(2);
  });

  it('a deleted step keeps its tag and note and does not navigate', async () => {
    setUrl('story=s1&step=3');
    render(<StoryReader />);
    const bar = await screen.findByTestId('story-bar');
    expect(within(bar).getByText('Comment deleted')).toBeInTheDocument();
    expect(within(bar).getByText('Ruled out')).toBeInTheDocument();
    expect(within(bar).getByTestId('story-step-note')).toHaveTextContent('ruled out early');
    expect(ctx.reveal).not.toHaveBeenCalled();
    expect(ctx.focusItem).not.toHaveBeenCalled();
    expect(ctx.openDrawer).not.toHaveBeenCalled();
    expect(ctx.closeDrawer).toHaveBeenCalled(); // a previous step's drawer does not linger
  });

  // Value: protects=the bar centres on the page's content column, never on the window, so it does
  // not sit on the sidebar at laptop widths; fails_when=the bar goes back to left 50% of the window;
  // why_new=found by /ship QA at 1280px; seam=none; no_claim=real layout (jsdom rect is stubbed).
  it('centres the bar on the content column beside the sidebar', async () => {
    const main = document.createElement('main');
    main.className = 'content-area';
    main.getBoundingClientRect = () => ({ left: 280, width: 1000, top: 0, right: 1280, bottom: 900, height: 900, x: 280, y: 0, toJSON: () => ({}) });
    document.body.appendChild(main);
    try {
      setUrl('story=s1&step=3');
      render(<StoryReader />);
      const bar = await screen.findByTestId('story-bar');
      const style = window.getComputedStyle(bar);
      expect(style.left).toBe('780px');
    } finally {
      main.remove();
    }
  });

  it('says so when the step\'s card is not on this run', async () => {
    jest.useFakeTimers();
    try {
      setUrl('story=s1&step=4');
      render(<StoryReader />);
      await act(async () => {
        await Promise.resolve();
      });
      await screen.findByTestId('story-bar');
      expect(screen.queryByTestId('story-card-unavailable')).not.toBeInTheDocument();
      act(() => jest.advanceTimersByTime(1600));
      expect(screen.getByTestId('story-card-unavailable')).toHaveTextContent('card not available on this run');
    } finally {
      jest.useRealTimers();
    }
  });

  it('Prev / Next and the arrow keys walk the URL; keys inside a text field are left alone; Esc exits', async () => {
    setUrl('story=s1&step=2');
    render(<StoryReader />);
    await screen.findByTestId('story-bar');
    fireEvent.click(screen.getByRole('button', { name: 'Next ›' }));
    expect(lastReplace()).toBe('/test-runs/run-1?story=s1&step=3');
    fireEvent.click(screen.getByRole('button', { name: 'Previous step' }));
    expect(lastReplace()).toBe('/test-runs/run-1?story=s1&step=1');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(lastReplace()).toBe('/test-runs/run-1?story=s1&step=3');

    const input = document.createElement('input');
    document.body.appendChild(input);
    router.replace.mockClear();
    fireEvent.keyDown(input, { key: 'ArrowLeft' });
    expect(router.replace).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(lastReplace()).toBe('/test-runs/run-1?');
  });

  it('on exit puts back every card it replayed a view on, with the view captured before the first replay', async () => {
    jest.useFakeTimers();
    try {
      setUrl('story=s1&step=1');
      const { rerender } = render(<StoryReader />);
      await act(async () => {
        await Promise.resolve();
      });
      await screen.findByTestId('story-bar');
      setUrl('story=s1&step=2');
      rerender(<StoryReader />);
      setUrl('story=s1&step=1'); // revisiting the card does not take a second snapshot
      rerender(<StoryReader />);
      expect(ctx.captureView).toHaveBeenCalledTimes(1);

      setUrl('');
      rerender(<StoryReader />);
      act(() => jest.advanceTimersByTime(500));
      expect(ctx.applyView).toHaveBeenCalledTimes(1);
      expect(ctx.applyView).toHaveBeenCalledWith('graphs', { kind: 'graphs', series: [{ dashboardId: 'mine', panelId: 9, metricName: 'before' }] });
      expect(ctx.setActiveThreadId).toHaveBeenLastCalledWith(null);
      expect(ctx.closeDrawer).toHaveBeenCalled(); // the story's drawer goes with it
      expect(screen.queryByTestId('story-bar')).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows the conclusion past the last step', async () => {
    setUrl('story=s1&step=5');
    render(<StoryReader />);
    const dialog = await screen.findByRole('dialog', { name: /conclusion/ });
    expect(within(dialog).getByText('Heap too small.')).toBeInTheDocument();
  });

  // PR7: opening an investigation marks it read, once, and only when the API says it is unread.
  it('marks an unread investigation read when it opens, once, and tells the page', async () => {
    api.fetchStory.mockResolvedValue({ ...clone(STORY), unread: true });
    setUrl('story=s1');
    const { rerender } = render(<StoryReader />);
    await screen.findByRole('dialog', { name: 'Checkout latency' });
    await waitFor(() => expect(api.markStorySeen).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(ctx.noteStoryRead).toHaveBeenCalledTimes(1));
    rerender(<StoryReader />);
    expect(api.markStorySeen).toHaveBeenCalledTimes(1);
  });

  it('writes nothing for an investigation that is already read', async () => {
    api.fetchStory.mockResolvedValue({ ...clone(STORY), unread: false });
    setUrl('story=s1&step=2');
    render(<StoryReader />);
    await screen.findByTestId('story-bar');
    expect(api.markStorySeen).not.toHaveBeenCalled();
  });

  it('says a story it cannot read is not available', async () => {
    api.fetchStory.mockRejectedValue(Object.assign(new Error('Loading story failed (404)'), { status: 404 }));
    setUrl('story=nope');
    render(<StoryReader />);
    expect(await screen.findByText(/This investigation is not available/)).toBeInTheDocument();
  });
});

describe('isTypingTarget', () => {
  it('recognises text fields, selects and contenteditable', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    expect(isTypingTarget(document.createElement('select'))).toBe(true);
    expect(isTypingTarget(div)).toBe(true);
    expect(isTypingTarget(document.createElement('button'))).toBe(false);
    expect(isTypingTarget(window)).toBe(false);
  });
});

describe('StoryEditor', () => {
  const draft = (): RunStory => ({
    ...clone(STORY),
    status: 'draft',
    publishedAt: null,
    steps: [
      { position: 1, note: null, comment: comment({ id: 'a', tag: 'action', createdAt: '2026-11-20T10:00:00Z', body: 'raise heap' }) },
      { position: 2, note: null, comment: comment({ id: 'b', tag: 'symptom', createdAt: '2026-11-20T11:00:00Z', body: 'p95' }) },
      { position: 3, note: null, comment: comment({ id: 'c', tag: null, createdAt: '2026-11-20T09:00:00Z', body: 'misc' }) },
    ],
  });
  const order = () => screen.getAllByTestId('story-editor-step').map((el) => el.getAttribute('data-comment-id'));

  it('suggests an order by tag then time, moves steps with the buttons, and saves the whole list in one PUT', async () => {
    api.fetchStory.mockResolvedValue(draft());
    api.replaceStorySteps.mockImplementation(async (_id, steps) => ({ ...draft(), steps: steps.map((s, i) => ({ position: i + 1, note: s.note ?? null, comment: draft().steps.find((x) => x.comment.id === s.commentId)!.comment })) }));
    render(<StoryEditor storyId="s1" onClose={jest.fn()} onRead={jest.fn()} />);
    await screen.findByTestId('story-editor');
    expect(order()).toEqual(['a', 'b', 'c']);
    fireEvent.click(screen.getByRole('button', { name: 'Suggest order' }));
    expect(order()).toEqual(['b', 'a', 'c']);
    fireEvent.click(screen.getByRole('button', { name: 'Move step 3 up' }));
    expect(order()).toEqual(['b', 'c', 'a']);
    fireEvent.change(screen.getByLabelText('Note for step 1'), { target: { value: 'first the spike' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.replaceStorySteps).toHaveBeenCalledTimes(1));
    expect(api.replaceStorySteps).toHaveBeenCalledWith('s1', [
      { commentId: 'b', note: 'first the spike' },
      { commentId: 'c', note: null },
      { commentId: 'a', note: null },
    ]);
    expect(api.updateStory).not.toHaveBeenCalled();
  });

  it('cannot publish a story with no steps', async () => {
    api.fetchStory.mockResolvedValue({ ...draft(), steps: [] });
    render(<StoryEditor storyId="s1" onClose={jest.fn()} onRead={jest.fn()} />);
    await screen.findByTestId('story-editor');
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
  });

  it('removes a step and publishes after saving', async () => {
    api.fetchStory.mockResolvedValue(draft());
    api.replaceStorySteps.mockImplementation(async () => ({ ...draft(), steps: draft().steps.slice(1) }));
    api.updateStory.mockImplementation(async (_id, patch) => ({ ...draft(), steps: draft().steps.slice(1), status: patch.status ?? 'draft' }));
    render(<StoryEditor storyId="s1" onClose={jest.fn()} onRead={jest.fn()} />);
    await screen.findByTestId('story-editor');
    fireEvent.click(screen.getByRole('button', { name: 'Remove step 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }));
    await waitFor(() => expect(api.updateStory).toHaveBeenCalledWith('s1', { status: 'published' }));
    expect(api.replaceStorySteps).toHaveBeenCalledWith('s1', [{ commentId: 'b', note: null }, { commentId: 'c', note: null }]);
    expect(await screen.findByText('Published')).toBeInTheDocument();
  });
});

describe('AddToStoryMenu', () => {
  it('offers only the caller\'s stories and starts a new one with this comment as its first step', async () => {
    api.fetchStories.mockResolvedValue([
      { ...STORY, id: 'mine', title: 'Mine', canEdit: true },
      { ...STORY, id: 'theirs', title: 'Theirs', canEdit: false },
    ]);
    api.createStory.mockResolvedValue(clone(STORY));
    render(<AddToStoryMenu commentId="c42" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add to investigation' }));
    expect(await screen.findByText('Mine')).toBeInTheDocument();
    expect(screen.queryByText('Theirs')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('New investigation…'));
    expect(await screen.findByRole('dialog', { name: 'New investigation' })).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'GC pauses' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(api.createStory).toHaveBeenCalledWith('run-1', 'GC pauses', [{ commentId: 'c42' }]));
    // The comment's "In: …" chips refetch even with the socket down.
    await waitFor(() => expect(ctx.noteStoryChanged).toHaveBeenCalledWith('s1'));
  });
});

// PR6b: an agent's story is a proposal a person reviews and publishes.
describe('agent stories', () => {
  const agentDraft = (): RunStory => ({
    ...clone(STORY),
    status: 'draft',
    publishedAt: null,
    publishedById: null,
    publishedByName: null,
    authorId: 'api-key:k1',
    authorName: 'Claude analysis agent',
    authorKind: 'agent',
    canEdit: true,
    canDelete: true,
  });
  const agentPublished = (): RunStory => ({
    ...agentDraft(),
    status: 'published',
    publishedAt: '2026-11-20T12:00:00Z',
    publishedById: 'u2',
    publishedByName: 'Mark',
    canEdit: false,
    canDelete: false,
  });

  it('labels a draft, an agent draft and a published story, and words the attribution', () => {
    expect(storyStatusLabel({ status: 'draft', authorKind: 'user' })).toBe('Draft');
    expect(storyStatusLabel({ status: 'draft', authorKind: 'agent' })).toBe('AI draft · not reviewed');
    expect(storyStatusLabel({ status: 'published', authorKind: 'agent' })).toBe('Published');
    expect(storyAttribution(agentPublished())).toBe('Proposed by Claude analysis agent (AI) · reviewed and published by Mark');
    expect(storyAttribution(STORY)).toBe('Anna');
  });

  it('lists an agent draft with the AI chip, its label and Edit; a published one names agent and reviewer', async () => {
    api.fetchStories.mockResolvedValue([{ ...agentDraft(), id: 'd1', title: 'Agent draft' }, { ...agentPublished(), id: 'p1', title: 'Agent published' }]);
    render(<StoriesPanel />);
    const rows = await screen.findAllByTestId('story-row');
    const draftRow = rows.find((r) => within(r).queryByText('Agent draft'))!;
    expect(within(draftRow).getByText(AI_DRAFT_LABEL)).toBeInTheDocument();
    expect(within(draftRow).getByTestId('comment-author-ai')).toBeInTheDocument();
    expect(within(draftRow).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    const pubRow = rows.find((r) => within(r).queryByText('Agent published'))!;
    expect(within(pubRow).getByTestId('story-proposed-by')).toHaveTextContent('Proposed by Claude analysis agent');
    expect(within(pubRow).getByTestId('story-proposed-by')).toHaveTextContent('reviewed and published by Mark');
    expect(within(pubRow).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('opens an agent draft in the editor with the review notice, Publish and Delete for any user', async () => {
    api.fetchStory.mockResolvedValue(agentDraft());
    render(<StoryEditor storyId="s1" onClose={jest.fn()} onRead={jest.fn()} />);
    await screen.findByTestId('story-editor');
    expect(screen.getByText(AI_DRAFT_LABEL)).toBeInTheDocument();
    expect(within(screen.getByTestId('story-editor-author')).getByTestId('comment-author-ai')).toBeInTheDocument();
    expect(screen.getByTestId('story-agent-review')).toHaveTextContent(/nobody has reviewed it yet/);
    expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Delete investigation' })).toBeInTheDocument();
  });

  it('hides Delete in the editor when the caller may not delete', async () => {
    api.fetchStory.mockResolvedValue({ ...clone(STORY), canDelete: false });
    render(<StoryEditor storyId="s1" onClose={jest.fn()} onRead={jest.fn()} />);
    await screen.findByTestId('story-editor');
    expect(screen.queryByRole('button', { name: 'Delete investigation' })).not.toBeInTheDocument();
  });

  it("introduces an agent draft as an unreviewed AI draft everyone can see, and a published one with its reviewer", async () => {
    setUrl('story=s1');
    api.fetchStory.mockResolvedValue(agentDraft());
    const { unmount } = render(<StoryReader />);
    let dialog = await screen.findByRole('dialog', { name: 'Checkout latency' });
    expect(dialog).toHaveTextContent(`${AI_DRAFT_LABEL}, visible to everyone who can see this run`);
    expect(within(dialog).getAllByTestId('comment-author-ai').length).toBeGreaterThan(0);
    unmount();
    api.fetchStory.mockResolvedValue(agentPublished());
    render(<StoryReader />);
    dialog = await screen.findByRole('dialog', { name: 'Checkout latency' });
    expect(within(dialog).getByTestId('story-proposed-by')).toHaveTextContent('reviewed and published by Mark');
  });
});
