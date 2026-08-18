import { BadRequestException } from '@nestjs/common';
import { MAX_AGGREGATED_TEST_RUNS, parseTestRunIds } from './parse-test-run-ids';

const PATH_RUN = 'EA-acc-loadtest-00020';

describe('parseTestRunIds', () => {
  it('falls back to the path run when the parameter names nothing', () => {
    // The parameter is optional: both endpoints default to aggregating the run in the URL.
    expect(parseTestRunIds(undefined, PATH_RUN)).toEqual([PATH_RUN]);
    expect(parseTestRunIds('', PATH_RUN)).toEqual([PATH_RUN]);
    expect(parseTestRunIds('  ,  , ', PATH_RUN)).toEqual([PATH_RUN]);
  });

  it('trims each id, since a comma-separated list is usually hand-spaced', () => {
    expect(parseTestRunIds('a, b ,c', PATH_RUN)).toEqual(['a', 'b', 'c']);
  });

  it('collapses duplicates, which would otherwise be read and returned once each', () => {
    expect(parseTestRunIds('a,b,a,b,a', PATH_RUN)).toEqual(['a', 'b']);
  });

  it('measures the cap after de-duplicating, not before', () => {
    // The cap bounds the work the server does, not the length of the string the caller sent.
    // 600 entries naming 2 distinct runs is 2 runs' worth of work.
    const repeated = Array.from({ length: MAX_AGGREGATED_TEST_RUNS + 100 }, (_, i) =>
      i % 2 === 0 ? 'a' : 'b',
    ).join(',');

    expect(parseTestRunIds(repeated, PATH_RUN)).toEqual(['a', 'b']);
  });

  it('accepts exactly the cap', () => {
    const atCap = Array.from({ length: MAX_AGGREGATED_TEST_RUNS }, (_, i) => `run-${i}`).join(',');

    expect(parseTestRunIds(atCap, PATH_RUN)).toHaveLength(MAX_AGGREGATED_TEST_RUNS);
  });

  it('rejects rather than truncates once past the cap', () => {
    // A silently shortened list returns an aggregate that looks complete but omits runs —
    // worse than an error the caller can act on.
    const overCap = Array.from(
      { length: MAX_AGGREGATED_TEST_RUNS + 1 },
      (_, i) => `run-${i}`,
    ).join(',');

    expect(() => parseTestRunIds(overCap, PATH_RUN)).toThrow(BadRequestException);
    expect(() => parseTestRunIds(overCap, PATH_RUN)).toThrow(
      new RegExp(`at most ${MAX_AGGREGATED_TEST_RUNS} runs \\(received ${MAX_AGGREGATED_TEST_RUNS + 1} distinct\\)`),
    );
  });
});
