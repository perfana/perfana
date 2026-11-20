import { throughputSeconds } from '../throughput-seconds';

// A ~2.5 h run with a long ramp-down: 1,210,700 executions in the analysis window, which the
// throughput graph draws at ~199/s. Dividing by the whole run read 133/s.
const run = {
  duration: 9090,
  start_time: '2026-11-19T10:31:43.183Z',
  end_time: '2026-11-19T13:03:34.540Z',
  analysis_start_offset: 300,
  analysis_end_offset: 2718,
};

describe('throughputSeconds', () => {
  it('divides analysis-window counts by the analysis window, both offsets out', () => {
    expect(throughputSeconds(run, true)).toBe(6072);
    expect(Math.round(1_210_700 / throughputSeconds(run, true))).toBe(199);
  });

  it('divides whole-run counts by the whole run', () => {
    expect(throughputSeconds(run, false)).toBe(9090);
  });

  it('keeps the whole run when the offsets do not fit it', () => {
    expect(throughputSeconds({ ...run, analysis_end_offset: 9000 }, true)).toBe(9090);
  });

  it('never returns 0, so a caller can divide by it', () => {
    expect(throughputSeconds({}, true)).toBe(1);
    expect(throughputSeconds({ duration: null }, false)).toBe(1);
  });
});
