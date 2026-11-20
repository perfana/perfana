// Value: protects=a marker post that comes back without a marker number is reported, not shown as a plain comment; fails_when=the markerSeq check in postMarker is removed; why_new=every other test mocks postMarker whole; seam=none; no_claim=server behaviour (authenticatedFetch mocked)
import { postMarker, viewOf } from '../test-run-comments';
import { authenticatedFetch } from '../api';

jest.mock('../api', () => ({ authenticatedFetch: jest.fn() }));

const reply = (body: object) => ({ ok: true, status: 201, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;
const ctx = { series: [] };

describe('postMarker', () => {
  it('returns the marker when the server numbered it', async () => {
    (authenticatedFetch as jest.Mock).mockResolvedValue(reply({ id: 'm1', markerSeq: 2 }));
    await expect(postMarker('run', 'spike', '2026-01-01T00:00:00Z', ctx)).resolves.toMatchObject({ markerSeq: 2 });
  });

  it('throws when an older API saved it as a plain comment', async () => {
    (authenticatedFetch as jest.Mock).mockResolvedValue(reply({ id: 'c1', markerSeq: null }));
    const err = postMarker('run', 'spike', '2026-01-01T00:00:00Z', ctx);
    await expect(err).rejects.toThrow(/plain comment/);
    // The saved comment rides on the error, so the drawer can list it instead of inviting a duplicate.
    await expect(err).rejects.toMatchObject({ saved: { id: 'c1' } });
  });
});

// Value: protects=a card only replays a view recorded on that card, and a Graphs view stored before
// `kind` existed (marker rows from the first PR2 build) still counts as Graphs; fails_when=viewOf
// stops defaulting a missing kind to 'graphs' (old markers stop restoring) or stops comparing kinds
// (the Trends card would feed a Graphs view's series into its own setters); why_new=GraphsCard's
// replay test uses a kind-less view only, so nothing checks the cross-card refusal; seam=none;
// no_claim=the server stamping kind (comment.dto.spec.ts).
describe('viewOf', () => {
  const legacy = { chartContext: { series: [] } };
  const trends = { chartContext: { kind: 'trends' as const, series: [], timeRange: 'Last week', evaluateType: 'avg' } };

  it('reads a kind-less view as Graphs and only as Graphs', () => {
    expect(viewOf(legacy, 'graphs')).toBe(legacy.chartContext);
    expect(viewOf(legacy, 'trends')).toBeNull();
  });

  it('returns a view only to the card it was recorded on', () => {
    expect(viewOf(trends, 'trends')).toBe(trends.chartContext);
    expect(viewOf(trends, 'graphs')).toBeNull();
    expect(viewOf(trends, 'compare')).toBeNull();
    expect(viewOf({ chartContext: null }, 'graphs')).toBeNull();
  });
});
