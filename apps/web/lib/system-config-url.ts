/**
 * Builds the URL of a system-under-test configuration page.
 *
 * Single owner of the query contract shared by every "open config from a test
 * run" link (SLO, dashboards, deep links, reporting, pyroscope, tracing):
 * `environment`/`workload` preselect the scope, `fromTestRun` makes the config
 * page's breadcrumb lead back to the originating test run.
 */
export function buildSystemConfigUrl(opts: {
  systemId: string;
  tab: string;
  environment?: string | null;
  workload?: string | null;
  fromTestRun?: string | null;
}): string {
  const params = new URLSearchParams({ tab: opts.tab });
  if (opts.environment) params.set('environment', opts.environment);
  if (opts.workload) params.set('workload', opts.workload);
  if (opts.fromTestRun) params.set('fromTestRun', opts.fromTestRun);
  return `/systems/${opts.systemId}/config?${params.toString()}`;
}
