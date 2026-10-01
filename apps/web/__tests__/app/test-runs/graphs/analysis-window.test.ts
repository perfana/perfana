/**
 * Boundary math for the ADAPT analysis window overlay.
 *
 * `chart-utils.test.ts` covers the common cases; this file covers the edges where
 * the two boundaries interact — a start offset that runs off the end of the data,
 * an end boundary that would land before the start, a single-sample run — and
 * exercises `analysisWindowShapes` directly rather than through the layout,
 * so the "nothing to dim" cases are pinned rather than inferred.
 */

import { calculateAnalysisWindowIndices } from '@/app/test-runs/[id]/components/graphs/utils/chart-utils';
import { analysisWindowShapes, chartTheme } from '@/lib/charts';
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

describe('analysisWindowShapes', () => {
  const theme = chartTheme('light');
  const empty = { shapes: [], annotations: [] };

  // The both-null case is already covered through the layout builder.
  it('emits nothing for a start boundary already at the first sample', () => {
    // startIndex 0 means the window starts at sample 0 — there is no leading
    // region to wash, and a zero-width rect would still paint a stray boundary line.
    expect(analysisWindowShapes(0, null, 10, theme)).toEqual(empty);
  });

  it('emits nothing for an end boundary already at the last sample', () => {
    expect(analysisWindowShapes(null, 9, 10, theme)).toEqual(empty);
  });

  it('emits nothing when there is nothing to draw on (0 or 1 samples)', () => {
    expect(analysisWindowShapes(null, null, 0, theme)).toEqual(empty);
    expect(analysisWindowShapes(0, 0, 1, theme)).toEqual(empty);
  });

  it('washes each excluded region and names its edge in mono, with no amber anywhere', () => {
    const { shapes, annotations } = analysisWindowShapes(3, 7, 10, theme) as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      shapes: Array<Record<string, any>>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      annotations: Array<Record<string, any>>;
    };
    expect(shapes).toHaveLength(4);

    const [leadRect, leadLine, tailRect, tailLine] = shapes;
    expect(leadRect).toMatchObject({
      type: 'rect', x0: 0, x1: 3, yref: 'paper', fillcolor: theme.excluded, layer: 'below',
    });
    expect(tailRect).toMatchObject({ type: 'rect', x0: 7, x1: 9, fillcolor: theme.excluded });

    // A hairline at half opacity, in `faint`. The amber (#f59e0b) this replaces was the
    // same colour the SLO charts used for a DATA series.
    for (const line of [leadLine, tailLine]) {
      expect(line.type).toBe('line');
      expect(line.line).toMatchObject({ color: theme.faint, width: 1 });
      expect(line.opacity).toBe(0.5);
      expect(JSON.stringify(line)).not.toContain('f59e0b');
    }
    expect(leadLine).toMatchObject({ x0: 3, x1: 3 });
    expect(tailLine).toMatchObject({ x0: 7, x1: 7 });

    expect(annotations.map((a) => a.text)).toEqual(['start', 'end']);
    expect(annotations[0]).toMatchObject({ x: 3, xanchor: 'left' });
    expect(annotations[1]).toMatchObject({ x: 7, xanchor: 'right' });
  });
});
