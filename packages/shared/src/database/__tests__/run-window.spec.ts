import {
  CHUNK_CACHE_TTL_MS,
  RUN_WINDOW_PAD_MS,
  analysisBoundsFromEntity,
  analysisBoundsFromRow,
  resetChunkCache,
  snapBoundsToChunks,
  spanBounds,
  timeBoundsSql,
} from '../run-window';

/**
 * The rules these functions encode are correctness rules, not formatting ones — see
 * issue #674 and "A raw-hypertable read takes a lock per chunk" in apps/api/CLAUDE.md.
 * Both apps bind their `time` predicates from here, so a change that looks harmless
 * here silently un-bounds reads in two services at once.
 */
describe('run-window', () => {
  const START = '2026-01-01T10:00:00.000Z';
  const END = '2026-01-01T11:00:00.000Z';
  const row = { start_time: START, end_time: END, ramp_up: '120', ramp_down: '60' };

  describe('analysisBoundsFromRow', () => {
    it('pads the run window by an hour either side when the toggle is off', () => {
      // The padding is not cosmetic: ingest has been observed arriving 36 s past
      // end_time, and a load generator's clock can run ahead of start_time.
      const b = analysisBoundsFromRow(row, false);
      expect(b.startCutoff!.toISOString()).toBe('2026-01-01T09:00:00.000Z');
      expect(b.endCutoff!.toISOString()).toBe('2026-01-01T12:00:00.000Z');
      expect(RUN_WINDOW_PAD_MS).toBe(3_600_000);
    });

    it('narrows to the analysis timerange when the toggle is on', () => {
      const b = analysisBoundsFromRow(row, true);
      expect(b.startCutoff!.toISOString()).toBe('2026-01-01T10:02:00.000Z');
      expect(b.endCutoff!.toISOString()).toBe('2026-01-01T10:59:00.000Z');
    });

    it('still bounds when the toggle is on but the run has no ramp configured', () => {
      const b = analysisBoundsFromRow({ start_time: START, end_time: END }, true);
      expect(b.startCutoff!.toISOString()).toBe('2026-01-01T09:00:00.000Z');
      expect(b.endCutoff!.toISOString()).toBe('2026-01-01T12:00:00.000Z');
    });

    it('leaves the end open for an in-flight run', () => {
      // No chunks past now() to exclude, so an open end costs nothing.
      const b = analysisBoundsFromRow({ start_time: START, ramp_up: '120' }, true);
      expect(b.startCutoff).not.toBeNull();
      expect(b.endCutoff).toBeNull();
    });

    it('returns no bounds for a run that does not exist', () => {
      expect(analysisBoundsFromRow(undefined, false)).toEqual({ startCutoff: null, endCutoff: null });
    });

    it.each([['0'], ['-5'], ['abc'], [null]])('ignores a non-positive or unparseable ramp (%s)', (ramp) => {
      const b = analysisBoundsFromRow({ ...row, ramp_up: ramp as string | null }, true);
      expect(b.startCutoff!.toISOString()).toBe('2026-01-01T09:00:00.000Z');
    });
  });

  describe('analysisBoundsFromEntity', () => {
    it('reads the entity spelling of the same four columns', () => {
      const b = analysisBoundsFromEntity(
        { startTime: new Date(START), endTime: new Date(END), analysisStartOffset: 120, analysisEndOffset: 60 },
        true,
      );
      expect(b.startCutoff!.toISOString()).toBe('2026-01-01T10:02:00.000Z');
      expect(b.endCutoff!.toISOString()).toBe('2026-01-01T10:59:00.000Z');
    });
  });

  describe('spanBounds', () => {
    const b = (s: string | null, e: string | null) => ({
      startCutoff: s ? new Date(s) : null,
      endCutoff: e ? new Date(e) : null,
    });

    it('takes the earliest start and the latest end', () => {
      const span = spanBounds([b(START, END), b('2026-01-02T10:00:00Z', '2026-01-02T11:00:00Z')]);
      expect(span.startCutoff!.toISOString()).toBe(START);
      expect(span.endCutoff!.toISOString()).toBe('2026-01-02T11:00:00.000Z');
    });

    it('leaves the end open when any run is still in flight', () => {
      expect(spanBounds([b(START, END), b('2026-01-02T10:00:00Z', null)]).endCutoff).toBeNull();
    });

    it('gives up entirely when any run has no start', () => {
      // A missing start means one run's rows could be anywhere; a span that excluded
      // them would drop rows the unbounded query returned.
      expect(spanBounds([b(START, END), b(null, END)])).toEqual({ startCutoff: null, endCutoff: null });
    });

    it('bounds nothing for an empty list', () => {
      expect(spanBounds([])).toEqual({ startCutoff: null, endCutoff: null });
    });
  });

  describe('timeBoundsSql', () => {
    const bounds = analysisBoundsFromRow(row, false);

    it('numbers from startIndex and returns the next free slot', () => {
      const t = timeBoundsSql(bounds, 't.time', 4);
      expect(t.clause).toBe('AND t.time >= $4::timestamptz AND t.time <= $5::timestamptz');
      expect(t.params).toHaveLength(2);
      expect(t.nextIndex).toBe(6);
    });

    it('emits two clauses over ONE parameter set when called twice at the same index', () => {
      // The pattern for a query with two table aliases: same values, different column.
      const a = timeBoundsSql(bounds, 't.time', 2);
      const c = timeBoundsSql(bounds, 'rr.time', 2);
      expect(a.params).toEqual(c.params);
      expect(c.clause).toBe('AND rr.time >= $2::timestamptz AND rr.time <= $3::timestamptz');
    });

    it('emits only the end that exists, so a NULL never reaches the comparison', () => {
      // `time <= NULL` is not "no upper bound" — it matches nothing.
      const t = timeBoundsSql({ startCutoff: new Date(START), endCutoff: null }, 'time', 2);
      expect(t.clause).toBe('AND time >= $2::timestamptz');
      expect(t.params).toHaveLength(1);
      expect(t.nextIndex).toBe(3);
    });

    it('emits nothing at all when there are no bounds, rather than a false predicate', () => {
      const t = timeBoundsSql({ startCutoff: null, endCutoff: null }, 'time', 2);
      expect(t.clause).toBe('');
      expect(t.params).toEqual([]);
      expect(t.nextIndex).toBe(2);
    });
  });
});

