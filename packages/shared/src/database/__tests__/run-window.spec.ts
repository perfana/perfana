import {
  RUN_WINDOW_PAD_MS,
  analysisBoundsFromEntity,
  analysisBoundsFromRow,
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
