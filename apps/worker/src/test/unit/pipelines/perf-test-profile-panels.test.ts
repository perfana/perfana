/**
 * `PERF_TEST_PROFILE_PANELS` (shared) is the profile SLO form's static copy of the panels
 * this pipeline writes on every perf-test dashboard, and the default uid regex must select
 * exactly the per-scenario dashboards. Both are literals on the other side; pin them here.
 */
import { describe, it, expect } from 'vitest';
import {
  PERF_TEST_PROFILE_PANELS,
  PERF_TEST_DASHBOARD_UID_PATTERN_DEFAULT,
} from '@perfana/shared/constants';
import {
  ALL_AGGREGATED_SCENARIO,
  METRIC_TYPE_PANEL_IDS,
  METRIC_TYPE_PANEL_NAMES,
} from '../../../constants/performance-metrics.js';
import { generateScenarioDashboardUid } from '../../../utils/uuid-generator.js';

describe('perf-test profile SLO constants', () => {
  it('lists every panel the pipeline writes, by id and title', () => {
    // Since v0.2.97.17 that includes the scenario-level panels (301-303): their single point
    // is written at `end_time - ramp_down`, inside the analysis window, so they get a
    // statistics row and an SLO on them can evaluate. See `scenarioMetricTime`.
    const fromWorker = Object.entries(METRIC_TYPE_PANEL_NAMES)
      .map(([id, title]) => ({ id: Number(id), title }))
      .sort((a, b) => a.id - b.id);
    expect([...PERF_TEST_PROFILE_PANELS].sort((a, b) => a.id - b.id)).toEqual(fromWorker);
    for (const id of [
      METRIC_TYPE_PANEL_IDS.SCENARIO_ERROR_COUNT,
      METRIC_TYPE_PANEL_IDS.SCENARIO_AVG_THREADS,
      METRIC_TYPE_PANEL_IDS.SCENARIO_MAX_THREADS,
    ]) {
      expect(PERF_TEST_PROFILE_PANELS.some((p) => p.id === id)).toBe(true);
    }
  });

  it('default uid pattern matches scenario dashboards, not the roll-up or the fallback', () => {
    // ponytail: JS RegExp here, Postgres ARE in grafana-sync — keep the pattern to the common subset.
    const re = new RegExp(PERF_TEST_DASHBOARD_UID_PATTERN_DEFAULT);
    expect(re.test(generateScenarioDashboardUid('T_WM_Zoek'))).toBe(true);
    expect(re.test(generateScenarioDashboardUid('AanvraagWwb'))).toBe(true);
    expect(re.test(generateScenarioDashboardUid(ALL_AGGREGATED_SCENARIO))).toBe(false);
    expect(re.test(generateScenarioDashboardUid('default'))).toBe(false);
    expect(re.test('some-grafana-uid')).toBe(false);
  });
});