describe('snapBoundsToChunks (#674 follow-up)', () => {
  const D = (s: string) => new Date(s);
  // One 7-day chunk (pre-migration-1815 width) then two 1-day chunks. Mixed widths are
  // the normal state of a table whose chunk_time_interval was changed, and the reason
  // these boundaries are read rather than computed.
  const ROWS = [
    { range_start: '2026-09-10T00:00:00.000Z', range_end: '2026-09-17T00:00:00.000Z' },
    { range_start: '2026-09-17T00:00:00.000Z', range_end: '2026-09-18T00:00:00.000Z' },
    { range_start: '2026-09-18T00:00:00.000Z', range_end: '2026-09-19T00:00:00.000Z' },
  ];
  const querier = (rows: unknown[] = ROWS) => jest.fn().mockResolvedValue(rows);

  beforeEach(() => resetChunkCache());

  it('widens outward to the real chunk boundary', async () => {
    const b = await snapBoundsToChunks(querier(), 'requests_raw', {
      startCutoff: D('2026-09-10T02:03:05.000Z'), endCutoff: D('2026-09-10T07:05:35.000Z'),
    });
    expect(b.startCutoff!.toISOString()).toBe('2026-09-10T00:00:00.000Z');
    expect(b.endCutoff!.toISOString()).toBe('2026-09-17T00:00:00.000Z');
  });

  it('never narrows — the result is always a superset of the input', async () => {
    // A window wider than the chunks it covers keeps its own edges.
    const wide = { startCutoff: D('2026-09-01T00:00:00.000Z'), endCutoff: D('2026-09-30T00:00:00.000Z') };
    const b = await snapBoundsToChunks(querier(), 'requests_raw', wide);
    expect(b.startCutoff!.getTime()).toBeLessThanOrEqual(wide.startCutoff.getTime());
    expect(b.endCutoff!.getTime()).toBeGreaterThanOrEqual(wide.endCutoff.getTime());
  });

  it('touches no chunk the original window did not', async () => {
    // Snapping must not pull in a neighbouring chunk — that would add locks back.
    const b = await snapBoundsToChunks(querier(), 'requests_raw', {
      startCutoff: D('2026-09-17T06:00:00.000Z'), endCutoff: D('2026-09-17T08:00:00.000Z'),
    });
    expect(b.startCutoff!.toISOString()).toBe('2026-09-17T00:00:00.000Z');
    expect(b.endCutoff!.toISOString()).toBe('2026-09-18T00:00:00.000Z');
  });

  /**
   * The trap that cost 11 locks before it was caught. A chunk's range is half-open, so a
   * bound snapped to `range_end` and compared with `<=` reaches one instant into the NEXT
   * chunk and takes its locks: measured 32 relation locks against 21 for the same rows,
   * giving back half of what the bound is for.
   */
  it('marks a chunk-snapped end half-open, and timeBoundsSql emits <', async () => {
    const b = await snapBoundsToChunks(querier(), 'requests_raw', {
      startCutoff: D('2026-09-10T02:03:05.000Z'), endCutoff: D('2026-09-10T07:05:35.000Z'),
    });
    expect(b.endExclusive).toBe(true);
    expect(timeBoundsSql(b, 'time', 2).clause).toBe('AND time >= $2::timestamptz AND time < $3::timestamptz');
  });

  it('keeps an inclusive end when the caller window already reached past the last chunk', async () => {
    // Nothing was snapped on that side, so the caller's own inclusive end stands.
    const b = await snapBoundsToChunks(querier(), 'requests_raw', {
      startCutoff: D('2026-09-10T02:00:00.000Z'), endCutoff: D('2026-10-01T00:00:00.000Z'),
    });
    expect(b.endCutoff!.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(b.endExclusive).toBe(false);
    expect(timeBoundsSql(b, 'time', 2).clause).toContain('time <= $3');
  });

  it('leaves an in-flight run open-ended', async () => {
    const b = await snapBoundsToChunks(querier(), 'requests_raw', {
      startCutoff: D('2026-09-10T02:00:00.000Z'), endCutoff: null,
    });
    expect(b.startCutoff!.toISOString()).toBe('2026-09-10T00:00:00.000Z');
    expect(b.endCutoff).toBeNull();
  });

  /** It is an optimisation. It must never be the reason a read breaks. */
  it.each([
    ['the catalog query throws', () => jest.fn().mockRejectedValue(new Error('no such view'))],
    ['the table has no chunks', () => querier([])],
  ])('returns the bounds untouched when %s', async (_label, mk) => {
    const input = { startCutoff: D('2026-09-10T02:00:00.000Z'), endCutoff: D('2026-09-10T07:00:00.000Z') };
    await expect(snapBoundsToChunks(mk(), 'requests_raw', input)).resolves.toEqual(input);
  });

  it('does nothing, and asks nothing, for an unbounded window', async () => {
    const q = querier();
    await expect(snapBoundsToChunks(q, 'requests_raw', { startCutoff: null, endCutoff: null }))
      .resolves.toEqual({ startCutoff: null, endCutoff: null });
    expect(q).not.toHaveBeenCalled();
  });

  it('caches per table, and re-reads once the TTL lapses', async () => {
    const q = querier();
    const w = { startCutoff: D('2026-09-10T02:00:00.000Z'), endCutoff: D('2026-09-10T07:00:00.000Z') };
    await snapBoundsToChunks(q, 'requests_raw', w, 1_000);
    await snapBoundsToChunks(q, 'requests_raw', w, 1_000 + CHUNK_CACHE_TTL_MS - 1);
    expect(q).toHaveBeenCalledTimes(1);
    await snapBoundsToChunks(q, 'requests_raw', w, 1_000 + CHUNK_CACHE_TTL_MS + 1);
    expect(q).toHaveBeenCalledTimes(2);
    // A different table is a different cache entry.
    await snapBoundsToChunks(q, 'transactions', w, 1_000 + CHUNK_CACHE_TTL_MS + 1);
    expect(q).toHaveBeenCalledTimes(3);
  });
});
