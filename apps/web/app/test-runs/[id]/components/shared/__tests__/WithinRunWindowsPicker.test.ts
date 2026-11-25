import { defaultRunWindows, runDurationSeconds, windowToIso } from '../WithinRunWindowsPicker';

describe('within-run window helpers', () => {
  const start = '2026-11-25T10:00:00.000Z';
  const end = '2026-11-25T11:00:00.000Z';

  it('measures the run and defaults to first third vs last third', () => {
    const d = runDurationSeconds(start, end);
    expect(d).toBe(3600);
    expect(defaultRunWindows(d)).toEqual({ baseline: [0, 1200], current: [2400, 3600] });
  });

  it('turns offsets into absolute ISO bounds', () => {
    expect(windowToIso(start, [60, 600])).toEqual({
      start: '2026-11-25T10:01:00.000Z',
      end: '2026-11-25T10:10:00.000Z',
    });
  });

  // Value: protects=a live run (no end_time) is measured up to now; fails_when=the Date.now() fallback is dropped or end is read as start; why_new=other rows always pass end; seam=none; no_claim=none beyond protects
  it('measures a live run with no end time up to now', () => {
    const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-25T10:30:00.000Z'));
    try {
      expect(runDurationSeconds(start, null)).toBe(1800);
      expect(runDurationSeconds(start)).toBe(1800);
    } finally {
      spy.mockRestore();
    }
  });

  it('reads an unparseable run as zero length', () => {
    expect(runDurationSeconds('nope', end)).toBe(0);
  });
});
