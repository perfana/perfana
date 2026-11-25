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

  it('reads an unparseable run as zero length', () => {
    expect(runDurationSeconds('nope', end)).toBe(0);
  });
});
