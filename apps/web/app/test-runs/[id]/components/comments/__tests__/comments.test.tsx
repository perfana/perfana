import React from 'react';
import { runCommentsLabel } from '../run-comments/RunCommentsButton';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { COMMENT_CARD_BY_EXPANSION_KEY } from '@perfana/shared/constants/comment-cards';
import { TAB_CARDS } from '../../../hooks/useExpansionState';
import { CommentsProvider, PAGE_ORDER, useCommentItemFocus, useComments, useGraphMarkers } from '../CommentsContext';
import CardComments from '../CardComments';
import CommentsDrawer, { describeView } from '../CommentsDrawer';

/** The Comments dialog's Next unread, without the dialog: what it calls once it has closed. */
function NextUnread() {
  const ctx = useComments();
  if (!ctx?.nextUnreadCard) return null;
  return (
    <button data-testid="next-unread" aria-label={`next: ${ctx.nextUnreadCard} (${ctx.totalUnread})`} onClick={ctx.jumpToNextUnread}>
      {ctx.totalUnread}
    </button>
  );
}
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
  postMarker: jest.fn(),
}));

const mocked = api as jest.Mocked<typeof api>;
const comment = (over: Partial<api.RunComment>): api.RunComment => ({
  id: 'c', testRunId: 'run', cardKey: 'graphs', parentId: null, body: 'b', deleted: false, authorId: 'other',
  authorName: 'Anna', markerSeq: null, markerTime: null, createdAt: '2026-11-19T09:00:00Z', editedAt: null, ...over,
});

const renderPage = (reveal = jest.fn()) =>
  render(
    <CommentsProvider runId="run" reveal={reveal}>
      <NextUnread />
      <CardComments card="sloExpanded" expanded><div>slo card</div></CardComments>
      <CardComments card="graphsExpanded" expanded><div>graphs card</div></CardComments>
    </CommentsProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mocked.markCommentsSeen.mockResolvedValue(undefined);
});

// Design R11: a stored card key must never depend on a React state name. Every card the page
// renders needs a permanent key, and no two cards may share one.
it('maps every expansion key on the page to a distinct permanent card key', () => {
  const pageKeys = Object.values(TAB_CARDS).flat().sort();
  expect(Object.keys(COMMENT_CARD_BY_EXPANSION_KEY).sort()).toEqual(pageKeys);
  const values = Object.values(COMMENT_CARD_BY_EXPANSION_KEY);
  expect(new Set(values).size).toBe(values.length);
});

it('builds the next-unread page order from the cards in page order', () => {
  expect(PAGE_ORDER).not.toContain(undefined);
  expect(PAGE_ORDER).toEqual(
    Object.values(TAB_CARDS).flat().map((k) => COMMENT_CARD_BY_EXPANSION_KEY[k as keyof typeof COMMENT_CARD_BY_EXPANSION_KEY]),
  );
  expect(PAGE_ORDER.slice(0, 2)).toEqual(['details', 'config']);
});

it('shows a red unread count, a neutral total when all is read, and nothing when a card has no comments', async () => {
  mocked.fetchCommentCounts.mockResolvedValue({ graphs: { total: 5, unread: 2 }, slo: { total: 3, unread: 0 } });
  render(
    <CommentsProvider runId="run" reveal={jest.fn()}>
      <CardComments card="graphsExpanded" expanded={false}><div>graphs card</div></CardComments>
      <CardComments card="sloExpanded" expanded={false}><div>slo card</div></CardComments>
      <CardComments card="trendsExpanded" expanded={false}><div>trends card</div></CardComments>
    </CommentsProvider>,
  );
  const graphs = await screen.findByTestId('card-comments-graphs');
  await waitFor(() => expect(graphs).toHaveAttribute('data-state', 'unread'));
  expect(graphs).toHaveTextContent('2');
  expect(graphs).toHaveAccessibleName('2 unread comments on Graphs (5 in total)');

  const slo = screen.getByTestId('card-comments-slo');
  expect(slo).toHaveAttribute('data-state', 'read');
  expect(slo).toHaveTextContent('3');

  const trends = screen.getByTestId('card-comments-trends');
  expect(trends).toHaveAttribute('data-state', 'empty');
  expect(trends).not.toHaveTextContent(/\d/);
  // Visible without hovering only when there is something to see.
  expect(graphs.parentElement).toHaveStyle({ opacity: '1' });
  expect(slo.parentElement).toHaveStyle({ opacity: '1' });
  expect(trends.parentElement).toHaveStyle({ opacity: '0' });
});

it('next unread jumps to the first unread card in page order and opens its drawer', async () => {
  mocked.fetchCommentCounts.mockResolvedValue({ graphs: { total: 1, unread: 1 }, slo: { total: 2, unread: 2 } });
  mocked.fetchCommentThreads.mockResolvedValue({ threads: [], lastSeenAt: null });
  const reveal = jest.fn();
  renderPage(reveal);
  const button = await screen.findByTestId('next-unread');
  expect(button).toHaveAccessibleName('next: slo (3)');

  fireEvent.click(button);
  expect(reveal).toHaveBeenCalledWith('sloExpanded'); // Results tab comes before Reporting
  expect(await screen.findByRole('complementary', { name: 'Comments on Service level objectives' })).toBeInTheDocument();
  await waitFor(() => expect(mocked.markCommentsSeen).toHaveBeenCalledWith('run', 'slo'));
});

it('says how many unread an AI agent wrote in the header comments label', () => {
  expect(runCommentsLabel(5, 5, 0, 3)).toBe('Comments: 5, 5 unread (3 from AI)');
  expect(runCommentsLabel(5, 5, 0, 0)).toBe('Comments: 5, 5 unread');
  expect(runCommentsLabel(5, 0, 0, 0)).toBe('Comments: 5');
});

it('marks an agent author with an AI chip in the drawer, and a person without one', async () => {
  mocked.fetchCommentCounts.mockResolvedValue({ graphs: { total: 2, unread: 0 } });
  mocked.fetchCommentThreads.mockResolvedValue({
    lastSeenAt: '2999-01-01T00:00:00Z',
    threads: [
      { ...comment({ id: 'ai', body: 'agent finding', authorName: 'Claude analysis agent', authorKind: 'agent' }), replies: [] },
      { ...comment({ id: 'hu', body: 'human note', authorName: 'Anna', authorKind: 'user' }), replies: [] },
    ],
  });
  renderPage();
  fireEvent.click(await screen.findByTestId('card-comments-graphs'));
  const drawer = await screen.findByRole('complementary', { name: 'Comments on Graphs' });
  await within(drawer).findAllByText('agent finding');
  const rows = [...drawer.querySelectorAll('button[aria-expanded]')];
  const agentRow = rows.find((r) => r.textContent?.includes('Claude analysis agent'))!;
  const humanRow = rows.find((r) => r.textContent?.includes('human note'))!;
  expect(within(agentRow as HTMLElement).getByTestId('comment-author-ai')).toHaveTextContent('AI');
  expect(within(humanRow as HTMLElement).queryByTestId('comment-author-ai')).toBeNull();
});

