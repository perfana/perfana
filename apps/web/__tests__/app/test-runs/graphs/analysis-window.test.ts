/**
 * Boundary math for the ADAPT analysis window overlay.
 *
 * `chart-utils.test.ts` covers the common cases; this file covers the edges where
 * the two boundaries interact — a start offset that runs off the end of the data,
 * an end boundary that would land before the start, a single-sample run — and
 * exercises `buildAnalysisWindowShapes` directly rather than through the layout,
 * so the "nothing to dim" cases are pinned rather than inferred.
 */

import {
  calculateAnalysisWindowIndices,
  buildAnalysisWindowShapes,
} from '@/app/test-runs/[id]/components/graphs/utils/chart-utils';
import { TestRun } from '@/types/test-runs';

function makeTestRun(overrides: Partial<TestRun> = {}): TestRun {
  return {
    id: 'test-run-uuid',
    test_run_id: 'run-1',
    system_name: 'sys',
    test_environment: 'env',
    workload: 'wl',
    completed: false,
    start_time: null,
    end_time: null,
    duration: null,
    planned_duration: null,
    analysis_start_offset: undefined,
    ...overrides,
  } as TestRun;
}

// 10 seconds apart, so an offset in seconds maps to a whole number of samples.
const T0 = '2024-01-01T00:00:00.000Z';
const T1 = '2024-01-01T00:00:10.000Z';
const T2 = '2024-01-01T00:00:20.000Z';
const T3 = '2024-01-01T00:00:30.000Z';
const T4 = '2024-01-01T00:00:40.000Z';
const FIVE = [T0, T1, T2, T3, T4];

describe('calculateAnalysisWindowIndices — boundary interaction', () => {
  it('resolves both boundaries independently when they do not overlap', () => {
    const run = makeTestRun({ analysis_start_offset: 10, analysis_end_offset: 10 });
    // start: first sample at or after 0s+10s → T1. end: first sample after 40s-10s → T4.
    expect(calculateAnalysisWindowIndices(run, FIVE)).toEqual({ startIndex: 1, endIndex: 4 });
  });

  it('clamps the end boundary to the start rather than letting it cross before it', () => {
    // Offsets sum to more than the run: the end boundary (10s) lands before the
    // start boundary (30s). Without the clamp the trailing dim would start at
    // index 2 and swallow the whole in-window region.
    const run = makeTestRun({ analysis_start_offset: 30, analysis_end_offset: 30 });
    expect(calculateAnalysisWindowIndices(run, FIVE)).toEqual({ startIndex: 3, endIndex: 3 });
  });

  it('keeps the clamp when the start offset itself runs past the last sample', () => {
    const run = makeTestRun({ analysis_start_offset: 9999, analysis_end_offset: 25 });
    // start clamps to the last index (2); the end boundary resolves to 0 and is
    // then pulled back up to 2 so it never precedes the start.
    expect(calculateAnalysisWindowIndices(run, [T0, T1, T2])).toEqual({ startIndex: 2, endIndex: 2 });
  });

  it('marks everything as excluded when the end offset spans the whole run', () => {
    const run = makeTestRun({ analysis_end_offset: 100 });
    expect(calculateAnalysisWindowIndices(run, FIVE)).toEqual({ startIndex: null, endIndex: 0 });
  });

  it('collapses both boundaries onto the only sample of a single-sample run', () => {
    const run = makeTestRun({ analysis_start_offset: 5, analysis_end_offset: 5 });
    expect(calculateAnalysisWindowIndices(run, [T0])).toEqual({ startIndex: 0, endIndex: 0 });
  });
});

describe('buildAnalysisWindowShapes', () => {
  const COLOR = '#e0e0e0';

  // The both-null case is already covered through buildChartLayout.
  it('emits nothing for a start boundary already at the first sample', () => {
    // startIndex 0 means the window starts at sample 0 — there is no leading
    // region to dim, and a zero-width rect would still paint a stray boundary line.
    expect(buildAnalysisWindowShapes(0, null, 10, COLOR)).toEqual([]);
  });

  it('emits nothing for an end boundary already at the last sample', () => {
    expect(buildAnalysisWindowShapes(null, 9, 10, COLOR)).toEqual([]);
  });

  it('emits nothing when there is nothing to draw on (0 or 1 samples)', () => {
    expect(buildAnalysisWindowShapes(null, null, 0, COLOR)).toEqual([]);
    expect(buildAnalysisWindowShapes(0, 0, 1, COLOR)).toEqual([]);
  });

  it('dims with the supplied colour and marks each boundary in amber dashes', () => {
    const shapes = buildAnalysisWindowShapes(3, 7, 10, COLOR) as Array<Record<string, any>>;
    expect(shapes).toHaveLength(4);

    const [leadRect, leadLine, tailRect, tailLine] = shapes;
    expect(leadRect).toMatchObject({
      type: 'rect', x0: 0, x1: 3, yref: 'paper', fillcolor: COLOR, opacity: 0.3, layer: 'below',
    });
    expect(tailRect).toMatchObject({ type: 'rect', x0: 7, x1: 9, fillcolor: COLOR, opacity: 0.3 });

    // Amber dashed, matching the SLO and Compare charts.
    for (const line of [leadLine, tailLine]) {
      expect(line.type).toBe('line');
      expect(line.line).toMatchObject({ color: '#f59e0b', width: 1.5, dash: 'dash' });
    }
    expect(leadLine).toMatchObject({ x0: 3, x1: 3 });
    expect(tailLine).toMatchObject({ x0: 7, x1: 7 });
  });
});
