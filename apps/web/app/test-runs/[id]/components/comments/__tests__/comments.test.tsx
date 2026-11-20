import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { COMMENT_CARD_BY_EXPANSION_KEY } from '@perfana/shared/constants/comment-cards';
import { TAB_CARDS } from '../../../hooks/useExpansionState';
import { CommentsProvider, useCommentItemFocus, useComments } from '../CommentsContext';
import CardComments from '../CardComments';
import CommentsDrawer from '../CommentsDrawer';
import RunCommentsButton from '../RunCommentsButton';
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
}));

const mocked = api as jest.Mocked<typeof api>;
const comment = (over: Partial<api.RunComment>): api.RunComment => ({
  id: 'c', testRunId: 'run', cardKey: 'graphs', parentId: null, body: 'b', deleted: false, authorId: 'other',
  authorName: 'Anna', markerSeq: null, markerTime: null, createdAt: '2026-11-19T09:00:00Z', editedAt: null, ...over,
});

const renderPage = (reveal = jest.fn()) =>
  render(
    <CommentsProvider runId="run" reveal={reveal}>
      <RunCommentsButton />
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

it('header button jumps to the first unread card in page order and opens its drawer', async () => {
  mocked.fetchCommentCounts.mockResolvedValue({ graphs: { total: 1, unread: 1 }, slo: { total: 2, unread: 2 } });
  mocked.fetchCommentThreads.mockResolvedValue({ threads: [], lastSeenAt: null });
  const reveal = jest.fn();
  renderPage(reveal);
  const button = await screen.findByTestId('run-comments-button');
  expect(button).toHaveAccessibleName('3 unread · next: Service level objectives (2)');

  fireEvent.click(button);
  expect(reveal).toHaveBeenCalledWith('sloExpanded'); // Results tab comes before Reporting
  expect(await screen.findByRole('complementary', { name: 'Comments on Service level objectives' })).toBeInTheDocument();
  await waitFor(() => expect(mocked.markCommentsSeen).toHaveBeenCalledWith('run', 'slo'));
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
  const rows = [...drawer.querySelectorAll('[aria-expanded]')];
  expect(rows[0]).toHaveTextContent('fresh one');
  expect(rows[0]).toHaveAttribute('aria-expanded', 'true');
  expect(within(drawer).getByText('unread reply')).toBeInTheDocument();
  expect(mocked.markCommentsSeen).toHaveBeenCalledTimes(1);
  expect(mocked.fetchCommentThreads.mock.invocationCallOrder[0]).toBeLessThan(mocked.markCommentsSeen.mock.invocationCallOrder[0]);
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
      <RunCommentsButton />
      <CommentsDrawer />
    </CommentsProvider>,
  );
  fireEvent.click(await screen.findByTestId('run-comments-button'));
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
  expect(mocked.postComment).toHaveBeenCalledWith('run', 'slo', 'margin is 8%', undefined, { itemKey: 'row-7', itemLabel: 'Heap Usage SLO' });
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