it('shows the investigations a thread is in, and a chip opens that investigation in the reader', async () => {
  mocked.fetchCommentCounts.mockResolvedValue({ graphs: { total: 2, unread: 0 } });
  mocked.fetchCommentThreads.mockResolvedValue({
    lastSeenAt: '2999-01-01T00:00:00Z',
    threads: [
      { ...comment({ id: 'in', body: 'p95 jumps' }), stories: [{ id: 'st1', title: 'Checkout latency after deploy', position: 1 }], replies: [] },
      { ...comment({ id: 'out', body: 'not in one' }), stories: [], replies: [] },
    ],
  });
  const router = (jest.requireMock('next/navigation') as { useRouter: () => { push: jest.Mock } }).useRouter();
  router.push.mockClear();
  renderPage();
  fireEvent.click(await screen.findByTestId('card-comments-graphs'));
  const drawer = await screen.findByRole('complementary', { name: 'Comments on Graphs' });
  await within(drawer).findAllByText('p95 jumps');
  const chips = within(drawer).getAllByTestId('drawer-thread-stories');
  expect(chips).toHaveLength(1);
  const chip = within(chips[0]!).getByRole('button', { name: /Read the investigation Checkout latency after deploy/ });
  expect(chip).toHaveTextContent('In: Checkout latency after deploy');
  // Outside the thread's own row button: a button inside a button is invalid and swallows clicks.
  expect(chip.closest('button[aria-expanded]')).toBeNull();
  fireEvent.click(chip);
  expect(router.push).toHaveBeenCalledWith(expect.stringContaining('story=st1'), { scroll: false });
});

it('lists unread threads first, expands the oldest unread one, and marks seen only after loading', async () => {
  mocked.fetchCommentCounts.mockResolvedValue({ graphs: { total: 1, unread: 1 } });
  mocked.fetchCommentThreads.mockResolvedValue({
    lastSeenAt: '2026-11-19T10:00:00Z',
    threads: [
      { ...comment({ id: 'old', body: 'already read', createdAt: '2026-11-19T08:00:00Z' }), replies: [] },
      { ...comment({ id: 'new', body: 'fresh one', createdAt: '2026-11-19T07:00:00Z', authorId: 'me', authorName: 'Me' }),
        replies: [comment({ id: 'r', parentId: 'new', body: 'unread reply', createdAt: '2026-11-19T11:00:00Z' })] },
    ],
  });
  renderPage();
  fireEvent.click(await screen.findByTestId('card-comments-graphs'));

  const drawer = await screen.findByRole('complementary', { name: 'Comments on Graphs' });
  await within(drawer).findAllByText('fresh one');
  const rows = [...drawer.querySelectorAll('button[aria-expanded]')];
  expect(rows[0]).toHaveTextContent('fresh one');
  expect(rows[0]).toHaveAttribute('aria-expanded', 'true');
  expect(within(drawer).getByText('unread reply')).toBeInTheDocument();
  expect(mocked.markCommentsSeen).toHaveBeenCalledTimes(1);
  expect(mocked.fetchCommentThreads.mock.invocationCallOrder[0]).toBeLessThan(mocked.markCommentsSeen.mock.invocationCallOrder[0]);
});

