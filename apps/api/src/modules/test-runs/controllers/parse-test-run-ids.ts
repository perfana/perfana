import { BadRequestException } from '@nestjs/common';

/**
 * Most runs a single request may fan out to.
 *
 * `testRunIds` arrives as an unbounded comma-separated string and every id costs an indexed
 * rollup read, so one request fans out in proportion to the list. Trends passes every run in the
 * selected range, which a wide range on a busy system makes arbitrarily long. The cap is far
 * above any range the UI builds — it exists so a hand-built URL cannot turn one request into
 * unbounded work.
 */
export const MAX_AGGREGATED_TEST_RUNS = 500;

/**
 * Parse the `testRunIds` query parameter into a bounded, de-duplicated list.
 *
 * Shared because two endpoints take this parameter and parsed it identically — the aggregate
 * metric endpoint and the Compare card's URL-metric endpoint. Capping one and not the other
 * left the bound trivially avoidable by calling the other.
 *
 * De-duplicates before measuring: the cap bounds the work the server does, not the length of
 * the string the caller happened to send, so 600 entries naming 40 distinct runs is 40 runs'
 * worth of work and is allowed through.
 *
 * Rejects rather than truncates. A silently shortened list returns an aggregate that looks
 * complete but omits runs, which is worse than an error the caller can act on.
 *
 * @param raw the comma-separated parameter, absent or empty when the caller wants one run
 * @param fallbackTestRunId the path run, used when the parameter names nothing
 */
export function parseTestRunIds(raw: string | undefined, fallbackTestRunId: string): string[] {
  const parsed = (raw ?? '')
    .split(',')
    .map(id => id.trim())
    .filter(id => id.length > 0);

  if (parsed.length === 0) return [fallbackTestRunId];

  const ids = [...new Set(parsed)];
  if (ids.length > MAX_AGGREGATED_TEST_RUNS) {
    throw new BadRequestException(
      `testRunIds accepts at most ${MAX_AGGREGATED_TEST_RUNS} runs (received ${ids.length} distinct); narrow the range and try again`,
    );
  }
  return ids;
}
