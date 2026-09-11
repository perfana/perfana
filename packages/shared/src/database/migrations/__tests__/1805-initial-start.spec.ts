import { ShortenDsMetricsCompressAfter1805000000000 as M } from '../1805000000000-ShortenDsMetricsCompressAfter';

describe('migration 1805 initial_start', () => {
  // The first policy run compresses the previous ~113 GB chunk; it must land in a quiet hour.
  it('defaults to the next 02:00 UTC', () => {
    expect(M.resolveInitialStart(undefined, new Date('2026-09-11T13:00:00Z'))).toBe('2026-09-12T02:00:00.000Z');
    expect(M.resolveInitialStart(undefined, new Date('2026-09-11T01:30:00Z'))).toBe('2026-09-11T02:00:00.000Z');
    expect(M.resolveInitialStart(undefined, new Date('2026-09-11T02:00:00Z'))).toBe('2026-09-12T02:00:00.000Z');
  });

  it('honours a valid override and ignores a broken one', () => {
    expect(M.resolveInitialStart('2026-09-13T22:00:00Z', new Date('2026-09-11T13:00:00Z'))).toBe('2026-09-13T22:00:00.000Z');
    expect(M.resolveInitialStart('tonight', new Date('2026-09-11T13:00:00Z'))).toBe('2026-09-12T02:00:00.000Z');
  });
});