it("offers Delete, but not Edit, on someone else's comment only when the API says the caller may moderate", async () => {
  mocked.fetchCommentCounts.mockResolvedValue({ graphs: { total: 1, unread: 0 } });
  const thread = { ...comment({ id: 'theirs', body: 'by someone else' }), replies: [] };
  mocked.fetchCommentThreads.mockResolvedValue({ threads: [thread], lastSeenAt: '2999-01-01T00:00:00Z', canModerate: true });
  const { unmount } = renderPage();
  fireEvent.click(await screen.findByTestId('card-comments-graphs'));
  let drawer = await screen.findByRole('complementary', { name: 'Comments on Graphs' });
  await within(drawer).findAllByText('by someone else');
  const expand = (d: HTMLElement) => {
    const row = d.querySelector('button[aria-expanded]');
    if (row?.getAttribute('aria-expanded') === 'false') fireEvent.click(row);
  };
  expand(drawer);
  expect(await within(drawer).findByRole('button', { name: 'Delete' })).toBeInTheDocument();
  expect(within(drawer).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  unmount();

  mocked.fetchCommentThreads.mockResolvedValue({ threads: [thread], lastSeenAt: '2999-01-01T00:00:00Z', canModerate: false });
  renderPage();
  fireEvent.click(await screen.findByTestId('card-comments-graphs'));
  drawer = await screen.findByRole('complementary', { name: 'Comments on Graphs' });
  await within(drawer).findAllByText('by someone else');
  expand(drawer);
  await within(drawer).findAllByText('by someone else');
  expect(within(drawer).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
});

it('keeps the text in the box when posting fails', async () => {
  mocked.fetchCommentCounts.mockResolvedValue({});
  mocked.fetchCommentThreads.mockResolvedValue({ threads: [], lastSeenAt: null });
  mocked.postComment.mockRejectedValue(new Error('Posting comment failed (500)'));
  renderPage();
  fireEvent.click(await screen.findByTestId('card-comments-graphs'));
  expect(await screen.findByText('No comments on Graphs yet.')).toBeInTheDocument();

  const box = screen.getByLabelText('New comment on this card…');
  fireEvent.change(box, { target: { value: 'GC storm starts here' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Comment' })));

  expect(await screen.findByRole('alert')).toHaveTextContent('Not posted');
  expect(box).toHaveValue('GC storm starts here');
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
});

// Row anchors: a card registers how to show one of its rows; the drawer asks it to whenever an
// anchored thread is opened, and a comment started from a row carries that row's anchor.
function FakeSloCard({ onFocus }: { onFocus: (key: string) => boolean }) {
  useCommentItemFocus('slo', onFocus);
  const ctx = useComments();
  return <button onClick={() => ctx?.commentOnItem('slo', 'row-7', 'Heap Usage SLO')}>comment on row</button>;
}

it('opening an anchored thread asks its card to show that row', async () => {
  mocked.fetchCommentCounts.mockResolvedValue({ slo: { total: 1, unread: 1 } });
  mocked.fetchCommentThreads.mockResolvedValue({
    lastSeenAt: null,
    threads: [{ ...comment({ id: 't1', cardKey: 'slo', itemKey: 'row-7', itemLabel: 'Heap Usage SLO', body: 'too tight' }), replies: [] }],
  });
  const onFocus = jest.fn().mockReturnValue(true);
  const reveal = jest.fn();
  render(
    <CommentsProvider runId="run" reveal={reveal}>
      <FakeSloCard onFocus={onFocus} />
      <NextUnread />
      <CommentsDrawer />
    </CommentsProvider>,
  );
  fireEvent.click(await screen.findByTestId('next-unread'));
  // The only unread thread auto-expands on open, which is "opening" it.
  await waitFor(() => expect(onFocus).toHaveBeenCalledWith('row-7'));
  expect(reveal).toHaveBeenCalledWith('sloExpanded');
  expect(within(screen.getByRole('complementary')).getAllByText('Heap Usage SLO').length).toBeGreaterThan(0);
});

it('a comment started from a row is posted with that row as its anchor', async () => {
  mocked.fetchCommentCounts.mockResolvedValue({});
  mocked.fetchCommentThreads.mockResolvedValue({ threads: [], lastSeenAt: null });
  mocked.postComment.mockResolvedValue(comment({ id: 'n', cardKey: 'slo', itemKey: 'row-7', itemLabel: 'Heap Usage SLO', authorId: 'me' }));
  const onFocus = jest.fn().mockReturnValue(true);
  render(
    <CommentsProvider runId="run" reveal={jest.fn()}>
      <FakeSloCard onFocus={onFocus} />
      <CommentsDrawer />
    </CommentsProvider>,
  );
  fireEvent.click(screen.getByText('comment on row'));
  const box = await screen.findByLabelText('Comment on Heap Usage SLO…');
  expect(screen.getByText('Heap Usage SLO', { selector: 'span' })).toBeInTheDocument();
  fireEvent.change(box, { target: { value: 'margin is 8%' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Comment' })));
  expect(mocked.postComment).toHaveBeenCalledWith('run', 'slo', 'margin is 8%', undefined, { itemKey: 'row-7', itemLabel: 'Heap Usage SLO' }, undefined, null);
  // The author is already at the row: posting must not yank the page to it again.
  expect(onFocus).not.toHaveBeenCalled();
});

// The panel belongs to the expanded card, not to the page.
describe('panel placement', () => {
  function Page({ graphsExpanded, reveal }: { graphsExpanded: boolean; reveal: jest.Mock }) {
    return (
      <CommentsProvider runId="run" reveal={reveal}>
        <CardComments card="sloExpanded" expanded={false}><div>slo card</div></CardComments>
        <CardComments card="graphsExpanded" expanded={graphsExpanded}><div>graphs card</div></CardComments>
      </CommentsProvider>
    );
  }

  beforeEach(() => {
    mocked.fetchCommentCounts.mockResolvedValue({});
    mocked.fetchCommentThreads.mockResolvedValue({ threads: [], lastSeenAt: null });
  });

  it('renders inside the expanded card cell, next to the card', async () => {
    render(<Page graphsExpanded reveal={jest.fn()} />);
    fireEvent.click(await screen.findByTestId('card-comments-graphs'));
    const panel = await screen.findByRole('complementary', { name: 'Comments on Graphs' });
    const cell = screen.getByTestId('comment-card-graphsExpanded');
    expect(cell).toContainElement(panel);
    expect(within(cell).getByText('graphs card')).toBeInTheDocument();
    expect(screen.getByTestId('comment-card-sloExpanded')).not.toContainElement(panel);
  });

  // A remount drops the card's state: opening Graphs comments wiped the user's chart.
  it('keeps the card mounted, with its state, when the panel opens and closes', async () => {
    let mounts = 0;
    function Stateful() {
      React.useEffect(() => {
        mounts += 1;
      }, []);
      return <div>graphs card</div>;
    }
    render(
      <CommentsProvider runId="run" reveal={jest.fn()}>
        <CardComments card="graphsExpanded" expanded><Stateful /></CardComments>
      </CommentsProvider>,
    );
    expect(mounts).toBe(1);
    fireEvent.click(await screen.findByTestId('card-comments-graphs'));
    await screen.findByRole('complementary', { name: 'Comments on Graphs' });
    fireEvent.click(screen.getByRole('button', { name: 'Close comments' }));
    await waitFor(() => expect(screen.queryByRole('complementary')).not.toBeInTheDocument());
    expect(mounts).toBe(1);
  });

  it('expands a collapsed card before opening its comments, and closes them when it collapses', async () => {
    // Stands in for page.tsx: reveal expands the card in the same batch as the open.
    let collapse: () => void = () => undefined;
    function Harness() {
      const [expanded, setExpanded] = React.useState(false);
      collapse = () => setExpanded(false);
      const reveal = React.useCallback(() => setExpanded(true), []);
      return (
        <CommentsProvider runId="run" reveal={reveal}>
          <CardComments card="graphsExpanded" expanded={expanded}><div>graphs card</div></CardComments>
          <button onClick={() => setExpanded(true)}>expand</button>
        </CommentsProvider>
      );
    }
    render(<Harness />);
    fireEvent.click(await screen.findByTestId('card-comments-graphs'));
    expect(await screen.findByRole('complementary', { name: 'Comments on Graphs' })).toBeInTheDocument();

    act(() => collapse());
    await waitFor(() => expect(screen.queryByRole('complementary')).not.toBeInTheDocument());
    fireEvent.click(screen.getByText('expand'));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument(); // stays closed
  });
});

describe('item headers in the root-cause cards', () => {
  it('mark a tab red for unread, grey for read, nothing without threads', async () => {
    const { TabCommentMark } = await import('../ItemCommentHeader');
    const counts = { a: { threads: 1, unread: 1 }, b: { threads: 2, unread: 0 } };
    const { container, rerender } = render(<TabCommentMark counts={counts} itemKey="a" />);
    expect(screen.getByLabelText('1 unread comments')).toBeInTheDocument();
    rerender(<TabCommentMark counts={counts} itemKey="b" />);
    expect(screen.getByLabelText('2 comment threads')).toBeInTheDocument();
    rerender(<TabCommentMark counts={counts} itemKey="c" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('tracing comment anchors', () => {
  it('carry the service and its filters, and read back the same', async () => {
    const { tracingItemKey, parseTracingItemKey } = await import('../../distributed-tracing/components/DistributedTracingExpandedContent');
    const svc = { tracingServiceId: 's1', serviceName: 'orders|api', tracingInstanceLabel: 'j', tracingUi: 'jaeger' as const };
    const key = tracingItemKey(svc, { scenario: 'checkout', transaction: 'pay', sampler: null });
    expect(parseTracingItemKey(key)).toEqual({ serviceId: 's1', serviceName: 'orders|api', scenario: 'checkout', transaction: 'pay', sampler: null });
    expect(parseTracingItemKey('s1|orders')).toBeNull();
  });
});

describe('pyroscope comment anchors', () => {
  it('carry the view, and still read the earlier key without one', async () => {
    const { pyroscopeItemKey, parsePyroscopeItemKey } = await import('../../pyroscope/utils/pyroscope-comment-key');
    const combo = { application: 'fe', profiler: 'memory:alloc:bytes' };
    expect(parsePyroscopeItemKey(pyroscopeItemKey(combo, 1))).toEqual({ ...combo, viewModeTab: 1 });
    expect(parsePyroscopeItemKey('fe|memory:alloc:bytes')).toEqual({ ...combo, viewModeTab: null });
  });
});

describe('a single read thread', () => {
  function Card({ card, onFocus }: { card: 'distributed-tracing' | 'slo'; onFocus: (key: string) => boolean }) {
    useCommentItemFocus(card, onFocus);
    const ctx = useComments();
    return <button onClick={() => ctx?.openDrawer(card)}>open comments</button>;
  }
  const setup = (card: 'distributed-tracing' | 'slo') => {
    mocked.fetchCommentCounts.mockResolvedValue({ [card]: { total: 1, unread: 0 } });
    mocked.fetchCommentThreads.mockResolvedValue({
      lastSeenAt: '2999-01-01T00:00:00Z', // read
      threads: [{ ...comment({ id: 't1', cardKey: card, itemKey: 'k1', itemLabel: 'orders · Checkout / Pay' }), replies: [] }],
    });
    const onFocus = jest.fn().mockReturnValue(true);
    render(
      <CommentsProvider runId="run" reveal={jest.fn()}>
        <Card card={card} onFocus={onFocus} />
        <CommentsDrawer />
      </CommentsProvider>,
    );
    fireEvent.click(screen.getByText('open comments'));
    return onFocus;
  };

  it('opens by itself on the tracing card and restores its view', async () => {
    const onFocus = setup('distributed-tracing');
    await waitFor(() => expect(onFocus).toHaveBeenCalledWith('k1'));
  });

  it('stays closed on other cards', async () => {
    const onFocus = setup('slo');
    await waitFor(() => expect(mocked.markCommentsSeen).toHaveBeenCalled());
    expect(onFocus).not.toHaveBeenCalled();
  });
});

// Value: protects=the test-run list's comment badge landing on the right card with its comments open
// (`?comments=next` = first unread card, `?comments=first` = first card with comments); fails_when=the
// param name drifts from TestRunsTable's `comments`, CommentDeepLink stops waiting for counts, or the
// next/first branches are swapped; why_new=the header-button test calls jumpToNextUnread by click,
// nothing rendered CommentDeepLink; seam=none (global next/navigation mock); no_claim=the DataGrid
// cell that builds the URL.
describe('list badge deep link', () => {
  const nav = jest.requireMock('next/navigation') as { useSearchParams: jest.Mock };
  let restore: () => void = () => undefined;
  afterEach(() => restore());

  it.each([
    ['next', { graphs: { total: 1, unread: 1 }, slo: { total: 2, unread: 2 } }, 'sloExpanded', 'Service level objectives'],
    ['first', { graphs: { total: 3, unread: 0 } }, 'graphsExpanded', 'Graphs'],
  ])('?comments=%s reveals the card once counts arrive and opens its comments', async (mode, counts, key, title) => {
    const params = new URLSearchParams(`comments=${mode}`);
    const original = nav.useSearchParams.getMockImplementation();
    nav.useSearchParams.mockImplementation(() => params);
    restore = () => nav.useSearchParams.mockImplementation(original);
    const { default: CommentDeepLink } = await import('../CommentDeepLink');
    mocked.fetchCommentCounts.mockResolvedValue(counts);
    mocked.fetchCommentThreads.mockResolvedValue({ threads: [], lastSeenAt: null });
    const reveal = jest.fn();
    render(
      <CommentsProvider runId="run" reveal={reveal}>
        <CommentDeepLink />
        <CardComments card="sloExpanded" expanded><div>slo card</div></CardComments>
        <CardComments card="graphsExpanded" expanded><div>graphs card</div></CardComments>
      </CommentsProvider>,
    );
    expect(await screen.findByRole('complementary', { name: `Comments on ${title}` })).toBeInTheDocument();
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(reveal).toHaveBeenCalledWith(key);
  });
});

// Value: protects=a Performance Analysis transaction anchor reading back the same scenario and
// transaction, whatever characters they hold, and rejecting a key of another shape;
// fails_when=the key moves to a separator join (a `|` in a name splits wrong) or the parser accepts
// a non-pair; why_new=only the tracing and pyroscope keys had round-trip tests; seam=none;
// no_claim=TransactionsTable's focus scrolling.
describe('transaction comment anchors', () => {
  it('round-trip any text and refuse other shapes', async () => {
    const { transactionItemKey, parseTransactionItemKey } = await import('../../performance-analysis/utils/scenario-filter');
    const key = transactionItemKey('checkout|eu', 'Pay "now" / confirm');
    expect(parseTransactionItemKey(key)).toEqual({ scenario: 'checkout|eu', transaction: 'Pay "now" / confirm' });
    expect(transactionItemKey('a', 'b')).not.toBe(transactionItemKey('b', 'a'));
    for (const bad of ['checkout|pay', '["only-one"]', '["a",2]', '{"a":"b"}', '']) {
      expect(parseTransactionItemKey(bad)).toBeNull();
    }
  });
});

// Value: protects=a tracing service tab summing every anchor of that service (one per filter set)
// into one mark, red when any is unread; fails_when=the predicate branch of TabCommentMark takes the
// first match or drops unread; why_new=the existing TabCommentMark case passes string keys only;
// seam=none; no_claim=which keys isServiceKey selects.
describe('tab mark over several anchors', () => {
  it('sums the threads and unread of every key the predicate accepts', async () => {
    const { TabCommentMark } = await import('../ItemCommentHeader');
    const counts = { 's1:a': { threads: 2, unread: 0 }, 's1:b': { threads: 1, unread: 3 }, 's2:a': { threads: 5, unread: 5 } };
    const { rerender, container } = render(<TabCommentMark counts={counts} itemKey={(k) => k.startsWith('s1:')} />);
    expect(screen.getByLabelText('3 unread comments')).toBeInTheDocument();
    rerender(<TabCommentMark counts={{ 's1:a': { threads: 2, unread: 0 }, 's1:b': { threads: 1, unread: 0 } }} itemKey={(k) => k.startsWith('s1:')} />);
    expect(screen.getByLabelText('3 comment threads')).toBeInTheDocument();
    rerender(<TabCommentMark counts={counts} itemKey={(k) => k.startsWith('s3:')} />);
    expect(container).toBeEmptyDOMElement();
  });
});

// Value: protects=the "+mm:ss" half of a marker's time label, which is what places it in the run;
// fails_when=the elapsed maths, the hour roll-over, the sign or the no-start fallback breaks;
// why_new=formatMarkerTime had no test; seam=none (pure); no_claim=the locale's wall-clock half.
describe('formatMarkerTime', () => {
  const start = '2026-11-20T10:00:00Z';
  it.each([
    ['2026-11-20T10:37:10Z', / \(\+37:10\)$/],
    ['2026-11-20T10:00:05Z', / \(\+0:05\)$/],
    ['2026-11-20T11:02:03Z', / \(\+1:02:03\)$/],
    ['2026-11-20T09:59:55Z', / \(-0:05\)$/],
  ])('%s reads %s into the run', (iso, suffix) => {
    expect(api.formatMarkerTime(iso, start)).toMatch(suffix);
  });
  it('prints the wall clock alone without a usable run start', () => {
    expect(api.formatMarkerTime('2026-11-20T10:37:10Z')).not.toContain('(');
    expect(api.formatMarkerTime('2026-11-20T10:37:10Z', 'not a time')).not.toContain('(');
  });
});

// Value: protects=placing a marker from the drawer: step buttons move the pending pin bucket by bucket
// and stop at the chart's ends, the post carries the stepped time and the view captured AT POST TIME,
// and the mode switches off after one marker; closing the drawer drops a pending pin;
// why_new=no test rendered MarkerComposer or the startMarker/closeDrawer draft state;
// fails_when=onMove indexes the wrong neighbour, the edge disable goes, capture() is read at start
// instead of submit, cancelMarker is not called after posting, or closeDrawer keeps markerDraft;
// seam=none (context + drawer, API mocked as elsewhere in this file); no_claim=the chart pin itself.
describe('placing a graph marker', () => {
  const steps = ['2026-11-20T10:00:00Z', '2026-11-20T10:01:00Z', '2026-11-20T10:02:00Z'];
  function FakeGraphsCard({ capture }: { capture: () => api.MarkerChartContext }) {
    const ctx = useComments();
    return (
      <>
        <button onClick={() => ctx?.startMarker({ time: steps[1]!, steps, capture })}>add marker</button>
        <button onClick={() => ctx?.openDrawer('graphs')}>open graphs comments</button>
        <button onClick={() => ctx?.openDrawer('slo')}>open slo comments</button>
        <span data-testid="draft">{ctx?.markerDraft?.time ?? 'none'}</span>
      </>
    );
  }
  const setup = () => {
    mocked.fetchCommentCounts.mockResolvedValue({});
    mocked.fetchCommentThreads.mockResolvedValue({ threads: [], lastSeenAt: null });
    let view: api.MarkerChartContext = { series: [] };
    const capture = jest.fn(() => view);
    render(
      <CommentsProvider runId="run" runStart="2026-11-20T10:00:00Z" reveal={jest.fn()}>
        <FakeGraphsCard capture={capture} />
        <CommentsDrawer />
      </CommentsProvider>,
    );
    return { capture, setView: (v: api.MarkerChartContext) => { view = v; } };
  };

  it('steps the pin, posts the stepped time with the view at post time, then leaves marker mode', async () => {
    const { capture, setView } = setup();
    const posted = comment({ id: 'm1', markerSeq: 1, markerTime: steps[0]!, authorId: 'me', chartContext: null });
    mocked.postMarker.mockResolvedValue(posted);
    fireEvent.click(screen.getByText('add marker'));
    const earlier = await screen.findByRole('button', { name: 'Move marker one bucket earlier' });
    const later = screen.getByRole('button', { name: 'Move marker one bucket later' });
    fireEvent.click(later);
    expect(screen.getByTestId('draft')).toHaveTextContent(steps[2]!);
    expect(later).toBeDisabled();
    fireEvent.click(earlier);
    fireEvent.click(earlier);
    expect(screen.getByTestId('draft')).toHaveTextContent(steps[0]!);
    expect(earlier).toBeDisabled();
    expect(capture).not.toHaveBeenCalled();

    const view = { series: [], xRange: ['2026-11-20T10:00:00Z', '2026-11-20T10:30:00Z'] as [string, string] };
    setView(view);
    fireEvent.change(screen.getByLabelText(/^Describe what happens at .*\(\+0:00\)/), { target: { value: 'GC pause' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Place marker' })));
    expect(mocked.postMarker).toHaveBeenCalledWith('run', 'GC pause', steps[0], view, null);
    expect(screen.getByTestId('draft')).toHaveTextContent('none');
    expect(screen.getByLabelText('New comment on this card…')).toBeInTheDocument();
  });

  it('drops the pending pin when the drawer closes', async () => {
    setup();
    fireEvent.click(screen.getByText('add marker'));
    await screen.findByRole('button', { name: 'Place marker' });
    fireEvent.click(screen.getByRole('button', { name: 'Close comments' }));
    expect(screen.getByTestId('draft')).toHaveTextContent('none');
    fireEvent.click(screen.getByText('open graphs comments'));
    expect(await screen.findByLabelText('New comment on this card…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Place marker' })).not.toBeInTheDocument();
  });

  // Value: protects=the remaining marker-draft exits (state matrix): Cancel keeps the drawer, another
  // card drops the pin, a failed post keeps the draft and lists what an older API saved; fails_when=
  // cancelMarker, the card !== 'graphs' guard or the saved-comment upsert is removed; why_new=only
  // post and close-drawer were tested; seam=none; no_claim=server behaviour (postMarker mocked).
  it('Cancel drops the pin but keeps the drawer open', async () => {
    setup();
    fireEvent.click(screen.getByText('add marker'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('draft')).toHaveTextContent('none');
    expect(screen.getByLabelText('New comment on this card…')).toBeInTheDocument();
  });

  it("opening another card's comments drops the pending pin", async () => {
    setup();
    fireEvent.click(screen.getByText('add marker'));
    await screen.findByRole('button', { name: 'Place marker' });
    fireEvent.click(screen.getByText('open slo comments'));
    expect(screen.getByTestId('draft')).toHaveTextContent('none');
  });

  it('keeps the draft when the post fails, and lists a comment an older API saved anyway', async () => {
    setup();
    const plain = comment({ id: 'p1', body: 'GC pause', markerSeq: null, authorId: 'me' });
    mocked.postMarker.mockRejectedValue(Object.assign(new Error('Saved as a plain comment: no markers'), { saved: plain }));
    fireEvent.click(screen.getByText('add marker'));
    fireEvent.change(await screen.findByLabelText(/^Describe what happens at/), { target: { value: 'GC pause' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Place marker' })));
    expect(screen.getByTestId('draft')).toHaveTextContent(steps[1]!);
    expect(await screen.findByText(/Saved as a plain comment/)).toBeInTheDocument();
    expect(screen.getAllByText('GC pause').length).toBeGreaterThan(0);
  });
});

// Value: protects=a ?comment= deep link to a marker replays its view, while opening the same marker
// from its pin or the drawer does not; "Restore view" replays again with a fresh key and reveals the
// Graphs card; fails_when=CommentDeepLink stops passing replay, the drawer ignores focusReplay or
// replays unconditionally, or restoreView reuses a key so GraphsCard's consumed-set skips the second
// request; why_new=no test covered focusReplay, restoreView or viewRequest; seam=none;
// no_claim=GraphsCard's loadView/Undo (proposed separately).
describe('marker view replay', () => {
  const marker = comment({
    id: 'm1', markerSeq: 4, markerTime: '2026-11-20T10:37:10Z',
    chartContext: { series: [{ dashboardId: 'd', dashboardLabel: 'JVM', panelId: 3, panelTitle: 'Heap', metricName: 'used', source: 'grafana' }] as never },
  });
  function Opener({ replay }: { replay: boolean }) {
    const ctx = useComments();
    return (
      <>
        <button onClick={() => ctx?.openDrawer('graphs', 'm1', replay)}>open marker</button>
        <span data-testid="view">{ctx?.viewRequest?.key ?? 'none'}</span>
      </>
    );
  }
  const setup = (replay: boolean) => {
    mocked.fetchCommentCounts.mockResolvedValue({ graphs: { total: 1, unread: 0 } });
    mocked.fetchCommentThreads.mockResolvedValue({ threads: [{ ...marker, replies: [] }], lastSeenAt: '2999-01-01T00:00:00Z' });
    const reveal = jest.fn();
    render(
      <CommentsProvider runId="run" runStart="2026-11-20T10:00:00Z" reveal={reveal}>
        <Opener replay={replay} />
        <CommentsDrawer />
      </CommentsProvider>,
    );
    fireEvent.click(screen.getByText('open marker'));
    return reveal;
  };

  it('replays on a deep link, and Restore view asks again with a new key', async () => {
    const reveal = setup(true);
    await waitFor(() => expect(screen.getByTestId('view')).toHaveTextContent(/^comment:m1:\d+$/));
    expect(reveal).toHaveBeenCalledWith('graphsExpanded');
    const first = screen.getByTestId('view').textContent;
    fireEvent.click(await screen.findByRole('button', { name: 'Restore view' }));
    expect(screen.getByTestId('view').textContent).toMatch(/^comment:m1:\d+$/);
    expect(screen.getByTestId('view').textContent).not.toBe(first);
  });

  it('does not replay when the marker is merely opened', async () => {
    setup(false);
    expect(await screen.findByRole('button', { name: 'Restore view' })).toBeInTheDocument();
    expect(screen.getByTestId('view')).toHaveTextContent('none');
  });

  // Value: protects=a diff-tab view (pyroscope) shows its description but no Restore view, which it cannot replay;
  // fails_when=ViewLine's diff check is dropped or inverted; why_new=only Graphs views were rendered in the drawer;
  // seam=none; no_claim=tracing kind and the line clamp (same branch, not rendered here)
  it('shows a diff-tab view as text with no Restore view', async () => {
    const diff = comment({
      id: 'p1', cardKey: 'pyroscope',
      chartContext: { kind: 'pyroscope', view: 'diff', baselineTestRunId: 'base-run', resultSummary: 'cpu +12%' } as never,
    });
    mocked.fetchCommentCounts.mockResolvedValue({ pyroscope: { total: 1, unread: 0 } });
    mocked.fetchCommentThreads.mockResolvedValue({ threads: [{ ...diff, replies: [] }], lastSeenAt: '2999-01-01T00:00:00Z' });
    function Open() {
      const ctx = useComments();
      return <button onClick={() => ctx?.openDrawer('pyroscope', 'p1', false)}>open diff</button>;
    }
    render(
      <CommentsProvider runId="run" reveal={jest.fn()}>
        <Open />
        <CommentsDrawer />
      </CommentsProvider>,
    );
    fireEvent.click(screen.getByText('open diff'));
    const line = await screen.findByTestId('comment-view-p1');
    expect(line).toHaveTextContent('Diff view vs run base-run');
    expect(line).toHaveTextContent('cpu +12%');
    expect(screen.queryByRole('button', { name: 'Restore view' })).not.toBeInTheDocument();
  });
});

// Value: protects=the Graphs card's pins: only roots with a marker number AND a marker time become
// pins, and the list refetches when a Graphs comment arrives over the socket but not when another
// card's does; fails_when=useGraphMarkers drops either half of its filter (plain comments or a
// half-written marker draw a pin at an undefined time), keys the refetch on every event (one
// /threads request per comment anywhere on the run) or on none (a colleague's new marker never
// appears); why_new=no test rendered useGraphMarkers; seam=none (socket mock's recorded handlers);
// no_claim=GraphsChart's pin drawing (markerOverlay.test.ts).
describe('useGraphMarkers', () => {
  const socket = (jest.requireMock('@/lib/socket') as { socketManager: { on: jest.Mock } }).socketManager;
  function Pins() {
    const markers = useGraphMarkers(true);
    return <span data-testid="pins">{markers.map((m) => m.id).join(',') || 'none'}</span>;
  }
  const emit = (cardKey: string) => {
    const [, created] = socket.on.mock.calls.find(([t]) => t === 'comment:created')!;
    act(() => created(comment({ id: `e-${cardKey}`, cardKey: cardKey as never, testRunId: 'run' })));
  };

  it('keeps numbered, timed roots only and refetches on a Graphs event, not another card', async () => {
    mocked.fetchCommentCounts.mockResolvedValue({});
    mocked.fetchCommentThreads.mockResolvedValue({
      lastSeenAt: null,
      threads: [
        { ...comment({ id: 'pin', markerSeq: 1, markerTime: '2026-11-20T10:01:00Z' }), replies: [] },
        { ...comment({ id: 'plain' }), replies: [] },
        { ...comment({ id: 'notime', markerSeq: 2, markerTime: null }), replies: [] },
        { ...comment({ id: 'gone', markerSeq: 3, markerTime: '2026-11-20T10:02:00Z', deleted: true }), replies: [] },
      ],
    });
    render(<CommentsProvider runId="run" reveal={jest.fn()}><Pins /></CommentsProvider>);
    await waitFor(() => expect(screen.getByTestId('pins')).toHaveTextContent('pin,gone'));
    expect(mocked.fetchCommentThreads).toHaveBeenCalledTimes(1);
    expect(mocked.fetchCommentThreads).toHaveBeenCalledWith('run', 'graphs');

    emit('slo');
    await act(async () => undefined);
    expect(mocked.fetchCommentThreads).toHaveBeenCalledTimes(1);

    emit('graphs');
    await waitFor(() => expect(mocked.fetchCommentThreads).toHaveBeenCalledTimes(2));
  });
});

// Value: protects=a shared `?card=graphs&comment=<id>` link replaying the marker's view (design
// premise 6), revealing the Graphs card and focusing that thread; fails_when=CommentDeepLink stops
// passing replay=true (the link opens the drawer but the chart never shows the marker's view) or
// passes the wrong card/comment; why_new=the replay suite calls openDrawer(…, true) by hand and the
// list-badge suite covers only ?comments=; seam=none (global next/navigation mock);
// no_claim=GraphsCard consuming the view key (GraphsCard.markers.test.tsx).
describe('marker deep link', () => {
  const nav = jest.requireMock('next/navigation') as { useSearchParams: jest.Mock };
  let restore: () => void = () => undefined;
  afterEach(() => restore());

  it('?card=graphs&comment= opens the drawer on that comment with replay on', async () => {
    const params = new URLSearchParams('card=graphs&comment=m9');
    const original = nav.useSearchParams.getMockImplementation();
    nav.useSearchParams.mockImplementation(() => params);
    restore = () => nav.useSearchParams.mockImplementation(original);
    const { default: CommentDeepLink } = await import('../CommentDeepLink');
    mocked.fetchCommentCounts.mockResolvedValue({});
    function Probe() {
      const ctx = useComments();
      return <span data-testid="probe">{`${ctx?.openCard}|${ctx?.focusCommentId}|${ctx?.focusReplay}`}</span>;
    }
    const reveal = jest.fn();
    render(
      <CommentsProvider runId="run" reveal={reveal}>
        <CommentDeepLink />
        <Probe />
      </CommentsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('graphs|m9|true'));
    expect(reveal).toHaveBeenCalledWith('graphsExpanded');
  });
});

// Value: protects=the collapsed thread row's summary lines: the reply count reads "1 reply" / "N
// replies" and the marker's time label places it in the run (+mm:ss from runStart) before anyone
// expands it; fails_when=the count or its plural is dropped or reverts to a bare number, the marker
// time line is removed or loses runStart, or the item label line goes; why_new=every other drawer
// test reads an EXPANDED row or the composer, none asserts the collapsed row's lines; seam=none
// (provider + drawer, API mocked as elsewhere in this file); no_claim=the 3-line clamp and layout.
describe('collapsed thread row', () => {
  it('shows the reply count with its plural, the marker time into the run and the item label', async () => {
    mocked.fetchCommentCounts.mockResolvedValue({});
    mocked.fetchCommentThreads.mockResolvedValue({
      lastSeenAt: '2999-01-01T00:00:00Z',
      threads: [
        { ...comment({ id: 'm', markerSeq: 2, markerTime: '2026-11-20T10:37:10Z', body: 'GC pause' }),
          replies: [comment({ id: 'r1', parentId: 'm' })] },
        { ...comment({ id: 'a', itemKey: 'p-3', itemLabel: 'Heap · Panel 3', body: 'noisy' }),
          replies: [comment({ id: 'r2', parentId: 'a' }), comment({ id: 'r3', parentId: 'a' })] },
      ],
    });
    function Open() {
      const ctx = useComments();
      return <button onClick={() => ctx?.openDrawer('graphs')}>open</button>;
    }
    render(
      <CommentsProvider runId="run" runStart="2026-11-20T10:00:00Z" reveal={jest.fn()}>
        <Open />
        <CommentsDrawer />
      </CommentsProvider>,
    );
    fireEvent.click(screen.getByText('open'));
    const drawer = await screen.findByRole('complementary', { name: 'Comments on Graphs' });
    await within(drawer).findByText('GC pause');
    const rows = [...drawer.querySelectorAll('button[aria-expanded]')];
    const marker = rows.find((r) => r.textContent?.includes('GC pause'))!;
    const anchored = rows.find((r) => r.textContent?.includes('noisy'))!;
    expect(marker).toHaveAttribute('aria-expanded', 'false');
    expect(anchored).toHaveAttribute('aria-expanded', 'false');
    expect(within(marker as HTMLElement).getByText('1 reply')).toBeInTheDocument();
    expect(within(marker as HTMLElement).getByText(/\(\+37:10\)$/)).toBeInTheDocument();
    expect(within(anchored as HTMLElement).getByText('2 replies')).toBeInTheDocument();
    expect(within(anchored as HTMLElement).getByText('Heap · Panel 3')).toBeInTheDocument();
  });
});

// Value: protects=a root comment on Graphs/Trends/Compare records its card's view (and nothing when
// the card has none to record), the drawer says what that view was, and a deep link to a plain
// Trends comment replays it on the Trends card; fails_when=the drawer stops passing captureView's
// result to postComment, a capture returning null still posts an empty view (the API 400s), the
// caption mislabels a kind, or the deep-link replay goes back to markers only; why_new=views were
// recorded for markers alone before; seam=none; no_claim=the cards' own capture and replay
// (useTrendsCommentView / useCompareCommentView tests) and the server's validation (API specs).
describe('comment views on Graphs, Trends and Compare', () => {
  const trendsView: api.TrendsView = {
    kind: 'trends',
    series: [{ dashboardId: 'd', panelId: 3, metricName: 'used', source: 'grafana' }],
    timeRange: 'Last week',
    evaluateType: 'p95',
  };
  function Registrar({ card, view }: { card: api.CommentCardKey; view: api.CommentView | null }) {
    const ctx = useComments();
    const register = ctx?.registerViewCapture;
    React.useEffect(() => register?.(card, () => view), [register, card, view]);
    return <button onClick={() => ctx?.openDrawer(card)}>open</button>;
  }
  const post = async (card: api.CommentCardKey, view: api.CommentView | null) => {
    mocked.fetchCommentCounts.mockResolvedValue({});
    mocked.fetchCommentThreads.mockResolvedValue({ threads: [], lastSeenAt: null });
    mocked.postComment.mockResolvedValue(comment({ id: 'n1', cardKey: card }));
    render(
      <CommentsProvider runId="run" reveal={jest.fn()}>
        <Registrar card={card} view={view} />
        <CommentsDrawer />
      </CommentsProvider>,
    );
    fireEvent.click(screen.getByText('open'));
    fireEvent.change(await screen.findByLabelText('New comment on this card…'), { target: { value: 'p95 creeping up' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Comment' })));
  };

  it("posts a root comment with its card's current view", async () => {
    await post('trends', trendsView);
    expect(mocked.postComment).toHaveBeenCalledWith('run', 'trends', 'p95 creeping up', undefined, undefined, trendsView, null);
  });

  it('posts the comment without its view when the server refuses the view', async () => {
    mocked.postComment.mockRejectedValueOnce(new Error('Posting comment failed (400): chartContext.customRange must run forwards'));
    await post('trends', trendsView);
    expect(mocked.postComment).toHaveBeenCalledTimes(2);
    expect(mocked.postComment).toHaveBeenLastCalledWith('run', 'trends', 'p95 creeping up', undefined, undefined, undefined, null);
  });

  // Value: protects=a diff-tab comment still posts against an API older than the web app; fails_when=the
  // fallback matches only 'chartContext' again; why_new=the older API's card refusal names no field;
  // seam=none; no_claim=the API's real wording beyond this message
  it('posts the comment without its view when an older API refuses views on that card', async () => {
    mocked.postComment.mockRejectedValueOnce(new Error('Posting comment failed (400): Only a root comment on Graphs, Trends, Compare or a Configuration item records a view'));
    await post('trends', trendsView);
    expect(mocked.postComment).toHaveBeenCalledTimes(2);
    expect(mocked.postComment).toHaveBeenLastCalledWith('run', 'trends', 'p95 creeping up', undefined, undefined, undefined, null);
  });

  it('posts no view when the card has nothing to record', async () => {
    await post('compare', null);
    expect(mocked.postComment).toHaveBeenCalledWith('run', 'compare', 'p95 creeping up', undefined, undefined, undefined, null);
  });

  it('describes each kind of view', () => {
    expect(describeView(trendsView, false)).toBe('1 series · Last week · p95');
    expect(describeView({ ...trendsView, customRange: ['2026-11-13T00:00:00Z', '2026-11-20T00:00:00Z'] }, false)).toMatch(/^1 series · Last week \(.+–.+\) · p95$/);
    expect(describeView({ kind: 'compare', series: trendsView.series, baselineTestRunId: 'control-group' }, false)).toBe('1 series · vs control group');
    expect(describeView({ kind: 'compare', series: trendsView.series }, false)).toBe('1 series · no baseline');
    expect(describeView({ kind: 'pyroscope', view: 'diff', baselineTestRunId: 'App-00004' }, false)).toBe('Diff view vs run App-00004');
    expect(describeView({ kind: 'pyroscope', view: 'diff', baselineWindowSeconds: [0, 1200], currentWindowSeconds: [2400, 3725] }, false))
      .toBe("Diff view of this run: 0:00–20:00 (baseline) vs 40:00–1:02:05, from the run's start");
    expect(describeView({ kind: 'distributed-tracing', view: 'diff', resultSummary: 'Traces: 3 current / 4 baseline' }, false)).toBe('Diff view, no baseline selected\nTraces: 3 current / 4 baseline');
    expect(describeView({ series: [] }, true)).toBe('Placed on 0 series · whole run');
    expect(describeView({ kind: 'graphs', series: [] }, false)).toBe('Written on 0 series · whole run');
  });

  it('replays a plain Trends comment from a deep link on the Trends card', async () => {
    const plain = comment({ id: 't1', cardKey: 'trends', chartContext: trendsView });
    mocked.fetchCommentCounts.mockResolvedValue({ trends: { total: 1, unread: 0 } });
    mocked.fetchCommentThreads.mockResolvedValue({ threads: [{ ...plain, replies: [] }], lastSeenAt: '2999-01-01T00:00:00Z' });
    const reveal = jest.fn();
    function Viewer() {
      const ctx = useComments();
      return (
        <>
          <button onClick={() => ctx?.openDrawer('trends', 't1', true)}>deep link</button>
          <span data-testid="req">{ctx?.viewRequest ? `${ctx.viewRequest.card}:${ctx.viewRequest.comment.id}` : 'none'}</span>
        </>
      );
    }
    render(
      <CommentsProvider runId="run" reveal={reveal}>
        <Viewer />
        <CommentsDrawer />
      </CommentsProvider>,
    );
    fireEvent.click(screen.getByText('deep link'));
    await waitFor(() => expect(screen.getByTestId('req')).toHaveTextContent('trends:t1'));
    expect(reveal).toHaveBeenCalledWith('trendsExpanded');
    expect(await screen.findByText('1 series · Last week · p95')).toBeInTheDocument();
  });
});

// Value: protects=a root comment anchored to a Configuration item records the view for THAT item
// (the drawer hands the anchor to the card's capture), and the drawer prints the recorded
// comparison under the comment with a Restore view that replays it on the Configuration card;
// fails_when=captureView stops receiving the anchor, the snapshot moves above the body or
// disappears, or describeView mislabels a config view; why_new=PR1 of
// test-run-analysis-stories.md; seam=none; no_claim=the card's own capture and replay
// (useConfigComments test) and the API's validation (comments specs).
describe('comment views on Configuration items', () => {
  const view: api.ConfigView = { kind: 'config', comparedToTestRunId: 'App-00006', status: 'changed', previousValue: '2g', currentValue: '512m' };

  it('describes a config view', () => {
    expect(describeView(view, false)).toBe('Compared with run App-00006: 2g → 512m (changed)');
    expect(describeView({ ...view, status: 'same', previousValue: '512m' }, false)).toBe('Compared with run App-00006: 512m (same)');
    expect(describeView({ kind: 'config', status: 'new', currentValue: '1', previousValue: null }, false)).toBe('Not compared with another run: 1 (new)');
  });

  it("posts an item comment with that item's view", async () => {
    const capture = jest.fn((itemKey?: string | null) => (itemKey === 'config:heap.max' ? view : null));
    function Card() {
      const ctx = useComments();
      const register = ctx?.registerViewCapture;
      React.useEffect(() => register?.('config', capture), [register]);
      return <button onClick={() => ctx?.commentOnItem('config', 'config:heap.max', 'heap.max')}>comment on row</button>;
    }
    mocked.fetchCommentCounts.mockResolvedValue({});
    mocked.fetchCommentThreads.mockResolvedValue({ threads: [], lastSeenAt: null });
    mocked.postComment.mockResolvedValue(comment({ id: 'n1', cardKey: 'config' }));
    render(
      <CommentsProvider runId="run" reveal={jest.fn()}>
        <Card />
        <CommentsDrawer />
      </CommentsProvider>,
    );
    fireEvent.click(screen.getByText('comment on row'));
    fireEvent.change(await screen.findByLabelText('Comment on heap.max…'), { target: { value: 'heap shrank' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Comment' })));
    expect(capture).toHaveBeenCalledWith('config:heap.max');
    expect(mocked.postComment).toHaveBeenCalledWith('run', 'config', 'heap shrank', undefined, { itemKey: 'config:heap.max', itemLabel: 'heap.max' }, view, null);
  });

  it('shows the comparison under the comment, and Restore view asks the Configuration card to replay it', async () => {
    const root = comment({ id: 'k1', cardKey: 'config', itemKey: 'config:heap.max', itemLabel: 'heap.max', body: 'heap shrank', chartContext: view });
    mocked.fetchCommentCounts.mockResolvedValue({ config: { total: 1, unread: 0 } });
    mocked.fetchCommentThreads.mockResolvedValue({ threads: [{ ...root, replies: [] }], lastSeenAt: '2999-01-01T00:00:00Z' });
    const reveal = jest.fn();
    function Viewer() {
      const ctx = useComments();
      return (
        <>
          <button onClick={() => ctx?.openDrawer('config', 'k1')}>open</button>
          <span data-testid="req">{ctx?.viewRequest ? `${ctx.viewRequest.card}:${ctx.viewRequest.comment.id}` : 'none'}</span>
          <span data-testid="focus">{ctx?.itemFocus ? ctx.itemFocus.itemKey : 'none'}</span>
        </>
      );
    }
    render(
      <CommentsProvider runId="run" reveal={reveal}>
        <Viewer />
        <CommentsDrawer />
      </CommentsProvider>,
    );
    fireEvent.click(screen.getByText('open'));
    const snapshot = await screen.findByText('Compared with run App-00006: 2g → 512m (changed)');
    // Opening the thread only focuses the item; it does not replay the comparison.
    await waitFor(() => expect(screen.getByTestId('focus')).toHaveTextContent('config:heap.max'));
    expect(screen.getByTestId('req')).toHaveTextContent('none');
    const bodies = screen.getAllByText('heap shrank');
    const body = bodies[bodies.length - 1]!;
    expect(body.compareDocumentPosition(snapshot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restore view' }));
    expect(screen.getByTestId('req')).toHaveTextContent('config:k1');
    expect(reveal).toHaveBeenCalledWith('configExpanded');
  });
});
