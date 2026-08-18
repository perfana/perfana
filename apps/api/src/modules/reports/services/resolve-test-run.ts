import { FindOneOptions, Repository } from 'typeorm';
import { TestRun } from '@perfana/shared';
import { withRequestEm } from '../../../common/db/request-em';

/**
 * A test run has two identifiers, and reporting endpoints are handed either one.
 *
 * `test_runs.id` is the internal uuid the UI puts in the links it builds. `test_runs.test_run_id`
 * is the human-readable name a person or a CI/CD pipeline knows, because it is what they handed
 * the load test tool.
 */
export const TEST_RUN_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Find a test run by either identifier.
 *
 * Two separate statements rather than one `id = :x OR test_run_id = :x`: a repeated named
 * parameter is sent once and Postgres types it from the first comparison it appears in, so the
 * uuid column types the parameter as uuid and a human id can never reach the second half of the
 * OR — it raises 22P02 instead.
 *
 * A uuid-shaped id is looked up as a uuid first and then falls through to the name column,
 * because nothing stops a person naming a run with something uuid-shaped. Falling through costs
 * one extra query in the rare miss and avoids answering "not found" for a run that exists.
 *
 * A human id skips the uuid lookup entirely — one query, not two.
 */
export async function findTestRunByEitherId(
  repo: Repository<TestRun>,
  testRunId: string,
  options: Omit<FindOneOptions<TestRun>, 'where'> = {},
): Promise<TestRun | null> {
  const em = withRequestEm(repo);

  if (TEST_RUN_UUID_RE.test(testRunId)) {
    const byUuid = await em.findOne({ ...options, where: { id: testRunId } });
    if (byUuid) return byUuid;
    // Shaped like a uuid but no row has it as an id — fall through and try it as a name.
  }
  return em.findOne({ ...options, where: { testRunId } });
}

/**
 * Resolve either identifier to the internal uuid, or null when no run matches.
 *
 * For callers that only need the uuid — `awr_reports.test_run_id` is a uuid foreign key onto
 * `test_runs(id)`, unlike the rest of the reporting tables, which are keyed by the human id.
 */
export async function resolveTestRunUuid(
  repo: Repository<TestRun>,
  testRunId: string,
): Promise<string | null> {
  const run = await findTestRunByEitherId(repo, testRunId, { select: ['id'] });
  return run?.id ?? null;
}
