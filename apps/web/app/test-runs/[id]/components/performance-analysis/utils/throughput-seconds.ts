import { analysedSeconds } from '@perfana/shared/database/run-window';

/** The `/test-runs/:id` fields the divisor needs; the offsets arrive under their entity names. */
export interface ThroughputRunFields {
  duration?: number | null;
  start_time?: string | null;
  end_time?: string | null;
  analysis_start_offset?: number | null;
  analysis_end_offset?: number | null;
}

/**
 * The seconds a top-10 list divides its counts by to get a rate.
 *
 * With the analysis-window toggle on, the counts are for `[start + ramp_up, end - ramp_down)`,
 * so the divisor has to be that window, not the whole run: dividing by `duration` read 133/s for
 * a transaction the throughput graph showed at 199/s. `analysedSeconds` is the rule the API and
 * the report divide by, so the three agree. Never 0, so a caller can divide without a guard.
 */
export function throughputSeconds(run: ThroughputRunFields, excludeRampUp: boolean): number {
  const seconds = excludeRampUp
    ? analysedSeconds({
        duration: run.duration,
        start_time: run.start_time,
        end_time: run.end_time,
        ramp_up: run.analysis_start_offset,
        ramp_down: run.analysis_end_offset,
      })
    : (run.duration ?? 0);
  return seconds > 0 ? seconds : 1;
}
