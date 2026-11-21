// Value: protects=the request bodies that carry a comment tag: a root post sends its tag and an
// untagged one sends no tag key, a PATCH sends `tag` only when the caller passes one (null clears)
// so a text-only edit never touches the stored tag; fails_when=editComment always sends `tag`
// (a text edit would clear it) or postComment drops it; why_new=the drawer tests mock these helpers
// whole; seam=none; no_claim=server behaviour (authenticatedFetch mocked).
import { editComment, postComment, postMarker } from '../test-run-comments';
import { authenticatedFetch } from '../api';

jest.mock('../api', () => ({ authenticatedFetch: jest.fn() }));

const reply = (body: object) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const sent = () => JSON.parse(((authenticatedFetch as jest.Mock).mock.calls.at(-1)![1] as RequestInit).body as string);

beforeEach(() => (authenticatedFetch as jest.Mock).mockResolvedValue(reply({ id: 'c', markerSeq: 1 })));

it('posts a root with its tag, and an untagged one without the key', async () => {
  await postComment('run', 'graphs', 'p95 jumps', undefined, undefined, undefined, 'symptom');
  expect(sent()).toMatchObject({ card: 'graphs', body: 'p95 jumps', tag: 'symptom' });
  await postComment('run', 'graphs', 'plain', undefined, undefined, undefined, null);
  expect(sent()).not.toHaveProperty('tag');
});

it('posts a marker with its tag', async () => {
  await postMarker('run', 'spike', '2026-01-01T00:00:00Z', { series: [] }, 'evidence');
  expect(sent()).toMatchObject({ markerTime: '2026-01-01T00:00:00Z', tag: 'evidence' });
});

it.each([
  ['a text-only edit sends no tag', undefined, { body: 'x' }],
  ['a retag sends it', 'root-cause' as const, { body: 'x', tag: 'root-cause' }],
  ['clearing sends null', null, { body: 'x', tag: null }],
])('%s', async (_label, tag, expected) => {
  await editComment('c', 'x', tag);
  expect(sent()).toEqual(expected);
});
